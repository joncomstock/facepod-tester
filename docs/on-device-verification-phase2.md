# On-Device Verification — Phase 2 Live Video Feed (FacePod tester)

**Purpose:** the one validation the mock cannot cover — run the Phase 2 live video feed + detection overlay against the **real FacePod over USB/Deno-FFI** on the Windows kiosk, and confirm every behavior that only manifests on hardware. This is the last gate before the feature is considered done.

**Who runs this:** an operator at the Windows kiosk with the FacePod attached. No code changes are expected; if a test fails, capture the evidence and hand it back — do not patch on the device.

**What's already proven (do NOT re-litigate):** mock-mode E2E, all unit tests (64 backend + 46 frontend), `deno check`, production build, and the Phase 0 video-frame probe (fps, JPEG 1080×1920, concurrency, bbox/landmark registration, live quality). This runbook validates the **tester UI consuming the real seam end-to-end**, plus the things the probe didn't exercise through the full app (teardown under load, error surfacing, sustained CPU).

---

## 0. Preconditions (confirm BEFORE running)

- [ ] Windows kiosk, **800×1280 portrait, touch**, with the FacePod (HID U.ARE.U Face Module) attached and enumerated.
- [ ] `HidFace.dll` present (+ co-located `ICypher.dll` / VC runtime). Known path from the probe: `C:\Users\Facepod\Desktop\FacePODDemo_MattWolfe\HidFace.dll` — confirm the actual path on this kiosk.
- [ ] **Both repos checked out as SIBLINGS** in the same parent dir (the tester imports the lib by relative path `../hardware-libs/hid/facepod/mod.ts`):
  - `hardware-libs` on branch **`feature/facepod`** (has the `getVideoFrame` / `onIntermediate` seam). Verify: `git -C ../hardware-libs rev-parse --abbrev-ref HEAD` → `feature/facepod`, and `deno check ../hardware-libs/hid/facepod/mod.ts` is clean.
  - `facepod-tester` on **`main`** (the merged Phase 2 work).
- [ ] **Camera exclusivity:** the FacePod camera is held exclusively while a context is open. **Stop every other FacePod consumer first** — any prior tester instance, the vendor demo app, and any FFI probe. If another process holds the camera, connect/openCamera will fail or the feed will be empty.
- [ ] Deno installed; able to load native DLLs (run as the kiosk user, not a restricted sandbox).

---

## 1. Build + launch (LIVE / FFI)

Single-process (recommended for the kiosk — backend serves the built UI on loopback):

```bash
cd facepod-tester
npm install            # first run only
npm run build          # builds the React UI into ./dist (tsc -b && vite build)
deno task dev          # backend LIVE: --allow-ffi --allow-net --allow-env --allow-read; serves ./dist
```

- Set the DLL path if it isn't the prefilled default: `HIDFACE_DLL_PATH` (or enter it in the UI's ⚙ Connection settings, which persist to localStorage).
- Open the kiosk browser to **http://127.0.0.1:8787** (loopback only — the backend binds `127.0.0.1`).
- The status strip should show transport **USB / FFI** (not Mock). If it says Mock, you launched `dev:mock` or `--mock` — relaunch with `deno task dev`.

Two-process alternative (dev): `deno task dev` (backend) + `npm run dev` (Vite on 5174, proxies `/api` to 8787); open http://localhost:5174.

---

## 2. Test cases

For each: follow the steps, check the expected result, mark PASS/FAIL, and note anything off (with a screenshot + the backend console line). "Go Live" = the one-tap button that connects + opens the camera + starts the watch loop.

### T1 — Live full-frame feed renders
1. Tap **Go Live**.
2. Stand in front of the camera.
- **Expect:** a real, full-frame **portrait video feed** of the camera (not a cropped face thumbnail, not a frozen image), updating smoothly. Idle ≈ 7.5–8 fps; visibly faster while a capture is active.
- **PASS:** continuous live video in the feed area; no frozen first frame; no "Mock" badge.

### T2 — Overlay registration on the real 1080×1920 frame (the headline check)
1. With a face in view, observe the green bounding box + landmark dots.
- **Expect:** the **bbox tracks the face** and the **5 landmark dots** (eyes, nose, mouth corners) sit on the correct features — i.e. the overlay is registered to the *displayed full frame* with no offset/scale error. (This is what the prior round could only do "data-only"; the device is the proof.)
- **PASS:** box + dots visually land on the face and follow it; no systematic shift, mirror, or scale mismatch. **FAIL** if the box is offset/clipped or the dots are off the face → capture a screenshot (this would indicate a coordinate-mapping bug).

### T3 — Overlay clears correctly (no ghost box)
1. With the box tracking, **step out of frame** (no face).
- **Expect:** the box/dots **clear promptly** (no stale box frozen on an empty frame). Step back in → box reacquires.
- **PASS:** no ghost box lingering after you leave; clean reacquire.

### T4 — Per-frame live telemetry + positioning guidance
1. Move closer/farther, turn your head left/right, tilt.
- **Expect:** the **Quality** bar updates smoothly per-frame; the **positioning guidance line** shows live corrective strings ("Move closer", "Turn right", …) that change in real time as you move, and clears when well-positioned. Guidance shown as **device** feedback (not the "derived" label) when the device reports positioning.
- **PASS:** quality animates per-frame; guidance is live + corrective and matches your movement; no stale correction stuck after you re-center.

### T5 — Verdict / liveness / match at capture cadence (fail-closed)
1. Hold still, well-lit, looking at the camera.
- **Expect:** **ACCEPT/REJECT verdict**, **Liveness** bar, and (if a reference is set) **Match %** update at capture cadence (~per op, chunkier than the feed). Verdict gates on the device's measured values.
2. Present a photo/phone (spoof), if policy allows testing it.
- **Expect:** liveness **fails closed** — REJECT; never a faked pass. A no-measurement case must not show a pass.
- **PASS:** verdict/liveness/match reflect the device's measured result; spoof is rejected; no green/pass the device didn't measure.

### T6 — Capture-and-hold reference + match%
1. With a good live face, tap **Use current face** (capture-and-hold).
- **Expect:** the **Match** bar activates and shows a live match% against the held template, **without a visible extra capture/stutter** (it reuses the last finalized template — no new device op).
2. Also verify the **upload reference** path still works (pick an image file).
- **PASS:** match% activates from the held face; no contention/stall in the feed when setting it; upload path also works; both are session-only (cleared on End).

### T7 — Derived hints labeled
1. Observe the brightness/distance hints row.
- **Expect:** a visually **distinct row labeled "Derived · not HID-measured"**, separate from the measured telemetry bars; values update at a throttled cadence (not every frame).
- **PASS:** present, clearly labeled, never mixed with the measured bars.

### T8 — Teardown while watching (the critical hardware path)
1. While actively watching (feed + overlay live, mid-capture), tap **End session**.
- **Expect:** clean teardown — the feed stops, the UI returns to idle, **no crash / no native access violation**, and **no spurious error toast** on a normal End. (Server drains both lanes before disposing; it must never dispose under an in-flight frame read.)
2. Check the backend console: no use-after-dispose / FFI crash on shutdown.
- **PASS:** returns to idle cleanly, no error, no crash in the console.

### T9 — Reconnect after End
1. After T8, tap **Go Live** again.
- **Expect:** reconnects, reopens the camera, the feed resumes (cursor reset — no permanently-null/frozen feed from a stale poll cursor).
- **PASS:** full live feed + overlay again after reconnect; repeat End→Go Live a few times with no degradation.

### T10 — Ctrl-C / process kill mid-session
1. With a session live, Ctrl-C the backend (or SIGTERM).
- **Expect:** process exits and **releases the camera** (forceDispose). Afterward, a fresh `deno task dev` can Go Live again (camera not stuck held).
- **PASS:** next launch connects/opens cleanly (no "camera busy" from a leaked context).

### T11 — Sustained run / performance (the deferred decision)
1. Leave a session watching for **several minutes** with a subject intermittently present.
2. Watch Task Manager (CPU/memory of the Deno backend + the browser) and the feel of the feed.
- **Measure + record:** sustained fps, backend CPU%, browser CPU%, memory trend. The feed is ~100 KB JPEG → base64 at ~8 fps (~1 MB/s) over loopback, re-encoded each frame + decoded to a data-URI on the client.
- **Decision gate:** if CPU/latency is comfortable → the deferred **binary `image/jpeg` endpoint** optimization stays dropped (good). If it's hot/janky on the kiosk → flag it; the spec's documented fallback (binary frame endpoint + parallel metadata poll) becomes the follow-up.
- **PASS:** stable over several minutes (no leak/creep, no fps decay); record the numbers either way.

### T12 — No biometric data-at-rest (spot check)
1. During/after a session, check that no frame images or templates are written to disk or printed in the backend console.
- **Expect:** frames/templates live in memory only; the console logs status, not pixel/template data.
- **PASS:** nothing biometric on disk or in logs.

### T13 — Real read-error surfacing (best-effort, if reproducible)
- If a genuine device read error can be induced (e.g. unplug mid-feed), confirm the feed **stops and surfaces an error** to the operator (error banner) rather than silently freezing. (Normal "no new frame" backpressure must NOT trigger this — only a real fault.)
- **PASS / N/A:** if reproducible, the error reaches the UI; if not inducible, mark N/A.

---

## 3. What to capture / hand back

- The PASS/FAIL grid for T1–T13.
- T11 numbers: sustained fps, backend + browser CPU%, memory over the run, and the binary-endpoint decision.
- Screenshots for T2 (overlay registration) and any failure.
- Relevant backend console lines (especially around T8/T10 teardown).
- Device banner for the record: HFApi version / firmware / serial (the probe saw HFApi 1.1.0.336 / firmware 1.2.0.286 / serial 5301672200098).

---

## 4. Definition of done (this feature)

- T1–T10 + T12 **PASS**; T11 measured (and the binary-endpoint decision recorded); T13 PASS or N/A.
- No native crash, no use-after-dispose, no camera left stuck, no faked liveness pass, no biometric data-at-rest.
- Then land the lib (§5). The Phase 2 tester work is already merged to `main`.

---

## 5. Landing the hardware-libs seam (post-validation)

The device consumes the seam directly from the `feature/facepod` sibling checkout — **merging is not required to run this runbook.** Landing it is the final bookkeeping step once the device test passes:

- The seam ships in **PR #28 — `@eai/hid@1.0.0`** (`elevationai/hardware-libs`, base `master`, repo convention is a **merge commit**, not squash). It's a **1.0.0 package publish**, so treat it as a release.
- **Before merging:** its only CI blocker is `deno fmt --check` (cosmetic — local `deno test` is green at 83 passing, `deno check` clean). Run `deno fmt` on the offending files and push; refresh the PR #28 body to include the video seam (`getVideoFrame` / streaming `onIntermediate`), which postdates the original description.
- **Then merge PR #28** (merge commit) → `@eai/hid@1.0.0` is published; the device can subsequently consume the seam from `master` instead of the feature branch.
