# FacePod Tester — Full Device Capability Plan

**Status:** Plan / not yet authorized for build. UI design handled separately (Claude Design); this plan defines the **lib → backend → API contract** so design and engineering proceed in parallel.
**Date:** 2026-06-23
**Scope:** Add every device capability the tester does not yet exercise — parameter **writes**, RGB/IR + high-res capture, **diagnostics & logs**, and **enrollment + on-device DB + 1:N identify + verify-against-record** — across `../hardware-libs/hid/facepod` (the FFI lib) and `facepod-tester` (backend + API).

## Sources (authoritative)
- On-device probe verdicts: `../hardware-libs/hid/facepod/docs/capability-gap-analysis.md` and `docs/HIDFACE-ABI.md` (Track B, FFI, firmware `1.2.0.286`, HFApi `1.1.0.336`).
- SDK headers: `…/HID_U.ARE.U_Camera_USB_Integration_Kit_1.2.0.500/include/HFApi.h`, `HFTypes.h`, `HFErrors.h`.
- Reference implementations: the kit's C++ samples (`sample/AddRecord`, `EnrollIdentify`, `IdentifyRecord`, `VerifyRecord`, `ContinuousCaptureImage`, `GetVideoFrames`, `GetLogs`, `Configure*`) and the C# wrapper (`csharp/wrapper/HFApiWrapper.cs`, `HFCameraApi.cs`).
- Custom kiosk reference: `FacePODDemo_MattWolfe` (perpetual-identify + named records + consent + LED/audio).

## Transport note
The module is **FFI-over-USB via `HidFace.dll`** (`src/hidFaceFfi.ts`). The gap-analysis REST tables describe the alternate **NetHFAPI** transport and are *not* our path — but its **FFI Track-B probe verdicts and capability evidence apply directly**. All work here is FFI.

---

## Guiding principles & constraints

1. **Probe before build.** Each new FFI area gets a read-only/low-risk on-device probe first (the team's established method: `examples/ffi/paramProbe.ts`, `positioningProbe.ts`). Signatures for records/identify/verify/diag are confirmed in the demo logs + headers but **not yet bound** in our lib; param **writes** are signature-confirmed but **never exercised**. Probes de-risk every phase.
2. **Layered spine (unchanged architecture).** Each capability flows through the same layers:
   `hidFaceAbi.ts` (flags/codecs/enums) → `hidFaceFfi.ts` (symbol decl + native method) → `hidFaceSdk.ts` (seam) → `hidFaceFfiClient.ts` (raw→v1 shaping, base64) → `faceModule.ts`/`types.ts` (public API) → **mock parity** (`tests/mockHidFaceSdk.ts` + `server/mockClient.ts`) → `server/facepodSession.ts` (orchestration, op-lock) → `server/main.ts` (HTTP) → `src/api.ts` (client contract) → UI.
3. **One op per context.** Identify/verify/enroll/continuous are async ops sharing the single HF op-lock. They must serialize with the capture/watch loop exactly as `capture()` does today (reuse the session's busy lane + abort/drain).
4. **Biometric data-at-rest is opt-in.** Enrollment/records/identify create persistent biometric data on the device (gap-analysis "Architectural line"). Gate behind an explicit, labeled opt-in; provide easy bulk delete; document the obligation. Default tester behavior stays stateless 1:1.
5. **Destructive ops are guarded.** Reboot / database-reset require double-confirm and are never automatic. **Excluded entirely:** factory reset, decommission, firmware update.
6. **Mock parity is mandatory.** Every new seam method gets a realistic mock so the UI and tests run cross-platform without hardware (template size **1064 B**; match scores L1/L2/L3 = 0.155/0.590/0.892; thresholds 0.7/0.7/0.5).
7. **Design is external.** The **API Contract (Appendix A)** is the stable interface the new UI binds to. Keep it stable; iterate UI freely.

---

## Phase 0 — On-device capability probes (read-only / reversible)

> ### ✅ RESULTS — run live 2026-06-23 (HFApi 1.1.0.336 / fw 1.2.0.286), scripts in `../probes/`
> Probes: `setParamProbe.ts`, `recordsProbe.ts`, `recordsRoundTripProbe.ts`. The device was left clean (no records, params reset). **Verdicts that shape the build:**
>
> - **Parameter writes (Phase 1): CONFIRMED.** `HFSetParamInt`/`HFSetParamDouble` change values immediately (JPEG 95→80→95 OK; STREAM_MODE 0→1→2→0 OK). **Monotonic = factory-envelope clamp, not a one-way ratchet:** trying to *loosen past the device default* is rejected with **`rc=8 HFERROR_ARGUMENT_INVALID`, value unchanged** (MAX_ROLL 30→35 rejected; MIN_ROLL −30→−35 rejected). You can *tighten within* the envelope and *restore back to default* freely (30→25→30 all OK). So the lib should surface `applied: set|rejected` and **restore-to-default always works**.
> - **Writes are context-scoped, NOT persisted: CONFIRMED.** After close+reopen, JPEG/STREAM/pose all reset to device defaults. ⇒ any tester tweak is wiped on the next `HFOpenContext` (every "Go Live"); the kiosk is unaffected. **Big safety win — param-write UI needs no "danger" framing beyond the per-write rejection.**
> - **Stream mode RGB/IR + high-res (Phase 2): CONFIRMED.** Stream mode 10004 (AUTO=0/RGB=1/IR=2) settable. With `CAMERA_ENABLE_HIGH_RES`(11001)=1, a live capture returns `HFRESULT_IMAGE_HIGH_RES` (flag `2097152`) = **2160×3840 PNG (~7.5 MB) — true 4K, exactly 2× the 1080×1920 default** (~2.1 MB). Encoding follows `CAPTURE_IMAGE_ENCODING`. Faceless capture returns status=ERROR/no image (expected). ⇒ backend should treat a 4K still as a one-shot download, not a streamed/base64-inlined field.
> - **Enrollment + 1:N identify + verify (Phase 4): FULL ROUND-TRIP CONFIRMED.** `processImage(facepod-capture.png)` → faces=1, q=0.897, **template = 1064 B**; `HFAddRecordWithTemplate` OK → `HFListRecords` shows it → `HFGetRecord` decodes → `HFAsyncIdentifyWithTemplate` returns a gallery with the record at **score 1.0000** → `HFAsyncVerifyWithTemplate` 1.0000 → `HFDeleteRecord` OK → list empty. **Confirmed ABI (add to `hidFaceAbi.ts`):** match-gallery flag `HFRESULT_MATCHGALLERY_MATCH_GALLERY = 0x400 (1024)`; structs (Pack=1, x64): `HFDatabaseRecord` = recordID char*@0, customData{data@8,size@16}, templ{data@20,size@28} (32 B); `HFMatchRecord` = header(20 B) + score f64@20 (28 B stride); `HFMatchGallery` = records ptr@0, count u32@8. Signatures: `HFAddRecordWithTemplate ["u32","pointer","bool"]`, `HFDeleteRecord ["u32","pointer"]`, `HFGetRecord ["u32","pointer","pointer"]`, `HFListRecords ["u32","pointer","pointer"]`, `HFAsyncIdentify/VerifyWithTemplate ["u32","pointer","f64","pointer","pointer"]`, `HFParseResultMatchGallery ["pointer","u64","pointer"]`.
> - **Diagnostics + logs (Phase 3): CONFIRMED.** `HFDiagnostics(ctx, ECHO=0, inHFData*, &outHFData*)` round-trips bytes (29→29 OK). `HFAsyncDiagnostics(ctx, code, inHFData*, &op)` → poll → `HFGetFinalResult(op, HFRESULT_DATA_DIAGNOSTICS=0x80000)` → `HFParseResultData` returns the log blob. **All 10 log codes (`0x40000000 + n`) returned OK.** Logs are **JSON-lines text** (SECURE_EVENTS is plain bracketed text); `NETHFAPI_HTTP_LOGS` is empty (USB/FFI path, expected). **Sizes vary widely — HFAPI ~3.6 MB, JEngine ~2.2 MB, HFAPI_ERROR ~2.5 MB**, down to a few KB ⇒ the backend/UI must cap or paginate (don't ship multi-MB blobs to the browser whole). Signatures: `HFDiagnostics ["u32","u32","pointer","pointer"]`, `HFAsyncDiagnostics ["u32","u32","pointer","pointer"]`, diag result flag `0x80000`. **REBOOT(1)/DATABASE_RESET(2) were NOT exercised** (destructive — keep guarded).
> - **All four capability areas are now confirmed live — nothing left to probe.** Every signature, struct offset, error code, and safety behavior is backed by an on-device run.

**Goal:** confirm exact native signatures + behavior before binding anything. Output: probe scripts under `../hardware-libs/hid/facepod/examples/ffi/` and findings appended to `docs/HIDFACE-ABI.md`.

- `setParamProbe.ts` — exercise `HFSetParamInt`/`HFSetParamDouble` on a safe knob (e.g. `ENCODING_JPEG_QUALITY`, `STREAM_MODE`); confirm writes take effect (read-back), and confirm the **monotonic constraints** (`MIN_*` increase-only, `MAX_*` decrease-only, `MIN_DISTANCE` ↑-only, `MAX_DISTANCE` ↓-only) and the rejection error for illegal writes. Restore originals.
- `highResProbe.ts` — set `CAMERA_ENABLE_HIGH_RES`, capture with the `HFRESULT_IMAGE_HIGH_RES` flag, confirm a high-res buffer returns + its dimensions; toggle `STREAM_MODE` AUTO/RGB/IR and confirm frame source changes.
- `recordsProbe.ts` — `HFAddRecordWithTemplate` (a throwaway template) → `HFListRecords` → `HFGetRecord` → `HFDeleteRecord`; confirm round-trip + the record/gallery struct layouts. **Cleans up every record it creates.**
- `identifyProbe.ts` — enroll one record, `HFAsyncIdentifyWithTemplate`, parse `HFParseResultMatchGallery` (struct: records[]+scores); also `HFAsyncVerifyWithTemplate` against the record id. Clean up.
- `diagProbe.ts` — `HFDiagnostics(ECHO)`; `HFAsyncDiagnostics` for each log code (HFApi/HTTP/camera-access/db-audit/auth/illumination); confirm payloads. **Do not** call reboot/db-reset in the probe.
- `continuousProbe.ts` *(optional)* — `HFAsyncContinuousCaptureAndProcessImage`; confirm multi-final-result streaming + stop semantics.

**Exit criteria:** every signature + struct codec documented in `HIDFACE-ABI.md`; any firmware-not-implemented call noted (like `SYSTEM_TIME`). Build phases below are unblocked per-area as their probe passes.

---

## Phase 1 — Parameter writes (foundation)

The tester reads 39 params; make the settable ones writable. Reuses existing param infrastructure (`hidFaceAbi.ts` param map, `getParameters`).

**Lib (`../hardware-libs/hid/facepod`)**
- `hidFaceFfi.ts`: wrap the already-declared `HFSetParamInt`; declare + wrap `HFSetParamDouble`, `HFSetParamString`.
- `hidFaceAbi.ts`: add a per-key **writability + constraint** table (settable? int/double/string; monotonic direction; range). Encode the header truth: `MIN_*` ↑-only, `MAX_*` ↓-only, `SYSTEM_TIME` firmware-N/I.
- `hidFaceSdk.ts`: add `setParameters(patch: Partial<DeviceParameters>): DeviceParameters` (returns the re-read live params) to the seam + `NullHidFaceSdk`.
- `hidFaceFfiClient.ts` / `faceModule.ts`: public `setParameters(patch)`; validate against the constraint table, surface device rejections as a typed error (`ParameterRejectedError` in `errors.ts`).
- `types.ts`: a `DeviceParameterMeta` map (key → {settable, kind, min/max, monotonic}) exported for the UI.

**Backend (`facepod-tester/server`)**
- `facepodSession.ts`: `setParameters(patch)` (op-lock; camera must be open).
- `main.ts`: `POST /api/parameters` → `{ parameters, applied: Record<key,"set"|"clamped"|"rejected">, rejected?: {...} }`.
- `mockClient.ts`: in-memory param store honoring monotonic clamp + rejection.

**API (`src/api.ts`)**: `setParameters(patch)`, plus export `DeviceParameterMeta` for the UI to render typed controls (sliders/toggles with min/max + monotonic hints).

**Tests:** ABI constraint table; client validation/clamp/reject; mock store; session + route; api shape. **On-device acceptance:** set roll/pitch/yaw/distance limits + jpeg quality, read back, confirm behavior change; confirm illegal monotonic writes are rejected cleanly.

---

## Phase 2 — RGB/IR stream toggle + high-res capture (+ optional continuous)

Builds on Phase 1's param plumbing; adds capture-surface changes.

**Lib**
- `hidFaceAbi.ts`: add result flag `HFRESULT_IMAGE_HIGH_RES`; extend capture poll flags to optionally include it; add `HFImageRes`/`HFFrameMode` enums.
- `hidFaceFfi.ts`/`hidFaceSdk.ts`: `capture()` gains `highRes?: boolean`; `HidFaceCapture` gains `highResImage?`/`highResFormat?`. Stream/capture mode set via `setParameters` (`STREAM_MODE` 10004, `CAPTURE_MODE` 10005, `STREAM_IMAGE_ENCODING` 10006, `CAMERA_ENABLE_HIGH_RES` 11001).
- `getVideoFrame`: confirm encoding respects `STREAM_IMAGE_ENCODING`; expose current stream mode in status.
- *(Optional)* `captureContinuous()` seam method wrapping `HFAsyncContinuousCaptureAndProcessImage` (multi-final-result), behind a feature flag.

**Backend**: `POST /api/capture` accepts `highRes?`; result adds `highResImage?`. Stream/mode via the Phase-1 params endpoint. Status reports active stream mode + high-res flag.

**API/UI contract**: capture option `highRes`; a "stream mode" enum control (AUTO/RGB/IR) and "high-res" toggle (these are param writes). High-res image surfaced as a downloadable still.

**Tests:** flag/enum codecs; capture-with-highRes shaping; mock returns a distinct high-res fixture; RGB↔IR mock switch. **On-device:** force IR at the kiosk (matches the IR frames seen in testing), grab a high-res still, confirm dimensions.

---

## Phase 3 — Diagnostics & device logs

Independent of capture; mostly read-only. High diagnostic value for a hardware tester.

**Lib**
- `hidFaceFfi.ts`: wrap `HFDiagnostics` (sync: `ECHO`, `REBOOT`, `DATABASE_RESET`) and `HFAsyncDiagnostics` (log codes: HFApi, HTTP, JEngine, secure-events, auth, db-sync, db-audit, fw-update, camera-access, illumination, hfapi-error).
- `hidFaceAbi.ts`: `HFDiagCode` / `HFAsyncDiagCode` enums; `HFRESULT_DATA_DIAGNOSTICS` parse.
- `hidFaceSdk.ts`/`faceModule.ts`: `echo(bytes)`, `getLogs(code)`, `reboot()`, `resetDatabase()` (last two guarded by a `confirm: true` arg).

**Backend**
- `main.ts`: `POST /api/diagnostics/echo`, `GET /api/diagnostics/logs?type=…` (**cap/paginate — confirmed logs reach multi-MB**; stream or tail rather than returning whole), `POST /api/diagnostics/reboot` and `POST /api/diagnostics/database-reset` (both require an explicit confirm token; never auto). Reboot triggers the session's reconnect/adopt path.
- `mockClient.ts`: synthetic JSON-lines logs + echo; mock reboot bumps `sessionGeneration`.

**API/UI contract**: a "Diagnostics" surface — log type picker + viewer (download), echo/comms test, and **guarded** reboot / DB-reset (double-confirm modal).

**Tests:** diag codecs; log retrieval; echo round-trip; guard rejects unconfirmed destructive calls. **On-device:** pull each log type; echo; (optionally) reboot in a controlled run.

---

## Phase 4 — Enrollment + on-device DB + 1:N identify + verify-against-record

The largest phase and the device's headline capability. **Opt-in; creates biometric data-at-rest** (principle #4).

**Lib**
- `hidFaceAbi.ts`: add `HFRESULT_MATCHGALLERY_MATCH_GALLERY` flag + codecs for `HFDatabaseRecord` (id, customData, template), `HFMatchRecord` (record+score), `HFMatchGallery` (records[]+count); `HFParseResultMatchGallery`.
- `hidFaceFfi.ts`: declare/wrap `HFAddRecordWithCaptured`, `HFAddRecordWithTemplate`, `HFDeleteRecord`, `HFGetRecord`, `HFListRecords`, `HFAddRecordToGallery`, `HFRemoveRecordFromGallery`, `HFListGalleries`, `HFAsyncIdentifyWithCaptured/Template`, `HFAsyncVerifyWithCaptured/Template`.
- `hidFaceSdk.ts`/`faceModule.ts`/`types.ts`: seam + public methods + types:
  - Records: `addRecord({id, customData?, template} | fromCaptured)`, `listRecords(gallery?)`, `getRecord(id)`, `deleteRecord(id)`; galleries: `addToGallery`/`removeFromGallery`/`listGalleries`.
  - Match: `identify({template|captured, gallery?, maxResults?, minScore?}) → MatchRecord[]` (ranked); `verify({recordId, template|captured, minScore?}) → {match, score}`.
- Distinguish **enroll quality** (`REC_MIN_ENROLL_TEMPLATE_QUALITY`) from verify quality in the enroll path.

**Backend (`facepod-tester/server`)**
- `facepodSession.ts`: record CRUD, identify, verify (all op-locked); a **perpetual-identify** watch mode (capture → identify-against-gallery each cycle, returns the top match for the live frame).
- `main.ts`: `GET/POST/DELETE /api/records`, `GET /api/records/:id`, `GET/POST/DELETE` gallery routes, `POST /api/identify`, `POST /api/verify`. (Full shapes in Appendix A.)
- `mockClient.ts`: in-memory record store with realistic 1064-B templates; identify ranks by a deterministic score; verify thresholds at 0.59 (L2); mock scenarios `identify-hit`/`identify-miss`/`enroll-ok`/`gallery-empty`.

**API/UI contract**: enrollment flow (capture or upload → name/customData → add), records list (with delete + "delete all"), identify panel (ranked matches + scores against a live capture), verify-against-record, and a **perpetual-identify** live mode reusing the watch loop. UI must show a clear **data-at-rest** notice when enrollment is enabled.

**Tests:** gallery/record/matchgallery codecs; record CRUD shaping; identify ranking + verify thresholding; mock store; session op-lock serialization; all routes. **On-device:** enroll 2–3 faces, identify a live face (correct top match + score), verify hit/miss, delete + DB-reset cleanup.

---

## Phase 5 — Cross-cutting hardening

- **Error mapping:** extend `server/errors.ts` + lib `errors.ts` for new failure modes (parameter rejected, record-not-found, gallery-empty, identify-no-match vs error, diag-unsupported). Map to correct HTTP statuses.
- **Status surface:** `GET /api/status` reports new state (stream mode, high-res, record count, enrollment-enabled, perpetual-identify on/off).
- **Mock parity audit:** every public method has a mock; scenarios cover the new flows.
- **Docs:** update lib `README.md` + `mod.ts` exports; append `HIDFACE-ABI.md` (new flags/structs/diag codes); write the paired design doc reference; mark the gap-analysis items as implemented.
- **Integration tests:** end-to-end through the mock for each capability; on-device acceptance checklist per phase.
- **Concurrency review:** confirm all new ops serialize on the op-lock and honor the `getVideoFrame` teardown contract.

---

## Out of scope (explicitly)
- **LED & audio** — host-side via FT260 USB-HID, *not* in HFApi. A separate seam/driver; optional later follow-up (the kiosk demo's accept/reject sounds + LED would need an FT260 binding).
- **Crypto / CP001 provisioning / secure-credentials / RBAC** — deployment/security admin, high risk.
- **Network / SSL / 802.1X / time-sync / CORS config** — deployment admin (NetHFAPI-side anyway).
- **Firmware update, factory reset, decommission, emergency reset** — destructive / can re-lock or brick the device.
- **NetHFAPI REST transport** — FFI-only constraint holds.

---

## Risks & mitigations
| Risk | Mitigation |
| --- | --- |
| ~~Param writes never exercised~~ — RESOLVED (Phase 0): writes work, are context-scoped (reset on reopen), not persisted | n/a — confirmed safe |
| Monotonic constraints cause confusing failures | Confirmed: loosen-past-default → `rc=8 ARGUMENT_INVALID`, value unchanged; tighten + restore-to-default OK. Lib returns `applied: set/rejected`; UI clamps to factory envelope |
| Enrollment writes persistent biometric data | Opt-in only, labeled data-at-rest notice, easy bulk delete, default stays stateless |
| Reboot/DB-reset are destructive | Double-confirm tokens; never automatic; factory/firmware excluded |
| Op-lock contention (new ops vs watch loop) | Reuse session busy lane + abort/drain; serialize all ops |
| ~~Identify struct/codec wrong~~ — RESOLVED (Phase 0): full enroll→identify→verify→delete round-trip parsed correctly (self-match 1.0), DB left clean | n/a — codecs confirmed |
| Sibling-repo drift | Lib + tester change together (already co-developed on `feature/facepod` / `feature/live-hud-fixes`) |

## Suggested sequencing
Phase 0 (all probes) → **1 → 2 → 3** in parallelizable order (params/capture/diagnostics are largely independent) → **4** (depends on records/identify probe) → **5** (hardening). Each phase is independently shippable behind the stable API contract.

---

## Appendix A — HTTP API contract (stable interface for the UI)

Existing (unchanged): `GET /api/status`, `GET /api/parameters`, `POST /api/capture`, `POST /api/process-image`, `POST /api/match`, `GET /api/video-frame`, camera open/close, connect/disconnect, mock scenario.

**New:**
```
POST   /api/parameters            { params: Partial<DeviceParameters> }
        → { parameters, applied: Record<key,"set"|"clamped"|"rejected">, rejected?: {key,reason}[] }

POST   /api/capture               (+ option) { …, highRes?: boolean }
        → result gains highResImage?: { datatype, data }

GET    /api/diagnostics/logs?type=hfapi|http|jengine|secure|auth|db-sync|db-audit|fw|camera|illumination
        → { type, text|entries }
POST   /api/diagnostics/echo      { data: string } → { echoed: string }
POST   /api/diagnostics/reboot    { confirm: true } → { status }
POST   /api/diagnostics/database-reset { confirm: true } → { status, deleted: number }

GET    /api/records               (?gallery=) → { records: [{ id, customData?, quality?, hasTemplate }] }
POST   /api/records               { id, customData?, source:"captured"|"template", template?, gallery? }
        → { record }
GET    /api/records/:id           → { record: { id, customData?, template } }
DELETE /api/records/:id           → { deleted: true }
GET    /api/galleries             → { galleries: [{ id, count }] }
POST   /api/galleries/:id/records { recordIds: string[] } → { gallery }
DELETE /api/galleries/:id/records { recordIds: string[] } → { gallery }

POST   /api/identify              { source:"captured"|"template", template?, gallery?, maxResults?, minScore?,
                                    capture?: {minimalQuality, maximalSpoofScore?, timeoutMs?} }
        → { matches: [{ recordId, customData?, score }], live?: CaptureResult }
POST   /api/verify                { recordId, source:"captured"|"template", template?, minScore?,
                                    capture?: {...} }
        → { match: boolean, score: number, live?: CaptureResult }
```
Perpetual-identify is a client-driven loop over `POST /api/identify {source:"captured"}` reusing the existing watch-loop cadence; the live frame stream is unchanged (`/api/video-frame`).

## Appendix B — Settable parameters (from HFTypes.h, monotonic noted)
Stream/capture mode (10004/10005), stream/capture encoding (10006/10002, JPEG/PNG/ISO), camera reservation timeout (10007), high-res enable (11001), suspend (11002), idle timeout (11003), encoding acceleration (11004), low-power mode/timeout (11005/11006), face-select policy (12001: AUTO/SMART/LARGEST/BEST_QUALITY), **min/max distance** (20001/20002 — ↑/↓-only), **min/max roll·pitch·yaw** (20003–20008 — ↑/↓-only), margin (20009), only-centered (20010), max-results (20100), day/night thresholds + viscosities (20200–20203), AE timeouts (20204/20206), capture stabilization (20205: NONE/MILD/MEDIUM/STRICT), JPEG quality (20300). Read-only: SDK/product/PAD versions, serial, all `REC_*` recommended thresholds. `SYSTEM_TIME` (20400) is firmware-not-implemented on this unit.
