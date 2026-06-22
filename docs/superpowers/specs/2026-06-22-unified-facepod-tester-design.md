# Unified single-screen FacePod Tester — design spec

- **Date:** 2026-06-22
- **Status:** Approved design (pending spec review) → implementation plan next
- **Branch:** `feature/live-hud-fixes`
- **Scope:** Front-end only (React/Vite UI). No server or `@eai/hid/facepod` changes.

## 1. Goal

Collapse the FacePod Tester into a **single screen** built around one workflow: watch a
live feed and read as many device/API stats as possible at a glance, with photo-match as a
secondary, inline action. Remove the Live/Manual tab split and the stepped Manual flow.

### Non-goals
- No new device capabilities; this is a presentation/IA change.
- Not removing the ability to *inspect* values that matter (they move into Frame Data or
  the verdict), only the dedicated stepped panels and raw dumps.
- Camera selection, DLL path/dir, and poll interval are dropped from the UI (server
  defaults are used). They are not part of the demo workflow.

## 2. Current state (what exists today)

- `App.tsx` holds session state and a `mode: "live" | "manual"` toggle, renders a header
  (title + state pill + Live/Manual tabs), an error banner, and either `LiveView` or
  `ManualView`.
- `LiveView` already owns a full session lifecycle: `goLive` (connect + open camera),
  continuous watch loop, frame poll/video feed, `pickReference`/`useCurrentFace`,
  `endSession`, and renders Feed + Telemetry + Frame Data + dock. (Two-pane layout shipped
  in `f00e694`.)
- `ManualView` renders six stepped, gated panels: **01 Connection**, **02 Device &
  Cameras**, **03 Camera Context**, **04 Live Capture** (single-shot + accept gate),
  **05 Reference & Match**, **Device Parameters** (raw HFParam dump).
- The Live view already covers connect/open, continuous capture+verdict, and reference
  photo → Match telemetry. The genuinely Manual-only capabilities are: threshold editing,
  mock scenario, camera/DLL config, and the diagnostics dumps.

## 3. Decisions (locked)

| Topic | Decision |
|---|---|
| Tabs | **Removed.** Single screen = the live view. |
| Kept from Manual | **Threshold editing** + **mock scenario**. |
| Cut from Manual | Camera/DLL/poll config, single-shot capture + accept gate, device-info/cameras inspection, raw Device Parameters dump. |
| Config home | **Settings affordance** opened from a header gear (centered modal on wide, **bottom sheet** on narrow). |
| Match flow | **Inline in the dock** (continuous), not a separate screen/modal. |
| Gauge style | **Header line (NAME · value%) over a full-width track** with threshold + device ticks. |

## 4. Screen layout

Two regions + a full-width dock. The **feed has visual priority**; **Frame Data scrolls
independently** so a long payload (e.g. many landmarks) never compresses the feed or gauges.

```
┌──────────────────────────────────────────────┐
│ ▪ FacePod Tester      ● CAMERA OPEN        ⚙  │  header: title · state pill (·mock) · gear
├───────────────────────────┬──────────────────┤
│  FEED (9:16)              │  FRAME DATA        │  right pane: overflow-y:auto, own scroll
│   + verdict chip          │  ▸ Face            │
│   + bbox / landmarks      │  ▸ Capture         │
│                           │  ▸ Liveness        │
├───────────────────────────┤  ▸ Match          │
│  QUALITY   ▓▓▓▓░ 83%      │  ▸ Stream          │
│  LIVENESS  ▓▓▓▓▓ 100%     │  (scrolls within   │
│  MATCH     ░░░░ No ref     │   its own height)  │
│  guidance note            │                    │
├───────────────────────────┴──────────────────┤
│ Stop watching │ End session │ Reference ▸      │  dock: full width
└──────────────────────────────────────────────┘
```

- **Left column (feed priority, ~60%):** Feed (verdict chip folded on, per `f00e694`) →
  Quality/Liveness/Match gauges below it → guidance footnote.
- **Right column (~40%):** Frame Data, top-aligned, **`overflow-y: auto`** with a max-height
  tied to the feed+gauges height.
- **Feed sizing:** the feed keeps its native 9:16 ratio but is **height-capped** so feed +
  gauges + dock fit the kiosk viewport without page scroll on wide/portrait-kiosk layouts.
  Width target is ~60% of the row, but the height cap governs when the two conflict (on the
  800×1280 kiosk the cap binds, so "60%" is a ceiling, not a fixed width).
- **Dock (full width):** the watch button, End session, and the reference/match controls.

## 5. Components

### 5.1 Header
`▪ FacePod Tester` · state pill (`Disconnected`/`Connected`/`Camera Open`/`Busy`/`Error`,
plus a mock tag when mock is on) · **⚙ gear** opening Settings. The Live/Manual toggle is
deleted. Connection/camera status (the pill) is kept **visibly distinct** from watching
status (the dock button label + the feed verdict chip).

### 5.2 Feed
Unchanged from `f00e694` except sizing (§4): full live frame, bbox + landmark overlay, the
folded verdict chip (`Watching… / Acquiring… / ✓ ACCEPT / ✗ REJECT`), and the bottom
guidance caption.

### 5.3 Telemetry gauges (redesign)
Replaces the cramped `name │ track │ value` grid (the tracks collapsed and the
`min 70`/`device` tick labels collided between rows). New per-gauge structure:

- **Header line:** `NAME` (left) · `value%` (right), value color-coded by pass/fail.
- **Full-width track** below the header, with:
  - a **threshold marker** (the configured minimum, labeled e.g. `min 70`), and
  - a dashed **device tick** (the device-recommended value, labeled `device`),
  both positioned and labeled within the gauge's own vertical band so adjacent gauges never
  overlap.
- Generous spacing between the three gauges.

**Gauge direction (explicit) — deviation from review point #4.** All three gauges read
**higher-is-better, left-to-right fill, threshold tick = minimum to pass**:
- **Quality** — value `q ∈ [0,1]`, pass if `≥ minimalQuality`.
- **Liveness** — displayed as **confidence = `1 − spoofScore`**, pass if `≥ 1 − maximalSpoofScore`.
  We deliberately do **not** show a downward "Spoof" gauge; raw spoof of 0 (best) rendered as
  an empty "0%" bar reads as failure. (Existing intentional choice — see the comment in
  `Telemetry.tsx`.)
- **Match** — value `m ∈ [0,1]`, pass if `≥ minimalMatchScore`; shows **"No reference"** (not
  `—`) when no reference is set.

The **raw spoof score (lower-is-better)** remains inspectable as a number in Frame Data →
Liveness, labeled so its direction is unambiguous. This satisfies the review's real ask
(direction defined explicitly, coloring/ticks consistent with it) without an inverted gauge.

**Freshness/stale state — two independent signals:**
- **Video-stream freshness** (the feed): from the frame poll's fps / snapshot age.
- **Capture-telemetry freshness** (the gauges + measured Frame Data): from the age of the
  last watch-loop `CaptureFrame`.

Treatment:
- Watching **intentionally off** → gauges/feed read **"Paused"** (not an error/no-signal).
- Watching **on** but the relevant stream has gone stale (no fresh frame past its threshold)
  → dim + **"No signal"**, rather than showing a frozen value as if it were live.

### 5.4 Frame Data (grouped, scrollable)
Same fields as today, but grouped under labeled sub-sections instead of one flat list, in
its own independently-scrolling pane:

- **Face:** Faces, Face status, Bounding box, Landmarks, Positioning
- **Capture:** Captured, Quality, Template
- **Liveness:** Spoof score (raw, lower-is-better), Liveness PASS/FAIL
- **Match:** Match score, Match PASS/FAIL
- **Stream:** Frame size, Frame type, Feed rate, Brightness, Distance

Stale handling mirrors §5.3 (dim + indicator when frames stop).

### 5.5 Action dock
- **Watch button — single stateful control:** `Start watching` ⇄ `Stop watching`
  (toggles the watch loop). Distinct from:
- **End session** — disconnects/closes the camera (returns to the idle "Go Live" scene).
- **Reference / match (inline):**
  - When **no reference**: `Set from photo…` (file upload) and `Use current face`.
  - When a **reference is set**: a **thumbnail/source chip** (photo thumbnail, or a "current
    face" label when captured from the live frame) plus **Replace** and **Clear**.
    **Replace** re-opens the photo picker; **Use current face** stays available alongside it,
    so both reference sources remain reachable whether or not a reference already exists.
  - **`Use current face` gate (strict):** enabled only when the **current** live frame is a
    fresh, finalized capture with **exactly one face**, a **template present**,
    **quality ≥ minimalQuality**, and liveness **measured and passing**. It captures *that*
    frame's template — never an older cached `lastTemplate` — so a stale/low-quality template
    can't qualify. When the gate fails, the control is disabled with inline guidance
    ("Hold a single face in view at good quality to use it as the reference.").
  - Setting/replacing/clearing the reference updates the Match gauge and the feed verdict
    continuously.

### 5.6 Settings (gear)
A single surface — **centered modal on wide, bottom sheet on narrow (≤560px)** — containing
only what was kept:
- **Thresholds:** min Quality, max Spoof, min Match, capture timeout.
- **Mock:** on/off toggle + scenario picker (good / low-quality / spoof / no-face / no-match /
  device-error).
- **Apply semantics (explicit in the UI):**
  - **Threshold** changes apply **immediately** to the running watch loop.
  - **Scenario** changes apply **immediately only while connected in mock mode** (via
    `api.setScenario`); otherwise the selection is stored and applies **next session**.
  - The **mock on/off** toggle is a **connect-time** parameter, so it applies on the
    **next session — after End session → Go Live** (toggling watch does not reconnect).
- **Capture-timeout wiring:** `useWatchLoop` currently hard-codes a 1500 ms per-capture bound
  (`useWatchLoop.ts:50`). It must instead consume the configured **capture timeout** (default
  1500 ms when blank). Surface the caveat in the UI: a high value slows the watch loop's
  responsiveness, since each capture waits up to that long.

## 6. State & data flow

- `App.tsx` slims to: `status`, `error`, `busy`, threshold values (`minimalQuality`,
  `maximalSpoofScore`, `minimalMatchScore`, `timeoutMs`), mock settings, and
  `useDeviceParameters` (for the gauge device ticks). It renders: header (+ gear) →
  `LiveView` → Settings surface → error banner. The `mode` state and the `ManualView` branch
  are removed.
- **Device parameters keep being fetched** in the background (they power the dashed "device"
  ticks); only the *raw dump panel* is removed.
- **Connection sends server defaults.** `goLive` **stops passing** UI-derived
  `dllPath`/`dllDir`/`pollIntervalMs`; it sends only `{ mock, mockScenario }`. The persisted
  `connectionSettings` shrinks to `{ mock, scenario }`, and the old
  `dllPath`/`dllDir`/`pollIntervalMs` localStorage keys are **ignored/migrated** on load.
  - **Risk flag:** today `CONNECTION_DEFAULTS.dllPath` is a hard-coded machine-specific path
    (`…\FacePODDemo_MattWolfe\HidFace.dll`, `connectionSettings.ts:17`) and the kiosk
    currently connects using it. Dropping it is only safe if the **server** supplies a DLL
    default (env). Before removing it, confirm the server default exists; otherwise keep a
    single baked-in DLL constant in the connection layer (not user-editable) rather than
    breaking Go Live.
- Mock + scenario persist via the (reduced) `connectionSettings` store; `goLive` reads it.
- Threshold values (including the capture timeout, §5.6) feed `LiveView` / `useWatchLoop`.

## 7. What gets deleted

- The Live/Manual tab toggle and `mode` state.
- `src/components/manual/ManualView.tsx` and `DeviceParametersPanel.tsx`.
- `src/components/DeviceConfigPanel.tsx`, `DeviceStatusPanel.tsx`, `CameraControls.tsx`,
  `CapturePanel.tsx`, `MatchPanel.tsx` (their unique capabilities are cut or already covered
  by Live).
- App-level handlers/state that only served Manual: single `capture`, explicit `match`,
  `captureAndMatch`, device-info/cameras inspection, and the associated result state.
- `api.ts` keeps its full client surface (faithful to the server); unused methods are left in
  place rather than pruned.

## 8. Responsive behavior

- **Wide / portrait kiosk (default):** two-pane as §4; the page does **not** scroll — only the
  Frame Data pane scrolls internally.
- **Narrow (≤560px):** single column, stacked **Feed → gauges → reference/dock → Frame Data**.
  "Single screen" means **one unified workflow**, not necessarily zero scrolling — on narrow
  widths the page may scroll, with Frame Data last. Settings opens as a **bottom sheet**.

## 9. Testing

- Existing Vitest suite (logic/overlay/derived/framePoll) must stay green; pure-logic helpers
  (`barState`, liveness-confidence mapping, stale detection) get unit coverage.
- `tsc -b` clean after the App/component pruning (no dangling imports/props).
- Manual on-device verification on the 800×1280 kiosk: feed + gauges + grouped Frame Data
  visible together; gauges legible; reference thumbnail + Replace/Clear; "No reference" state;
  settings modal/bottom-sheet; mock scenario switching mid-session; stale state when the feed
  stops.

## 10. Locked decisions / rationale

- **Gauge direction (approved):** all three gauges are higher-is-better; **Liveness =
  `1 − spoofScore`** confidence rather than a downward "Spoof" gauge (a raw spoof of 0 = best
  would render as an empty/failing bar). The raw spoof value stays inspectable as a number in
  Frame Data → Liveness (§5.3 / §5.4). No inverted gauge.
