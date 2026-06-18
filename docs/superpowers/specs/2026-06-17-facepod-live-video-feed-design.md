# FacePod Tester — Live Video Feed + Live Detection Overlay (Phase 2 consume) — Design

**Date:** 2026-06-17
**Repo:** `facepod-tester` (consumes `hardware-libs` `@eai/hid/facepod` by local-path import; **hardware-libs is NOT modified**)
**Base branch:** `main` (see Grounding §0 — the prior `feature/consume-phase2-params` work is already merged into `main`)
**Status:** approved in brainstorming; ready for an implementation plan.

---

## 0. Grounding (verified against the actual code, 2026-06-17)

- **hardware-libs** is on `feature/facepod` tip `384761b`. The Phase 1 seam is present and exported from `@eai/hid/facepod`:
  - `FaceModule.getVideoFrame(lastSeq?: bigint): Promise<VideoFrame | null>` — pure read, **bypasses the lib op-lock**, can run concurrently with an in-flight `captureAndProcess`. Unguarded against teardown: the caller MUST stop calling it before `close()`/`disconnect()`/`dispose()`.
  - `FaceModule.captureAndProcess(opts, signal?, onIntermediate?: (snap: LiveSnapshot) => void | Promise<void>)` — streams per-frame snapshots while the op runs; the lib isolates callback errors (fire-and-forget).
  - `VideoFrame { bytes: Uint8Array; format: "png"|"jpg"|"jpeg"; seq: bigint }`.
  - `LiveSnapshot { numberOfFaces: number; quality?: number; boundingBox?: {x,y,width,height}; landmarks?: {type?,x,y}[]; positioningFeedback?: {raw,ok,flags,unknownBits} }` — **decoded** positioning, same vocabulary as `CaptureResult`. **Note what it does NOT carry: no liveness/spoof, no match, no `isCaptured`.**
- **Import wiring is correct.** `deno.jsonc` maps `@eai/hid/facepod` → `../hardware-libs/hid/facepod/mod.ts`; `deno check` confirms the tester resolves the new seam. **No import-map change required.**
- **CORRECTION vs. the kickoff brief:** `feature/consume-phase2-params` was **merged to `main`** (PR #2, commit `98be5e6`) and the remote branch deleted. The video work branches off **`main`**, which already contains the Telemetry bars, ACCEPT/REJECT verdict, device-threshold ticks, and derived positioning guidance.
- **CRITICAL — the tester does not currently compile against the Phase 1 seam.** Phase 1 added `getVideoFrame` to the `FaceModuleClient` *interface*; `DeterministicMockClient` (`server/mockClient.ts:92`) does not implement it, so `deno check` fails with 2 errors. Restoring green is a **prerequisite task (Task 0)**, not a feature.
- **On-device probe findings** (`hardware-libs/.../docs/video-frame-probe-findings.md`), treated as settled:
  - Frames are **JPEG, 1080×1920 portrait**, ~86–100 KB; **~7.5–7.9 fps idle, ≥~12.8 fps during capture**. No warm-up needed.
  - **CONCURRENT:** `getVideoFrame` never returns BUSY during an in-flight capture — feed lane and capture lane are two independent streams.
  - **REGISTERED:** bbox + 5 landmarks fall inside the 1080×1920 raster → overlay drawn directly on the full frame with **no coordinate-space transform** (display *scaling* is still required — see §4).
  - **Quality streams live** during the intermediate phase.
  - **No intermediate-result seq exists** — the i64 video-frame `seq` is the only cursor; snapshots may duplicate and **cannot be proven to correspond to a specific frame**.
  - `HFERROR_ALREADY_RETURNED` is the natural "no new frame yet" backpressure signal, surfaced as `getVideoFrame` → `null`.
- **Existing tester facts:** single-op busy lock `#track` (`server/facepodSession.ts:154` — every device op 409s if one is in flight); browser watch loop of short capture ops (`src/live/useWatchLoop.ts`); CSRF gate (`server/security.ts`, `server/main.ts:53` — `x-facepod-tester` header required on **every** method, JSON content-type required only on **non-GET**); feed image styled `object-fit: cover` (`src/styles.css:564`); `.bbox` overlay positioned in raw px (`src/styles.css:579`).

---

## 1. Goal & scope

Deliver a real **full-frame live video feed** in the Live HUD with a **visual bounding-box + landmark overlay** drawn on the frame, plus per-frame live telemetry — consuming the Phase 1 seam unmodified.

**In scope:**
- **Core:** full-frame feed (source A = `getVideoFrame`), a frame endpoint (poll), and the bbox + landmark overlay drawn on the live frame.
- **Live telemetry** (quality / face-count / positioning guidance) streaming per-frame from the intermediate snapshot; liveness / match / verdict at capture cadence.
- **Capture-and-hold reference** for match% (in-memory, session-only) — *separate task*.
- **Derived brightness/distance hints** off the frame, labeled "derived, not HID-measured" — *separate task*.

**Out of scope / forbidden:** any change to hardware-libs; browser `getUserMedia`/UVC feed (camera held exclusively → source A only); REST/NetHFAPI; any enroll/gallery/data-at-rest; setParameters writes; a combined capture+match endpoint (YAGNI).

---

## 2. Architecture — two independent lanes (browser-orchestrated)

The overlay **pixels** come from `getVideoFrame()` (pure read, ~8 fps); the overlay **metadata** (bbox / landmarks / quality / positioning) comes only from a running capture op's `onIntermediate`. Both are server-side sources combined and shipped to the browser. The browser owns both timers.

```
LANE 1 — FEED + OVERLAY (smooth, ~8 fps)        LANE 2 — CAPTURE + MATCH (per ~1.5s op)
browser useFramePoll                            browser useWatchLoop (existing, extended)
 └ GET /api/video-frame?lastSeq=<seq>            └ POST /api/capture        (#track-serialized)
     server getVideoFrame()  ← BYPASSES #track   └ POST /api/match (only if reference held)
     + reads session.latestSnapshot buffer            server captureAndProcess(opts, signal,
     returns discriminated {frame|null, snapshot,                              onIntermediate)
              snapshotAgeMs, captureId,                  └ each snapshot → session.latestSnapshot
              sessionGeneration}                     final CaptureResult → CaptureFrame (verdict,
                                                                            liveness, isCaptured)
```

**Lane 2 is two ops** (capture, then conditional match) exactly as `useWatchLoop` does today — both serialized by `#track`. No combined endpoint.

### 2.1 What rides which lane (dictated by the seam)

| Signal | Source | Lane / cadence |
| --- | --- | --- |
| Frame pixels | `getVideoFrame()` | Lane 1, ~8 fps |
| Face present / count | `LiveSnapshot.numberOfFaces` | Lane 1, per-frame |
| **Live quality bar** | `LiveSnapshot.quality` | Lane 1, per-frame |
| **bbox + landmarks overlay** | `LiveSnapshot.boundingBox` / `.landmarks` | Lane 1, per-frame |
| **Positioning guidance line** | `LiveSnapshot.positioningFeedback` (decoded) | Lane 1, per-frame |
| Feed glow (present / searching) | live face-count | Lane 1, per-frame |
| **Liveness / spoof bar (fail-closed)** | `CaptureResult.liveness` | Lane 2, per-op |
| **Match % bar** | `MatchResult` (needs reference) | Lane 2, per-op |
| `isCaptured` | `CaptureResult.isCaptured` | Lane 2, per-op |
| **ACCEPT / REJECT verdict chip** | `CaptureFrame` only | Lane 2, per-op |

### 2.2 Two separate client state shapes — live never feeds the verdict

- **`LiveSnapshotState`** (from `LiveSnapshot`, per-frame): face-count, live quality, bbox, landmarks, positioning. Drives the overlay, guidance line, live quality bar, and the feed glow.
- **`CaptureFrame`** (today's `LiveFrame`, renamed; from final `CaptureResult` + optional `MatchResult`): quality (final), liveness, match, `isCaptured`. Drives the verdict, liveness bar, match bar.
- `computeVerdict()` consumes **only `CaptureFrame`** — authoritative, final values. The live quality bar (intermediate) and the verdict's quality gate (final) may transiently diverge; that is intentional and honest — the verdict is authoritative. The feed glow uses live face-count for responsiveness; the verdict chip uses `CaptureFrame` for authority. These are deliberately decoupled.

### 2.3 Frame/snapshot alignment is best-effort (known limitation)

Intermediate results carry **no frame sequence** (probe Q3b). `captureId` + `sessionGeneration` prevent stale-**operation** and stale-**session** mixing, but **cannot prove the overlay box matches the exact frame it is drawn on** — frame and snapshot are temporally close, not synchronized. The overlay is therefore only ever painted **alongside a fresh frame** (§5.2), never advanced on a frozen frame.

---

## 3. Server changes

### 3.1 Task 0 — restore green (prerequisite)

`DeterministicMockClient` must implement the expanded `FaceModuleClient` and stay **lockstep** with real data (no false test confidence):

- `getVideoFrame(lastSeq?: bigint): Promise<VideoFrame | null>` that genuinely exercises concurrency:
  - **honors `lastSeq`** and returns `null` for backpressure (nothing newer than the cursor yet);
  - **increments a monotonic frame `seq`**;
  - returns a **valid, known-size image** (e.g. a fixed W×H PNG/JPEG) whose dimensions match the synthetic bbox/landmark coordinates the capture path emits.
- `captureAndProcess(opts, signal?, onIntermediate?)`:
  - **emits several intermediate snapshots over an asynchronous capture interval** (spaced `await`s), not a single synchronous result;
  - **supports abort** via `signal`;
  - the `approach` scenario streams a ramping sequence so the full live feature demos with no hardware.

Acceptance for Task 0: `deno check` and `deno test` green again.

### 3.2 `facepodSession.ts`

- **`getVideoFrame(lastSeq?: bigint)`** — **bypasses `#track`** (pure read, mirroring the lib). Guarded by a **frame-gate**: a `#closing` flag + an in-flight frame-read counter. Returns `null` immediately if `#closing`; otherwise increments the counter, calls `device.getVideoFrame`, decrements in `finally`.
- **`latestSnapshot` buffer** holding `{ snapshot: LiveSnapshot, captureId: number, monotonicAtWrite: number }` where `monotonicAtWrite = performance.now()`. Plus `#captureId` and `#sessionGeneration` counters.
- **`capture()` / `captureAndMatch()`** forward an `onIntermediate` callback that writes the buffer tagged with the current `#captureId`. The buffer is **cleared at op start** (so a prior op's snapshot never lingers) and `#captureId` is incremented at op start.
- **`#sessionGeneration`** increments on every successful `connect()`; reset clears `latestSnapshot`.
- **Teardown quiesce:** `disconnect()` / `#teardown()` set `#closing = true`, **await the in-flight frame-read counter to drain**, *then* `dispose()`. This honors the lib's "stop calling getVideoFrame before dispose()" contract server-side. `forceDispose()` (SIGINT/SIGTERM) still bypasses for emergency release.

### 3.3 `main.ts` + `security.ts`

- **`GET /api/video-frame?lastSeq=<string>`** behind the **same CSRF gate** (header alone suffices for GET; no change to `security.ts` logic needed). `seq` is **string-encoded** in the query and the response — the bigint is never narrowed to `number`.
- **Discriminated response** (frame may be absent — `getVideoFrame` returns `null`):
  - no new frame: `{ frame: null, snapshot: <LiveSnapshot|null>, snapshotAgeMs: <number|null>, captureId, sessionGeneration }`
  - fresh frame: `{ frame: { datatype, data, seq }, snapshot, snapshotAgeMs, captureId, sessionGeneration }`
  - `data` is base64 of the frame bytes; `seq` is a string; `datatype ∈ {png,jpg,jpeg}`.
- **`snapshotAgeMs` is computed server-side from monotonic time** (`performance.now() - latestSnapshot.monotonicAtWrite`). Any wall-clock value is diagnostic only and must not drive fading.
- **No biometric data-at-rest:** frame bytes are base64'd in-request and returned; **never logged, cached, or written to disk**. The `latestSnapshot` and reference template live only in memory for the session.

---

## 4. Overlay coordinate mapping (the registration fix)

The frame is 1080×1920; the feed element renders smaller. The current `.feed-img { object-fit: cover }` (`styles.css:564`) **crops** the image, so percentage scaling of the raw-px `.bbox` (`styles.css:579`) is wrong — the visible image origin/scale is shifted by the cover crop.

**Primary approach — shared 9:16 contain media layer.** Render the feed in a media box with **`aspect-ratio: 9 / 16`** (matching 1080×1920), sized to fit the available height budget on the 800×1280 portrait kiosk. The frame image fills that box with **no cover-crop**, and the overlay is a **sibling absolutely-positioned layer in the same box** using **percentage coordinates** of the natural 1080×1920 raster (`left = x/1080`, `top = y/1920`, etc.). Because the box is exactly 9:16, there is no letterbox and percentages map 1:1 — no offset math.

**Fallback (only if layout forces a non-9:16 box):** compute the `contain` (or `cover`) scale and X/Y offsets from natural vs. rendered dimensions and apply them to overlay coordinates. Prefer the exact-ratio box to keep the math trivial.

The portrait 9:16 feed is tall-and-narrow on the kiosk; the §5 layout (UI-FEEDBACK §5) adapts the feed region to a portrait media box rather than the earlier landscape sketch.

---

## 5. Client changes

### 5.1 `useFramePoll` hook (new)

Mirrors `useWatchLoop`'s lifecycle. Polls `GET /api/video-frame?lastSeq=<lastSeq>`, **de-dups by `seq`**, and exposes the newest `videoFrame` + `LiveSnapshotState`. Idle poll target ≈ 8 fps (~125 ms); may poll faster while a capture is active. `lastSeq` carried as a string.

### 5.2 Frame/snapshot consumption rule

The overlay is **only displayed alongside a fresh frame.** When the response has `frame: null`, the client keeps the prior frame + overlay and does **not** advance the overlay from a snapshot-only update. This keeps the overlay locked to a real frame and reinforces best-effort alignment (§2.3).

### 5.3 Stale-overlay fade policy

Driven by server `snapshotAgeMs`: retain the last box, **begin fade at ≈300 ms, remove at ≈600 ms.** A snapshot whose `captureId` ≠ the current op or whose `sessionGeneration` ≠ the current session is discarded immediately, before age is considered.

### 5.4 `Feed.tsx`

The full frame becomes the feed image (`videoFrame` already preferred over `frame.image`). Replace the raw-px `.bbox` with the §4 percentage overlay inside the 9:16 media box; draw the bbox + 5 landmark dots; apply the §5.3 fade.

### 5.5 `Telemetry.tsx`

Quality bar ← `LiveSnapshotState` (live). Liveness / match bars + verdict chip ← `CaptureFrame`. Device-threshold ticks and bar internals already exist — minimal rewiring of the data source, not a rebuild.

### 5.6 Teardown (`stopAndDrain`) — concrete mechanics

Today `useWatchLoop` only flips a boolean and cannot await an in-flight capture; browser fetches carry no abort signal. The new design defines, for **both** hooks:

- An **`AbortController`** per hook; its `signal` is passed to `fetch`. The capture endpoint reads the **request abort signal** (`c.req.raw.signal`) and propagates it into `captureAndProcess(opts, signal)` — so a client abort tears down the server-side device op too.
- Each hook retains its **in-flight request promise** in a ref.
- **`stopAndDrain(): Promise<void>`** = set `active = false` → `abortController.abort()` → `await` the retained in-flight promise (swallowing `AbortError`).

`LiveView.endSession()` is reordered to honor the teardown contract:

1. `useFramePoll.stopAndDrain()` (stop frame polling, await in-flight frame request)
2. `useWatchLoop.stopAndDrain()` (abort + drain capture/match)
3. `POST /api/disconnect` (server flips `#closing`, drains frame-reads, disposes)
4. clear `LiveSnapshotState`, `CaptureFrame`, reference template, session state.

### 5.7 Reference / match% (separate task)

Keep the existing **upload** path. Add **"Use current face → reference"** which **reuses the latest finalized template** already held from Lane 2's most recent `CaptureFrame` — it does **not** launch another capture op (no contention with Lane 2). Both reference sources are **in-memory, session-only**, cleared on disconnect. No enroll/gallery/data-at-rest.

### 5.8 Derived hints (separate task)

Browser-side, **throttled** (every Nth frame, not all ~8 fps) to bound kiosk CPU:
- **Brightness** via offscreen-canvas luminance histogram off the rendered frame.
- **Distance** via bbox-area proxy.

Rendered in a **visually distinct "Derived — not HID-measured"** row, never mixed with the measured telemetry bars (fail-closed trust).

---

## 6. Task decomposition (ordering preserves a shippable core)

1. **Task 0 — mock seam parity** (`getVideoFrame`, async multi-snapshot `captureAndProcess` w/ abort, lockstep image/coords). Restores `deno check`/`deno test` green. *Blocks everything.*
2. **Server frame lane** — `getVideoFrame` bypass + frame-gate quiesce; `latestSnapshot` buffer w/ `captureId`/`sessionGeneration`/monotonic age; `capture()` forwards `onIntermediate`; `GET /api/video-frame` (discriminated response, string seq, CSRF gate).
3. **Client frame lane + feed** — `useFramePoll`; `Feed.tsx` full-frame + 9:16 media box + percentage overlay + fade; frame/snapshot consumption rule.
4. **Telemetry streaming split + teardown** — `LiveSnapshotState` vs `CaptureFrame`; `stopAndDrain` for both hooks + AbortController propagation; reordered `endSession`.
5. **Capture-and-hold reference** (*separate; does not block 1–4*).
6. **Derived brightness/distance hints** (*separate; does not block 1–4*).

Tasks 5 and 6 are deliberately isolated so they cannot block the core feed/overlay rollout.

---

## 7. Hard constraints (carried into the plan)

- **FFI-only.** REST-only metrics (lighting / measured-distance) are derived-and-labeled or dropped.
- **Fail closed** on liveness/verdict — never show a pass the device didn't measure; liveness/match/verdict ride final results only.
- **No biometric data-at-rest** — frames in memory only (never logged/cached/written); reference template in-memory, session-only; no enroll/records/galleries.
- **CSRF header gate** on the frame endpoint.
- **Portrait 800×1280, touch** — big tap targets, vertical stack, modal config.
- **`seq` is a bigint** — string-encoded across HTTP; never narrowed.
- **Do NOT modify hardware-libs** — consume as published.
- Commits carry **no Claude/AI attribution** (authored solely as Jon); PR bodies must not link internal `docs/superpowers/` paths.

---

## 8. Testing

- **Mock-mode end-to-end** is the primary dev path (no hardware): the `approach` scenario must drive a live feed + streaming overlay + telemetry + verdict in-browser.
- Unit tests: `useFramePoll` de-dup + drain; `stopAndDrain` ordering; overlay coordinate mapping (natural→rendered); `snapshotAgeMs`/`captureId`/`sessionGeneration` invalidation; discriminated frame response; CSRF gate on `/api/video-frame`.
- `deno test --allow-env --allow-read server/` stays green; mock fixtures stay **lockstep** with the real seam shapes.
- On-device verification (separate, operator-run): feed fps, overlay registration on the live 1080×1920 frame, teardown drains cleanly with no use-after-dispose.
