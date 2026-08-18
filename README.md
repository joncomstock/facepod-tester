# FacePod Tester

A small, standalone **local hardware test utility** for the HID **FacePod /
U.ARE.U Face Module**, built on the local `@eai/hid/facepod` library.

It is intentionally minimal — no auth, no database, no cloud. A Deno backend
owns all device communication; a React/Vite frontend drives the workflow.

> The browser **never** talks to the FacePod directly. The live transport is USB
> over Deno FFI (native `HidFace.dll`), and the library is Deno-native — so all
> device calls go through the backend.

```text
Browser (React/Vite)  ──/api──►  Deno backend (Hono)  ──USB / Deno FFI──►  FacePod (HidFace.dll)
                                       │
                                       └─ @eai/hid/facepod  (published package, unmodified)
```

## Quick start

Prereqs: **Deno ≥ 2** and **Node ≥ 18**. No sibling checkout is needed — the
FacePod library resolves from the registry (see
[Prerequisites](#prerequisites)).

**Fastest path — mock mode, no hardware, one terminal:**

```bash
npm install            # frontend deps (one time)
npm run build          # bundle the UI into dist/ (one time / after UI edits)
deno task dev:mock     # backend serves the API *and* the built UI (no hardware)
# → open http://localhost:8787
```

The app opens in **Live mode** — tap **Go Live** to connect, open the camera,
and start the continuous watch loop. A HUD displays the latest detected-face
image, three threshold-marker bars (Quality / Liveness / Match), an ACCEPT /
REJECT verdict, and derived positioning guidance. Switch to **Manual mode**
(masthead toggle) for the original step-by-step panels (01–05).

Use the **Mock scenario** selector (connection gear → panel 01 ⚙) to exercise
failure paths (`spoof`, `no-face`, `device-error`, `approaching`, …).

**Hot-reloading UI development — two terminals:**

```bash
# Terminal 1 — backend (mock); the Vite dev server proxies /api here
deno task dev:mock

# Terminal 2 — frontend dev server with hot reload
npm run dev
# → open http://localhost:5174
```

**Real hardware:** run `deno task dev` (live, USB/FFI) on the device — see
[Run — live hardware](#run--live-hardware) for the required `--allow-ffi`
permission and the `HidFace.dll` location.

> `deno task` does not auto-load `.env`, so the examples prefix env vars inline
> (e.g. `FACEPOD_MOCK=true deno task dev`). Alternatively `export` them first.

Stop either server with `Ctrl-C` (it disposes the FacePod session on the way
out).

## UI modes

| Mode               | Description                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Live** (default) | Tap **Go Live** — connects, opens the camera, and starts a continuous watch loop. The HUD shows the detected-face image refreshed by each loop iteration, three threshold-marker bars (Quality / Liveness / Match), an ACCEPT/REJECT verdict, and derived positioning guidance (bbox size / faceStatus). Optionally set an in-memory reference image to activate the Match bar. |
| **Manual**         | The original five-panel step-through (01 Connection · 02 Device Info · 03 Camera · 04 Capture · 05 Match / Upload). Useful for one-off testing, inspecting raw JSON, and exercising individual API calls.                                                                                                                                                                       |

The masthead toggle switches between modes without dropping the session.

> **Live feed boundary:** the HUD displays the **detected-face image** returned
> by each `captureAndProcess` iteration (the crop the HF pipeline actually
> evaluated). It is **not** a full-frame webcam stream. A true full-frame video
> feed with bounding-box / landmark overlay requires binding `HFGetVideoFrame`
> in `hardware-libs` — that is a separate **Phase 2** effort. Positioning
> guidance shown in the HUD is derived in-UI from bbox size and faceStatus and
> is labeled "derived, not HID-measured."

## Layout

```text
facepod-tester/
├── deno.jsonc          # backend import map (→ jsr:@eai/hid/facepod) + tasks
├── package.json        # frontend (React + Vite)
├── server/             # Deno backend
│   ├── main.ts           # Hono app + all API endpoints + graceful shutdown
│   ├── config.ts         # env/request config parsing (mock + FFI loader knobs)
│   ├── errors.ts         # FaceModule error → JSON envelope normalization
│   ├── facepodSession.ts # single in-memory FacePod session manager (USB/FFI or mock)
│   └── mockClient.ts     # deterministic fake client for mock mode
└── src/                # React frontend (Live HUD / Manual panels / shared components)
```

## Prerequisites

- **Deno** ≥ 2.x and **Node** ≥ 18 (for the Vite dev server).
- No sibling checkout: `@eai/hid/facepod` resolves from the registry, so a fresh
  clone builds on its own. To test against **unlanded** library work, point that
  one import-map entry at a local path (e.g.
  `../hardware-libs/hid/facepod/mod.ts`) and revert it before committing — a
  committed relative path makes the repo unbuildable for anyone without that
  sibling directory.
- **For live hardware:**
  - **Windows** with the FacePod attached over USB and `HidFace.dll` available
    (plus its co-located deps — `ICypher.dll` and the MSVC runtime).
  - Device **firmware + license** that enables biometric operations (capture,
    process, match). Without the license these calls return device errors.
  - Deno run with **`--allow-ffi`** so the native DLL can load (the `dev` task
    includes it).

## Install

```bash
# Frontend deps
npm install
# Backend deps are fetched by Deno on first run (no install step).
```

Copy the env template and edit as needed:

```bash
cp .env.example .env
```

> `deno task` does not auto-load `.env`. Either export the vars in your shell,
> or prefix the command (e.g. `FACEPOD_MOCK=true deno task dev`). The examples
> below use inline prefixes so they work without any shell setup.

## Run — mock mode (no hardware)

Exercise the entire UI workflow against a deterministic fake device:

```bash
# Terminal 1 — backend (mock)
deno task dev:mock

# Terminal 2 — frontend
npm run dev      # → http://localhost:5174
```

Open the UI, tick **Mock mode** (or rely on the env flag), and click
**Connect**. Capture, process, and match all return realistic, deterministic
results so you can drive the full flow offline.

### Scenario presets

Mock mode can simulate failure paths, not just the happy path. Pick a scenario
from the **Mock scenario** selector (panel 01) — it switches **live, no
reconnect** — or set the initial one via `FACEPOD_MOCK_SCENARIO`:

| Scenario       | Simulates                                                         |
| -------------- | ----------------------------------------------------------------- |
| `good`         | high quality, live face, templates present, match succeeds        |
| `low-quality`  | quality below threshold → `isCaptured: false`                     |
| `spoof`        | high spoof score → liveness **FAIL**                              |
| `no-face`      | 0 faces, no template/image (capture-and-match reports no face)    |
| `no-match`     | good capture, but match score `0.28` → **NO MATCH**               |
| `device-error` | capture/process/match throw `FaceModuleApiError` (tests error UI) |

`device-error` keeps `getInfo`/`getCameraList`/camera-open working so you can
connect and open a camera, then see the error surface on capture.

## Run — live hardware

Live mode drives the FacePod over USB via Deno FFI (native `HidFace.dll`). Run
on the Windows device with `--allow-ffi` (the `dev` task includes it):

```bash
# Terminal 1 — backend (live, USB/FFI)
deno task dev

# Terminal 2 — frontend
npm run dev
```

By default the library finds `HidFace.dll` via its own resolution (env
`HIDFACE_DLL_PATH`, else `HidFace.dll` on `PATH`). To point at a specific
install, set the env vars below or enter them per-connect in panel 01.

### DLL configuration

The tester's env convention is `FACEPOD_*`; `HIDFACE_DLL_PATH` /
`HIDFACE_DLL_DIR` are also honored as a fallback (`FACEPOD_*` wins when both are
set).

| Env var                    | Purpose                                                                                                                    |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `FACEPOD_DLL_PATH`         | Path to `HidFace.dll` (falls back to `HIDFACE_DLL_PATH`).                                                                  |
| `FACEPOD_DLL_DIR`          | Search dir for co-located deps (`ICypher.dll`, VC runtime); falls back to `HIDFACE_DLL_DIR`, else the DLL's own directory. |
| `FACEPOD_POLL_INTERVAL_MS` | Poll interval (ms) while awaiting an async native op (default 33).                                                         |

```bash
# Example: point at a specific install
FACEPOD_DLL_PATH='C:\hid\HidFace.dll' deno task dev
```

## Single-server mode (optional)

`npm run build` emits `dist/`. If `dist/index.html` exists when the backend
starts, the backend also serves the built UI, so you can run everything from one
process:

```bash
npm run build
deno task dev:mock   # UI now also at http://localhost:8787
```

## API

All endpoints are under `/api`. Errors return
`{ "error": { name, message, code?, status?, datatype?, httpStatus } }`.

| Method + path                 | Purpose                                                                         |
| ----------------------------- | ------------------------------------------------------------------------------- |
| `GET  /api/status`            | connection state, camera state, last error, transport/DLL info                  |
| `POST /api/connect`           | create session + connect (body may override dllPath/dllDir/pollIntervalMs/mock) |
| `POST /api/disconnect`        | close camera + dispose session                                                  |
| `GET  /api/device-info`       | `getInfo`                                                                       |
| `GET  /api/cameras`           | `getCameraList`                                                                 |
| `POST /api/camera/open`       | open camera context (`cameraId?`)                                               |
| `POST /api/camera/close`      | close camera context                                                            |
| `POST /api/capture`           | `captureAndProcess` (`minimalQuality`, `maximalSpoofScore?`, `timeoutMs?`)      |
| `POST /api/process-image`     | `processImage` (`image` base64, `datatype` png/jpg/jpeg)                        |
| `POST /api/match`             | `matchWithTemplate` (`template1`, `template2`, `minimalMatchScore`)             |
| `POST /api/capture-and-match` | process reference image → capture live → match (combined)                       |
| `POST /api/mock/scenario`     | switch the live mock scenario (mock mode only)                                  |

## Tests

```bash
npm test          # frontend unit tests (vitest — Live HUD logic, bar state, verdict)
deno task test    # backend unit tests (config parsing + error normalization)
deno task check   # backend type-check
npm run build     # frontend type-check + build
```

Automated tests do **not** require FacePod hardware.

## Manual live smoke test

With the backend running live on the device (`deno task dev`, valid license):

### Live mode (default)

1. Tap **Go Live** — the app connects, opens the default camera, and starts the
   continuous watch loop automatically.
2. Stand in front of the camera; watch the Quality / Liveness bars fill and the
   verdict update.
3. Optionally tap **Set reference…**, choose a PNG/JPEG face; the Match bar
   activates and contributes to the verdict.
4. Tap **Continuous watch · ON** to pause the loop (clears the last
   frame/verdict); tap again to resume.
5. Tap **End session** to close the camera, disconnect, and return to the idle
   screen.

### Manual mode (for step-by-step testing)

Switch to **Manual** in the masthead toggle, then:

1. **Connect** (panel 01) — leave mock unticked (live); device info appears.
2. **Get Device Info** / **Get Cameras** (panel 02) — confirm the device and
   camera list.
3. **Open Camera** (panel 03) — pick a camera (or default) and open the context.
4. **Upload + Process Reference** (panel 05) — choose a PNG/JPEG face; click
   _Process Reference → Template_.
5. **Capture Live Face** (panel 04) — set quality/spoof thresholds; click
   _Capture Live Face_.
6. **Match** (panel 05) — click _Match Reference ↔ Live_ (or _Capture & Match_
   for the combined flow); check the pass/fail verdict, score, and liveness.
7. **Close Camera** (panel 03).
8. **Disconnect** (panel 01).

## Security model

This is an unauthenticated **local** hardware-control API, so it is locked down
to the operator's machine:

- The backend binds **`127.0.0.1` only** — never exposed on the LAN.
- **CORS is restricted** to the loopback Vite-dev and backend origins (no
  wildcard).
- **CSRF gate** (the real cross-site defense — CORS alone doesn't stop "simple"
  form / `no-cors` POSTs from reaching the server): every `/api/*` route
  requires a custom `X-FacePod-Tester` header and mutations require
  `Content-Type:
  application/json`. Neither can be set by a drive-by page
  without triggering a preflight that the CORS allow-list denies. The UI sends
  both automatically; see [server/security.ts](server/security.ts). Disallowed
  requests get `403`/`415` before any device action runs.
- The device + camera context are single-occupancy: overlapping operations are
  rejected with **`409 BusyError`** rather than racing the hardware.

## Notes

- This app is **not** production software and adds **no** CUSS2/platform
  abstractions — it is purely a local FacePod tester.
- The UI follows the **AirOps** visual language (near-black canvas, bright-cyan
  accent, self-hosted Urbanist, hairline flat frames, tinted pill badges, cyan
  glow on live data). Urbanist TTFs are vendored under `public/fonts/`. Tokens
  mirror `@airops/theme` but are expressed in plain CSS (no Tailwind/Radix
  dependency).
- `hardware-libs` is consumed read-only; it is not modified by this project.
- Do not commit `.env` or `*.pem` (see `.gitignore`). No real keys are
  hard-coded.
