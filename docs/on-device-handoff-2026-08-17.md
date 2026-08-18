# On-device handoff — FacePod changeset + demo integration

**Written:** 2026-08-17 · **Run + corrected:** 2026-08-18 · **Device:** HID U.ARE.U Face Module
(HF API 1.1.0.336)

Everything below is copy-pasteable. Each step states its **PASS** condition. Stop at the first
FAIL and record the output — later steps assume earlier ones passed.

## STATUS after the 2026-08-18 run

**Validated on hardware.** The changeset is pushed and the kiosk confirmed it against a real
face: library `c7de44b`, tester `2ef7d3f`, demo `a9a1f59`.

| | Result |
|---|---|
| §0 prerequisites | all pass — Deno **2.9.2** (Windows, V8 14.9, TS 6.0.3) |
| §1 tester | 8 of 9 pass; **§1.8 is the one open gate** |
| §1.2 the correctness fix | **PASS** — unmeasured capture returns `{passed: false}` with the `spoofScore` key **absent** (was `{spoofScore: 0, passed: false}`) |
| §1.3 | **PASS** — HTTP 400, was 500 |
| §1.5 | **PASS** — hex read back exactly `46414345504f442d444941472d4543484f` |
| §2 demo | **PASS** on lineage B — 634/0, both boarding flows walked, ATR200 unplug/replug clean (fault 2.7 s, recovery ~2 s, no cross-device fault leakage) |
| library suite | 243 passed + 1 platform-skipped on Windows = 244, matching the macOS baseline |

**Still open: §1.8 only.** It needs a kiosk with a physically reachable camera cable; the
2026-08-18 machine could not reach one. Everything else in §1 and §2 is closed.

The corrections from that run are folded in below and marked **[corrected 08-18]**.

---

## 0. Blocking prerequisites — do these first, in order

> **Where each step runs:** §0.0 is on the **dev machine** (that is where the uncommitted work
> lives). Everything from §0.0b onward is on the **Windows kiosk**.

### 0.0 Publish the work — ✅ DONE 2026-08-18 · *dev machine*

> **Completed.** Pushed from the macOS dev machine: hardware-libs `c5e70ae..c7de44b`
> (`feat/hid-facepod`), facepod-tester `81537a6..2ef7d3f` (`feature/diagnostics-slice2`), and
> mobile-boarding `a9a1f59` to the **new** branch `feat/facepod-demo-liveness-cleanup` — see
> §2.5.1 for why it could not go to `feat/facepod-config-system`. The procedure below is retained
> as the record of what was done. Skip to §0.0b.

**This is the hard blocker.** At the time of writing, all three repos sit at **0 ahead / 0
behind** their upstreams, and the entire changeset is uncommitted working-tree state on the dev
machine. A kiosk that clones `feat/hid-facepod` today gets `c5e70ae` — the code *before* any of
this. Nothing below works until these are committed and pushed.

| Repo | Local branch | Upstream | Uncommitted |
|---|---|---|---|
| `hardware-libs` (worktree `wt-pr55`) | `pr55/hid-facepod` | `origin/feat/hid-facepod` | 7 files |
| `facepod-tester` | `feature/diagnostics-slice2` | `origin/feature/diagnostics-slice2` | 21 modified + 9 untracked |
| `mobile-boarding` | `feat/facepod-config-system` | **NONE — never pushed** | 9 files |

**⚠ Stage explicit paths, never `git add .`** — `docs/superpowers/` is *not* in
`facepod-tester/.gitignore`, so `add .` sweeps 8 design documents into the commit. They are
meant to stay on-disk only.

```bash
# 1) hardware-libs (from the wt-pr55 worktree)
cd wt-pr55
git add hid/facepod/src hid/facepod/tests
git commit -m "FacePod: honest liveness contract, Promise.try, and stdlib cleanups"
git push                                   # → origin/feat/hid-facepod

# 2) facepod-tester — explicit paths; docs/superpowers stays local
cd ../facepod-tester
git add README.md deno.jsonc server/ src/ docs/on-device-handoff-2026-08-17.md
git status --short                         # CONFIRM: no docs/superpowers/ entries staged
git commit -m "FacePod tester: optional spoofScore, Promise.try, stdlib + validation cleanups"
git push                                   # → origin/feature/diagnostics-slice2

# 3) mobile-boarding — has NO upstream; -u is required on the first push
cd ../mobile-boarding
git add demos/facepod-boarding/server demos/facepod-boarding/src
git commit -m "FacePod demo: optional spoofScore, Promise.try, name-based error test"
git push -u origin feat/facepod-config-system
```

Two notes before you run these:

- **Revert the import-map swap first if you did 0.2 already.** `facepod-tester/deno.jsonc` must
  be committed with the `jsr:` pin, never the relative path (see 0.2).
- **`docs/superpowers/specs/2026-08-17-facepod-session-core-extraction.md`** (the session-core
  extraction design) is inside the excluded pile, so it will NOT be committed and has no remote
  backup. Copy it somewhere durable if you want it to survive this machine.

### 0.0b Get the code onto the kiosk

The kiosk needs **two sibling checkouts** — the tester resolves the library through a relative
path (`../hardware-libs/…`), so the layout is load-bearing:

```
C:\Demos\
  hardware-libs\      ← branch feat/hid-facepod
  facepod-tester\     ← branch feature/diagnostics-slice2
  mobile-boarding\    ← branch feat/facepod-demo-liveness-cleanup  (only for section 2)
```

Fresh clone:

```cmd
mkdir C:\Demos && cd C:\Demos
git clone -b feat/hid-facepod https://github.com/elevationai/hardware-libs.git
git clone -b feature/diagnostics-slice2 https://github.com/joncomstock/facepod-tester.git
git clone -b feat/facepod-demo-liveness-cleanup --recurse-submodules https://github.com/elevationai/mobile-boarding.git
```

Already cloned — update in place:

```cmd
cd C:\Demos\hardware-libs   && git fetch origin && git checkout feat/hid-facepod          && git pull
cd C:\Demos\facepod-tester  && git fetch origin && git checkout feature/diagnostics-slice2 && git pull
cd C:\Demos\mobile-boarding && git fetch origin && git checkout feat/facepod-demo-liveness-cleanup && git pull
cd C:\Demos\mobile-boarding && git submodule update --init --recursive
```

**PASS:** each repo reports the expected branch and `git status` is clean. Confirm the tester
actually has this work — a missing `toErrorDetail` means you pulled a stale branch:

```cmd
cd C:\Demos\facepod-tester && findstr /C:"toErrorDetail" src\api.ts
```

> `mobile-boarding` carries the `vendor/hardware-libs` **submodule** — a plain `git pull` does
> NOT update it. Always follow with `git submodule update --init --recursive`, or you will be
> running library code from whatever revision was last checked out.

### 0.1 Deno version — the single highest risk in this changeset

`Promise.try` replaced a hand-rolled helper in **11 library call sites and both session
managers**. It is ES2025 / V8 12.9+, i.e. **Deno ≥ 2.1**. On an older Deno every device
operation throws `TypeError: Promise.try is not a function` immediately — connect, capture,
match, everything.

```cmd
deno --version
```

**PASS:** `deno 2.1.0` or newer.
**FAIL → STOP.** Upgrade Deno before anything else; nothing downstream will work. Do not try
to work around it — the swap is intentional and the fix is the runtime, not the code.

### 0.2 The tester's library pin is not published yet

`facepod-tester/deno.jsonc` reads `"@eai/hid/facepod": "jsr:@eai/hid@^1.0.0/facepod"`. That
package **does not exist on JSR yet** — PR #55 has not merged/published. For on-device work,
swap that one line to a relative path and **do not commit it**:

```jsonc
// facepod-tester/deno.jsonc line 10 — TEMPORARY, revert before committing
"@eai/hid/facepod": "../hardware-libs/hid/facepod/mod.ts",
```

With the 0.0b layout that resolves to the sibling clone — `C:\Demos\hardware-libs`, on branch
`feat/hid-facepod`. Confirm:

```cmd
deno check server/main.ts
```

**PASS:** `Check server/main.ts`, exit 0.
**FAIL:** wrong relative path, or the checkout is not on the #55 branch.

> A previous round committed that relative path by accident and a fresh clone failed with
> TS2307 plus two implicit-any cascades. Revert it before committing — including from the
> kiosk, where this swap leaves the working tree dirty.

**Once PR #55 merges and `@eai/hid` publishes to JSR, skip 0.2 entirely** — the committed
`jsr:` pin resolves on its own and no sibling checkout is needed. At that point
`C:\Demos\hardware-libs` is only required if you want to test library work that is still
unlanded.

### 0.3 Camera exclusivity

**The FacePod camera is exclusive — exactly one process may hold it.** Before any FFI run,
confirm nothing else has it: no other `deno` process, no earlier tester/demo backend, no probe
script. `HFEnumerateCameras` returns 0 cameras when something else holds the device, which
presents as "no HF API camera found" rather than anything obviously about contention.

```cmd
tasklist | findstr deno
```

**PASS:** no stale `deno.exe`. Kill any you find before proceeding.

### 0.4 Port collision between the two apps

Both backends default to **8787**. The tester's Vite is 5174, the demo's is 5175, but the
**backends collide**. Combined with 0.3, this means: run the tester section fully, shut it
down, then run the demo section. Never both.

---

## 1. Tester — changeset regression pass

```cmd
cd C:\Demos\facepod-tester
npm install
npm run build
set FACEPOD_DLL_PATH=C:\Users\Facepod\Desktop\FacePODDemo_MattWolfe\HidFace.dll
deno task dev
```
Then in a second terminal `npm run dev` → http://localhost:5174 (or use the built UI on 8787).

**[corrected 08-18] `FACEPOD_DLL_PATH` is required, not optional.** The loader derives `dllDir`
from it, and that directory is what lets `HidFace.dll`'s siblings resolve — `HFApiWrapper.dll`,
`ICypher.dll`, and three `Accord*.dll`. Without it the load fails as *"The specified module could
not be found"*, which names the DLL you pointed at rather than the sibling that is actually
missing. The path baked into `src/live/connectionSettings.ts` covers Go Live in the UI; the env
var covers the backend's own loader.

**[corrected 08-18] Rebuild before trusting anything you see in the UI.** `dist/` is gitignored,
so a stale bundle is served silently with no warning — the copy found on the kiosk was five weeks
older than its source. `npm run build` above is not optional for UI-based observations.

### 1.1 Connect + camera open — proves `Promise.try` and the `#cameraOpen` removal

Click **Go Live**.

**PASS:** the status strip shows camera open, and device info populates with the HF API version
(e.g. `1.1.0.336`). The `cameraOpen` flag now derives from `device.isOpen` rather than a mirrored
field — if it ever disagrees with reality, that is the regression.

**[corrected 08-18] `deviceId` reads `"unknown"` here, and that is correct.** An earlier version
of this step expected the serial `5301672200098`; that expectation was wrong. Serial and firmware
require an open context — `hidFaceFfi.ts:627` caches them inside `open()`, and `getInfo()` falls
back to `"unknown"` when they are absent (`:365`). The session calls `connect()` → `getInfo()`
*before* `openCamera()`, so a pre-open read has no serial to report. To see it, re-read
device-info **after** the camera is open. Both consumers report `"unknown"` at connect.

**FAIL signature for a stale Deno:** `Promise.try is not a function` → go back to 0.1.

### 1.2 Unmeasured liveness — **the correctness fix; the most important step here**

In Settings, **clear `maximalSpoofScore`** (leave it unset), then capture.

**PASS, all three:**
- Liveness gauge reads **empty / "—"**, NOT `100%`
- Frame Data → Spoof score reads **"not measured"**
- Liveness verdict reads **"n/a"**, not PASS

**FAIL:** a gauge showing `100%` or a spoof score of `0.000` means an unmeasured capture is
being rendered as maximally live. That is precisely the defect this changeset fixed
(`spoofScore` is now optional and the UI guards on its absence, not on a `faceStatus` string).

Then set `maximalSpoofScore` to `0.5` and capture again.
**PASS:** gauge shows a real number, Frame Data shows a score to 3 decimals, verdict PASS/FAIL.

### 1.3 Threshold validation → 400, not 502

Set `minimalQuality` to something out of range (e.g. `50`) and capture.

**PASS:** the error pill reads an **InvalidArgumentError** naming `minimalQuality`, and the
network tab shows **HTTP 400**.
**FAIL:** a 502 Bad Gateway blames the device for the caller's input — the old behaviour.

### 1.4 setParameters — proves the inlined `HFSetParamInt`/`HFSetParamDouble`

Open the Tune drawer. Write a **narrowing** pose limit (e.g. `maxYaw` 15 → 10), then a
**widening** one (e.g. `maxYaw` → 45).

**PASS:** narrowing reports `applied` with the new effective value; widening reports
`rejected` or `clamped` with the effective value read back from the device. Statuses come from
a real read-back, so an `applied` that did not change the value is a FAIL.

Then close and reopen the camera and re-read.
**PASS:** values return to factory defaults — writes are context-scoped, not persisted.

### 1.5 Diagnostics — proves `encodeHex`

Hit the Diagnostics panel (`GET /api/diagnostics`).

**PASS:** `ok: true`, `match: true`, and `sentHex` == `receivedHex` ==
`46414345504f442d444941472d4543484f` (that is `FACEPOD-DIAG-ECHO`, 17 bytes, 34 hex chars,
lowercase). A different case or an odd length means the encoder swap regressed.

### 1.6 Logs — proves the clamp now lives only at the HTTP boundary

```cmd
curl -H "x-facepod-tester: 1" "http://localhost:8787/api/logs?code=hfapi&cursor=0&limit=99999"
```

**PASS:** exactly **1000** entries (the hard max), not more. The session no longer re-clamps,
so this proves `parseLogQuery` is doing it.

```cmd
curl -H "x-facepod-tester: 1" "http://localhost:8787/api/logs?code=hfapi&limit=abc"
curl -H "x-facepod-tester: 1" "http://localhost:8787/api/logs?code=reboot"
```
**PASS:** `400` for the bad limit; `422` for the destructive code.

### 1.7 Image datatypes — proves the shared `isImageDatatype`

Upload a reference JPEG, then a PNG.
**PASS:** both accepted; `PNG`/`JPG` uppercase also accepted (the wire boundary case-folds).
Send a bogus datatype → **422** naming the datatype.

### 1.8 Freshness UI — proves the collapsed `freshnessStatus` · ⚠ THE ONE OPEN GATE

**[status 08-18] Not yet run.** The 2026-08-18 kiosk had no physically reachable camera cable,
so the pull-the-cable half could not be performed. This is the only unvalidated step in the whole
changeset — it needs a machine where the USB cable can be reached.

With the watch loop running, unplug nothing; just stop watching.
**PASS:** both the telemetry gauges and the video feed go to **paused** (not "No signal").
Resume, then pull the USB cable.
**PASS:** both lanes go to **stale / "No signal"** within ~2.5 s, and an error surfaces.
Both lanes are now driven by one function, so a lane behaving differently from the other is the
regression to look for.

### 1.9 Teardown

Click **End session**, then Ctrl-C the backend.
**PASS:** no `HFCloseContext refused` in the log, and the camera is released — re-running
`deno task dev` and connecting again succeeds. A camera left claimed means teardown regressed.

---

## 2. Demo integration

### 2.1 Blocking prerequisite — bump the vendored submodule

The demo resolves the library through `mobile-boarding/vendor/hardware-libs`, pinned at
**`5e1b4fa`**, which **predates PR #55**. Until that pin moves, the demo's liveness behaviour is
not the behaviour this changeset fixed. Two concrete consequences, both verified in the vendored
source:

- `hidFaceFfiClient.ts` emits `liveness = { spoofScore: 0, passed: false }` on the unmeasured
  path — **0, the most-live value, as the sentinel**. This is the exact defect #55 replaced with
  an omitted field.
- `deterministicMockClient.ts`'s `passedSpoof` returns **`true`** when no threshold was
  supplied — the fail-OPEN mock. A demo run in mock mode will show liveness passing a gate it
  never ran.

So: **do not judge demo liveness behaviour before the bump.** Section 1.2's expectations do not
apply to the demo until this is done.

The bump is a **commit in `mobile-boarding`**, not a local checkout — a submodule pointer only
travels if it is committed and pushed. `<sha>` is the merge commit of PR #55 on
`hardware-libs`; it does not exist until #55 lands, so this step is **blocked on that merge**.

**[corrected 08-18] The bump must be SURGICAL, not a wholesale repoint.** The pin `5e1b4fa` has
the ATR200 driver but the old facepod; `feat/hid-facepod` (`c7de44b`) has the fixed facepod but
**no `access-is` package at all**. Repointing the submodule wholesale silently deletes barcode
scanning. Check out only the one path:

```cmd
cd C:\Demos\mobile-boarding\vendor\hardware-libs
git fetch origin feat/hid-facepod
git checkout c7de44b -- hid/facepod          REM ONLY this path
```

Everything else stays at `5e1b4fa`, so `access-is/barcode/scanner.ts` and `responseDemux.ts`
(PR #35) survive. Verified on 2026-08-18: 634/0 and the honest liveness contract on device.

**This leaves the submodule dirty, not a committed pointer.** It is a validation technique, not
the integration — it will not survive a clone, and it must not be mistaken for the landed state.
The real bump still waits on #55 merging, and then a committed `git add vendor/hardware-libs`.

**PASS:** `git submodule status` shows the new SHA with a leading space (checked out and
matching). A leading `+` means the working tree differs from the committed pointer — you
checked out but did not commit the bump, and the next clone will get the old revision.

Then re-run the demo gate (see 2.2) — the mirrors in `demos/facepod-boarding/src/api.ts` already
declare `spoofScore` optional, so they are correct-and-forward-compatible today and become
*accurate* after the bump.

### 2.2 Demo gates before touching hardware

```cmd
cd C:\Demos\mobile-boarding\demos\facepod-boarding
npm install
deno install
deno task check --allow-import=code.cuss2.app:443
deno task test  --allow-import=code.cuss2.app:443
npx tsc --noEmit
```

**PASS:** check exit 0 (three entry points); test **634 passed | 0 failed**; tsc exit 0.

**[corrected 08-18] Neither Deno task runs as originally written on Deno 2.9.2.** Two additions
are required:

- `--allow-import=code.cuss2.app:443` — that host is not on Deno's default import allow-list, and
  the demo's import map resolves libraries from it by exact version.
- `deno install` — `npm install` alone does not materialize `npm:` specifiers, so `npm:jose@^5`
  fails first without it.

> `deno task check` only covers `server/main.ts`, `server/agent/main.ts` and the seeder — test
> files are **outside that graph**. A test-only type error therefore shows up in `deno task test`
> and nowhere else. That is how a `TS2305` on `InvalidArgumentError` sat green-on-check and
> red-on-test; it is fixed, but re-run **both** after the bump.

### 2.3 Demo on hardware

Shut down the tester first (0.3 and 0.4).

```cmd
deno task dev
npm run dev
```
→ backend 8787, UI http://localhost:5175

Walk the boarding flow: scan a boarding pass → face capture → CBP/TVS → result. Do it twice —
once with a mismatched pass (expect red) and once matched (expect green). Both walked clean on
2026-08-18.

**[corrected 08-18] Never poll the device-health supervisor faster than ~32 s.** The ATR200
unplug/replug path is healthy — failure detected in 2.7 s, recovery ~2 s, failing scans return
`USB device not found: VID=0db5, PID=0142` in under 100 ms rather than blocking, and
`camera:healthy` never wavers while the scanner is down (no fault leakage across device
boundaries). An earlier run appeared to show a 31-second recovery lag; that was a sampler firing
30-second scans back-to-back and starving the probe, not a supervisor defect. The same trap will
catch the next person.

**PASS:**
- Capture completes and the liveness verdict matches section 1.2's rules (**after** the bump)
- A caller-input error surfaces as **400**, not 502 (the demo carries the same
  `InvalidArgumentError` arm)
- Camera released cleanly on shutdown

---

## 2.5 Local-source wiring — running the newest code on the kiosk

**Why this section exists:** every `@eai/*` dependency of the newest demo branch is currently
**unresolvable**. Verified 2026-08-17:

| Specifier | Declared | Reality |
|---|---|---|
| `jsr:@eai/models@^1.5.0` | 1.5.0 | JSR latest is **1.4.0** — not published |
| `jsr:@eai/api-client@^0.2.0` | 0.2.0 | JSR latest is **0.1.0** — not published |
| `code.cuss2.app/@eai/hid/1.0.0/…` | 1.0.0 | **HTTP 404** |
| `code.cuss2.app/@eai/access-is/2.1.0/…` | 2.1.0 | **HTTP 404** |
| `code.cuss2.app/@eai/honeywell/1.3.0/…` | 1.3.0 | **HTTP 404** |
| `code.cuss2.app/@eai/usb/1.1.1/…` | 1.1.1 | **HTTP 404** |

Local filesystem references are therefore the only way to run the newest code on-device.
Published and fine as-is — leave them alone: `@eai/async` (1.0.1), `@eai/logging-ts` (2.7.2),
`@hono/hono`, `@std/*`, `jose`, and the npm packages.

### 2.5.1 Branch per repository

| Repo | Branch to check out | Provides | State |
|---|---|---|---|
| `hardware-libs` | **must be created** — see 2.5.2 | FacePod (#55) + ATR200 | no single branch has both |
| `mobile-boarding` | **`feat/facepod-demo-liveness-cleanup`** @ `a9a1f59` — "lineage B" | the BioBoarding demo **carrying the liveness changeset**; validated 08-18 at 634/0 | on origin |
| `domain` | `feat/register-facepod-event-codes` @ `68f1fa7` (2026-08-15) | `@eai/models` 1.5.0 (event codes 349–353) **and** `@eai/api-client` 0.2.0 | on origin |
| `facepod-tester` | `feature/diagnostics-slice2` | FacePod tester | see 0.0 |

### 2.5.2 hardware-libs needs a local integration branch

`feat/hid-facepod` (34 commits) and `feat/atr200-barcode` (5 commits) are **disjoint feature
branches** off `master` (`c5e2b9f`). Neither contains the other:

- `feat/hid-facepod` — PR #55 FacePod ✓, **no `access-is/atr200`** ✗
- `feat/atr200-barcode` — `access-is/atr200` ✓, **no PR #55 FacePod** ✗
- `integ/facepod-review` (local, `713e694`) — PR #55 ✓ but the **older `access-is/barcode`**
  path, so it does not satisfy the newest demo's `@eai/access-is/atr200` import

BioBoarding needs the scanner and the FacePod module together, so build the branch:

```bash
cd C:\Demos\hardware-libs
git checkout -b kiosk/facepod-atr200-integ origin/feat/hid-facepod
git merge origin/feat/atr200-barcode        # disjoint trees; conflicts unlikely
deno task test                              # expect green before trusting it on-device
```

Then merge §0.0's committed FacePod changeset into it if it is not already an ancestor.

### 2.5.3 Kiosk layout — four sibling checkouts

```
C:\Demos\
  hardware-libs\    ← kiosk/facepod-atr200-integ   (created in 2.5.2)
  domain\           ← feat/register-facepod-event-codes
  mobile-boarding\  ← feat/facepod-domain-eventing
  facepod-tester\   ← feature/diagnostics-slice2
```

```cmd
cd C:\Demos\domain          && git fetch origin && git checkout feat/register-facepod-event-codes && git pull
cd C:\Demos\mobile-boarding && git fetch origin && git checkout feat/facepod-domain-eventing      && git pull
```

### 2.5.4 Import-map overrides

**`C:\Demos\mobile-boarding\demos\facepod-boarding\deno.jsonc`** — replace the `@eai/*` entries.
Paths are relative to that file, so `../../../` reaches the sibling checkouts. **Local testing
only — do not commit.**

```jsonc
"@eai/hid/facepod":          "../../../hardware-libs/hid/facepod/mod.ts",
"@eai/honeywell":            "../../../hardware-libs/honeywell/mod.ts",
"@eai/access-is/atr200":     "../../../hardware-libs/access-is/atr200/src/scanner.ts",
"@eai/usb":                  "../../../hardware-libs/usb/mod.ts",

"@eai/models":               "../../../domain/models/mod.ts",
// api-client imports these sub-exports; a bare "@eai/models" mapping will NOT cover them.
"@eai/models/Device":        "../../../domain/models/src/Device.ts",
"@eai/models/Events":        "../../../domain/models/src/Events.ts",
"@eai/models/LogLevel":      "../../../domain/models/src/LogLevel.ts",
"@eai/models/Realtime":      "../../../domain/models/src/Realtime.ts",
"@eai/models/Telemetry":     "../../../domain/models/src/Telemetry.ts",

"@eai/api-client/device":    "../../../domain/api-client/src/device/mod.ts",
"@eai/api-client/realtime":  "../../../domain/api-client/src/realtime/mod.ts",
"@eai/api-client/telemetry": "../../../domain/api-client/src/telemetry/mod.ts",
```

**`C:\Demos\facepod-tester\deno.jsonc`** (this is §0.2's swap; the tester is a sibling, so one `../`):

```jsonc
"@eai/hid/facepod": "../hardware-libs/hid/facepod/mod.ts",
```

**PASS:**

```cmd
cd C:\Demos\mobile-boarding\demos\facepod-boarding && deno task check && deno task test
cd C:\Demos\facepod-tester && deno check server/main.ts
```

Local paths **inline** at bundle time whereas `jsr:` stays external, so never commit these —
they change what a published artifact contains, not just where it resolves from.

### 2.5.5 Lineage — settled by the 2026-08-18 run

**Run lineage B: `feat/facepod-demo-liveness-cleanup`.** It carries the liveness changeset and
was validated on hardware at 634/0 with both boarding flows walked.

**Lineage A (`feat/facepod-domain-eventing`) does not carry the fix and cannot receive it.** The
two share the name `feat/facepod-config-system` on origin and locally while being *independent
creations of the demo*: their merge-base is `2fb3308` (2026-07-06), which contains no
`demos/facepod-boarding` directory at all. Merging them yields **10 add/add conflicts with no
correct resolution**. Anyone running `git pull` or opening a PR across the two walks into that.

⚠ **Rename one of them before someone branches from the wrong one.**

One more branch-scoped difference that reads like a contradiction if you miss it: the demo's
`deno.jsonc` import map points at `code.cuss2.app` on **lineage A**, and at
`../../vendor/hardware-libs/…` on **lineage B**. Both are correct for their branch. On lineage A
the Dockerfile and README still describe the submodule as the import path, which is a genuine
self-contradiction in that branch — not in this document.

## 3. What to send back

For each failing step: the step number, the exact command, the full output, and — for UI steps —
a screenshot of the Frame Data panel (it shows the raw device values, which is what diagnoses
liveness questions).

Also worth recording even on a clean run:
- `deno --version` from the kiosk
- Device info line (serial / firmware / HF API version)
- The 1.5 hex string, verbatim

---

## Appendix — what changed, and why each step exists

| Step | Change under test | Repo |
|---|---|---|
| 1.1 | `Promise.try` ×11 + `#track`; write-only `#cameraOpen` removed | library + both consumers |
| 1.2 | `Liveness.spoofScore` optional; UI guards on score presence, not `faceStatus` | library types + tester UI |
| 1.3 | `assertCaptureThresholds` shrink; `InvalidArgumentError` → 400 | library + both consumers |
| 1.4 | `#setParamInt`/`#setParamDouble` inlined into `setParameters` | library |
| 1.5 | hand-rolled hex → `@std/encoding/hex` `encodeHex` | tester |
| 1.6 | session-level log clamp removed; `parseLogQuery` is the only validator | tester |
| 1.7 | local `VALID_DATATYPES` → library `isImageDatatype`/`IMAGE_DATATYPES` | tester |
| 1.8 | `telemetryStatus` + `videoStatus` collapsed into `freshnessStatus` | tester |
| 2.x | submodule pin; demo mirrors | demo |

Off-device status at handoff: library **244 passed**, tester **74 server + 72 frontend**, demo
**634 passed**; fmt/lint/check clean in all three.
