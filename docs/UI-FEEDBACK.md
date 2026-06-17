# FacePod Tester — UI Feedback & Design Notes

**Purpose:** capture UX direction + a grounded design for a live-feed / live-detection
experience, so a separate implementation plan can be drafted from it. Nothing here
except §1 is built yet.

**Device reality:** kiosk display is **800 × 1280 (portrait)**, touch-capable. Transport
is **USB / Deno FFI only** (`createFaceModuleFfi`) — NetHFAPI/REST is out of scope and
must not be reintroduced. All "what's measurable" claims below are grounded in the
on-device Track B probe (`hardware-libs/hid/facepod/docs/HIDFACE-ABI.md`,
`track-b-probe-findings.md`, `capability-gap-analysis.md`).

---

## 1. Simpler connect / open-camera  — ✅ implemented (Phase 0)

**Feedback:** "Too complex to use. I should be able to Connect and Open Camera very
easily — click both and be running. All other settings hidden behind gear icons."

**Done in this change:**
- **Panel 01 · Connection** is now a single prominent **Connect** button + a one-line
  target summary. The DLL path / dir / poll-interval / mock toggle moved into a **⚙
  Settings modal**. The DLL path is **pre-filled with this kiosk's default** and
  persisted to `localStorage`, so Connect works with zero input and the path "never has
  to be seen again." (`src/components/DeviceConfigPanel.tsx`)
- **Panel 03 · Camera Context** is now a one-click **Open Camera** (device default) +
  Close, with camera selector / algorithm / reservation-timeout behind a **⚙ Camera
  Settings modal**. (`src/components/CameraControls.tsx`)
- The sticky status strip no longer prints the full DLL path — just transport + the DLL
  filename (full path on hover). (`src/App.tsx`)

**Still worth doing (small):** ~~auto-advance~~ — this follow-up is now the **one-tap
Go Live** button (Live mode): a single tap connects, opens the camera, and starts the
continuous watch loop. The Manual mode panels remain explicit for test/debug use.

---

## 2. Live camera feed

> **Status (2026-06-16):** The Live HUD shell, continuous watch loop, telemetry bars,
> ACCEPT/REJECT verdict, and derived positioning guidance are **implemented** in the
> Live/Manual redesign. The detected-face image refreshed by the watch loop is the
> current feed. Full-frame `HFGetVideoFrame` binding + bounding-box/landmark overlay
> remain **Phase 2**, gated on a separate `hardware-libs` plan (items 1–2 in §6).

**Ask:** after connect/open, show the live feed from the camera.

### Two possible sources (FFI-only world)

| Source | How | Pros | Cons / unknowns |
| ------ | --- | ---- | --------------- |
| **A. HF API preview frames (FFI)** | `HFGetVideoFrame(ctx, lastSeq, &HFImage, &seq, res)` — already in the native export table (ABI §Native symbols), **not yet bound** in the seam. Poll it on a timer, hand each `HFImage` (JPEG/PNG bytes) to the UI. | Single owner of the device (same context as capture); consistent with the HF pipeline; works through our existing seam model. | Frame rate unknown (poll-driven, not a true stream); needs new seam method + an endpoint to ferry frames; bytes-over-HTTP overhead. |
| **B. Raw UVC webcam (browser)** | The module also enumerates as a **USB UVC camera** (`VID_05BA&PID_0030`). A browser `getUserMedia({video})` could show it directly with zero backend cost. | Smooth native video; trivial UI; no seam work. | **Likely blocked by exclusivity** (see note); also needs kiosk camera permission; frame pixels won't carry HF metadata. |

> **Camera is claimed exclusively (confirmed on-device 2026-06-16).** While the tester
> holds a camera context (`cameraOpen:true`), a *second* FFI process can't even
> enumerate the camera (`HFEnumerateCameras` → 0). So you cannot run a side probe and
> the tester at once — and a concurrent **browser UVC** feed is therefore unlikely to
> work while a context is open. This pushes strongly toward source **A**.

**Recommendation:** use **A (HFGetVideoFrame)** — single device owner, FFI-only,
unaffected by the exclusivity above. Treat **B** as improbable given the exclusive
claim; only revisit if an on-device test proves UVC survives an open HF context. Spike
A's frame rate on the real device early; it gates the whole feature.

### Backend work A implies
- Bind `HFGetVideoFrame` in `hidFaceFfi.ts` (symbol already documented), add a
  `getVideoFrame()` seam method returning `{ bytes, format, seq }`.
- An endpoint — either `GET /api/video-frame?lastSeq=` (UI polls ~10–15 fps) or an
  SSE/WebSocket push. Polling is simplest and matches the HF poll model; measure fps.
- Keep the CSRF header gate; frames are read-only.

---

## 3. Live detection + stats as a face approaches

**Ask:** as a person walks in, detect the face and show live stats next to the feed,
with threshold markers (e.g. "match 90% vs threshold 70%" on a bar).

### The FFI mechanism (this is the key grounding)
A live capture op already produces **intermediate results** you poll with
`HFGetIntermediateResult` *while the op runs* — this is the live-feedback channel on
FFI. Today the seam only requests `OPERATION_STATUS` in the intermediate flags. To drive
a live overlay it should also request, per frame:

- `NUMBER_OF_FACES` (16) — is someone there
- `DOUBLE_QUALITY` (32) — live quality 0–1
- `BBOX_UPPER_LEFT` (128) / `BBOX_BOTTOM_RIGHT` (256) — box to draw on the feed
- `LANDMARKS` group (126976) — 5 points for an overlay
- `INT_POSITIONING_FEEDBACK` (1048576) — the decoded bitmask → on-screen guidance

Then one of two loop shapes (both host-driven — **true device-side perpetual identify is
REST-only and NOT available on FFI**):
1. **One long capture op**, polling intermediate results for the live overlay until a
   good frame finalizes. Simplest for a single "step up and capture" flow.
2. **Host loop of short capture ops** for a continuous "kiosk watching the door" feel.
   More device churn; validate timing on hardware.

### What each live stat can be (measured vs derived)

| Stat | Source | Real measured value on FFI? |
| ---- | ------ | --------------------------- |
| **Face present / count** | `NUMBER_OF_FACES` | ✅ |
| **Quality** | `HFRESULT_DOUBLE_QUALITY` [0–1] | ✅ |
| **Liveness / anti-spoof** | `HFRESULT_DOUBLE_SPOOF_PROBABILITY` [0–1] | ✅ (only measured when a face is present + a spoof threshold is set; **fail-closed** otherwise) |
| **Match %** vs a reference | `HFRESULT_DOUBLE_MATCH_SCORE` [0–1] from `matchWithTemplate(reference, live)` | ✅ — **requires a loaded reference template** (see below) |
| **Positioning guidance** | `positioning_feedback` bits (decoded) | ✅ geometric only: get-closer / move-away / turn L·R / lift / lower / tilt L·R |
| **Bounding box + landmarks** | bbox corners + 5 landmark points | ✅ |
| **Lighting uniformity / brightness / sharpness** | — | ❌ **not exposed on FFI** — derive in-UI (luminance histogram off the frame) and **label "derived, not HID-measured"** |
| **Measured distance** | — | ❌ not exposed — only near/far hints (positioning bits) or a bbox-area proxy, labeled derived |

### The "90% match vs 70% threshold" feature needs a reference
A live match percentage is a **1:1 compare against a known template**. So the flow is:
load a reference (upload a face image → `processImage` → template, or capture-and-hold
one), then each live frame's template is matched against it and you display
`matchScore` vs `minimalMatchScore`. Without a reference there is no "match %" — only
quality + liveness bars. **No gallery / enrolled records** (biometric data-at-rest stays
out per the hard constraints); the reference is in-memory for the session only.

---

## 4. Threshold-marker visualization

A horizontal bar per metric: fill = current value (0–100%), a fixed **marker** at the
threshold, green/red by whether the value passes. "Pass" direction differs per metric:
quality & match pass when **≥** threshold; spoof passes when **≤** threshold (lower is
more live).

```
 QUALITY            ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░░  92%   ● pass
                    0        ▲min 70                100
                             threshold

 LIVENESS (spoof)   ▓▓▓░░░░░░░░░░░░░░░░░░░░░░   8%   ● pass   (≤ 50 max)
                    0                ▲max 50         100

 MATCH vs reference ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░░  90%   ● pass
                    0            ▲min 70            100
```

- The **marker** (▲) is the threshold; the **fill** is the live value, animating as the
  face moves. Color the fill green when passing, red when failing, amber within a small
  margin. Show the numeric value + threshold inline.
- These reuse the existing accept-gate logic the tester already computes; this is a
  richer visual form of it.
- A combined **ACCEPT / REJECT** verdict chip (already in the capture panel) sits above
  the bars: `isCaptured && quality≥min && liveness.passed && match≥min`.

---

## 5. Proposed layout for 800 × 1280 (portrait)

> **Status (2026-06-16):** Portrait layout, Live/Manual tabs (masthead toggle), HUD
> shell, telemetry bars, verdict, and derived positioning guidance are **implemented**.
> The feed area currently shows the detected-face image; the full-frame video region
> with bbox/landmark overlay is **Phase 2** (separate `hardware-libs` plan).

"Next to the feed" is tight at 800px wide, so stack **feed on top, stats below**, with
the box/landmarks/guidance drawn **as an overlay on the feed** and the threshold bars
beneath. This reads top-to-bottom on a portrait kiosk and keeps the feed large.

```
┌────────────────────────────────────────────┐ 800px
│  ● LIVE · Camera open                    ⚙  │  status
├────────────────────────────────────────────┤
│                                              │
│            LIVE FEED  (≈744 × 560)           │
│        ┌───────────────┐                     │
│        │   bbox + dots │  ← overlay          │
│        └───────────────┘                     │
│        "Move a little closer"  ← positioning │
│                                              │
├────────────────────────────────────────────┤
│  ACCEPT ✓        (or REJECT ✗ · reason)      │
│                                              │
│  QUALITY   ▓▓▓▓▓▓▓▓▓░  92%   ▲70             │
│  LIVENESS  ▓▓░░░░░░░░   8%   ▲≤50            │
│  MATCH     ▓▓▓▓▓▓▓▓▓░  90%   ▲70             │
│                                              │
│  Reference: [ uploaded ✓ ]   [ Capture ]     │
└────────────────────────────────────────────┘
        ↑ vertical scroll for JSON / details
```

- Overlay guidance text comes straight from the decoded `positioning_feedback` bits
  ("get closer", "turn left", …) — friendly strings, optionally arrows around the box.
- Below the fold: the existing raw-JSON disclosures for debugging.
- This is a **new "Live" panel/mode**; the current step-by-step panels (02–05) stay as
  the manual/debug surface (a tab or toggle between "Live" and "Manual").

---

## 6. Net new work this implies (dependency list, grounded)

Library / seam (`hardware-libs`), each gated by on-device confirmation:
1. **Bind `HFGetVideoFrame`** + `getVideoFrame()` seam method (live feed source A).
   → **Phase 2 — not yet consumed.**
2. **Extend capture intermediate flags** to include quality / faces / bbox / landmarks /
   positioning_feedback, and surface them on the intermediate-result callback so the UI
   can render per-frame (today only `OPERATION_STATUS` is polled).
   → **Phase 2 — not yet consumed.** Visual overlay on the feed frame is also Phase 2.
3. **Add `positioningFeedback` + `landmarks` to `CaptureResult`** (decoded bits + points).
   Both are confirmed-available; see `track-b-probe-findings.md` §seam proposal.
   → **✅ Consumed by the tester (Phase 2 lib, Tasks 1–10 of consume-phase2-params).**
   - `positioningFeedback`: decoded strings drive the Live-mode guidance line
     (real device strings shown with a "Guidance is from the device's positioning
     feedback" hint; fallback label when absent).
   - `landmarks`: present in the **Frame data** disclosure (data-only; no canvas overlay
     yet — that remains Phase 2 item 2 above).
4. (Optional) read-only `getParameters()` to show live thresholds in the UI; **no
   `setParameters` writes** until the separately-gated set-probe is approved.
   → **✅ Consumed by the tester (Phase 2 lib, Tasks 1–10 of consume-phase2-params).**
   - Parameters are read on session start (Live mode) and on demand via **Refresh** in
     the Manual-mode **Device Parameters** panel.
   - Threshold markers on the telemetry bars show a dashed amber **device** tick at the
     live device threshold alongside the solid operator marker — reference-only; no
     writes.
   - Refresh requires an open camera (`cameraOpen: true`); the button is disabled
     otherwise.

Tester (this repo):
5. New **Live panel**: feed + overlay canvas + threshold-marker bars + verdict.
6. **Frame endpoint** (poll or SSE) + a small client render loop.
7. **Reference-template management** (in-memory, session-only) to enable match %.
8. **Derived-only** brightness/distance hints, clearly labeled, if wanted.

---

## 7. Hard constraints to carry into the plan
- **FFI only.** If a metric is REST-only (lighting/brightness/measured-distance, device
  perpetual-identify), it is **not** available — derive-and-label in the UI or drop it.
- **Liveness fails closed.** Never show a "live/pass" the device didn't measure.
- **No biometric data-at-rest.** Reference templates stay in memory for the session; no
  enroll / records / galleries.
- **Portrait 800 × 1280, touch.** Big tap targets; stack vertically; modal config.

## 8. Open questions for the on-device spike
- `HFGetVideoFrame` real frame rate? Enough for a "live" feel?
- ~~Can browser UVC run concurrently with an open HF context?~~ **Answered:** the camera
  is held exclusively while a context is open (a second FFI consumer can't even
  enumerate it), so concurrent UVC is improbable — plan on source A.
- Intermediate-result poll cadence vs. CPU on the kiosk — what fps is sustainable?
- Does `positioning_feedback` populate during the *intermediate* phase (live), or only
  on the final result? (Determines whether guidance is truly live.)
