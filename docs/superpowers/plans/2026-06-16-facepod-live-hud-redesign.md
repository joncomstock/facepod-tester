# FacePod Tester — Live HUD Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the FacePod tester front-end into a portrait-kiosk "biometric viewfinder HUD" with a one-tap Go-Live flow and a continuous-watch loop, while preserving the existing step panels behind a Manual mode.

**Architecture:** A new `Live` mode becomes the front door: one **Go Live** action connects + opens the camera + starts a continuous capture loop, and a HUD shows the live detected-face image, derived positioning guidance, threshold-marker telemetry bars (quality / liveness / match), and an ACCEPT/REJECT verdict. The existing five panels move verbatim into a `Manual` mode reachable from a toggle. All device logic stays server-side on the **existing** `@eai/hid/facepod` seam — no `hardware-libs` changes. Pure UI logic (verdict gating, bar state, derived guidance, result→frame mapping) is extracted into framework-free modules unit-tested with Vitest; the effectful loop is a thin hook; visuals are verified with the Playwright MCP at 800×1280.

**Tech Stack:** React 18 + Vite 5 + TypeScript (front-end, `src/`); Deno + Hono (back-end, `server/`); Vitest 2 (new front-end test runner); the local `@eai/hid/facepod` library (read-only).

## Global Constraints

- **`hardware-libs` is READ-ONLY.** This repo imports `../hardware-libs/hid/facepod/mod.ts` and MUST NOT modify it. Anything needing a new seam method (e.g. `HFGetVideoFrame`, extra intermediate-result flags, decoded `positioningFeedback`) is OUT OF SCOPE for this plan — see "Out of Scope / Phase 2" below.
- **FFI / mock only.** The live transport is USB over Deno FFI (`createFaceModuleFfi`). Never reintroduce NetHFAPI/REST. Mock mode (`server/mockClient.ts`) is the only non-hardware path and is owned by this repo.
- **Target device: 800 × 1280 portrait, touch.** Optimize this resolution first. Big tap targets (≥ 44px), vertical stacking, settings behind gear modals.
- **No biometric data-at-rest.** Reference templates are held in memory for the session only — no enroll, gallery, or persistence of templates/images.
- **Liveness fails closed.** Never render a "live/pass" the device did not measure; `livenessPassed` comes straight from the result.
- **Honest "feed".** v1's feed is the **live detected-face image** (the `image` field of each capture result) refreshed by the watch loop — NOT a full-frame webcam stream. The full-frame video + bounding-box/landmark overlay (the mockup's tracking box) depends on the Phase 2 `hardware-libs` seam and is built as inert extension points only.
- **AirOps visual language.** Near-black canvas, cyan (`--primary: 198 100% 64%`) accent with glow on live data, self-hosted Urbanist. Tokens already exist in `src/styles.css`.
- **Visual reference:** `docs/live-hud-mockup.html` is the approved look for all four states (idle / connecting / watching / accept). Port its markup + CSS.
- **Back-end test command must keep its flags:** `deno test --allow-env --allow-read server/`.

## Out of Scope / Phase 2 (separate `hardware-libs` plan)

These are documented in `docs/UI-FEEDBACK.md` §6 and require modifying `hardware-libs`, so they are NOT tasks here:
1. Bind `HFGetVideoFrame` + a `getVideoFrame()` seam method (true full-frame video feed).
2. Extend capture intermediate flags (quality / faces / bbox / landmarks / positioning) and surface per-frame intermediate results.
3. Add decoded `positioningFeedback` + `landmarks` (full-frame coords) to `CaptureResult`.

The `Feed` component in this plan exposes optional `videoFrame` / `overlayBox` props that stay unused (`null`) in v1 so Phase 2 can wire them without a rewrite.

## File Structure

**New (front-end logic + tests):**
- `src/live/types.ts` — shared Live types (`LiveThresholds`, `LiveFrame`, `Verdict`, `BarView`).
- `src/live/logic.ts` — pure functions: `toLiveFrame`, `barState`, `computeVerdict`, `deriveGuidance`.
- `src/live/logic.test.ts` — Vitest unit tests for the above.
- `src/live/useWatchLoop.ts` — effectful continuous-capture hook.
- `src/live/connectionSettings.ts` — shared connection-settings load/save (extracted from `DeviceConfigPanel`).
- `src/live/readImageFile.ts` — shared file→base64 reader (extracted from `MatchPanel`).

**New (front-end components):**
- `src/components/live/LiveView.tsx` — container: scenes (idle/connecting/live), Go-Live orchestration, watch wiring, reference + settings.
- `src/components/live/Feed.tsx` — viewfinder: live face image + corner brackets + detection glow + guidance + (inert) overlay props.
- `src/components/live/Telemetry.tsx` — three threshold-marker bars + verdict chip.
- `src/components/live/ActionDock.tsx` — Go-Live / watch toggle + reference chip + reference upload.
- `src/components/manual/ManualView.tsx` — the current five-panel grid, moved verbatim.

**Modified:**
- `src/App.tsx` — becomes a shell: status rail + Live/Manual toggle; owns shared session state; renders `LiveView` or `ManualView`.
- `src/styles.css` — add HUD styles (ported from the mockup); add portrait layout.
- `src/api.ts` — add `"approach"` to `MOCK_SCENARIOS` + `SCENARIO_LABELS`.
- `src/components/DeviceConfigPanel.tsx` — use the extracted `connectionSettings.ts`.
- `src/components/MatchPanel.tsx` — use the extracted `readImageFile.ts`.
- `server/mockClient.ts` — add the `"approach"` scenario (ramping captures for a believable watch demo).
- `server/mockClient.test.ts` — cover the new scenario.
- `package.json` — add Vitest + `test` script.
- `vite.config.ts` — add Vitest config (`test` block).
- `README.md` / `docs/UI-FEEDBACK.md` — document the new modes + mark §1 follow-ups done.

---

### Task 1: Add the Vitest front-end test harness

**Files:**
- Modify: `package.json`
- Modify: `vite.config.ts`
- Create: `src/live/smoke.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: an `npm test` script running `vitest run`; the convention that pure logic lives under `src/live/` and is unit-tested there.

- [ ] **Step 1: Add Vitest dev dependency**

Run:
```bash
cd /Users/jon/elevationai/facepod-tester
npm install -D vitest@^2.1.8
```
Expected: `vitest` appears under `devDependencies` in `package.json`.

- [ ] **Step 2: Add the `test` script**

Edit `package.json` `scripts` to add the test entry (keep existing scripts):
```json
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "test": "vitest run"
  },
```

- [ ] **Step 3: Configure Vitest in `vite.config.ts`**

Add a `test` block (node environment — pure logic needs no DOM). Replace the file's `defineConfig({...})` call so it reads:
```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The browser must never talk to the FacePod directly — all /api calls are
// proxied to the Deno backend, which owns device communication over the local
// USB/FFI transport (HidFace.dll via Deno FFI).
const BACKEND_PORT = process.env.PORT ?? "8787";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    proxy: {
      "/api": {
        target: `http://localhost:${BACKEND_PORT}`,
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
```

- [ ] **Step 4: Write a smoke test**

Create `src/live/smoke.test.ts`:
```ts
import { describe, expect, it } from "vitest";

describe("vitest harness", () => {
  it("runs", () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test`
Expected: PASS — 1 passed (1 test).

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json vite.config.ts src/live/smoke.test.ts
git commit -m "test: add vitest front-end harness"
```

---

### Task 2: Live types + `toLiveFrame` mapping

**Files:**
- Create: `src/live/types.ts`
- Create: `src/live/logic.ts`
- Create: `src/live/logic.test.ts`

**Interfaces:**
- Consumes: `CaptureResult`, `MatchResult` from `src/api.ts` (already exported).
- Produces:
  - `LiveThresholds { minimalQuality: number; maximalSpoofScore: number; minimalMatchScore: number }`
  - `LiveFrame { image: { datatype: string; data: string } | null; quality: number; spoofScore: number; livenessPassed: boolean; numberOfFaces: number; boundingBox: { x:number; y:number; width:number; height:number } | null; isCaptured: boolean; faceStatus?: string; matchScore: number | null; matchPassed: boolean | null }`
  - `Verdict { state: "searching"|"acquiring"|"accept"|"reject"; reasons: string[] }`
  - `BarView { pct: number; pass: boolean; tone: "ok"|"warn"|"bad" }`
  - `toLiveFrame(cap: CaptureResult, match?: MatchResult | null): LiveFrame`

- [ ] **Step 1: Write the types**

Create `src/live/types.ts`:
```ts
/** Shared types for the Live HUD. Pure data — no React/DOM. */

export interface LiveThresholds {
  /** Quality passes when value >= this. */
  minimalQuality: number;
  /** Liveness passes when spoof score <= this (lower is more live). */
  maximalSpoofScore: number;
  /** Match passes when score >= this. Only used when a reference is set. */
  minimalMatchScore: number;
}

export interface LiveFrame {
  /** The detected-face image from the capture result (v1 "feed"). */
  image: { datatype: string; data: string } | null;
  quality: number;
  spoofScore: number;
  livenessPassed: boolean;
  numberOfFaces: number;
  /** Full-frame coords (px) — present in v1 but not drawn (no full frame yet). */
  boundingBox: { x: number; y: number; width: number; height: number } | null;
  isCaptured: boolean;
  faceStatus?: string;
  /** null when no reference template is loaded. */
  matchScore: number | null;
  matchPassed: boolean | null;
}

export type VerdictState = "searching" | "acquiring" | "accept" | "reject";

export interface Verdict {
  state: VerdictState;
  /** Failing gate names for a reject, e.g. ["quality", "match"]. */
  reasons: string[];
}

export interface BarView {
  /** Fill width 0–100. */
  pct: number;
  pass: boolean;
  /** ok = passing comfortably, warn = passing within margin, bad = failing. */
  tone: "ok" | "warn" | "bad";
}
```

- [ ] **Step 2: Write the failing test for `toLiveFrame`**

Create `src/live/logic.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import type { CaptureResult, MatchResult } from "../api.ts";
import { toLiveFrame } from "./logic.ts";

const baseCapture: CaptureResult = {
  quality: 0.92,
  numberOfFaces: 1,
  template: { modality: "face", datatype: "hftemplate", data: "LIVE" },
  image: { modality: "face", datatype: "png", data: "AAAA" },
  liveness: { spoofScore: 0.08, passed: true },
  boundingBox: { x: 40, y: 30, width: 180, height: 220 },
  isCaptured: true,
  faceStatus: "ok",
};

describe("toLiveFrame", () => {
  it("maps a capture result into a LiveFrame with no match", () => {
    const f = toLiveFrame(baseCapture);
    expect(f.image).toEqual({ datatype: "png", data: "AAAA" });
    expect(f.quality).toBe(0.92);
    expect(f.spoofScore).toBe(0.08);
    expect(f.livenessPassed).toBe(true);
    expect(f.numberOfFaces).toBe(1);
    expect(f.boundingBox).toEqual({ x: 40, y: 30, width: 180, height: 220 });
    expect(f.isCaptured).toBe(true);
    expect(f.matchScore).toBeNull();
    expect(f.matchPassed).toBeNull();
  });

  it("includes match fields when a match result is supplied", () => {
    const match: MatchResult = { match: true, matchScore: 0.9 };
    const f = toLiveFrame(baseCapture, match);
    expect(f.matchScore).toBe(0.9);
    expect(f.matchPassed).toBe(true);
  });

  it("nulls image/boundingBox when absent", () => {
    const f = toLiveFrame({
      quality: 0,
      numberOfFaces: 0,
      liveness: { spoofScore: 0, passed: true },
      isCaptured: false,
    });
    expect(f.image).toBeNull();
    expect(f.boundingBox).toBeNull();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — cannot resolve `./logic.ts` / `toLiveFrame is not a function`.

- [ ] **Step 4: Implement `toLiveFrame`**

Create `src/live/logic.ts`:
```ts
/** Pure Live-HUD logic — no React/DOM, fully unit-tested. */
import type { CaptureResult, MatchResult } from "../api.ts";
import type { LiveFrame } from "./types.ts";

/** Fold a capture result (+ optional match) into the HUD's frame shape. */
export function toLiveFrame(
  cap: CaptureResult,
  match?: MatchResult | null,
): LiveFrame {
  return {
    image: cap.image ? { datatype: cap.image.datatype, data: cap.image.data } : null,
    quality: cap.quality,
    spoofScore: cap.liveness.spoofScore,
    livenessPassed: cap.liveness.passed,
    numberOfFaces: cap.numberOfFaces,
    boundingBox: cap.boundingBox ?? null,
    isCaptured: cap.isCaptured,
    faceStatus: cap.faceStatus,
    matchScore: match ? match.matchScore : null,
    matchPassed: match ? match.match : null,
  };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test`
Expected: PASS — `toLiveFrame` suite green.

- [ ] **Step 6: Commit**

```bash
git add src/live/types.ts src/live/logic.ts src/live/logic.test.ts
git commit -m "feat(live): add Live types and toLiveFrame mapping"
```

---

### Task 3: `barState` + `computeVerdict`

**Files:**
- Modify: `src/live/logic.ts`
- Modify: `src/live/logic.test.ts`

**Interfaces:**
- Consumes: `LiveFrame`, `LiveThresholds`, `Verdict`, `BarView` from `./types.ts`.
- Produces:
  - `barState(value: number, threshold: number, higherPasses: boolean): BarView`
  - `computeVerdict(frame: LiveFrame, t: LiveThresholds, hasReference: boolean): Verdict`

- [ ] **Step 1: Write the failing tests**

Append to `src/live/logic.test.ts`:
```ts
import { barState, computeVerdict } from "./logic.ts";
import type { LiveFrame, LiveThresholds } from "./types.ts";

const T: LiveThresholds = {
  minimalQuality: 0.7,
  maximalSpoofScore: 0.5,
  minimalMatchScore: 0.7,
};

function frame(over: Partial<LiveFrame> = {}): LiveFrame {
  return {
    image: null,
    quality: 0.92,
    spoofScore: 0.08,
    livenessPassed: true,
    numberOfFaces: 1,
    boundingBox: { x: 0, y: 0, width: 200, height: 240 },
    isCaptured: true,
    matchScore: null,
    matchPassed: null,
    ...over,
  };
}

describe("barState", () => {
  it("passes comfortably above threshold (higher passes)", () => {
    expect(barState(0.92, 0.7, true)).toEqual({ pct: 92, pass: true, tone: "ok" });
  });
  it("warns within margin of threshold", () => {
    expect(barState(0.73, 0.7, true).tone).toBe("warn");
  });
  it("fails below threshold (higher passes)", () => {
    expect(barState(0.5, 0.7, true)).toEqual({ pct: 50, pass: false, tone: "bad" });
  });
  it("passes when lower is better (spoof)", () => {
    expect(barState(0.08, 0.5, false)).toEqual({ pct: 8, pass: true, tone: "ok" });
  });
  it("clamps pct to 0..100", () => {
    expect(barState(1.4, 0.7, true).pct).toBe(100);
    expect(barState(-0.2, 0.7, true).pct).toBe(0);
  });
});

describe("computeVerdict", () => {
  it("searching when no face", () => {
    expect(computeVerdict(frame({ numberOfFaces: 0 }), T, false).state).toBe("searching");
  });
  it("accept when quality+liveness+captured pass and no reference", () => {
    expect(computeVerdict(frame(), T, false).state).toBe("accept");
  });
  it("reject lists failing gates", () => {
    const v = computeVerdict(frame({ quality: 0.4, livenessPassed: false }), T, false);
    expect(v.state).toBe("reject");
    expect(v.reasons).toEqual(["quality", "liveness"]);
  });
  it("requires match when a reference is set", () => {
    const ok = computeVerdict(frame({ matchScore: 0.9, matchPassed: true }), T, true);
    expect(ok.state).toBe("accept");
    const bad = computeVerdict(frame({ matchScore: 0.3, matchPassed: false }), T, true);
    expect(bad.state).toBe("reject");
    expect(bad.reasons).toEqual(["match"]);
  });
  it("acquiring when face present, nothing failing, but not captured", () => {
    expect(computeVerdict(frame({ isCaptured: false }), T, false).state).toBe("acquiring");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — `barState` / `computeVerdict` not exported.

- [ ] **Step 3: Implement `barState` and `computeVerdict`**

Append to `src/live/logic.ts`:
```ts
import type { BarView, LiveThresholds, Verdict } from "./types.ts";

/** Width-margin (0–1) within which a passing value is "warn" not "ok". */
const WARN_MARGIN = 0.06;

/** Bar fill + pass/tone for one metric. higherPasses=false means lower passes. */
export function barState(
  value: number,
  threshold: number,
  higherPasses: boolean,
): BarView {
  const pass = higherPasses ? value >= threshold : value <= threshold;
  const margin = Math.abs(value - threshold);
  const tone: BarView["tone"] = pass
    ? (margin < WARN_MARGIN ? "warn" : "ok")
    : "bad";
  return { pct: Math.max(0, Math.min(100, value * 100)), pass, tone };
}

/**
 * Derive the accept/reject verdict from a frame + thresholds. The same gate the
 * tester already computes, expressed as a HUD state machine:
 *   no face → searching; all gates pass + captured → accept;
 *   any hard fail → reject(reasons); otherwise (face, no fail, not captured) → acquiring.
 */
export function computeVerdict(
  frame: LiveFrame,
  t: LiveThresholds,
  hasReference: boolean,
): Verdict {
  if (frame.numberOfFaces < 1) return { state: "searching", reasons: [] };

  const qPass = frame.quality >= t.minimalQuality;
  const lPass = frame.livenessPassed;
  const mPass = hasReference ? frame.matchPassed === true : true;

  const reasons: string[] = [];
  if (!qPass) reasons.push("quality");
  if (!lPass) reasons.push("liveness");
  if (hasReference && frame.matchPassed === false) reasons.push("match");

  if (qPass && lPass && mPass && frame.isCaptured) {
    return { state: "accept", reasons: [] };
  }
  if (reasons.length > 0) return { state: "reject", reasons };
  return { state: "acquiring", reasons: [] };
}
```

Note: `LiveFrame` is already imported at the top of `logic.ts` from Task 2; do not import it twice.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS — all `barState` + `computeVerdict` cases green.

- [ ] **Step 5: Commit**

```bash
git add src/live/logic.ts src/live/logic.test.ts
git commit -m "feat(live): add barState and computeVerdict logic"
```

---

### Task 4: `deriveGuidance` (derived positioning hints)

**Files:**
- Modify: `src/live/logic.ts`
- Modify: `src/live/logic.test.ts`

**Interfaces:**
- Consumes: `LiveFrame` from `./types.ts`.
- Produces: `deriveGuidance(frame: LiveFrame): string | null` — derived, NOT HID-measured positioning hint (null = locked/no hint).

- [ ] **Step 1: Write the failing tests**

Append to `src/live/logic.test.ts`:
```ts
import { deriveGuidance } from "./logic.ts";

describe("deriveGuidance", () => {
  it("prompts to step in when no face", () => {
    expect(deriveGuidance(frame({ numberOfFaces: 0 }))).toBe("Step in front of the camera");
  });
  it("prompts closer when the face box is small", () => {
    expect(deriveGuidance(frame({ boundingBox: { x: 0, y: 0, width: 80, height: 90 } })))
      .toBe("Move a little closer");
  });
  it("prompts to look at camera on spoof suspicion", () => {
    expect(deriveGuidance(frame({ faceStatus: "spoof_suspected" })))
      .toBe("Look directly at the camera");
  });
  it("asks to hold still when face is present but not captured", () => {
    expect(deriveGuidance(frame({ isCaptured: false }))).toBe("Hold still");
  });
  it("returns null when locked (captured, good size)", () => {
    expect(deriveGuidance(frame())).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — `deriveGuidance` not exported.

- [ ] **Step 3: Implement `deriveGuidance`**

Append to `src/live/logic.ts`:
```ts
/**
 * DERIVED positioning guidance (NOT HID-measured). The seam does not expose
 * decoded positioning feedback on FFI today (see docs/UI-FEEDBACK.md §3/§7), so
 * we infer a friendly hint from the bounding box + face status. The UI must
 * label this as "derived". Returns null when the subject looks locked.
 */
const MIN_FACE_AREA = 14_400; // px² (≈120×120); below → likely too far. Heuristic.

export function deriveGuidance(frame: LiveFrame): string | null {
  if (frame.numberOfFaces < 1) return "Step in front of the camera";
  const bb = frame.boundingBox;
  if (bb && bb.width * bb.height < MIN_FACE_AREA) return "Move a little closer";
  if (frame.faceStatus === "spoof_suspected") return "Look directly at the camera";
  if (!frame.isCaptured) return "Hold still";
  return null;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS — `deriveGuidance` suite green.

- [ ] **Step 5: Commit**

```bash
git add src/live/logic.ts src/live/logic.test.ts
git commit -m "feat(live): add derived positioning guidance"
```

---

### Task 5: Add the `"approach"` mock scenario (believable watch demo)

**Files:**
- Modify: `server/mockClient.ts`
- Modify: `server/mockClient.test.ts`
- Modify: `src/api.ts`

**Interfaces:**
- Consumes: existing `FaceModuleClient` interface from `@eai/hid/facepod`.
- Produces: a new `"approach"` scenario whose successive `captureAndProcess` calls ramp quality `0 → 0.95` and grow the bounding box, looping — so the front-end watch loop animates against mock. Existing scenarios are unchanged (still deterministic).

- [ ] **Step 1: Write the failing test**

Append to `server/mockClient.test.ts` (Deno test — keep the file's existing import style):
```ts
Deno.test("approach scenario ramps quality across successive captures", async () => {
  const client = new DeterministicMockClient(() => "approach");
  const first = await client.captureAndProcess({ minimalQuality: 0.7 });
  const samples = [first.quality];
  for (let i = 0; i < 12; i++) {
    samples.push((await client.captureAndProcess({ minimalQuality: 0.7 })).quality);
  }
  // It starts low and reaches a high (>=0.9) quality within the ramp.
  assert(samples[0] < 0.5, `expected low start, got ${samples[0]}`);
  assert(samples.some((q) => q >= 0.9), "expected ramp to reach >=0.9");
  // numberOfFaces is 1 once present.
  assert((await client.captureAndProcess({ minimalQuality: 0.7 })).numberOfFaces <= 1);
});
```
Ensure `assert` is imported at the top of the test file (it already imports from `@std/assert` — add `assert` to that import if absent).

- [ ] **Step 2: Run the test to verify it fails**

Run: `deno test --allow-env --allow-read server/mockClient.test.ts`
Expected: FAIL — `"approach"` not handled (constant quality 0.92 or type error on scenario).

- [ ] **Step 3: Add `"approach"` to the scenario union**

In `server/mockClient.ts`, add `"approach"` to `MOCK_SCENARIOS`:
```ts
export const MOCK_SCENARIOS = [
  "good", // high quality, live, templates present, match succeeds
  "low-quality", // quality below threshold → isCaptured false
  "spoof", // high spoof score → liveness FAIL
  "no-face", // 0 faces, no template/image
  "no-match", // good capture but match score below any sane threshold
  "device-error", // capture/process/match throw FaceModuleApiError
  "approach", // ramps quality + bbox across captures (drives the Live HUD demo)
] as const;
```

- [ ] **Step 4: Implement the ramp in `captureAndProcess`**

In `DeterministicMockClient`, add a private call counter and an `"approach"` branch. Add the field near the top of the class:
```ts
  #approachTick = 0;
```
Then, at the START of `captureAndProcess` (before the existing `if (scenario === "device-error")` block), insert:
```ts
    if (scenario === "approach") {
      // 16-step loop: 0–2 no face, then quality + box ramp to a lock, then reset.
      const n = this.#approachTick % 16;
      this.#approachTick++;
      if (n < 2) {
        return Promise.resolve({
          quality: 0,
          numberOfFaces: 0,
          liveness: { spoofScore: 0, passed: true },
          isCaptured: false,
          faceStatus: "no_face",
        });
      }
      const p = Math.min(1, (n - 2) / 9); // approach progress 0..1
      const quality = Math.round((0.2 + p * 0.75) * 100) / 100;
      const spoofScore = Math.round((0.6 - p * 0.5) * 100) / 100;
      const passed = passedSpoof(spoofScore, opts.maximalSpoofScore);
      const side = Math.round(120 + p * 120);
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
        isCaptured: quality >= opts.minimalQuality && passed,
        faceStatus: passed ? "ok" : "spoof_suspected",
      });
    }
```

- [ ] **Step 5: Mirror the scenario in the front-end API types**

In `src/api.ts`, add `"approach"` to `MOCK_SCENARIOS` and a label in `SCENARIO_LABELS`:
```ts
export const MOCK_SCENARIOS = [
  "good",
  "low-quality",
  "spoof",
  "no-face",
  "no-match",
  "device-error",
  "approach",
] as const;
```
```ts
export const SCENARIO_LABELS: Record<MockScenario, string> = {
  "good": "Good face (pass)",
  "low-quality": "Low quality",
  "spoof": "Spoof detected",
  "no-face": "No face",
  "no-match": "No match",
  "device-error": "Device error",
  "approach": "Approaching face (live demo)",
};
```

- [ ] **Step 6: Run the back-end tests to verify they pass**

Run: `deno test --allow-env --allow-read server/`
Expected: PASS — including the new `approach` test; existing scenario tests still pass.

- [ ] **Step 7: Type-check both sides**

Run: `deno task check && npm run build`
Expected: both succeed (no type errors from the new scenario in either union).

- [ ] **Step 8: Commit**

```bash
git add server/mockClient.ts server/mockClient.test.ts src/api.ts
git commit -m "feat(mock): add approach scenario for the live watch demo"
```

---

### Task 6: Shell refactor — Live/Manual modes + extract Manual view & shared settings

**Files:**
- Create: `src/components/manual/ManualView.tsx`
- Create: `src/live/connectionSettings.ts`
- Modify: `src/App.tsx`
- Modify: `src/components/DeviceConfigPanel.tsx`
- Modify: `src/styles.css` (mode-toggle styles only)

**Interfaces:**
- Consumes: existing panel components + handlers in `App.tsx`.
- Produces:
  - `loadConnectionSettings(): ConnectionSettings` and `saveConnectionSettings(s: ConnectionSettings): void` and `CONNECTION_DEFAULTS` and `type ConnectionSettings = { mock: boolean; scenario: MockScenario; dllPath: string; dllDir: string; pollIntervalMs: string }` from `src/live/connectionSettings.ts`.
  - `<ManualView ... />` rendering the current grid.
  - `App` exposing `mode: "live" | "manual"` with a toggle, and the existing shared state/handlers.

- [ ] **Step 1: Extract connection settings into a shared module**

Create `src/live/connectionSettings.ts` (lifted verbatim from `DeviceConfigPanel.tsx`'s `STORAGE_KEY` / `DEFAULTS` / `loadSettings`):
```ts
import type { MockScenario } from "../api.ts";

const STORAGE_KEY = "facepod-tester.connection";

export interface ConnectionSettings {
  mock: boolean;
  scenario: MockScenario;
  dllPath: string;
  dllDir: string;
  pollIntervalMs: string;
}

/** Baked-in defaults for this kiosk. Blank dllPath → server env default. */
export const CONNECTION_DEFAULTS: ConnectionSettings = {
  mock: false,
  scenario: "good",
  dllPath: "C:\\Users\\Facepod\\Desktop\\FacePODDemo_MattWolfe\\HidFace.dll",
  dllDir: "",
  pollIntervalMs: "",
};

export function loadConnectionSettings(): ConnectionSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...CONNECTION_DEFAULTS, ...(JSON.parse(raw) as Partial<ConnectionSettings>) };
  } catch { /* corrupt/unavailable storage → defaults */ }
  return { ...CONNECTION_DEFAULTS };
}

export function saveConnectionSettings(s: ConnectionSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch { /* storage unavailable — keep working in-memory */ }
}
```

- [ ] **Step 2: Point `DeviceConfigPanel` at the shared module**

In `src/components/DeviceConfigPanel.tsx`, remove the local `STORAGE_KEY`, `DEFAULTS`, `Settings` type, and `loadSettings`, and import from the shared module instead:
```ts
import {
  CONNECTION_DEFAULTS as DEFAULTS,
  type ConnectionSettings as Settings,
  loadConnectionSettings as loadSettings,
  saveConnectionSettings,
} from "../live/connectionSettings.ts";
```
Replace the persistence effect body to use the helper:
```ts
  useEffect(() => {
    saveConnectionSettings(settings);
  }, [settings]);
```
Leave the rest of the component unchanged. (The `basename` helper stays local.)

- [ ] **Step 3: Build the project to confirm the extraction compiles**

Run: `npm run build`
Expected: PASS — no type errors; `DeviceConfigPanel` behaves exactly as before.

- [ ] **Step 4: Extract the current grid into `ManualView`**

Create `src/components/manual/ManualView.tsx` by moving the `<div className="grid">…</div>` block and the trailing workflow `<p className="hint">` out of `App.tsx` into a presentational component. It takes every prop those panels need:
```tsx
import {
  type CameraInfo,
  type CaptureResult,
  type ConnectRequest,
  type DeviceInfo,
  type ImageDatatype,
  type MatchResult,
  type MockScenario,
  type ProcessResult,
  type SessionStatus,
} from "../../api.ts";
import { DeviceConfigPanel } from "../DeviceConfigPanel.tsx";
import { DeviceStatusPanel } from "../DeviceStatusPanel.tsx";
import { CameraControls } from "../CameraControls.tsx";
import { CapturePanel, type CaptureThresholds } from "../CapturePanel.tsx";
import { MatchPanel } from "../MatchPanel.tsx";

interface Props {
  status: SessionStatus | null;
  busy: boolean;
  deviceInfo: DeviceInfo | null;
  cameras: CameraInfo[] | null;
  captureResult: CaptureResult | null;
  referenceResult: ProcessResult | null;
  matchResult: MatchResult | null;
  refTemplate: string | null;
  liveTemplate: string | null;
  thresholds: CaptureThresholds;
  minimalMatchScore: number;
  onThresholdChange: (patch: Partial<CaptureThresholds>) => void;
  onMinimalMatchScoreChange: (v: number) => void;
  onConnect: (req: ConnectRequest) => void;
  onDisconnect: () => void;
  onSetScenario: (s: MockScenario) => void;
  onRefreshInfo: () => void;
  onRefreshCameras: () => void;
  onOpenCamera: (req: { cameraId?: string; algorithmType?: "on_device"; reservationTimeoutMs?: number }) => void;
  onCloseCamera: () => void;
  onCapture: () => void;
  onProcessReference: (image: { image: string; datatype: ImageDatatype }) => void;
  onMatch: () => void;
  onCaptureAndMatch: (image: { image: string; datatype: ImageDatatype }) => void;
}

/** The original step-by-step panels (01–05) preserved as the manual/debug surface. */
export function ManualView(p: Props) {
  return (
    <>
      <div className="grid">
        <DeviceConfigPanel
          status={p.status}
          busy={p.busy}
          onConnect={p.onConnect}
          onDisconnect={p.onDisconnect}
          onSetScenario={p.onSetScenario}
        />
        <DeviceStatusPanel
          status={p.status}
          deviceInfo={p.deviceInfo}
          cameras={p.cameras}
          busy={p.busy}
          onRefreshInfo={p.onRefreshInfo}
          onRefreshCameras={p.onRefreshCameras}
        />
        <CameraControls
          status={p.status}
          cameras={p.cameras}
          busy={p.busy}
          onOpen={p.onOpenCamera}
          onClose={p.onCloseCamera}
        />
        <CapturePanel
          status={p.status}
          busy={p.busy}
          thresholds={p.thresholds}
          onThresholdChange={p.onThresholdChange}
          result={p.captureResult}
          onCapture={p.onCapture}
        />
        <MatchPanel
          status={p.status}
          busy={p.busy}
          minimalMatchScore={p.minimalMatchScore}
          onMinimalMatchScoreChange={p.onMinimalMatchScoreChange}
          referenceResult={p.referenceResult}
          refTemplate={p.refTemplate}
          liveTemplate={p.liveTemplate}
          matchResult={p.matchResult}
          onProcessReference={p.onProcessReference}
          onMatch={p.onMatch}
          onCaptureAndMatch={p.onCaptureAndMatch}
        />
      </div>
      <p className="hint" style={{ marginTop: 24 }}>
        Workflow: connect → device info / cameras → open camera → upload &amp; process reference →
        capture live face → match → close camera → disconnect.
      </p>
    </>
  );
}
```

- [ ] **Step 5: Rewrite `App.tsx` as a shell with a mode toggle**

In `src/App.tsx`: keep all existing state and handlers; add a `mode` state and render the rail toggle + the selected view. Replace the masthead/grid region of the returned JSX with:
```tsx
  const [mode, setMode] = useState<"live" | "manual">("live");
```
and, inside the returned tree, replace the existing `<header className="masthead">…</header>` and the `<div className="grid">…</div>` + trailing hint with:
```tsx
      <header className="masthead">
        <h1>FacePod Tester</h1>
        <div className="mode-toggle" role="tablist" aria-label="View mode">
          <button
            role="tab"
            aria-selected={mode === "live"}
            className={mode === "live" ? "on" : ""}
            onClick={() => setMode("live")}
          >
            Live
          </button>
          <button
            role="tab"
            aria-selected={mode === "manual"}
            className={mode === "manual" ? "on" : ""}
            onClick={() => setMode("manual")}
          >
            Manual
          </button>
        </div>
      </header>

      {mode === "manual"
        ? (
          <ManualView
            status={status}
            busy={busy}
            deviceInfo={deviceInfo}
            cameras={cameras}
            captureResult={captureResult}
            referenceResult={referenceResult}
            matchResult={matchResult}
            refTemplate={refTemplate}
            liveTemplate={liveTemplate}
            thresholds={thresholds}
            minimalMatchScore={minimalMatchScore}
            onThresholdChange={(patch) => setThresholds((t) => ({ ...t, ...patch }))}
            onMinimalMatchScoreChange={setMinimalMatchScore}
            onConnect={handleConnect}
            onDisconnect={handleDisconnect}
            onSetScenario={handleSetScenario}
            onRefreshInfo={() => run(api.getDeviceInfo, (r) => setDeviceInfo(r.deviceInfo))}
            onRefreshCameras={() => run(api.getCameras, (r) => setCameras(r.cameras))}
            onOpenCamera={(req) => run(() => api.openCamera(req))}
            onCloseCamera={() => run(api.closeCamera)}
            onCapture={handleCapture}
            onProcessReference={handleProcessReference}
            onMatch={handleMatch}
            onCaptureAndMatch={handleCaptureAndMatch}
          />
        )
        : <div className="live-placeholder">Live mode lands in Task 9.</div>}
```
Add the imports at the top: `import { ManualView } from "./components/manual/ManualView.tsx";` and ensure `useState` is already imported (it is). Remove the now-unused direct panel imports from `App.tsx` that moved into `ManualView` (`DeviceConfigPanel`, `DeviceStatusPanel`, `CameraControls`, `MatchPanel`) — keep `CapturePanel`'s `CaptureThresholds` type import (App still owns `thresholds`). Keep the `status-strip` and `error-banner` blocks exactly as they are.

- [ ] **Step 6: Add minimal mode-toggle styles**

Append to `src/styles.css`:
```css
/* ---- Mode toggle (Live / Manual) ---- */
.mode-toggle { display: inline-flex; gap: 2px; background: hsl(var(--muted)); border: 1px solid hsl(var(--border)); border-radius: 999px; padding: 3px; }
.mode-toggle button { font: inherit; font-size: 12px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; color: hsl(var(--muted-foreground)); background: transparent; border: none; border-radius: 999px; padding: 6px 16px; cursor: pointer; }
.mode-toggle button.on { background: hsl(var(--primary) / 0.16); color: hsl(var(--primary)); }
.live-placeholder { color: hsl(var(--muted-foreground)); padding: 48px; text-align: center; }
```

- [ ] **Step 7: Build + run the back-end check; verify Manual mode is unchanged**

Run: `npm run build && npm test`
Expected: build PASS, vitest PASS. Then manual check:
```bash
deno task dev:mock
# in another shell: npm run dev → open http://localhost:5174, toggle to Manual,
# confirm the five panels work exactly as before (connect/open/capture/match in mock).
```

- [ ] **Step 8: Commit**

```bash
git add src/App.tsx src/components/manual/ManualView.tsx src/live/connectionSettings.ts src/components/DeviceConfigPanel.tsx src/styles.css
git commit -m "refactor(ui): add Live/Manual shell and extract Manual view"
```

---

### Task 7: Extract `readImageFile` + the watch loop hook

**Files:**
- Create: `src/live/readImageFile.ts`
- Create: `src/live/useWatchLoop.ts`
- Modify: `src/components/MatchPanel.tsx`

**Interfaces:**
- Consumes: `api` (`api.capture`, `api.match`), `CaptureRequest`, `ImageDatatype`, `NormalizedError`, `ApiError` from `src/api.ts`; `toLiveFrame` from `src/live/logic.ts`; `LiveFrame`, `LiveThresholds` from `src/live/types.ts`.
- Produces:
  - `readImageFile(file: File): Promise<{ data: string; datatype: ImageDatatype; previewUrl: string; fileName: string } | { error: string }>`
  - `useWatchLoop(opts: { active: boolean; refTemplate: string | null; thresholds: LiveThresholds; onFrame: (f: LiveFrame) => void; onError: (e: NormalizedError) => void; intervalMs?: number }): void`

- [ ] **Step 1: Extract the image reader**

Create `src/live/readImageFile.ts` (lifted from `MatchPanel.tsx`'s `detectDatatype` + `readFile`):
```ts
import type { ImageDatatype } from "../api.ts";

export interface ReadImageOk {
  data: string;
  datatype: ImageDatatype;
  previewUrl: string;
  fileName: string;
}

function detectDatatype(mime: string, fileName: string): ImageDatatype | null {
  if (mime === "image/png" || fileName.toLowerCase().endsWith(".png")) return "png";
  if (mime === "image/jpeg" || /\.jpe?g$/i.test(fileName)) return "jpeg";
  return null;
}

export function readImageFile(file: File): Promise<ReadImageOk | { error: string }> {
  return new Promise((resolve) => {
    const datatype = detectDatatype(file.type, file.name);
    if (!datatype) {
      resolve({ error: `Unsupported file type "${file.type || file.name}". Use PNG or JPEG.` });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result);
      const base64 = url.split(",")[1] ?? "";
      resolve({ data: base64, datatype, previewUrl: url, fileName: file.name });
    };
    reader.onerror = () => resolve({ error: "Could not read file." });
    reader.readAsDataURL(file);
  });
}
```

- [ ] **Step 2: Point `MatchPanel` at the shared reader**

In `src/components/MatchPanel.tsx`, delete the local `detectDatatype` and `readFile`, and the `RefImage` interface's duplication; import instead:
```ts
import { readImageFile, type ReadImageOk } from "../live/readImageFile.ts";
```
Replace `RefImage` usages with `ReadImageOk` and the `readFile(file)` call in `onFile` with `readImageFile(file)`. Leave all rendering unchanged.

- [ ] **Step 3: Build to confirm the extraction compiles**

Run: `npm run build`
Expected: PASS — `MatchPanel` behaves as before.

- [ ] **Step 4: Implement the watch loop hook**

Create `src/live/useWatchLoop.ts`:
```ts
import { useEffect, useRef } from "react";
import { api, ApiError, type NormalizedError } from "../api.ts";
import { toLiveFrame } from "./logic.ts";
import type { LiveFrame, LiveThresholds } from "./types.ts";

interface Options {
  active: boolean;
  refTemplate: string | null;
  thresholds: LiveThresholds;
  onFrame: (f: LiveFrame) => void;
  onError: (e: NormalizedError) => void;
  intervalMs?: number;
}

/**
 * Host-driven continuous watch (docs/UI-FEEDBACK.md §3, loop shape 2): while
 * `active`, repeatedly capture (serialized — never overlap the single device
 * context) and, when a reference template is held, match the live template
 * against it. Each result is folded into a LiveFrame and handed to `onFrame`.
 * A device error stops the loop and is reported via `onError`.
 */
export function useWatchLoop(opts: Options): void {
  // Keep latest opts in a ref so the loop reads fresh values without re-arming.
  const ref = useRef(opts);
  ref.current = opts;
  const runningRef = useRef(false);

  useEffect(() => {
    if (!opts.active) return;
    runningRef.current = true;

    const loop = async () => {
      while (runningRef.current && ref.current.active) {
        const { thresholds, refTemplate, onFrame, onError, intervalMs } = ref.current;
        try {
          const cap = await api.capture({
            minimalQuality: thresholds.minimalQuality,
            maximalSpoofScore: thresholds.maximalSpoofScore,
            timeoutMs: 1500, // bound a live capture so the loop stays responsive
          });
          let match = null;
          const live = cap.result.template?.data ?? null;
          if (refTemplate && live) {
            const m = await api.match({
              template1: refTemplate,
              template2: live,
              minimalMatchScore: thresholds.minimalMatchScore,
            });
            match = m.result;
          }
          if (!runningRef.current) break;
          onFrame(toLiveFrame(cap.result, match));
        } catch (e) {
          const detail = e instanceof ApiError
            ? e.detail
            : { name: "Error", message: String(e), httpStatus: 500 } as NormalizedError;
          // 409 BusyError is transient (a manual op raced us) — pause and retry.
          if (detail.name !== "BusyError") {
            onError(detail);
            runningRef.current = false;
            break;
          }
        }
        await new Promise((r) => setTimeout(r, ref.current.intervalMs ?? 150));
      }
    };
    loop();

    return () => {
      runningRef.current = false;
    };
  }, [opts.active]);
}
```

- [ ] **Step 5: Build + test to confirm types**

Run: `npm run build && npm test`
Expected: PASS (no runtime test for the hook — verified visually in Task 9).

- [ ] **Step 6: Commit**

```bash
git add src/live/readImageFile.ts src/live/useWatchLoop.ts src/components/MatchPanel.tsx
git commit -m "feat(live): add image reader and watch-loop hook"
```

---

### Task 8: Presentational HUD components — Feed, Telemetry, ActionDock

**Files:**
- Create: `src/components/live/Feed.tsx`
- Create: `src/components/live/Telemetry.tsx`
- Create: `src/components/live/ActionDock.tsx`

**Interfaces:**
- Consumes: `LiveFrame`, `LiveThresholds`, `Verdict` from `src/live/types.ts`; `barState`, `computeVerdict`, `deriveGuidance` from `src/live/logic.ts`.
- Produces:
  - `<Feed frame={LiveFrame | null} verdict={Verdict} guidance={string | null} videoFrame={null} overlayBox={null} />`
  - `<Telemetry frame={LiveFrame | null} thresholds={LiveThresholds} hasReference={boolean} verdict={Verdict} />`
  - `<ActionDock watching={boolean} hasReference={boolean} onToggleWatch={() => void} onPickReference={(file: File) => void} onClearReference={() => void} />`

- [ ] **Step 1: Build the Feed component**

Create `src/components/live/Feed.tsx`:
```tsx
import type { LiveFrame, Verdict } from "../../live/types.ts";

interface Props {
  frame: LiveFrame | null;
  verdict: Verdict;
  guidance: string | null;
  /** Phase 2 (HFGetVideoFrame) extension points — inert in v1. */
  videoFrame?: { datatype: string; data: string } | null;
  overlayBox?: { x: number; y: number; width: number; height: number } | null;
}

function imgSrc(datatype: string, data: string): string {
  return `data:image/${datatype === "jpg" ? "jpeg" : datatype};base64,${data}`;
}

/**
 * The viewfinder. v1 shows the live detected-face image (refreshed by the watch
 * loop) inside a framed reticle with a detection-state glow. `videoFrame` /
 * `overlayBox` are reserved for the Phase 2 full-frame feed + tracking box.
 */
export function Feed({ frame, verdict, guidance, videoFrame = null, overlayBox = null }: Props) {
  const img = videoFrame ?? frame?.image ?? null;
  const locked = verdict.state === "accept";
  const present = verdict.state !== "searching";
  return (
    <div className={`feed ${locked ? "locked" : present ? "present" : "searching"}`}>
      {img
        ? <img className="feed-img" src={imgSrc(img.datatype, img.data)} alt="live face" />
        : <div className="feed-empty" />}
      <div className="grain" />
      <div className="scan" />
      <div className="bracket tl" /><div className="bracket tr" />
      <div className="bracket bl" /><div className="bracket br" />
      {overlayBox && (
        <div
          className="bbox"
          style={{
            left: `${overlayBox.x}px`,
            top: `${overlayBox.y}px`,
            width: `${overlayBox.width}px`,
            height: `${overlayBox.height}px`,
          }}
        />
      )}
      {guidance && (
        <div className="guide"><span className="ar">⌖</span>{guidance}</div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Build the Telemetry component**

Create `src/components/live/Telemetry.tsx`:
```tsx
import { barState } from "../../live/logic.ts";
import type { LiveFrame, LiveThresholds, Verdict } from "../../live/types.ts";

interface Props {
  frame: LiveFrame | null;
  thresholds: LiveThresholds;
  hasReference: boolean;
  verdict: Verdict;
}

function Bar(
  { name, value, threshold, higherPasses, label }: {
    name: string;
    value: number | null;
    threshold: number;
    higherPasses: boolean;
    label: string;
  },
) {
  if (value === null) {
    return (
      <div className="tm">
        <div className="name">{name}</div>
        <div className="track"><div className="thresh" style={{ left: `${threshold * 100}%` }} data-t={label} /></div>
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
      </div>
      <div className={`val ${b.tone === "ok" ? "ok" : b.tone}`}>
        {Math.round(value * 100)}<small>%</small>
      </div>
    </div>
  );
}

/** Three threshold-marker bars + the verdict chip (docs/UI-FEEDBACK.md §4). */
export function Telemetry({ frame, thresholds, hasReference, verdict }: Props) {
  const cls = verdict.state === "accept" ? "accept"
    : verdict.state === "reject" ? "reject"
    : "searching";
  const label = verdict.state === "accept" ? "✓ ACCEPT"
    : verdict.state === "reject" ? "✗ REJECT"
    : verdict.state === "acquiring" ? "Acquiring…"
    : "Watching…";
  return (
    <>
      <div className={`verdict ${cls}`}>
        <span className="big">{label}</span>
        {verdict.reasons.length > 0 && (
          <span className="reason">{verdict.reasons.join(" · ")}</span>
        )}
      </div>
      <div className="telem">
        <Bar name="Quality" value={frame?.quality ?? null} threshold={thresholds.minimalQuality} higherPasses label={`min ${Math.round(thresholds.minimalQuality * 100)}`} />
        <Bar name="Liveness" value={frame ? frame.spoofScore : null} threshold={thresholds.maximalSpoofScore} higherPasses={false} label={`max ${Math.round(thresholds.maximalSpoofScore * 100)}`} />
        <Bar name="Match" value={hasReference ? (frame?.matchScore ?? null) : null} threshold={thresholds.minimalMatchScore} higherPasses label={`min ${Math.round(thresholds.minimalMatchScore * 100)}`} />
      </div>
      {!hasReference && <p className="hint">Match needs a reference — set one in the dock below.</p>}
    </>
  );
}
```

- [ ] **Step 3: Build the ActionDock component**

Create `src/components/live/ActionDock.tsx`:
```tsx
import { useRef } from "react";

interface Props {
  watching: boolean;
  hasReference: boolean;
  onToggleWatch: () => void;
  onPickReference: (file: File) => void;
  onClearReference: () => void;
}

/** Watch toggle + in-memory reference control (no persistence per constraints). */
export function ActionDock({ watching, hasReference, onToggleWatch, onPickReference, onClearReference }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <div className="dock">
      <button className="btn primary" onClick={onToggleWatch}>
        {watching ? "Continuous watch · ON" : "Start watching"}
      </button>
      <div className="refchip">
        <span className="k">Reference</span>
        {hasReference
          ? (
            <span className="v">
              ✓ set · in-memory
              <button className="link-btn" onClick={onClearReference}>clear</button>
            </span>
          )
          : (
            <button className="link-btn" onClick={() => fileRef.current?.click()}>
              Set reference…
            </button>
          )}
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg"
        style={{ display: "none" }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onPickReference(f);
          e.target.value = "";
        }}
      />
    </div>
  );
}
```

- [ ] **Step 4: Build to confirm the components type-check**

Run: `npm run build`
Expected: PASS (components compile; not yet mounted).

- [ ] **Step 5: Commit**

```bash
git add src/components/live/Feed.tsx src/components/live/Telemetry.tsx src/components/live/ActionDock.tsx
git commit -m "feat(live): add Feed, Telemetry and ActionDock components"
```

---

### Task 9: LiveView container — scenes, Go-Live, watch wiring, settings

**Files:**
- Create: `src/components/live/LiveView.tsx`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `Feed`, `Telemetry`, `ActionDock`; `useWatchLoop`; `computeVerdict`, `deriveGuidance`; `loadConnectionSettings`; `readImageFile`; `api`, `ApiError`, types from `src/api.ts`; the shared `LiveThresholds`.
- Produces: `<LiveView status={SessionStatus | null} thresholds={LiveThresholds} onError={(e: NormalizedError) => void} />`, mounted by `App` in Live mode.

- [ ] **Step 1: Build the LiveView container**

Create `src/components/live/LiveView.tsx`:
```tsx
import { useCallback, useState } from "react";
import { api, ApiError, type NormalizedError, type SessionStatus } from "../../api.ts";
import { loadConnectionSettings } from "../../live/connectionSettings.ts";
import { readImageFile } from "../../live/readImageFile.ts";
import { useWatchLoop } from "../../live/useWatchLoop.ts";
import { computeVerdict, deriveGuidance } from "../../live/logic.ts";
import type { LiveFrame, LiveThresholds } from "../../live/types.ts";
import { Feed } from "./Feed.tsx";
import { Telemetry } from "./Telemetry.tsx";
import { ActionDock } from "./ActionDock.tsx";

type Scene = "idle" | "connecting" | "live";

interface Props {
  status: SessionStatus | null;
  thresholds: LiveThresholds;
  onError: (e: NormalizedError) => void;
}

/** The Live HUD: one-tap Go Live → continuous watch → telemetry + verdict. */
export function LiveView({ status, thresholds, onError }: Props) {
  const [scene, setScene] = useState<Scene>(status?.cameraOpen ? "live" : "idle");
  const [watching, setWatching] = useState(false);
  const [frame, setFrame] = useState<LiveFrame | null>(null);
  const [refTemplate, setRefTemplate] = useState<string | null>(null);

  const hasReference = refTemplate !== null;
  const verdict = frame
    ? computeVerdict(frame, thresholds, hasReference)
    : { state: "searching" as const, reasons: [] };
  const guidance = frame ? deriveGuidance(frame) : "Step in front of the camera";

  useWatchLoop({
    active: watching && scene === "live",
    refTemplate,
    thresholds,
    onFrame: setFrame,
    onError: (e) => {
      setWatching(false);
      onError(e);
    },
  });

  const goLive = useCallback(async () => {
    setScene("connecting");
    try {
      const s = loadConnectionSettings();
      const poll = s.pollIntervalMs.trim();
      await api.connect({
        dllPath: s.dllPath.trim() || undefined,
        dllDir: s.dllDir.trim() || undefined,
        pollIntervalMs: poll === "" ? undefined : Number(poll),
        mock: s.mock || undefined,
        mockScenario: s.scenario,
      });
      await api.openCamera({});
      setScene("live");
      setWatching(true);
    } catch (e) {
      setScene("idle");
      onError(
        e instanceof ApiError ? e.detail : { name: "Error", message: String(e), httpStatus: 500 },
      );
    }
  }, [onError]);

  const pickReference = useCallback(async (file: File) => {
    const read = await readImageFile(file);
    if ("error" in read) {
      onError({ name: "ReferenceError", message: read.error, httpStatus: 400 });
      return;
    }
    try {
      const r = await api.processImage({
        image: read.data,
        datatype: read.datatype,
        minimalQuality: thresholds.minimalQuality,
      });
      if (!r.result.template) {
        onError({ name: "ReferenceError", message: "No face found in reference image.", httpStatus: 422 });
        return;
      }
      setRefTemplate(r.result.template.data);
    } catch (e) {
      onError(e instanceof ApiError ? e.detail : { name: "Error", message: String(e), httpStatus: 500 });
    }
  }, [onError, thresholds.minimalQuality]);

  if (scene === "idle") {
    return (
      <div className="live-shell">
        <div className="center-scene">
          <div className="idle-mark"><span className="m" /></div>
          <h1 className="idle-title">Ready when you are</h1>
          <p className="idle-sub">
            Tap to bring the camera online and start watching for a face. No setup —
            the device default is pre-configured.
          </p>
          <button className="go" onClick={goLive}>Go Live</button>
          <p className="target">Transport <b>USB / FFI</b> · default camera</p>
        </div>
      </div>
    );
  }

  if (scene === "connecting") {
    return (
      <div className="live-shell">
        <div className="center-scene">
          <div className="ring" />
          <h1 className="idle-title" style={{ fontSize: 26 }}>Bringing the camera online…</h1>
          <p className="idle-sub">Connecting to the module and opening the default camera.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="live-shell">
      <Feed frame={frame} verdict={verdict} guidance={guidance} />
      <Telemetry frame={frame} thresholds={thresholds} hasReference={hasReference} verdict={verdict} />
      <ActionDock
        watching={watching}
        hasReference={hasReference}
        onToggleWatch={() => setWatching((w) => !w)}
        onPickReference={pickReference}
        onClearReference={() => setRefTemplate(null)}
      />
      <p className="hint">Guidance is derived in-UI from face size/status, not HID-measured.</p>
    </div>
  );
}
```

- [ ] **Step 2: Mount `LiveView` in `App` Live mode**

In `src/App.tsx`, replace the `<div className="live-placeholder">…</div>` from Task 6 with:
```tsx
        : (
          <LiveView
            status={status}
            thresholds={{
              minimalQuality: thresholds.minimalQuality,
              maximalSpoofScore: thresholds.maximalSpoofScore,
              minimalMatchScore: minimalMatchScore,
            }}
            onError={setError}
          />
        )}
```
Add the import: `import { LiveView } from "./components/live/LiveView.tsx";`

- [ ] **Step 3: Build + test**

Run: `npm run build && npm test`
Expected: both PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/live/LiveView.tsx src/App.tsx
git commit -m "feat(live): wire LiveView container with Go-Live and watch loop"
```

---

### Task 10: HUD styles + 800×1280 portrait layout

**Files:**
- Modify: `src/styles.css`

**Interfaces:**
- Consumes: existing tokens in `:root` (`--primary`, `--success`, etc.) and the class names emitted by `Feed`/`Telemetry`/`ActionDock`/`LiveView` above.
- Produces: the AirOps HUD styles, ported from `docs/live-hud-mockup.html`, plus a portrait container override.

- [ ] **Step 1: Add the HUD styles**

Append to `src/styles.css` (class names match the components in Tasks 8–9; values ported from `docs/live-hud-mockup.html`):
```css
/* ================= Live HUD ================= */
.live-shell { display: flex; flex-direction: column; min-height: 60vh; }

/* Feed (hero viewfinder) */
.feed {
  position: relative; flex: 1; min-height: 420px; margin: 12px 0; border-radius: 18px;
  overflow: hidden; border: 1px solid hsl(var(--border));
  background: radial-gradient(420px 520px at 50% 42%, hsl(220 18% 22%), hsl(220 16% 9%) 70%, hsl(220 18% 6%));
}
.feed-img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; opacity: 0.92; }
.feed-empty { position: absolute; inset: 0; }
.feed.locked { border-color: hsl(var(--success) / 0.6); box-shadow: inset 0 0 60px hsl(var(--success) / 0.18); }
.feed.present { border-color: hsl(var(--primary) / 0.5); }
.scan { position: absolute; inset: 0; pointer-events: none; mix-blend-mode: screen; opacity: 0.6; height: 120px;
  background: linear-gradient(hsl(var(--primary) / 0) 0%, hsl(var(--primary) / 0.12) 50%, hsl(var(--primary) / 0) 100%);
  animation: scan 4.5s linear infinite; }
@keyframes scan { 0% { transform: translateY(-140px); } 100% { transform: translateY(620px); } }
.grain { position: absolute; inset: 0; pointer-events: none; opacity: 0.05;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E"); }
.bracket { position: absolute; width: 46px; height: 46px; border: 3px solid hsl(var(--primary) / 0.85); filter: var(--glow-primary); }
.bracket.tl { left: 16px; top: 16px; border-right: none; border-bottom: none; border-radius: 10px 0 0 0; }
.bracket.tr { right: 16px; top: 16px; border-left: none; border-bottom: none; border-radius: 0 10px 0 0; }
.bracket.bl { left: 16px; bottom: 16px; border-right: none; border-top: none; border-radius: 0 0 0 10px; }
.bracket.br { right: 16px; bottom: 16px; border-left: none; border-top: none; border-radius: 0 0 10px 0; }
.bbox { position: absolute; border: 2.5px solid hsl(var(--success)); border-radius: 12px; box-shadow: 0 0 18px hsl(var(--success) / 0.45);
  transition: left .5s cubic-bezier(.2,.7,.2,1), top .5s, width .5s, height .5s; }
.guide { position: absolute; left: 50%; bottom: 30px; transform: translateX(-50%);
  display: flex; align-items: center; gap: 12px; padding: 12px 22px; border-radius: 14px;
  background: hsl(0 0% 0% / 0.5); border: 1px solid hsl(var(--border)); backdrop-filter: blur(6px);
  font-size: 20px; font-weight: 700; white-space: nowrap; }
.guide .ar { font-size: 22px; color: hsl(var(--primary)); filter: var(--glow-primary); }

/* Verdict chip */
.verdict { height: 78px; border-radius: 16px; display: flex; align-items: center; justify-content: center; gap: 16px;
  font-size: 30px; font-weight: 800; letter-spacing: .04em; border: 1px solid hsl(var(--border)); transition: all .35s; margin: 4px 0; }
.verdict .big { display: inline-flex; align-items: center; gap: 14px; }
.verdict.searching { background: hsl(var(--muted)); color: hsl(var(--muted-foreground)); font-size: 20px; letter-spacing: .08em; text-transform: uppercase; }
.verdict.accept { background: hsl(var(--success) / 0.13); color: hsl(var(--success)); border-color: hsl(var(--success) / 0.45);
  text-shadow: 0 0 18px hsl(var(--success) / 0.5); animation: pop .4s cubic-bezier(.2,1.4,.4,1); }
.verdict.reject { background: hsl(var(--destructive) / 0.12); color: hsl(var(--destructive)); border-color: hsl(var(--destructive) / 0.4); }
.verdict .reason { font-size: 15px; font-weight: 600; letter-spacing: 0; opacity: .85; text-transform: none; }
@keyframes pop { 0% { transform: scale(.96); } 60% { transform: scale(1.02); } 100% { transform: scale(1); } }

/* Telemetry bars */
.telem { display: flex; flex-direction: column; gap: 14px; margin: 14px 0 0; }
.tm { display: grid; grid-template-columns: 110px 1fr 84px; align-items: center; gap: 14px; }
.tm .name { font-size: 12px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; color: hsl(var(--muted-foreground)); }
.track { position: relative; height: 18px; border-radius: 999px; background: hsl(var(--muted)); }
.fill { position: absolute; left: 0; top: 0; bottom: 0; border-radius: 999px; transition: width .3s ease, background .3s;
  background: hsl(var(--success)); box-shadow: 0 0 14px hsl(var(--success) / 0.5); }
.fill.bad { background: hsl(var(--destructive)); box-shadow: 0 0 14px hsl(var(--destructive) / 0.5); }
.fill.warn { background: hsl(var(--warning)); box-shadow: 0 0 14px hsl(var(--warning) / 0.5); }
.thresh { position: absolute; top: -5px; bottom: -5px; width: 3px; border-radius: 2px; background: hsl(var(--foreground)); box-shadow: 0 0 0 2px hsl(var(--background)); }
.thresh::after { content: attr(data-t); position: absolute; top: -19px; left: 50%; transform: translateX(-50%);
  font-size: 10px; font-weight: 700; color: hsl(var(--muted-foreground)); font-variant-numeric: tabular-nums; white-space: nowrap; }
.tm .val { text-align: right; font-size: 26px; font-weight: 800; font-variant-numeric: tabular-nums; letter-spacing: -.02em; }
.tm .val.ok { color: hsl(var(--success)); } .tm .val.bad { color: hsl(var(--destructive)); } .tm .val.warn { color: hsl(var(--warning)); }
.tm .val.muted { color: hsl(var(--muted-foreground)); }
.tm .val small { font-size: 13px; font-weight: 600; color: hsl(var(--muted-foreground)); }

/* Action dock */
.dock { display: flex; align-items: center; gap: 14px; margin: 18px 0 4px; }
.dock .btn { flex: 1; height: 64px; border-radius: 16px; font-size: 18px; font-weight: 800; }
.refchip { flex: none; height: 64px; padding: 0 20px; border-radius: 16px; border: 1px solid hsl(var(--border));
  background: hsl(var(--card)); display: flex; flex-direction: column; justify-content: center; gap: 2px; min-width: 172px; }
.refchip .k { font-size: 10px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; color: hsl(var(--muted-foreground)); }
.refchip .v { font-size: 15px; font-weight: 700; color: hsl(var(--success)); display: flex; align-items: center; gap: 10px; }

/* Idle / connecting scenes */
.center-scene { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 26px;
  padding: 60px 24px; text-align: center; min-height: 60vh; }
.idle-mark { width: 96px; height: 96px; border-radius: 24px; background: hsl(var(--primary) / 0.12); border: 1px solid hsl(var(--primary) / 0.4); display: flex; align-items: center; justify-content: center; }
.idle-mark .m { width: 34px; height: 34px; border-radius: 9px; background: hsl(var(--primary)); filter: var(--glow-primary); }
.idle-title { font-size: 34px; font-weight: 800; letter-spacing: -.02em; margin: 0; }
.idle-sub { font-size: 16px; color: hsl(var(--muted-foreground)); max-width: 440px; margin: 0; line-height: 1.5; }
.go { height: 74px; padding: 0 64px; font-size: 21px; font-weight: 800; border-radius: 18px; cursor: pointer;
  background: hsl(var(--primary)); color: hsl(var(--primary-foreground)); border: none; box-shadow: 0 0 34px hsl(var(--primary) / 0.4); }
.target { font-size: 13px; color: hsl(var(--muted-foreground)); } .target b { color: hsl(var(--foreground)); }
.ring { width: 96px; height: 96px; border-radius: 50%; border: 4px solid hsl(var(--muted)); border-top-color: hsl(var(--primary));
  animation: spin 1s linear infinite; filter: var(--glow-primary); }
@keyframes spin { to { transform: rotate(360deg); } }
```

- [ ] **Step 2: Add the portrait layout override**

Append to `src/styles.css`:
```css
/* ---- 800×1280 portrait kiosk: the primary target ---- */
@media (max-width: 840px) {
  .app { max-width: 100%; padding: 14px 14px 28px; }
  .grid { grid-template-columns: 1fr; }
  /* Touch sizing for the manual surface too. */
  .btn { min-height: 44px; }
}
```
(The existing `@media (max-width: 880px)` single-column rule remains; this adds kiosk padding/touch sizing.)

- [ ] **Step 3: Verify the styles build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/styles.css
git commit -m "style(live): add HUD styles and portrait kiosk layout"
```

---

### Task 11: End-to-end mock verification + docs

**Files:**
- Modify: `README.md`
- Modify: `docs/UI-FEEDBACK.md`

**Interfaces:**
- Consumes: the running app (mock mode) and the Playwright MCP.
- Produces: verified screenshots of all four states at 800×1280; updated docs.

- [ ] **Step 1: Full green gate**

Run:
```bash
npm run build
npm test
deno task check
deno test --allow-env --allow-read server/
```
Expected: all four PASS.

- [ ] **Step 2: Run the app in mock mode**

Run (two shells):
```bash
deno task dev:mock
npm run dev    # → http://localhost:5174
```

- [ ] **Step 3: Verify the four states at 800×1280 with the Playwright MCP**

Drive the browser at viewport 800×1280:
1. **Idle** — Live mode default shows "Ready when you are" + Go Live. Screenshot.
2. Click **Go Live** → **Connecting** ring appears briefly, then **Live**. Screenshot the watching state.
3. In the connection gear (Manual mode → panel 01 → ⚙), set Mock scenario to **Approaching face (live demo)**; return to Live, Go Live again; confirm telemetry bars and verdict animate and reach **ACCEPT**. Screenshot.
4. Click **Set reference…**, choose a PNG/JPEG face; confirm the **Match** bar activates and contributes to the verdict. Screenshot.

Expected: all four states match `docs/live-hud-mockup.html`; no console errors; verdict + bars update live.

- [ ] **Step 4: Update the README**

In `README.md`, under "Layout"/usage, document the two modes: Live (one-tap Go Live + continuous watch HUD, the default) and Manual (the existing 01–05 panels). Note that the live "feed" is the detected-face image refreshed by the watch loop, and that the full-frame video + tracking-box overlay is a future enhancement gated on the `hardware-libs` `HFGetVideoFrame` seam.

- [ ] **Step 5: Mark the design doc follow-ups**

In `docs/UI-FEEDBACK.md`, update §1's "Still worth doing" (auto-advance after Connect is now the one-tap Go Live) and add a one-line status note at the top of §2/§5 that the HUD shell, continuous watch, telemetry, verdict, and derived guidance are implemented in this redesign, while the HFGetVideoFrame feed + bbox/landmark overlay remain Phase 2 (separate hardware-libs plan).

- [ ] **Step 6: Commit**

```bash
git add README.md docs/UI-FEEDBACK.md
git commit -m "docs: document Live/Manual modes and Phase 2 feed boundary"
```

---

## Self-Review

**Spec coverage** (against `docs/UI-FEEDBACK.md` + the four locked decisions):
- One-tap Go Live (decision) → Task 9 `goLive` (connect + open + watch). ✅
- Continuous watch (decision) → Task 7 `useWatchLoop` + Task 9 wiring. ✅
- Keep & evolve AirOps (decision) → Task 10 ports the mockup tokens/styles. ✅
- Mockup-first (decision) → already delivered (`docs/live-hud-mockup.html`); Task 11 verifies parity. ✅
- §1 simpler connect/open → folded into Go Live + Manual mode preserved (Task 6). ✅
- §3 live detection + stats → telemetry bars (Task 8) from real capture fields (Task 2). ✅
- §4 threshold-marker viz → `barState` + `Telemetry` (Tasks 3, 8). ✅
- §5 portrait layout + Live/Manual tabs → Tasks 6, 10. ✅
- §7 constraints (FFI-only, fail-closed liveness, no data-at-rest, portrait) → Global Constraints + in-memory `refTemplate` (Task 9). ✅
- §2 full-frame feed / §6 seam work → explicitly OUT OF SCOPE (read-only hardware-libs); inert `videoFrame`/`overlayBox` props (Task 8) + documented Phase 2 (Task 11). ✅

**Placeholder scan:** No "TBD"/"add error handling"/"similar to". The one cross-file reference (CSS ported from the mockup) includes the full CSS inline in Task 10. ✅

**Type consistency:** `LiveFrame`, `LiveThresholds`, `Verdict`, `BarView` defined in Task 2 and used identically in Tasks 3, 4, 7, 8, 9. `toLiveFrame`/`barState`/`computeVerdict`/`deriveGuidance` signatures match across logic + consumers. `useWatchLoop` options match its call site in `LiveView`. `ConnectionSettings`/`readImageFile` extractions keep the same shapes their original call sites used. `MOCK_SCENARIOS` union updated in BOTH `server/mockClient.ts` and `src/api.ts` (Task 5). ✅

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-16-facepod-live-hud-redesign.md`. Two execution options:

1. **Subagent-Driven (recommended)** — a fresh subagent per task, reviewed between tasks, fast iteration.
2. **Inline Execution** — execute tasks in this session with checkpoints for review.

Which approach?
