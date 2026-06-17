# FacePod Tester — Consume Phase 2 lib surface — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the tester consume the already-published `@eai/hid/facepod` Phase 2 surface — real positioning feedback (replacing the derived heuristic), read-only device parameters (shown as reference, never altering the verdict gate), and landmark/bbox data — and restore the green build the new lib interface broke.

**Architecture:** Backend stays a thin passthrough: `/api/capture` already returns the lib `CaptureResult` whole, so positioning/landmarks flow once the UI types them; a new read-only `GET /api/parameters` exposes `getParameters()`. The UI keeps the operator-set verdict gate unchanged and shows device thresholds only as reference (a second bar tick + a Manual parameters panel). Device-params state is owned by `App` via a shared `useDeviceParameters` hook (Live and Manual both read it).

**Tech Stack:** Deno + Hono backend (`deno task test` / `deno task check`); React 18 + Vite + TypeScript front-end (`npm test` = Vitest, `npm run build` = `tsc -b && vite build`). Lib resolved by local path `../hardware-libs/hid/facepod/mod.ts`.

## Global Constraints

- `hardware-libs` is **READ-ONLY** — consume `@eai/hid/facepod` as published; never edit it.
- Verdict gate stays **operator-set**; device thresholds are reference-only and never seed or alter the gate.
- Liveness/verdict are **never fabricated** — fail closed.
- No biometric data-at-rest; reference templates stay in-memory/session only.
- Landmarks/bbox this round are **data only** — no visual overlay (coords are source-frame, the Feed shows the cropped face).
- `src/live/logic.ts` and `src/live/types.ts` stay **pure** (no React/DOM).
- `src/api.ts` `Landmark.type` stays `string` (loose, intentional) — do NOT tighten to the lib union.
- Commits carry **NO Claude/AI attribution** (no `Co-Authored-By`, no "Generated with Claude Code").
- Work from `/Users/jon/elevationai/facepod-tester` on a dedicated feature branch.

**Realistic mock `DeviceParameters` (used verbatim in Task 1; values chosen distinct from the UI defaults 0.7/0.5/0.7 so reference ticks are visibly offset):**

```ts
{
  captureImageEncoding: 1, streamMode: 0, captureMode: 1,
  recMaxSpoofProbability: 0.45, recMinEnrollTemplateQuality: 0.7,
  recMinVerifyTemplateQuality: 0.65,
  recMinMatchScoreL1: 0.8, recMinMatchScoreL2: 0.9, recMinMatchScoreL3: 0.95,
  cameraEnableHighRes: 1, cameraSuspend: 0, cameraIdleTimeoutMs: 30000,
  cameraEncodingAcceleration: 1, cameraLowPowerMode: 0, cameraLowPowerTimeoutMs: 60000,
  faceSelectPolicy: 0,
  minDistance: 0.3, maxDistance: 1.0, minRoll: -15, maxRoll: 15,
  minPitch: -15, maxPitch: 15, minYaw: -15, maxYaw: 15,
  margin: 20, onlyCenteredFaces: 1, maxResults: 1,
  dayToNightThreshold: 30, nightToDayThreshold: 60,
  dayToNightViscosity: 5, nightToDayViscosity: 5,
  aeBoundingBoxTimeoutMs: 2000, captureStabilization: 1, encodingJpegQuality: 90,
}
```

---

## Task 0: Branch

- [ ] **Step 1: Create the feature branch**

```bash
cd /Users/jon/elevationai/facepod-tester
git checkout main && git pull --ff-only
git checkout -b feature/consume-phase2-params
```

---

## Task 1: Backend mock `getParameters` (unblock the red build)

The lib made `FaceModuleClient.getParameters()` non-optional, so `DeterministicMockClient`
no longer satisfies the interface and `deno task check` currently fails. This task restores
the build and gives mock mode realistic device parameters.

**Files:**
- Modify: `server/mockClient.ts` (imports + add method to `DeterministicMockClient`)
- Test: `server/mockClient.test.ts`

**Interfaces:**
- Produces: `DeterministicMockClient.getParameters(): Promise<DeviceParameters>` returning the realistic values in Global Constraints.

- [ ] **Step 1: Write the failing test**

Add to `server/mockClient.test.ts`:

```ts
Deno.test("getParameters returns realistic params distinct from UI defaults", async () => {
  const client = new DeterministicMockClient(() => "good");
  const p = await client.getParameters();
  assertEquals(p.recMinVerifyTemplateQuality, 0.65);
  assertEquals(p.recMaxSpoofProbability, 0.45);
  assertEquals(p.recMinMatchScoreL1, 0.8);
  assertEquals(p.encodingJpegQuality, 90);
  // 33 fields populated (no undefined).
  assertEquals(Object.values(p).some((v) => v === undefined), false);
});
```

If `assertEquals` is not already imported in this file, add it to the existing
`@std/assert` import line.

- [ ] **Step 2: Run test to verify it fails**

Run: `deno task test`
Expected: FAIL — `getParameters` does not exist on `DeterministicMockClient` (type error / missing method).

- [ ] **Step 3: Add the `DeviceParameters` import**

In `server/mockClient.ts`, add `type DeviceParameters,` to the existing
`import { ... } from "@eai/hid/facepod";` block (alphabetically near `type DeviceInfo`).

- [ ] **Step 4: Implement `getParameters`**

Add this method to `DeterministicMockClient` (e.g. directly after `getCameraList`):

```ts
  getParameters(): Promise<DeviceParameters> {
    // Deterministic device config. Values chosen DISTINCT from the UI defaults
    // (0.7/0.5/0.7) so the reference ticks are visibly offset in the demo.
    return Promise.resolve({
      captureImageEncoding: 1, streamMode: 0, captureMode: 1,
      recMaxSpoofProbability: 0.45, recMinEnrollTemplateQuality: 0.7,
      recMinVerifyTemplateQuality: 0.65,
      recMinMatchScoreL1: 0.8, recMinMatchScoreL2: 0.9, recMinMatchScoreL3: 0.95,
      cameraEnableHighRes: 1, cameraSuspend: 0, cameraIdleTimeoutMs: 30000,
      cameraEncodingAcceleration: 1, cameraLowPowerMode: 0, cameraLowPowerTimeoutMs: 60000,
      faceSelectPolicy: 0,
      minDistance: 0.3, maxDistance: 1.0, minRoll: -15, maxRoll: 15,
      minPitch: -15, maxPitch: 15, minYaw: -15, maxYaw: 15,
      margin: 20, onlyCenteredFaces: 1, maxResults: 1,
      dayToNightThreshold: 30, nightToDayThreshold: 60,
      dayToNightViscosity: 5, nightToDayViscosity: 5,
      aeBoundingBoxTimeoutMs: 2000, captureStabilization: 1, encodingJpegQuality: 90,
    });
  }
```

- [ ] **Step 5: Run test + typecheck to verify green**

Run: `deno task test && deno task check`
Expected: PASS — the new test passes and `deno check` reports no errors (the TS2345/TS2420 errors are gone).

- [ ] **Step 6: Commit**

```bash
git add server/mockClient.ts server/mockClient.test.ts
git commit -m "fix(tester): implement mock getParameters to satisfy new lib interface"
```

---

## Task 2: positioningFeedback in mock capture fixtures

Give the mock realistic positioning data so the Live HUD's guidance is exercised without
hardware. The `approach` scenario ramps an **on-device-confirmed** corrective bit
(`TURN_RIGHT` = 4) while approaching, then `ok` once locked.

**Files:**
- Modify: `server/mockClient.ts` (`captureAndProcess`)
- Test: `server/mockClient.test.ts`

**Interfaces:**
- Produces: mock `CaptureResult.positioningFeedback` = `{ raw, ok, flags, unknownBits }` on the `approach` and steady (`good`/`low-quality`/`spoof`) capture results. Absent on `no-face`.

- [ ] **Step 1: Write the failing test**

Add to `server/mockClient.test.ts`:

```ts
Deno.test("approach scenario emits real positioning feedback then OK", async () => {
  const client = new DeterministicMockClient(() => "approach");
  const opts = { minimalQuality: 0.7, maximalSpoofScore: 0.5 };
  const frames = [];
  for (let i = 0; i < 16; i++) frames.push(await client.captureAndProcess(opts));
  // While approaching (face present, not yet locked) → corrective TURN_RIGHT bit.
  const correcting = frames.find((f) => f.numberOfFaces === 1 && !f.isCaptured);
  assertEquals(correcting?.positioningFeedback?.flags, ["TURN_RIGHT"]);
  assertEquals(correcting?.positioningFeedback?.raw, 4);
  // Once locked (captured) → OK (raw 0, no flags).
  const locked = frames.find((f) => f.isCaptured);
  assertEquals(locked?.positioningFeedback?.ok, true);
  assertEquals(locked?.positioningFeedback?.flags, []);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `deno task test`
Expected: FAIL — `positioningFeedback` is `undefined` on the mock results.

- [ ] **Step 3: Add positioningFeedback to the `approach` branch**

In `captureAndProcess`, inside the `if (scenario === "approach")` branch, in the returned
object for the ramping face (the one with `numberOfFaces: 1`), add a `positioningFeedback`
field computed from the lock state (synthetic — real hardware only reports positioning on a
finalized capture, and distance bits like GET_CLOSER were never observed on-device; see
docs/UI-FEEDBACK.md):

```ts
      const captured = quality >= opts.minimalQuality && passed;
      return Promise.resolve({
        quality,
        numberOfFaces: 1,
        template: faceTemplate(MOCK_LIVE_TEMPLATE),
        image: { modality: "face", datatype: "png", data: PLACEHOLDER_PNG_BASE64 },
        liveness: { spoofScore, passed },
        boundingBox: { x: 60, y: 40, width: side, height: Math.round(side * 1.2) },
        landmarks: [
          { type: "left_eye", x: 90, y: 110 },
          { type: "right_eye", x: 170, y: 110 },
          { type: "nose", x: 130, y: 160 },
        ],
        // Synthetic: corrective TURN_RIGHT while framing, OK once locked.
        positioningFeedback: captured
          ? { raw: 0, ok: true, flags: [], unknownBits: 0 }
          : { raw: 4, ok: false, flags: ["TURN_RIGHT"], unknownBits: 0 },
        isCaptured: captured,
        faceStatus: passed ? "ok" : "spoof_suspected",
      });
```

(This replaces the existing `approach` return object; the `isCaptured` value is now hoisted
into `captured` and reused.)

- [ ] **Step 4: Add positioningFeedback to the steady (non-approach) face branch**

In the final `return Promise.resolve({ ... })` of `captureAndProcess` (the steady path for
`good`/`low-quality`/`spoof`), add before `isCaptured`:

```ts
      // Steady face is well-positioned; spoof fails on liveness, not geometry.
      positioningFeedback: { raw: 0, ok: true, flags: [], unknownBits: 0 },
```

- [ ] **Step 5: Run test to verify it passes**

Run: `deno task test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/mockClient.ts server/mockClient.test.ts
git commit -m "feat(tester): add positioningFeedback to mock capture fixtures"
```

---

## Task 3: Session `getParameters` + `GET /api/parameters`

**Files:**
- Modify: `server/facepodSession.ts` (import + method)
- Modify: `server/main.ts` (route)
- Test: `server/facepodSession.test.ts`

**Interfaces:**
- Consumes: `DeterministicMockClient.getParameters` (Task 1).
- Produces: `FacePodSession.getParameters(): Promise<DeviceParameters>`; `GET /api/parameters` → `{ parameters: DeviceParameters }`.
- Note: `getParameters` requires an **open camera** (the lib facade `#requireOpen()` fires); not-connected throws `NotConnectedError`.

- [ ] **Step 1: Write the failing test**

Look at the top of `server/facepodSession.test.ts` to reuse its existing helper that builds a
session backed by the mock lifecycle (the same one its connect/capture tests use). Add:

```ts
Deno.test("getParameters returns device parameters when camera open", async () => {
  const session = newMockSession(); // reuse the file's existing mock-session helper
  await session.connect(mockConfig());        // reuse existing config helper
  await session.openCamera({});
  const p = await session.getParameters();
  assertEquals(p.recMinVerifyTemplateQuality, 0.65);
});

Deno.test("getParameters throws when not connected", async () => {
  const session = newMockSession();
  await assertRejects(() => session.getParameters());
});
```

Ensure `assertEquals` and `assertRejects` are imported from `@std/assert` at the top of the
file (add whichever is missing to the existing import line).

Match the exact helper/config names already used in this test file (e.g. the factory that
injects a `FaceModuleLifecycle` over `DeterministicMockClient`). If the file builds sessions
inline rather than via a helper, follow that same inline pattern.

- [ ] **Step 2: Run test to verify it fails**

Run: `deno task test`
Expected: FAIL — `session.getParameters` is not a function.

- [ ] **Step 3: Implement the session method**

In `server/facepodSession.ts`: add `type DeviceParameters,` to the `@eai/hid/facepod` import
block, then add this method (e.g. after `getCameras`):

```ts
  getParameters(): Promise<DeviceParameters> {
    return this.#track(() => this.#require().device.getParameters());
  }
```

- [ ] **Step 4: Add the route**

In `server/main.ts`, add after the `/api/cameras` route:

```ts
app.get(
  "/api/parameters",
  handle(async (c) => c.json({ parameters: await session.getParameters() })),
);
```

- [ ] **Step 5: Run test + typecheck**

Run: `deno task test && deno task check`
Expected: PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add server/facepodSession.ts server/main.ts server/facepodSession.test.ts
git commit -m "feat(tester): add session getParameters + GET /api/parameters"
```

---

## Task 4: Frontend `api.ts` — types + `CaptureResult.positioningFeedback` + `api.getParameters`

**Files:**
- Modify: `src/api.ts`
- Test: `src/live/api.test.ts` (create)

**Interfaces:**
- Produces: `PositioningFeedback`, `DeviceParameters` types; `CaptureResult.positioningFeedback?: PositioningFeedback`; `api.getParameters(): Promise<{ parameters: DeviceParameters }>`.

- [ ] **Step 1: Write the failing test**

Create `src/live/api.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { api } from "../api.ts";

describe("api.getParameters", () => {
  it("is a callable endpoint", () => {
    expect(typeof api.getParameters).toBe("function");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `api.getParameters` is undefined.

- [ ] **Step 3: Add the types**

In `src/api.ts`, after the `Landmark` interface, add:

```ts
export interface PositioningFeedback {
  raw: number;
  ok: boolean;
  flags: string[];
  unknownBits: number;
}

/** Read-only device configuration (HFParam reads). All fields always populated. */
export interface DeviceParameters {
  captureImageEncoding: number;
  streamMode: number;
  captureMode: number;
  recMaxSpoofProbability: number;
  recMinEnrollTemplateQuality: number;
  recMinVerifyTemplateQuality: number;
  recMinMatchScoreL1: number;
  recMinMatchScoreL2: number;
  recMinMatchScoreL3: number;
  cameraEnableHighRes: number;
  cameraSuspend: number;
  cameraIdleTimeoutMs: number;
  cameraEncodingAcceleration: number;
  cameraLowPowerMode: number;
  cameraLowPowerTimeoutMs: number;
  faceSelectPolicy: number;
  minDistance: number;
  maxDistance: number;
  minRoll: number;
  maxRoll: number;
  minPitch: number;
  maxPitch: number;
  minYaw: number;
  maxYaw: number;
  margin: number;
  onlyCenteredFaces: number;
  maxResults: number;
  dayToNightThreshold: number;
  nightToDayThreshold: number;
  dayToNightViscosity: number;
  nightToDayViscosity: number;
  aeBoundingBoxTimeoutMs: number;
  captureStabilization: number;
  encodingJpegQuality: number;
}
```

- [ ] **Step 4: Add the field to `CaptureResult`**

In `src/api.ts`, in the `CaptureResult` interface, add after `landmarks?: Landmark[];`:

```ts
  positioningFeedback?: PositioningFeedback;
```

- [ ] **Step 5: Add the API method**

In the `api` object, after `getCameras`, add:

```ts
  getParameters: () => request<{ parameters: DeviceParameters }>("/api/parameters"),
```

- [ ] **Step 6: Run test + build**

Run: `npm test && npm run build`
Expected: PASS, build clean.

- [ ] **Step 7: Commit**

```bash
git add src/api.ts src/live/api.test.ts
git commit -m "feat(tester): type positioningFeedback + DeviceParameters + getParameters in api client"
```

---

## Task 5: Live logic — frame fields, guidance (TDD, pure)

**Files:**
- Modify: `src/live/types.ts` (LiveFrame fields)
- Modify: `src/live/logic.ts` (toLiveFrame, positioningGuidance, guidanceFor)
- Test: `src/live/logic.test.ts`

**Interfaces:**
- Consumes: `PositioningFeedback` from `../api.ts` (Task 4); `Landmark` from `../api.ts`.
- Produces:
  - `LiveFrame.positioningFeedback: PositioningFeedback | null`, `LiveFrame.landmarks: Landmark[] | null`.
  - `positioningGuidance(fb: PositioningFeedback): string[]`
  - `guidanceFor(frame: LiveFrame): { text: string | null; derived: boolean }`
  - `deriveGuidance` retained (fallback).

- [ ] **Step 1: Write the failing tests**

Add to `src/live/logic.test.ts` (import `positioningGuidance, guidanceFor` alongside the
existing imports from `./logic.ts`; add a small `frame()` helper if the file lacks one):

```ts
import { guidanceFor, positioningGuidance } from "./logic.ts";

const baseFrame = {
  image: null, quality: 0.9, spoofScore: 0.1, livenessPassed: true,
  numberOfFaces: 1, boundingBox: { x: 0, y: 0, width: 200, height: 240 },
  isCaptured: false, faceStatus: "ok", matchScore: null, matchPassed: null,
  positioningFeedback: null, landmarks: null,
};

describe("positioningGuidance", () => {
  it("maps each known flag to a friendly string", () => {
    expect(positioningGuidance({ raw: 4, ok: false, flags: ["TURN_RIGHT"], unknownBits: 0 }))
      .toEqual(["Turn right"]);
    expect(positioningGuidance({ raw: 1, ok: false, flags: ["GET_CLOSER"], unknownBits: 0 }))
      .toEqual(["Move closer"]);
  });
  it("returns multiple strings for multiple flags", () => {
    expect(positioningGuidance({ raw: 36, ok: false, flags: ["LOWER_HEAD", "TURN_RIGHT"], unknownBits: 0 }))
      .toEqual(["Lower your head", "Turn right"]);
  });
  it("returns [] when ok", () => {
    expect(positioningGuidance({ raw: 0, ok: true, flags: [], unknownBits: 0 })).toEqual([]);
  });
  it("ignores unknownBits in the text", () => {
    expect(positioningGuidance({ raw: 256, ok: false, flags: [], unknownBits: 256 })).toEqual([]);
  });
});

describe("guidanceFor", () => {
  it("uses real feedback (not derived) when present and correcting", () => {
    const f = { ...baseFrame, positioningFeedback: { raw: 4, ok: false, flags: ["TURN_RIGHT"], unknownBits: 0 } };
    expect(guidanceFor(f)).toEqual({ text: "Turn right", derived: false });
  });
  it("says Hold still (real) when ok but not captured", () => {
    const f = { ...baseFrame, positioningFeedback: { raw: 0, ok: true, flags: [], unknownBits: 0 }, isCaptured: false };
    expect(guidanceFor(f)).toEqual({ text: "Hold still", derived: false });
  });
  it("returns null text (real) when ok and captured", () => {
    const f = { ...baseFrame, positioningFeedback: { raw: 0, ok: true, flags: [], unknownBits: 0 }, isCaptured: true };
    expect(guidanceFor(f)).toEqual({ text: null, derived: false });
  });
  it("falls back to derived when no feedback present", () => {
    const f = { ...baseFrame, numberOfFaces: 0, positioningFeedback: null };
    expect(guidanceFor(f)).toEqual({ text: "Step in front of the camera", derived: true });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `positioningGuidance`/`guidanceFor` not exported; `positioningFeedback`/`landmarks` not on the frame type.

- [ ] **Step 3: Extend `LiveFrame`**

In `src/live/types.ts`: add a type-only import at the top and two fields to `LiveFrame`:

```ts
import type { Landmark, PositioningFeedback } from "../api.ts";
```

```ts
  /** Decoded positioning feedback when the device/mock reported it; null otherwise. */
  positioningFeedback: PositioningFeedback | null;
  /** Source-frame landmark points (data only, not drawn in v1). */
  landmarks: Landmark[] | null;
```

- [ ] **Step 4: Carry the fields in `toLiveFrame`**

In `src/live/logic.ts`, in the object returned by `toLiveFrame`, add:

```ts
    positioningFeedback: cap.positioningFeedback ?? null,
    landmarks: cap.landmarks ?? null,
```

- [ ] **Step 5: Add `positioningGuidance` and `guidanceFor`**

Append to `src/live/logic.ts`:

```ts
/** Friendly string per known positioning bit. */
const POSITIONING_TEXT: Record<string, string> = {
  GET_CLOSER: "Move closer",
  MOVE_AWAY: "Move back",
  TURN_RIGHT: "Turn right",
  TURN_LEFT: "Turn left",
  LIFT_HEAD: "Lift your head",
  LOWER_HEAD: "Lower your head",
  TILT_RIGHT: "Tilt right",
  TILT_LEFT: "Tilt left",
};

/** Map decoded positioning flags to friendly strings (unknownBits excluded). */
export function positioningGuidance(fb: PositioningFeedback): string[] {
  return fb.flags.map((f) => POSITIONING_TEXT[f]).filter((s): s is string => Boolean(s));
}

/**
 * Guidance for the HUD. Prefers REAL device positioning feedback when present
 * (derived=false); otherwise falls back to the bbox/faceStatus heuristic
 * (derived=true). Real "ok" + not-captured → "Hold still"; real "ok" + captured → null.
 */
export function guidanceFor(frame: LiveFrame): { text: string | null; derived: boolean } {
  const fb = frame.positioningFeedback;
  if (fb) {
    if (!fb.ok) {
      const parts = positioningGuidance(fb);
      return { text: parts.length ? parts.join(" · ") : "Hold still", derived: false };
    }
    return { text: frame.isCaptured ? null : "Hold still", derived: false };
  }
  return { text: deriveGuidance(frame), derived: true };
}
```

Add `PositioningFeedback` to the existing `import type { ... } from "../api.ts";` line in
`logic.ts`.

- [ ] **Step 6: Run tests + build**

Run: `npm test && npm run build`
Expected: PASS (all new + existing logic tests), build clean.

- [ ] **Step 7: Commit**

```bash
git add src/live/types.ts src/live/logic.ts src/live/logic.test.ts
git commit -m "feat(tester): positioningGuidance + guidanceFor with derived fallback"
```

---

## Task 6: `useDeviceParameters` hook + App ownership

`App` owns the shared device-params cache; Live and Manual both read it. App passes
`deviceParams`, `fetchParams`, `clearParams` down, and clears on disconnect.

**Files:**
- Create: `src/live/useDeviceParameters.ts`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `api.getParameters` (Task 4).
- Produces: `useDeviceParameters(): { params: DeviceParameters | null; error: string | null; fetchParams: () => Promise<void>; clearParams: () => void }`.
- App passes to both views: `deviceParams: DeviceParameters | null`, `onFetchParams: () => Promise<void>`. (Consumed by LiveView in Task 9 and ManualView in Task 10.)

> **Test note:** the front-end Vitest harness runs in `environment: "node"` with no DOM/RTL,
> so React hooks/components are NOT unit-tested here (matching the existing repo). This task
> is verified by `npm run build` (tsc) and the Task 11 mock E2E. Do not add a DOM test.

- [ ] **Step 1: Create the hook**

`src/live/useDeviceParameters.ts`:

```ts
import { useCallback, useState } from "react";
import { api, ApiError, type DeviceParameters } from "../api.ts";

/**
 * Session-cached, read-only device parameters. Fetch is non-fatal: a failure
 * sets `error` and leaves `params` null (the UI falls back to operator
 * thresholds and shows an "unavailable" note). `getParameters` requires an
 * open camera — callers fetch only when the camera is open.
 */
export function useDeviceParameters() {
  const [params, setParams] = useState<DeviceParameters | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchParams = useCallback(async () => {
    try {
      const r = await api.getParameters();
      setParams(r.parameters);
      setError(null);
    } catch (e) {
      setParams(null);
      setError(e instanceof ApiError ? e.detail.message : String(e));
    }
  }, []);

  const clearParams = useCallback(() => {
    setParams(null);
    setError(null);
  }, []);

  return { params, error, fetchParams, clearParams };
}
```

- [ ] **Step 2: Wire into App**

In `src/App.tsx`:

1. Add the import: `import { useDeviceParameters } from "./live/useDeviceParameters.ts";`
2. Inside `App`, after the other `useState` calls, add:
   ```ts
   const { params: deviceParams, fetchParams, clearParams } = useDeviceParameters();
   ```
3. In `handleDisconnect`, add `clearParams();` inside the `after` callback (alongside the existing `setCaptureResult(null)` etc.):
   ```ts
   const handleDisconnect = () =>
     run(api.disconnect, () => {
       setDeviceInfo(null);
       setCameras(null);
       setCaptureResult(null);
       setReferenceResult(null);
       setMatchResult(null);
       clearParams();
     });
   ```
4. So this task stays independently green, declare the props as **optional** on both views
   now (they are consumed for real in Tasks 9 and 10). In `src/components/live/LiveView.tsx`
   AND `src/components/manual/ManualView.tsx`, add to each `Props` interface:
   ```ts
   deviceParams?: import("../../api.ts").DeviceParameters | null;
   onFetchParams?: () => Promise<void>;
   ```
   Then pass them from App to BOTH `<LiveView ... />` and `<ManualView ... />`:
   ```tsx
   deviceParams={deviceParams}
   onFetchParams={fetchParams}
   ```
   Unused optional props compile cleanly, so `npm run build` is green at the end of this task.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: clean (no unused-prop errors — the optional props are declared on both views).

- [ ] **Step 4: Commit**

```bash
git add src/live/useDeviceParameters.ts src/App.tsx src/components/live/LiveView.tsx src/components/manual/ManualView.tsx
git commit -m "feat(tester): App-owned useDeviceParameters hook shared by Live and Manual"
```

---

## Task 7: Telemetry device reference tick

Add a second, visually distinct "device" tick to each recognition bar. Quality and Match
ticks are floors; the Liveness (spoof) tick is a ceiling.

**Files:**
- Modify: `src/components/live/Telemetry.tsx`
- Modify: `src/styles.css`

**Interfaces:**
- Consumes: `DeviceParameters` from `../../api.ts`.
- Produces: `Telemetry` gains `deviceParams?: DeviceParameters | null`; `Bar` gains `deviceThreshold?: number`.

> Verified by `npm run build` + Task 11 E2E (presentational; no DOM unit test).

- [ ] **Step 1: Extend `Bar` with a device tick**

In `src/components/live/Telemetry.tsx`, add `deviceThreshold` to the `Bar` param type and
render a second marker in BOTH the null and non-null branches (place it next to the existing
`.thresh` div):

```tsx
function Bar(
  { name, value, threshold, higherPasses, label, deviceThreshold }: {
    name: string;
    value: number | null;
    threshold: number;
    higherPasses: boolean;
    label: string;
    deviceThreshold?: number;
  },
) {
  const deviceTick = deviceThreshold !== undefined
    ? <div className="thresh-device" style={{ left: `${deviceThreshold * 100}%` }} data-t="device" />
    : null;
  if (value === null) {
    return (
      <div className="tm">
        <div className="name">{name}</div>
        <div className="track">
          <div className="thresh" style={{ left: `${threshold * 100}%` }} data-t={label} />
          {deviceTick}
        </div>
        <div className="val muted">—</div>
      </div>
    );
  }
  const b = barState(value, threshold, higherPasses);
  return (
    <div className="tm">
      <div className="name">{name}</div>
      <div className="track">
        <div className={`fill ${b.tone === "ok" ? "" : b.tone}`} style={{ width: `${b.pct}%` }} />
        <div className="thresh" style={{ left: `${threshold * 100}%` }} data-t={label} />
        {deviceTick}
      </div>
      <div className={`val ${b.tone === "ok" ? "ok" : b.tone}`}>
        {Math.round(value * 100)}<small>%</small>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Pass device thresholds from `Telemetry`**

Add `deviceParams` to the `Props` interface and the function signature, then pass each tick:

```tsx
import type { DeviceParameters } from "../../api.ts";
// Props: add  deviceParams?: DeviceParameters | null;
// signature: export function Telemetry({ frame, thresholds, hasReference, verdict, deviceParams }: Props) {
```

In the three `<Bar .../>` elements add:
- Quality: `deviceThreshold={deviceParams?.recMinVerifyTemplateQuality}`
- Liveness: `deviceThreshold={deviceParams?.recMaxSpoofProbability}`
- Match: `deviceThreshold={deviceParams?.recMinMatchScoreL1}`

- [ ] **Step 3: Add the device-tick style**

In `src/styles.css`, near the existing `.thresh` rule, add a distinct style (e.g. dashed amber
vs the solid operator tick):

```css
.track .thresh-device {
  position: absolute;
  top: -3px;
  bottom: -3px;
  width: 0;
  border-left: 2px dashed hsl(var(--warning));
  opacity: 0.8;
}
.track .thresh-device::after {
  content: "device";
  position: absolute;
  bottom: -16px;
  left: 50%;
  transform: translateX(-50%);
  font-size: 9px;
  letter-spacing: 0.04em;
  color: hsl(var(--warning));
}
```

(Match the actual existing `.thresh` rule's positioning approach in styles.css; mirror its
`top/bottom`/label technique so the two ticks align on the same track.)

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/components/live/Telemetry.tsx src/styles.css
git commit -m "feat(tester): device-threshold reference tick on Live telemetry bars"
```

---

## Task 8: `LiveDataDisclosure` component

A collapsible, read-only data surface for the current frame's bbox, landmarks, and raw
positioning feedback.

**Files:**
- Create: `src/components/live/LiveDataDisclosure.tsx`
- Modify: `src/styles.css` (reuse existing `details.json` styling if present; add only if needed)

**Interfaces:**
- Consumes: `LiveFrame` from `../../live/types.ts`.
- Produces: `<LiveDataDisclosure frame={frame} />` (rendered by LiveView in Task 9).

> Verified by `npm run build` + Task 11 E2E.

- [ ] **Step 1: Create the component**

`src/components/live/LiveDataDisclosure.tsx`:

```tsx
import type { LiveFrame } from "../../live/types.ts";

/** Read-only data surface: bbox, landmarks, raw positioning bits (no overlay). */
export function LiveDataDisclosure({ frame }: { frame: LiveFrame | null }) {
  if (!frame) return null;
  const bb = frame.boundingBox;
  const fb = frame.positioningFeedback;
  return (
    <details className="json live-data">
      <summary>Frame data</summary>
      <div className="kv">
        <div><span className="k">Faces:</span> {frame.numberOfFaces}</div>
        <div>
          <span className="k">Bounding box:</span>{" "}
          {bb ? `x=${bb.x} y=${bb.y} w=${bb.width} h=${bb.height}` : "—"}
        </div>
        <div>
          <span className="k">Landmarks:</span>{" "}
          {frame.landmarks && frame.landmarks.length > 0
            ? `${frame.landmarks.length} — ${frame.landmarks.map((l) => `${l.type ?? "?"}(${l.x},${l.y})`).join(", ")}`
            : "—"}
        </div>
        <div>
          <span className="k">Positioning:</span>{" "}
          {fb
            ? `raw=${fb.raw} ok=${fb.ok} flags=[${fb.flags.join(", ")}]${fb.unknownBits ? ` unknownBits=${fb.unknownBits}` : ""}`
            : "— (not reported)"}
        </div>
      </div>
    </details>
  );
}
```

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: clean. (`details.json` and `.kv` classes already exist in styles.css; no new CSS
required. If the disclosure needs spacing, add a `.live-data { margin-top: 12px; }` rule.)

- [ ] **Step 3: Commit**

```bash
git add src/components/live/LiveDataDisclosure.tsx src/styles.css
git commit -m "feat(tester): LiveDataDisclosure read-only frame data surface"
```

---

## Task 9: LiveView wiring — real guidance, params fetch, refresh, data surface

Bring it together in Live mode: use `guidanceFor`, fetch params after `openCamera` and before
the watch loop, add a Refresh that pauses the loop, clear params on End session, pass
`deviceParams` to Telemetry, and render `LiveDataDisclosure`.

**Files:**
- Modify: `src/components/live/LiveView.tsx`

**Interfaces:**
- Consumes: `guidanceFor` (Task 5), `deviceParams`/`onFetchParams` (Task 6), Telemetry `deviceParams` (Task 7), `LiveDataDisclosure` (Task 8).

> Verified by `npm run build` + Task 11 E2E.

- [ ] **Step 1: Update imports + props**

In `src/components/live/LiveView.tsx`:
- Replace `import { computeVerdict, deriveGuidance } from "../../live/logic.ts";` with
  `import { computeVerdict, guidanceFor } from "../../live/logic.ts";`
- Add `import { LiveDataDisclosure } from "./LiveDataDisclosure.tsx";`
- Add to `Props` (replacing the optional placeholders from Task 6 with required usage):
  ```ts
  deviceParams?: import("../../api.ts").DeviceParameters | null;
  onFetchParams?: () => Promise<void>;
  ```
- Destructure them: `function LiveView({ status, thresholds, onError, onSessionChange, deviceParams, onFetchParams }: Props)`

- [ ] **Step 2: Replace guidance computation**

Replace:
```ts
  const guidance = frame ? deriveGuidance(frame) : "Step in front of the camera";
```
with (compute once):
```ts
  const g = frame ? guidanceFor(frame) : { text: "Step in front of the camera", derived: true };
  const guidance = g.text;
  const guidanceDerived = g.derived;
```

- [ ] **Step 3: Fetch params in `goLive` (after openCamera, before watch)**

In `goLive`, between `await api.openCamera({});` and `onSessionChange?.();`, add:
```ts
      await onFetchParams?.(); // params need an open camera; loop not started yet → no lock contention
```

- [ ] **Step 4: Add a Refresh that pauses the watch loop**

Add a callback in the component body:
```ts
  const refreshParams = useCallback(async () => {
    setWatching(false);          // free the device lock
    await onFetchParams?.();
    setWatching(true);
  }, [onFetchParams]);
```

- [ ] **Step 5: Clear params handled by App**

`endSession` calls `api.disconnect()`; App's own params live in the hook. Add
`onSessionChange?.()` already fires — but params clearing is owned by App's `handleDisconnect`
(Manual) and is NOT wired to Live's `endSession`. To clear on End session, App must expose
`clearParams`. Simplest: in `endSession`, after `await api.disconnect()`, the App-level
`onSessionChange` (`refreshStatus`) runs; ALSO call a passed clear. Add an optional prop
`onClearParams?: () => void` to `Props`, destructure it, and call `onClearParams?.()` inside
`endSession` (after `setScene("idle")`). Then in `src/App.tsx` pass `onClearParams={clearParams}`
to `<LiveView />`.

- [ ] **Step 6: Pass deviceParams to Telemetry + render Refresh + data surface**

In the `return` (live scene), update the Telemetry element and add the data surface:
```tsx
      <Telemetry frame={frame} thresholds={thresholds} hasReference={hasReference} verdict={verdict} deviceParams={deviceParams ?? null} />
      <ActionDock
        watching={watching}
        hasReference={hasReference}
        onToggleWatch={() => setWatching((w) => !w)}
        onPickReference={pickReference}
        onClearReference={() => setRefTemplate(null)}
        onEnd={endSession}
      />
      {deviceParams && (
        <p className="hint">
          Device thresholds shown as the dashed reference tick. <button className="link-btn" onClick={refreshParams}>Refresh</button>
        </p>
      )}
      <LiveDataDisclosure frame={frame} />
      <p className="hint">
        {guidanceDerived
          ? "Guidance is derived in-UI from face size/status, not HID-measured."
          : "Guidance is from the device's positioning feedback."}
      </p>
```

- [ ] **Step 7: Build**

Run: `npm run build`
Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add src/components/live/LiveView.tsx src/App.tsx
git commit -m "feat(tester): wire real guidance, device params + refresh, data surface into Live"
```

---

## Task 10: DeviceParametersPanel (Manual)

A read-only grouped table of all device parameters with a Refresh button gated on an open
camera.

**Files:**
- Create: `src/components/manual/DeviceParametersPanel.tsx`
- Modify: `src/components/manual/ManualView.tsx`

**Interfaces:**
- Consumes: `DeviceParameters` from `../../api.ts`; `deviceParams`/`onFetchParams` from App (Task 6).
- Produces: a new panel rendered in the Manual grid.

> Verified by `npm run build` + Task 11 E2E.

- [ ] **Step 1: Create the panel**

`src/components/manual/DeviceParametersPanel.tsx`:

```tsx
import type { DeviceParameters, SessionStatus } from "../../api.ts";

interface Props {
  status: SessionStatus | null;
  params: DeviceParameters | null;
  onRefresh: () => void;
}

const GROUPS: { title: string; fields: (keyof DeviceParameters)[] }[] = [
  { title: "Recognition", fields: ["recMaxSpoofProbability", "recMinEnrollTemplateQuality", "recMinVerifyTemplateQuality", "recMinMatchScoreL1", "recMinMatchScoreL2", "recMinMatchScoreL3", "faceSelectPolicy", "onlyCenteredFaces", "maxResults", "margin", "captureMode", "captureStabilization"] },
  { title: "Camera", fields: ["cameraEnableHighRes", "cameraSuspend", "cameraIdleTimeoutMs", "cameraEncodingAcceleration", "cameraLowPowerMode", "cameraLowPowerTimeoutMs", "streamMode", "captureImageEncoding", "encodingJpegQuality"] },
  { title: "Geometry", fields: ["minDistance", "maxDistance", "minRoll", "maxRoll", "minPitch", "maxPitch", "minYaw", "maxYaw"] },
  { title: "Exposure", fields: ["dayToNightThreshold", "nightToDayThreshold", "dayToNightViscosity", "nightToDayViscosity", "aeBoundingBoxTimeoutMs"] },
];

/** Read-only device parameters (HFParam reads). Refresh needs an open camera. */
export function DeviceParametersPanel({ status, params, onRefresh }: Props) {
  const cameraOpen = status?.cameraOpen ?? false;
  return (
    <section className="panel">
      <h2>Device Parameters</h2>
      <div className="btn-row" style={{ marginBottom: 12 }}>
        <button className="btn" onClick={onRefresh} disabled={!cameraOpen}>Refresh</button>
        {!cameraOpen && <span className="hint">Open the camera to read parameters.</span>}
      </div>
      {!params
        ? <p className="empty">No parameters loaded.</p>
        : GROUPS.map((g) => (
          <div key={g.title} style={{ marginBottom: 10 }}>
            <div className="modal-section-label" style={{ marginTop: 0 }}>{g.title}</div>
            <div className="kv">
              {g.fields.map((f) => (
                <div key={f}><span className="k">{f}:</span> {String(params[f])}</div>
              ))}
            </div>
          </div>
        ))}
    </section>
  );
}
```

- [ ] **Step 2: Render it in ManualView**

In `src/components/manual/ManualView.tsx`:
- Add the import: `import { DeviceParametersPanel } from "./DeviceParametersPanel.tsx";`
- Add to `Props`:
  ```ts
  deviceParams?: import("../../api.ts").DeviceParameters | null;
  onFetchParams?: () => Promise<void>;
  ```
- Add the panel as a sixth child of the `<div className="grid">`:
  ```tsx
        <DeviceParametersPanel
          status={p.status}
          params={p.deviceParams ?? null}
          onRefresh={() => { void p.onFetchParams?.(); }}
        />
  ```

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/components/manual/DeviceParametersPanel.tsx src/components/manual/ManualView.tsx
git commit -m "feat(tester): read-only Device Parameters panel in Manual mode"
```

---

## Task 11: End-to-end mock verification + docs

**Files:**
- Modify: `docs/UI-FEEDBACK.md` (mark items 3 & 4 consumed)

- [ ] **Step 1: Full test + build gate**

Run:
```bash
deno task test && deno task check && npm test && npm run build
```
Expected: all green.

- [ ] **Step 2: Manual E2E against the mock backend**

In two terminals:
```bash
# terminal 1 (backend, mock)
deno task dev:mock
# terminal 2 (frontend)
npm run dev
```
Open the Vite URL. Verify, in **Live** mode:
1. **Go Live** connects, opens the camera, and starts the watch loop.
2. Set the mock scenario to `approach` (Manual → Connection settings, or the scenario control)
   and return to Live: the guidance line shows **real** strings ("Turn right") while framing,
   and the closing hint reads "Guidance is from the device's positioning feedback."
3. The three telemetry bars show a **dashed amber "device" tick** offset from the solid
   operator marker (device quality 0.65 vs operator 0.70, spoof 0.45 vs 0.50, match 0.80 vs 0.70).
4. **Frame data** disclosure shows faces/bbox/landmarks/positioning raw+flags.
5. **Refresh** (Live hint link) re-reads params without throwing (loop pauses + resumes).
6. **End session** returns to idle; re-entering shows no stale params.

In **Manual** mode:
7. Open the camera, then the **Device Parameters** panel **Refresh** loads the grouped table;
   with the camera closed, Refresh is disabled.

Record the outcomes (pass/fail per item) in the commit message or PR body.

- [ ] **Step 3: Update the design doc status**

In `docs/UI-FEEDBACK.md`, update the §6 dependency list to note items 3 (positioning +
landmarks on CaptureResult) and 4 (getParameters) are now **consumed by the tester**
(reference-only thresholds; landmarks data-only; guidance real-with-fallback), and that the
full-frame feed (item 1) + intermediate streaming (item 2) + visual overlay remain Phase 2.

- [ ] **Step 4: Commit**

```bash
git add docs/UI-FEEDBACK.md
git commit -m "docs: mark Phase 2 items 3 & 4 consumed by the tester"
```

---

## Notes for the implementer

- **Run focused tests while iterating** (`npm test` re-runs all Vitest — fast; `deno task test`
  runs the backend suite). Run the full four-command gate (Task 11 Step 1) once before the
  final commit, not after every edit.
- **`getParameters` requires an open camera** — never call it before `openCamera` resolves.
- **Never touch `../hardware-libs`** — it is the published dependency.
- The hardware-libs checkout providing the lib is `feature/facepod` (HEAD ≥ `7658b00`); the
  new surface (`getParameters`, `positioningFeedback`, `DeviceParameters`, `Landmark`) is
  exported from its `mod.ts`.
