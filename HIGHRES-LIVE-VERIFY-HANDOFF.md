# FacePod 4K High-Res — Live On-Device Verification Handoff

**From:** Windows kiosk (HID FacePod, HFApi 1.1.0.336, fw 1.2.0.286, serial 5301672200098)
**Date:** 2026-06-24
**Branches under test:** hardware-libs `feature/facepod` (captureHighRes seam) + facepod-tester `feature/highres-slice1`
**Mode:** LIVE FFI (`mock:false`). No code changed on the device; behavioral issues handed back unpatched.

## TL;DR
The 4K high-res seam fundamentally **works** — genuine `2160×3840` PNG stills (~6.5–8 MB, 2× the 1080×1920 default) capture, download, and open over real USB/Deno-FFI. Three behavioral issues need dev-side triage. Two are in the hardware-libs FFI seam; one is connect/loader config.

## Pass/Fail
| Test | Verdict | Notes |
|------|---------|-------|
| T1 — 4K capture (face) | PASS w/ caveat | 4K downloads+opens; **first capture of the session was 1080×1920** (Finding 1) |
| T2 — Faceless | FAIL vs spec | Throws instead of `{hasImage:false}` (Finding 2) |
| T3 — One-shot eviction | PASS | Re-fetch used id → HTTP 404 `NotFoundError` |
| T4 — Normal capture after high-res | PASS | `numberOfFaces:1, isCaptured:true`, 1080×1920 PNG; normal path unaffected |

T1 dimensions observed: 1× `1080×1920` (~2.35 MB) then 7× `2160×3840` (~6.5–8.1 MB), all valid PNG (bitDepth 8, RGB).
Specific A ("face present but no hi-res image"): **not observed**; reachable in code only (`hidFaceFfi.ts:439` `parseImage(IMAGE_HIGH_RES)→null`).
Specific B (faceless context error): **= 14**.

---

## Finding 1 — First high-res capture of a session returns the 1080×1920 default (warm-up race)
**Severity:** High (silent wrong-resolution result on a user's first 4K capture)
**Repo:** hardware-libs (`hid/facepod/src/hidFaceFfi.ts` `captureHighRes`), possibly interacting with the tester's live frame lane.
**Symptom:** Through `POST /api/capture-high-res`, the *first* image-producing capture returned `width:1080,height:1920` (~2.35 MB, valid PNG). All 7 subsequent captures (same session/face) returned true 4K `2160×3840`.
**Likely cause:** The camera hasn't switched to high-res mode before the first frame is grabbed — the first frame is a pre-switch (default-res) frame. `CAMERA_ENABLE_HIGH_RES=1` is `#check`ed and succeeds, so it's not a failed enable; it's a timing/first-frame race.
**Not confirmed:** device-level vs tester-level (the direct `examples/ffi/highResProbe.ts` couldn't catch a face in its retry window when re-run; operator had stepped out).
**Repro:** connect+open, face in frame, fire `capture-high-res` and inspect `width/height` on the FIRST call.
**Suggested dev-side next step:** after enabling high-res, discard/settle one frame before the returned capture, or verify returned image dims == high-res and retry once if default; and re-run `highResProbe.ts` to see if the first raw-FFI frame is also 1080 (isolates device vs tester).

## Finding 2 — Faceless high-res throws (context error 14) instead of normalizing to `{hasImage:false}`
**Severity:** Medium (contract break; faceless is a normal outcome, not a fault)
**Repo:** hardware-libs `hid/facepod/src/hidFaceFfi.ts:424-425`
**Symptom:** Faceless `capture-high-res` → `HTTP 502 {"error":{"name":"FaceModuleApiError","message":"high-res capture failed (context error 14)","code":14}}`. Expected `{"result":{"hasImage":false}}`.
**Root cause:** The device returns `CONTEXT_ERROR=14` with the `NUMBER_OF_FACES` field **absent** on a faceless capture, so the guard `if (contextError !== 0 && numFacesRaw === undefined) throw ...` (line 424) fires before the intended faceless branch `if (numFaces < 1) return { faceFound: false }` (line 434). The code comment at lines 431-433 explicitly anticipated this ("Task 14 … if faceless also sets a CONTEXT_ERROR code, allowlist exactly that code here").
**Fix:** Allowlist context error **14** as the benign faceless outcome (treat as `faceFound:false` rather than throwing) while other context errors still throw.
**Note:** Normal `/api/capture` faceless is already correct — `numberOfFaces:0`/`no_face`, no throw.

## Finding 3 — Connect requires `HIDFACE_DLL_PATH` in the process env; body `dllPath` alone fails
**Severity:** Medium (operational; documented connect command fails on a fresh launch)
**Repo:** spans facepod-tester (`server/config.ts`) + hardware-libs loader (`hid/facepod/src/hidFaceFfi.ts:159` `#addDllDir`/`SetDllDirectoryW`)
**Symptom (reproduced 2×, deterministic):** `POST /api/connect {"dllPath":"…HidFace.dll"}` on a server launched WITHOUT the env var → `Could not open library: The specified module could not be found.` With `HIDFACE_DLL_PATH` set at launch, connect works with **either** an empty body **or** a body `dllPath`.
**Analysis:** The deciding factor is the **presence of the env var in the process**, not the resolved path — `config.dllPath` is the same full path in both the passing and failing cases, and the code does thread it to `new HidFaceFfi(ffiOptionsFromConfig(merged))` (`mod.ts:59`). Yet co-located `ICypher.dll` only resolves when the env var is present, which suggests the `SetDllDirectoryW(parent)` seam is not sufficient on its own under Deno's `dlopen` (libloading) on this box.
**Workaround / known-good launch:** `HIDFACE_DLL_PATH=C:\Users\Facepod\Desktop\FacePODDemo_MattWolfe\HidFace.dll deno task dev` (then connect with empty body).
**Suggested dev-side next step:** investigate the `SetDllDirectoryW`-vs-env interaction (e.g. switch to `AddDllDirectory` + `LOAD_LIBRARY_SEARCH_*`, or prepend the dir to `PATH` in the loader) so a body/config `dllPath` resolves co-located deps without the env var.

---

## Environment / how it was run
- Cleared a leftover tester (deno PIDs holding 8787) before launching; FacepodProximityService left running (coexists).
- Launch: `HIDFACE_DLL_PATH=…HidFace.dll deno task dev` → `127.0.0.1:8787` `[LIVE]`. Gate header `x-facepod-tester:1` on all `/api/*`.
- After: disconnected, stopped deno, port free, repos restored to their v2 branches (hardware-libs `feature/facepod-v2-ffi-groundtruth`, facepod-tester `feature/full-device-capabilities`).
