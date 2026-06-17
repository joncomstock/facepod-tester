# FacePod Tester — Consume Phase 2 lib surface (positioning feedback + device parameters)

**Date:** 2026-06-16
**Status:** Design for review (pre-plan) — revised after independent review
**Repo:** `facepod-tester` (React+Vite front-end / Deno+Hono backend)
**Depends on:** `hardware-libs` `feature/facepod` @ `7658b00` (already pushed) — the `@eai/hid/facepod` package now exposes positioning feedback, landmarks, and read-only device parameters.

---

## 1. Background & goal

The Live HUD redesign shipped (PR #1, merged). It currently shows: the detected-face
image, three threshold bars (Quality / Liveness / Match), an ACCEPT/REJECT verdict, and
**derived** positioning guidance (a heuristic from bbox area + faceStatus).

`hardware-libs` has since landed **two of the four** Phase 2 items:

- **Item 3 — DONE:** `CaptureResult.positioningFeedback` (decoded `HFPositioningFeedback`
  bitmask) and `CaptureResult.landmarks` (5 points), available on the **final** capture result.
- **Item 4 — DONE:** read-only `getParameters()` → `DeviceParameters` (~33 device config
  fields incl. the device's real recognition thresholds).

NOT yet landed (still Phase 2, separate `hardware-libs` plan — **out of scope here**):

- **Item 1:** `HFGetVideoFrame` / `getVideoFrame()` seam — the full-frame video stream.
- **Item 2:** per-frame **intermediate-result** streaming (live overlay while a face approaches).
  Today positioning/landmarks arrive only on the finalized capture, not streamed.

**Goal (front-end + tester backend only; `hardware-libs` is untouched):** consume what
items 3 & 4 already expose —
(a) replace the derived guidance with **real** `positioningFeedback` when present,
(b) surface the device's **real configured thresholds and full parameters as read-only
reference**,
(c) surface landmark/bbox **data** (no visual overlay yet — deferred to Phase 2).

### 1.1 Honest value statement (from review)

On **real hardware**, positioning is parsed only from the **finalized** capture, and a face
finalizes only when it is *already* well-positioned — so `positioningFeedback` will usually
be `ok` (raw 0), and rich corrective strings ("Turn right", "Lower head") will rarely fire
until **Item 2** (intermediate streaming) lands. Near-term hardware value is therefore:
the **device-parameters reference panel**, honest `ok`/`unknownBits` **data**, and a clean
seam ready for Item 2. The corrective-guidance strings are primarily exercised by the
**mock** until Item 2. This is acceptable: the work is the consumer-side foundation, built
and demoable now, with no wasted effort when Item 2 arrives.

## 2. Grounding facts (verified against code in independent review)

### New lib surface (`hardware-libs/hid/facepod/src/types.ts`, `hidFaceAbi.ts`)

```ts
interface PositioningFeedback {
  raw: number;          // raw HFRESULT_INT_POSITIONING_FEEDBACK
  ok: boolean;          // raw === 0 (HFPOSITION_OK)
  flags: string[];      // set known bits, e.g. ["GET_CLOSER","TURN_RIGHT"]; empty when ok
  unknownBits: number;  // set bits not in the recovered enum; 0 when none
}
// POSITIONING_BITS (hidFaceAbi.ts:142): GET_CLOSER(1) MOVE_AWAY(2) TURN_RIGHT(4)
//   TURN_LEFT(8) LIFT_HEAD(16) LOWER_HEAD(32) TILT_RIGHT(64) TILT_LEFT(128)

interface DeviceParameters { /* 33 numeric fields; recognition thresholds: */
  recMinVerifyTemplateQuality: number;  // device's configured quality threshold
  recMaxSpoofProbability: number;       // device's configured spoof ceiling
  recMinMatchScoreL1: number;           // device's configured match floor (L1/L2/L3 exist)
  minDistance; maxDistance; minRoll; maxRoll; minPitch; maxPitch; minYaw; maxYaw;
  margin; onlyCenteredFaces; /* …camera/exposure/ms fields (NOT 0..1 normalized)… */
}

interface CaptureResult {
  quality; numberOfFaces; template?; image?; liveness;
  boundingBox?; landmarks?;                    // already present
  positioningFeedback?: PositioningFeedback;   // NEW — add to src/api.ts
  isCaptured; faceStatus?;
}
interface Landmark { type?: string; x: number; y: number }  // SOURCE-FRAME coords
```

Verified: `getParameters()` on the facade (`faceModule.ts:48`); **requires an open camera** —
the facade guard `#requireOpen()` (`faceModule.ts:49`) fires first on the tester's call path
(`this.#require().device.getParameters()`), with defense-in-depth in the FFI client
(`hidFaceFfiClient.ts:65`). Validates "fetch on Go Live (camera online)". Re-exported from
`mod.ts:64-86`. Null/mock seam returns `zeroDeviceParameters()` (`client.ts:47`).
Pure HFGetParam reads are "safe outside the #enterOp lock" at the lib layer
(`hidFaceFfiClient.ts:66`) — but the tester's own `#track` busy-lock still serializes them
against the watch loop (see §6).

**`Landmark.type` stays `string`:** `src/api.ts:72` already types it loosely; this is
**retained intentionally** (landmarks are data-only here, §4.5). Do NOT tighten it to the
lib's `LandmarkType` union when adding the other types.

### Current tester seams (verified)

- **Capture passthrough:** `POST /api/capture` returns the lib result whole
  (`server/main.ts:213`; `facepodSession.ts:280-288`) — no whitelist, so positioning/landmarks
  serialize once `src/api.ts` types them.
- **`FaceModuleClient.getParameters()` is NON-optional** (`client.ts:30`). The tester's own
  mock `DeterministicMockClient` (`server/mockClient.ts:91`) does not implement it yet → the
  tester **fails type-check** against the new lib version until the mock adds it. **This is a
  build prerequisite (Step 0), not a feature step.**
- **Match gate is host-supplied, NOT device-driven:** the match pass/fail is
  `matchScore >= minimalMatchScore` using the host value (`hidFaceFfiClient.ts:194`; mock
  `mockClient.ts:257`). Device `recMinMatchScoreL1/L2/L3` never enter that comparison.
- **CSRF gate allows GET with header only** (`security.ts:62` — JSON content-type required
  only for non-GET/HEAD), so `GET /api/parameters` behaves like `/api/cameras`.
- **UI threshold state** (`App.tsx:42-47`): `thresholds` + `minimalMatchScore`; bars + verdict
  gate on these (`src/live/logic.ts` `barState`, `computeVerdict`). Guidance: `deriveGuidance`
  (`logic.ts:78`). Watch loop (`useWatchLoop.ts`) fires `api.capture` ~every 150ms in Live mode,
  each taking the session `#track` busy-lock; it swallows/retries `BusyError`.

## 3. Design decisions (resolved)

1. **Guidance:** real `positioningFeedback.flags` → friendly strings as primary; fall back to
   the derived heuristic only when the field is absent. Drop the "derived" label when real data
   is present. (Value caveat: §1.1.)
2. **Device thresholds = READ-ONLY REFERENCE (no gate change).** The verdict gate stays on the
   operator-set thresholds exactly as today — device params do **not** seed or alter it. Device
   values are shown as: (a) a full read-only **Device Parameters** panel (Manual mode), and (b)
   an optional secondary "device" reference tick on the Live bars (visually distinct from the
   operator gate marker; informational only). Rationale: device match thresholds do not gate the
   tester's match (`hidFaceFfiClient.ts:194`), so seeding the gate from them would make ACCEPT/
   REJECT hinge on an unrelated number. Reference-only removes that risk and the `overridden`-
   tracking complexity entirely.
3. **Fetch timing:** read once on Go Live, **after `openCamera` succeeds and before the watch
   loop starts** (so nothing else holds the busy-lock). Cache for the session; **invalidate on
   disconnect / End session**. Manual **Refresh** control that tolerates/retries `BusyError`
   (in Live mode the watch loop is always contending). No polling.
4. **Landmarks/bbox:** **data only** (count + points + bbox + positioning raw/flags/unknownBits
   in the data/debug area). **No visual overlay** — Feed shows the *cropped* face while coords
   are *source-frame*. `Feed`'s inert overlay props untouched. **Capture-only** for now;
   `ProcessResult` (reference-image) landmarks are not surfaced this round.

## 4. Component design

### 4.0 Step 0 — build prerequisite

`server/mockClient.ts`: implement `getParameters(): Promise<DeviceParameters>` on
`DeterministicMockClient` so the tester type-checks against the pinned lib. (Then extend it in
§4.1.) Verify `deno task check` passes before any feature work.

### 4.1 Backend (Deno/Hono)

- `FacePodSession.getParameters(): Promise<DeviceParameters>` — `#track(() =>
  this.#require().device.getParameters())` (busy-locked like other ops).
- `GET /api/parameters` → `{ parameters }`; behind the existing header gate; read-only.
  Not-connected → existing 409 `NotConnectedError`; camera-not-open → the lib's
  `#requireOpen()` error (mapped via `normalizeError`).
- Mock (`server/mockClient.ts`): deterministic `getParameters()` returning a realistic
  `DeviceParameters` with values **distinct from the UI defaults** so the reference tick is
  visibly offset (e.g. `recMinVerifyTemplateQuality: 0.65`, `recMaxSpoofProbability: 0.5`,
  `recMinMatchScoreL1: 0.8`, plausible others). **Landmarks already exist in the mock
  fixtures** (`mockClient.ts:154-158,191-195`) — the new fixture work is adding
  `positioningFeedback` (absent today) to the capture results; the `approach` scenario ramps
  an **on-device-confirmed** corrective bit (e.g. `TURN_RIGHT(4)` or `LOWER_HEAD(32)`) → `ok`,
  NOT the never-observed distance bits. Label the fixture as synthetic in a comment.

### 4.2 UI data layer (`src/api.ts`)

- Add `PositioningFeedback`, `DeviceParameters` types (mirror lib).
- Add `positioningFeedback?: PositioningFeedback` to `CaptureResult`.
- Add `api.getParameters(): Promise<{ parameters: DeviceParameters }>`.

### 4.3 Live logic (`src/live/logic.ts`, `src/live/types.ts`)

- `LiveFrame` gains `positioningFeedback: PositioningFeedback | null` and
  `landmarks: Landmark[] | null`; `toLiveFrame` carries them.
- Pure `positioningGuidance(fb): string[]` — flag→string map (`GET_CLOSER`→"Move closer",
  `MOVE_AWAY`→"Move back", `TURN_RIGHT`→"Turn right", `TURN_LEFT`→"Turn left",
  `LIFT_HEAD`→"Lift your head", `LOWER_HEAD`→"Lower your head", `TILT_RIGHT`→"Tilt right",
  `TILT_LEFT`→"Tilt left"); `ok`→`[]`. `unknownBits` is excluded from text.
- `guidanceFor(frame): { text: string | null; derived: boolean }` — real when
  `positioningFeedback` present (join flags; "Hold still" when `ok` && !isCaptured), else
  derived heuristic. `deriveGuidance` retained as fallback.

### 4.4 Device-parameters reference (read-only)

- **State owner: `App`**, via a `useDeviceParameters(api)` hook exposing
  `{ params, error, fetch(), clear() }`. `App` already owns `status`, `thresholds`, and the
  mode toggle, and **both** Live and Manual need the params — so one shared cache lives in
  `App`, passed down to `LiveView` and `ManualView`. (Rejected: LiveView-local state, which
  Manual couldn't read.)
- **Fetch triggers:**
  - **Live:** `goLive` calls `fetch()` after `openCamera` succeeds and **before**
    `setWatching(true)` — the busy-lock is free there (`LiveView.tsx:57-60`).
  - **Manual:** the panel's **Refresh** button is the only trigger; it is **disabled unless
    `status.cameraOpen`** (getParameters requires an open camera). A Refresh with the camera
    closed is prevented by the disabled state; any mapped error still renders as the non-fatal
    "unavailable" note, never a hard failure.
- **Cache clear:** `clear()` is called from BOTH reset paths — `LiveView.endSession`
  (`LiveView.tsx:69-80`) and Manual `handleDisconnect` (`App.tsx:105-112`) — since either can
  end the session.
- **Live bars (`Telemetry.tsx` `Bar`):** verdict + operator markers UNCHANGED. Add a new
  optional `deviceThreshold?: number` prop to `Bar` rendering a **second, visually distinct**
  "device" tick for the three recognition thresholds: quality←`recMinVerifyTemplateQuality`
  and match←`recMinMatchScoreL1` (floors, like their operator markers), spoof←
  `recMaxSpoofProbability` (a **ceiling/max** marker, matching the Liveness bar's
  `higherPasses={false}`). Only these three are 0..1; do NOT feed any other params into bar
  math.
- **Manual mode:** read-only **DeviceParametersPanel** — grouped table (recognition / camera /
  geometry / exposure) rendering raw values as-is (ints/ms shown plainly, NOT via `barState`),
  with the Refresh button (gated as above).

### 4.5 Landmarks/bbox data surface

New **`LiveDataDisclosure`** component (collapsible, rendered in `LiveView` below the
Telemetry/ActionDock; Live mode has no data disclosure today). Shows, from the current
`LiveFrame` (which §4.3 extends with `landmarks` + `positioningFeedback`): face count, bbox
(x/y/w/h), landmark count + points, and `positioningFeedback` raw/flags/unknownBits. No
overlay; capture-only.

### 4.6 Places new fields must be threaded (checklist)

`server/mockClient.ts` (getParameters + positioningFeedback) · `server/facepodSession.ts`
(getParameters method) · `server/main.ts` (route) · `src/api.ts` (types + getParameters +
CaptureResult field) · `src/live/types.ts` (LiveFrame fields) · `src/live/logic.ts`
(toLiveFrame + positioningGuidance + guidanceFor) · `src/components/live/Telemetry.tsx`
(Bar `deviceThreshold` prop) · new `LiveDataDisclosure` · new `DeviceParametersPanel` ·
`src/App.tsx` (useDeviceParameters owner + clear wiring) · `LiveView`/`ManualView` (props).

## 5. Data flow

`device/mock → CaptureResult{positioningFeedback,landmarks} → /api/capture (passthrough) →
api.ts CaptureResult → toLiveFrame → guidanceFor → HUD guidance line + data area`

`Go Live: openCamera → getParameters() → /api/parameters → cache → device reference ticks +
DeviceParametersPanel` (gate thresholds untouched)

## 6. Error handling

- `/api/parameters` not-connected → 409; camera-not-open → mapped error. **UI: params fetch
  failure is non-fatal** — bars render with operator thresholds only (no device tick); a small
  "device parameters unavailable" note shows; Refresh can retry.
- Params fetch vs watch loop: the **initial** Live fetch is contention-free (sequenced before
  `setWatching(true)`). A **Refresh during Live watching** would race the ~150ms capture loop
  for the `#track` lock, and a single retry can't guarantee a gap — so Refresh in Live
  **pauses the watch loop** for the fetch: `setWatching(false)` → `fetch()` →
  `setWatching(true)` (deterministic, no 409). In Manual mode there is no loop, so Refresh
  fetches directly (gated on `cameraOpen`).
- Guidance falls back to derived when `positioningFeedback` absent.

## 7. Testing

- **Vitest (pure):** `positioningGuidance` (each flag, multi-flag, `ok`→`[]`, `unknownBits`
  excluded from text); `guidanceFor` (real vs fallback, `derived` flag, `ok`&&!captured→"Hold
  still"); `toLiveFrame` carries `positioningFeedback`+`landmarks`.
- **Deno (backend):** `/api/parameters` happy path + not-connected 409; mock `getParameters`
  shape (values distinct from defaults); mock capture fixtures include positioning/landmarks
  with an on-device-confirmed bit.
- **Manual E2E (mock):** Go Live fetches params (device tick offset from operator marker, since
  mock values differ); `approach` shows real guidance strings; DeviceParametersPanel renders;
  verdict gate unchanged; params clear on End session; no regressions.

## 8. Out of scope (Phase 2, separate `hardware-libs` plan)

Full-frame `HFGetVideoFrame` feed; per-frame intermediate-result streaming; visual
landmark/bbox overlay; `ProcessResult` landmark surfacing; any `setParameters` write path
(gated set-probe, not approved).

## 9. Constraints

- `hardware-libs` is **read-only** here — consume `@eai/hid/facepod` as published.
- No biometric data-at-rest; reference templates remain in-memory/session only.
- Liveness/verdict never fabricated — fail closed. Verdict gate stays operator-set.
- Commits carry NO Claude/AI attribution.
