# Unified single-screen FacePod Tester — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse the FacePod Tester into one screen — a live feed with all stats visible at once and an inline photo-match flow — removing the Live/Manual tabs and the stepped Manual panels.

**Architecture:** `App` becomes a thin shell (header + gear-settings + `LiveView` + error banner). `LiveView` keeps owning the session; its layout becomes feed-priority two-pane (feed + gauges left, Frame Data right with its own scroll, dock full-width). Manual-only config (thresholds + mock scenario) moves into a Settings modal/bottom-sheet; everything else in Manual is deleted. Pure logic (liveness confidence, freshness, reference gate, settings parsing/migration) is extracted and unit-tested; presentation is verified by `tsc` + Vitest + on-device review.

**Tech Stack:** React 18 + Vite + TypeScript; Vitest; plain CSS (`src/styles.css`, AirOps-derived tokens). Backend is a Deno/Hono server reached via `src/api.ts`.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-06-22-unified-facepod-tester-design.md`. Every task implicitly inherits its decisions.
- Primary target device: **800×1280 portrait kiosk** (Edge browser). Two-pane is the default at that width; stacking is only for ≤560px.
- **Gauges are all higher-is-better.** Liveness = `1 − spoofScore` confidence; never an inverted gauge. Raw spoof stays a Frame Data number.
- No Claude attribution in commits (author is Jon). Keep commit subjects imperative and scoped.
- Branch: `feature/live-hud-fixes`. Run `npx tsc -b` and `npm test` (Vitest) green before each commit that touches `.ts/.tsx`.
- Camera/DLL/poll config is **not** user-facing. `goLive` sends only `{ mock, mockScenario }` (see Task 6 risk flag before removing the DLL path).

---

## File Structure

**Create**
- `src/settings.ts` — `Thresholds` type + `parseTimeoutMs()` (relocates `CaptureThresholds` out of the to-be-deleted `CapturePanel`).
- `src/live/freshness.ts` — pure `telemetryStatus()` / `videoStatus()` (Paused vs No-signal vs Live).
- `src/components/SettingsModal.tsx` — thresholds + mock/scenario surface (centered modal wide, bottom sheet narrow).
- Test files: `src/settings.test.ts`, `src/live/freshness.test.ts`, plus additions to `src/live/logic.test.ts`, and `src/live/connectionSettings.test.ts`.

**Modify**
- `src/live/logic.ts` — add `livenessConfidence`, `livenessConfidenceThreshold`, `canUseCurrentFace`.
- `src/live/types.ts` — add `timeoutMs?` to `LiveThresholds`.
- `src/live/useWatchLoop.ts` — consume configured capture timeout (replace hard-coded 1500).
- `src/live/connectionSettings.ts` — shrink to `{ mock, scenario }`; migrate/ignore legacy keys.
- `src/App.tsx` — single-screen shell; gear → Settings; remove tabs/`mode`/Manual branch + Manual-only state/handlers.
- `src/components/live/LiveView.tsx` — gauges move below the feed; Frame Data is the right pane; reference source/thumbnail state; freshness wiring; `goLive` server-defaults.
- `src/components/live/Telemetry.tsx` — gauge redesign + "No reference" + paused/stale.
- `src/components/live/LiveDataDisclosure.tsx` — grouped sections (Face/Capture/Liveness/Match/Stream) + stale dimming.
- `src/components/live/ActionDock.tsx` — single stateful watch button; reference chip (thumbnail/source + Replace/Clear); gated "Use current face".
- `src/styles.css` — gauges, feed-priority layout, Frame Data scroll, Settings sheet, reference chip, responsive stack.

**Delete**
- `src/components/manual/ManualView.tsx`, `src/components/manual/DeviceParametersPanel.tsx`
- `src/components/DeviceConfigPanel.tsx`, `src/components/DeviceStatusPanel.tsx`, `src/components/CameraControls.tsx`, `src/components/CapturePanel.tsx`, `src/components/MatchPanel.tsx`
- Any co-located tests for the above (search before deleting).

---

## Task 1: Pure logic helpers (liveness confidence, current-face gate, freshness)

**Files:**
- Modify: `src/live/logic.ts`
- Create: `src/live/freshness.ts`
- Test: `src/live/logic.test.ts` (append), `src/live/freshness.test.ts`

**Interfaces:**
- Produces:
  - `livenessConfidence(spoofScore: number): number`
  - `livenessConfidenceThreshold(maximalSpoofScore: number): number`
  - `canUseCurrentFace(frame: CaptureFrame | null, t: LiveThresholds): boolean`
  - `captureStaleMs(timeoutMs: number | undefined): number`
  - `telemetryStatus(i: { watching: boolean; captureAgeMs: number | null; sinceStartMs: number | null; staleAfterMs?: number; graceMs?: number }): "live" | "paused" | "stale"`
  - `videoStatus(i: { active: boolean; videoAgeMs: number | null; sinceStartMs: number | null; staleAfterMs?: number; graceMs?: number }): "live" | "paused" | "stale"`

- [ ] **Step 1: Write failing tests for the logic helpers**

Append to `src/live/logic.test.ts`:

```ts
import { livenessConfidence, livenessConfidenceThreshold, canUseCurrentFace } from "./logic.ts";
import type { CaptureFrame, LiveThresholds } from "./types.ts";

const T: LiveThresholds = { minimalQuality: 0.7, maximalSpoofScore: 0.5, minimalMatchScore: 0.7 };
const baseFrame: CaptureFrame = {
  image: null, quality: 0.9, spoofScore: 0.1, livenessPassed: true, numberOfFaces: 1,
  boundingBox: null, isCaptured: true, faceStatus: "ok", matchScore: null, matchPassed: null,
  positioningFeedback: null, landmarks: null, liveTemplate: "abc",
};

test("livenessConfidence inverts spoof", () => {
  expect(livenessConfidence(0)).toBe(1);
  expect(livenessConfidence(0.3)).toBeCloseTo(0.7);
});
test("livenessConfidenceThreshold inverts the max-spoof gate", () => {
  expect(livenessConfidenceThreshold(0.5)).toBe(0.5);
});
test("canUseCurrentFace passes for one good measured face with a template", () => {
  expect(canUseCurrentFace(baseFrame, T)).toBe(true);
});
test("canUseCurrentFace fails: no frame / no template / 2 faces / low quality / unmeasured / failed liveness", () => {
  expect(canUseCurrentFace(null, T)).toBe(false);
  expect(canUseCurrentFace({ ...baseFrame, liveTemplate: null }, T)).toBe(false);
  expect(canUseCurrentFace({ ...baseFrame, numberOfFaces: 2 }, T)).toBe(false);
  expect(canUseCurrentFace({ ...baseFrame, quality: 0.5 }, T)).toBe(false);
  expect(canUseCurrentFace({ ...baseFrame, faceStatus: "liveness_unmeasured" }, T)).toBe(false);
  expect(canUseCurrentFace({ ...baseFrame, livenessPassed: false }, T)).toBe(false);
});
```

- [ ] **Step 2: Run; verify failure**

Run: `npm test -- logic`
Expected: FAIL — `livenessConfidence`/`canUseCurrentFace` not exported.

- [ ] **Step 3: Implement the logic helpers**

Append to `src/live/logic.ts`:

```ts
/** Live confidence (0–1) = 1 − spoofScore, so higher = more live (gauge-friendly). */
export function livenessConfidence(spoofScore: number): number {
  return 1 - spoofScore;
}

/** The confidence value a Liveness gauge passes at, derived from the max-spoof gate. */
export function livenessConfidenceThreshold(maximalSpoofScore: number): number {
  return 1 - maximalSpoofScore;
}

/**
 * Strict gate for adopting the CURRENT live frame as a match reference: exactly one
 * face, a finalized template, quality at/above the gate, and liveness measured AND
 * passing. Prevents a stale/low-quality cached template from qualifying.
 */
export function canUseCurrentFace(
  frame: CaptureFrame | null,
  t: LiveThresholds,
): boolean {
  if (!frame) return false;
  return (
    frame.numberOfFaces === 1 &&
    frame.liveTemplate != null &&
    frame.quality >= t.minimalQuality &&
    frame.faceStatus !== "liveness_unmeasured" &&
    frame.livenessPassed === true
  );
}
```

- [ ] **Step 4: Write failing tests for freshness**

Create `src/live/freshness.test.ts`:

```ts
import { captureStaleMs, telemetryStatus, videoStatus } from "./freshness.ts";

test("telemetryStatus: not watching → paused", () => {
  expect(telemetryStatus({ watching: false, captureAgeMs: 10, sinceStartMs: null })).toBe("paused");
});
test("telemetryStatus: warming up (no frame yet, within grace) → live, not a false No-signal", () => {
  expect(telemetryStatus({ watching: true, captureAgeMs: null, sinceStartMs: 200, staleAfterMs: 3000 })).toBe("live");
});
test("telemetryStatus: no frame past grace → stale", () => {
  expect(telemetryStatus({ watching: true, captureAgeMs: null, sinceStartMs: 99999, staleAfterMs: 3000 })).toBe("stale");
});
test("telemetryStatus: fresh frame → live; old frame past threshold → stale", () => {
  expect(telemetryStatus({ watching: true, captureAgeMs: 100, sinceStartMs: 5000, staleAfterMs: 3000 })).toBe("live");
  expect(telemetryStatus({ watching: true, captureAgeMs: 99999, sinceStartMs: 99999, staleAfterMs: 3000 })).toBe("stale");
});
test("videoStatus: inactive → paused; warming up → live; stalled (non-throwing) → stale", () => {
  expect(videoStatus({ active: false, videoAgeMs: 10, sinceStartMs: null })).toBe("paused");
  expect(videoStatus({ active: true, videoAgeMs: null, sinceStartMs: 100 })).toBe("live");
  // A stalled-but-not-erroring stream is the real "No signal" case (not a hardware unplug).
  expect(videoStatus({ active: true, videoAgeMs: 9999, sinceStartMs: 9999 })).toBe("stale");
});
test("captureStaleMs scales with the configured capture timeout (+ margin)", () => {
  expect(captureStaleMs(undefined)).toBe(3000);
  expect(captureStaleMs(4000)).toBe(5500);
});
```

- [ ] **Step 5: Run; verify failure**

Run: `npm test -- freshness`
Expected: FAIL — module not found.

- [ ] **Step 6: Implement freshness**

Create `src/live/freshness.ts`:

```ts
/** Live = fresh data flowing; paused = intentionally stopped; stale = expected but stalled. */
export type FreshnessStatus = "live" | "paused" | "stale";

const DEFAULT_STALE_MS = 2500;

/**
 * Capture-lane stale threshold derived from the configurable capture timeout: a single
 * capture can take up to timeoutMs, plus a match + loop-interval + processing margin. A
 * fixed window would wrongly flag a normal long capture as stale.
 */
export function captureStaleMs(timeoutMs: number | undefined): number {
  return (timeoutMs ?? 1500) + 1500;
}

/**
 * Capture-telemetry freshness (gauges + measured Frame Data). A just-(re)started watch with
 * no frame yet is "live" during the grace window — not a false "stale" — and the caller must
 * reset the age timestamp on start so a leftover age can't trip it. graceMs defaults to the
 * stale window.
 */
export function telemetryStatus(
  i: { watching: boolean; captureAgeMs: number | null; sinceStartMs: number | null; staleAfterMs?: number; graceMs?: number },
): FreshnessStatus {
  if (!i.watching) return "paused";
  const stale = i.staleAfterMs ?? DEFAULT_STALE_MS;
  const grace = i.graceMs ?? stale;
  if (i.captureAgeMs == null) {
    return i.sinceStartMs != null && i.sinceStartMs <= grace ? "live" : "stale";
  }
  return i.captureAgeMs > stale ? "stale" : "live";
}

/** Video-stream freshness (the feed). Same grace treatment on (re)start. */
export function videoStatus(
  i: { active: boolean; videoAgeMs: number | null; sinceStartMs: number | null; staleAfterMs?: number; graceMs?: number },
): FreshnessStatus {
  if (!i.active) return "paused";
  const stale = i.staleAfterMs ?? DEFAULT_STALE_MS;
  const grace = i.graceMs ?? stale;
  if (i.videoAgeMs == null) {
    return i.sinceStartMs != null && i.sinceStartMs <= grace ? "live" : "stale";
  }
  return i.videoAgeMs > stale ? "stale" : "live";
}
```

- [ ] **Step 7: Run tests; verify pass**

Run: `npm test -- logic freshness`
Expected: PASS (all).

- [ ] **Step 8: Commit**

```bash
git add src/live/logic.ts src/live/logic.test.ts src/live/freshness.ts src/live/freshness.test.ts
git commit -m "feat(live): pure helpers for liveness confidence, current-face gate, freshness"
```

---

## Task 2: Thresholds type relocation + capture-timeout wiring

Relocate the `CaptureThresholds` type out of `CapturePanel` (which Task 5 deletes) into a neutral `src/settings.ts`, rename it `Thresholds`, give it `minimalMatchScore`, and add a `parseTimeoutMs` helper. Add `timeoutMs?` to `LiveThresholds` and make `useWatchLoop` use it.

**Files:**
- Create: `src/settings.ts`, `src/settings.test.ts`
- Modify: `src/live/types.ts`, `src/live/useWatchLoop.ts:47-51`, `src/App.tsx` (import + state type), `src/components/CapturePanel.tsx` (re-export shim — temporary), `src/components/manual/ManualView.tsx` (import path)

**Interfaces:**
- Produces:
  - `interface Thresholds { minimalQuality: number; maximalSpoofScore: number; minimalMatchScore: number; timeoutMs: string }`
  - `parseTimeoutMs(timeoutMs: string): number | undefined`
- Consumes: `LiveThresholds` (now with optional `timeoutMs?: number`).

- [ ] **Step 1: Write failing test for `parseTimeoutMs`**

Create `src/settings.test.ts`:

```ts
import { parseTimeoutMs } from "./settings.ts";

test("parseTimeoutMs: blank/whitespace → undefined", () => {
  expect(parseTimeoutMs("")).toBeUndefined();
  expect(parseTimeoutMs("   ")).toBeUndefined();
});
test("parseTimeoutMs: numeric string → number", () => {
  expect(parseTimeoutMs("2000")).toBe(2000);
});
test("parseTimeoutMs: non-numeric → undefined", () => {
  expect(parseTimeoutMs("abc")).toBeUndefined();
});
```

- [ ] **Step 2: Run; verify failure**

Run: `npm test -- settings`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/settings.ts`**

```ts
import type { MockScenario } from "./api.ts";

/** All user-tunable gates, edited in the Settings modal. timeoutMs is kept as a
 *  string for the text input ("" = use the default). */
export interface Thresholds {
  minimalQuality: number;
  maximalSpoofScore: number;
  minimalMatchScore: number;
  timeoutMs: string;
}

export const DEFAULT_THRESHOLDS: Thresholds = {
  minimalQuality: 0.7,
  maximalSpoofScore: 0.5,
  minimalMatchScore: 0.7,
  timeoutMs: "",
};

/** Parse the capture-timeout input → ms, or undefined when blank/invalid. */
export function parseTimeoutMs(timeoutMs: string): number | undefined {
  const t = timeoutMs.trim();
  if (t === "") return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}

export type { MockScenario };
```

- [ ] **Step 4: Add `timeoutMs` to `LiveThresholds`**

In `src/live/types.ts`, inside `interface LiveThresholds` (after `minimalMatchScore`):

```ts
  /** Per-capture timeout (ms) for the watch loop; falls back to a default when unset. */
  timeoutMs?: number;
```

- [ ] **Step 5: Wire `useWatchLoop` to the configured timeout**

In `src/live/useWatchLoop.ts`, replace the hard-coded literal at lines 47-51:

```ts
          const capP = api.capture({
            minimalQuality: thresholds.minimalQuality,
            maximalSpoofScore: thresholds.maximalSpoofScore,
            // Bound a live capture so the loop stays responsive; default 1500ms.
            timeoutMs: thresholds.timeoutMs ?? 1500,
          }, ac.signal);
```

- [ ] **Step 6: Repoint the old `CaptureThresholds` consumers (temporary shim)**

`CapturePanel.tsx` currently *defines* `CaptureThresholds`. Until it is deleted (Task 5), add a re-export so existing imports keep compiling. At the top of `src/components/CapturePanel.tsx`, add:

```ts
import type { Thresholds } from "../settings.ts";
export type CaptureThresholds = Thresholds;
```

Then remove the panel's own `export interface CaptureThresholds { ... }` declaration (search for it in the file) so there is a single definition. Leave the rest of the panel untouched (it is deleted in Task 5).

Because `Thresholds` requires `minimalMatchScore`, the **existing** App initializer (typed `useState<CaptureThresholds>`) no longer satisfies the type — App isn't rewritten until Task 4, so fix the initializer now. In `src/App.tsx`, change it to include the field (the separate `minimalMatchScore` state stays until Task 4):

```ts
  const [thresholds, setThresholds] = useState<CaptureThresholds>({
    minimalQuality: 0.7,
    maximalSpoofScore: 0.5,
    minimalMatchScore: 0.7,
    timeoutMs: "",
  });
```

If `npx tsc -b` flags any other `CaptureThresholds` object literal (e.g. a default inside `CapturePanel`), add `minimalMatchScore` there too.

- [ ] **Step 7: Type-check**

Run: `npx tsc -b`
Expected: exit 0 (App/ManualView still import `CaptureThresholds` from `CapturePanel`, now an alias of `Thresholds`).

- [ ] **Step 8: Run tests**

Run: `npm test`
Expected: PASS (50 existing + new settings tests).

- [ ] **Step 9: Commit**

```bash
git add src/settings.ts src/settings.test.ts src/live/types.ts src/live/useWatchLoop.ts src/components/CapturePanel.tsx src/App.tsx
git commit -m "refactor(settings): relocate thresholds type, wire configurable capture timeout"
```

---

## Task 3: Settings modal / bottom-sheet component

**Files:**
- Create: `src/components/SettingsModal.tsx`
- Modify: `src/styles.css` (append `.sheet*` + `.settings-*` styles)

**Interfaces:**
- Produces:

```ts
interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
  thresholds: import("../settings.ts").Thresholds;
  onThresholdChange: (patch: Partial<import("../settings.ts").Thresholds>) => void;
  mock: boolean;
  scenario: import("../api.ts").MockScenario;
  connected: boolean;
  /** The ACTIVE session's mock state (status.mock) — distinct from the desired `mock` toggle. */
  sessionMock: boolean;
  onMockChange: (mock: boolean) => void;
  onScenarioChange: (s: import("../api.ts").MockScenario) => void;
}
export function SettingsModal(props: SettingsModalProps): JSX.Element | null;
```

- [ ] **Step 1: Create the component**

Create `src/components/SettingsModal.tsx`:

```tsx
import { MOCK_SCENARIOS, SCENARIO_LABELS, type MockScenario } from "../api.ts";
import type { Thresholds } from "../settings.ts";

interface Props {
  open: boolean;
  onClose: () => void;
  thresholds: Thresholds;
  onThresholdChange: (patch: Partial<Thresholds>) => void;
  mock: boolean;
  scenario: MockScenario;
  connected: boolean;
  sessionMock: boolean;
  onMockChange: (mock: boolean) => void;
  onScenarioChange: (s: MockScenario) => void;
}

function Num(
  { label, value, onChange, step = 0.05, min = 0, max = 1 }: {
    label: string; value: number; onChange: (n: number) => void;
    step?: number; min?: number; max?: number;
  },
) {
  return (
    <label className="field">
      <span>{label}</span>
      <input
        type="number" value={value} step={step} min={min} max={max}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}

/** Thresholds + mock/scenario. Centered modal on wide, bottom sheet on narrow (CSS). */
export function SettingsModal(
  { open, onClose, thresholds, onThresholdChange, mock, scenario, connected, sessionMock, onMockChange, onScenarioChange }: Props,
) {
  if (!open) return null;
  return (
    <div className="sheet-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label="Settings">
        <div className="sheet-head">
          <h3>Settings</h3>
          <button className="icon-btn" aria-label="Close settings" onClick={onClose}>✕</button>
        </div>
        <div className="sheet-body">
          <div className="settings-group">
            <div className="settings-label">Thresholds</div>
            <Num label="Min quality" value={thresholds.minimalQuality} onChange={(n) => onThresholdChange({ minimalQuality: n })} />
            <Num label="Max spoof" value={thresholds.maximalSpoofScore} onChange={(n) => onThresholdChange({ maximalSpoofScore: n })} />
            <Num label="Min match" value={thresholds.minimalMatchScore} onChange={(n) => onThresholdChange({ minimalMatchScore: n })} />
            <label className="field">
              <span>Capture timeout (ms)</span>
              <input
                type="text" inputMode="numeric" placeholder="default 1500"
                value={thresholds.timeoutMs}
                onChange={(e) => onThresholdChange({ timeoutMs: e.target.value })}
              />
            </label>
            <p className="hint">Higher capture timeout = slower watch loop (each capture waits up to this long).</p>
          </div>

          <div className="settings-group">
            <div className="settings-label">Mock</div>
            <label className="checkbox">
              <input type="checkbox" checked={mock} onChange={(e) => onMockChange(e.target.checked)} />
              Mock mode
            </label>
            <label className="field">
              <span>Scenario</span>
              <select value={scenario} disabled={!(mock || sessionMock)} onChange={(e) => onScenarioChange(e.target.value as MockScenario)}>
                {MOCK_SCENARIOS.map((s) => <option key={s} value={s}>{SCENARIO_LABELS[s]}</option>)}
              </select>
            </label>
            <p className="hint">
              {connected && sessionMock
                ? "Scenario applies immediately. "
                : "Scenario applies next session. "}
              Mock on/off applies next session — after End session → Go Live.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Append styles**

Append to `src/styles.css`:

```css
/* ---- Settings sheet (centered modal on wide, bottom sheet on narrow) ---- */
.sheet-overlay {
  position: fixed; inset: 0; z-index: 100; display: flex;
  align-items: center; justify-content: center; padding: 24px;
  background: hsl(0 0% 0% / 0.6); backdrop-filter: blur(2px);
  animation: reveal 0.16s ease-out both;
}
.sheet {
  width: 100%; max-width: 460px; max-height: calc(100vh - 48px); overflow-y: auto;
  background: hsl(var(--card)); border: 1px solid hsl(var(--border));
  border-radius: var(--radius); box-shadow: 0 24px 64px hsl(0 0% 0% / 0.55);
  animation: panel-in 0.22s ease-out both;
}
.sheet-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 15px 20px; border-bottom: 1px solid hsl(var(--border));
}
.sheet-head h3 { margin: 0; font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; }
.sheet-body { padding: 18px 20px; display: flex; flex-direction: column; gap: 22px; }
.settings-group { display: flex; flex-direction: column; gap: 10px; }
.settings-label {
  font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em;
  color: hsl(var(--muted-foreground));
}
.field { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin: 0; }
.field > span { font-size: 13px; color: hsl(var(--muted-foreground)); }
.field input, .field select { width: 160px; }

@media (max-width: 560px) {
  .sheet-overlay { align-items: flex-end; padding: 0; }
  .sheet {
    max-width: 100%; max-height: 85vh;
    border-radius: 16px 16px 0 0; border-bottom: none;
    animation: sheet-up 0.24s ease-out both;
  }
}
@keyframes sheet-up { from { transform: translateY(100%); } to { transform: none; } }
```

- [ ] **Step 3: Type-check (component not yet mounted)**

Run: `npx tsc -b`
Expected: exit 0 (component compiles; unused until Task 4 mounts it — confirm no `noUnusedLocals` error by leaving it unimported until Task 4, which is the next commit).

> Note: if `tsc` flags the new file as unused, that is fine — it is a module export, not a local. Proceed.

- [ ] **Step 4: Commit**

```bash
git add src/components/SettingsModal.tsx src/styles.css
git commit -m "feat(settings): SettingsModal (thresholds + mock/scenario), bottom-sheet on narrow"
```

---

## Task 4: App → single-screen shell (remove tabs + Manual branch)

Rewrite `App.tsx`: one `Thresholds` object, mock/scenario state seeded from `connectionSettings`, a gear that opens `SettingsModal`, always render `LiveView`. Remove `mode`, the `ManualView` branch, `run`, `busy`, and all Manual-only state/handlers.

**Files:**
- Modify (replace body): `src/App.tsx`

**Interfaces:**
- Consumes: `LiveView` props (`status`, `thresholds: LiveThresholds`, `onError`, `onSessionChange`, `deviceParams`, `deviceParamsError`, `onFetchParams`, `onClearParams`), `SettingsModal` props (Task 3), `loadConnectionSettings`/`saveConnectionSettings` (current shape until Task 6; reads `mock`/`scenario`).

- [ ] **Step 1: Replace `src/App.tsx` with the single-screen shell**

```tsx
import { useCallback, useEffect, useState } from "react";
import { api, ApiError, type MockScenario, type NormalizedError, type SessionStatus } from "./api.ts";
import { DEFAULT_THRESHOLDS, parseTimeoutMs, type Thresholds } from "./settings.ts";
import { LiveView } from "./components/live/LiveView.tsx";
import { SettingsModal } from "./components/SettingsModal.tsx";
import { useDeviceParameters } from "./live/useDeviceParameters.ts";
import { loadConnectionSettings, saveConnectionSettings } from "./live/connectionSettings.ts";

// No "Busy" state (spec §5.1, revised): the continuous watch loop holds the server's op
// lock almost constantly, so a Busy pill would be permanently lit. The connect transition
// is shown by LiveView's full-screen "Bringing the camera online…" scene.
function statePill(status: SessionStatus | null, error: NormalizedError | null) {
  if (error) return { cls: "state-error", label: "Error" };
  if (status?.cameraOpen) return { cls: "state-camera", label: "Camera Open" };
  if (status?.connected) return { cls: "state-connected", label: "Connected" };
  return { cls: "state-disconnected", label: "Disconnected" };
}

export function App() {
  const [status, setStatus] = useState<SessionStatus | null>(null);
  const [error, setError] = useState<NormalizedError | null>(null);
  const [thresholds, setThresholds] = useState<Thresholds>(DEFAULT_THRESHOLDS);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const initial = loadConnectionSettings();
  const [mock, setMock] = useState<boolean>(initial.mock);
  const [scenario, setScenario] = useState<MockScenario>(initial.scenario);

  const { params: deviceParams, error: deviceParamsError, fetchParams, clearParams } = useDeviceParameters();

  const refreshStatus = useCallback(async () => {
    try {
      setStatus(await api.getStatus());
    } catch {
      setStatus((s) => (s ? { ...s, connected: false } : null));
    }
  }, []);

  useEffect(() => { refreshStatus(); }, [refreshStatus]);

  // Persist mock/scenario; apply scenario live only while connected in mock mode.
  const onMockChange = useCallback((next: boolean) => {
    setMock(next);
    // Spread the current settings so this satisfies the connectionSettings type both before
    // Task 6 (legacy dll/poll fields still required) and after (shrunk to {mock,scenario}).
    saveConnectionSettings({ ...loadConnectionSettings(), mock: next, scenario });
  }, [scenario]);

  const onScenarioChange = useCallback((next: MockScenario) => {
    setScenario(next);
    saveConnectionSettings({ ...loadConnectionSettings(), mock, scenario: next });
    if (status?.connected && status?.mock) {
      api.setScenario(next).catch((e) =>
        setError(e instanceof ApiError ? e.detail : { name: "Error", message: String(e), httpStatus: 500 })
      );
    }
  }, [mock, status]);

  const pill = statePill(status, error);

  return (
    <div className="app">
      <header className="masthead">
        <h1>FacePod Tester</h1>
        <div className="masthead-status" role="status" aria-live="polite">
          <span className={`state-pill ${pill.cls}`}>
            <span className="dot" />
            {pill.label}
          </span>
          {status?.mock && (
            <span className="mock-tag">
              Mock{status.scenario && status.scenario !== "good" ? ` · ${status.scenario}` : ""}
            </span>
          )}
        </div>
        <button className="icon-btn settings-btn" aria-label="Settings" onClick={() => setSettingsOpen(true)}>⚙</button>
      </header>

      {error && (
        <div className="error-banner" role="alert">
          <span className="etitle">{error.name}</span>
          <span className="ecode">
            {error.code !== undefined ? `code ${error.code}` : ""}
            {error.status !== undefined ? ` · http ${error.status}` : ""}
            {error.datatype ? ` · datatype ${error.datatype}` : ""}
          </span>
          <div>{error.message}</div>
        </div>
      )}

      <LiveView
        status={status}
        thresholds={{
          minimalQuality: thresholds.minimalQuality,
          maximalSpoofScore: thresholds.maximalSpoofScore,
          minimalMatchScore: thresholds.minimalMatchScore,
          timeoutMs: parseTimeoutMs(thresholds.timeoutMs),
        }}
        onError={setError}
        onSessionChange={refreshStatus}
        deviceParams={deviceParams}
        deviceParamsError={deviceParamsError}
        onFetchParams={fetchParams}
        onClearParams={clearParams}
      />

      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        thresholds={thresholds}
        onThresholdChange={(patch) => setThresholds((t) => ({ ...t, ...patch }))}
        mock={mock}
        scenario={scenario}
        connected={!!status?.connected}
        sessionMock={!!status?.mock}
        onMockChange={onMockChange}
        onScenarioChange={onScenarioChange}
      />
    </div>
  );
}
```

- [ ] **Step 2: Update the header gear in CSS (grid already has 3 columns)**

The masthead is `grid-template-columns: 1fr auto 1fr` with `.mode-toggle { justify-self: end }`. Add to `src/styles.css`:

```css
header.masthead .settings-btn { justify-self: end; }
```

- [ ] **Step 3: Type-check**

Run: `npx tsc -b`
Expected: exit 0. `ManualView` is now unreferenced (deleted next task); `CapturePanel`'s `CaptureThresholds` alias is no longer imported by App. The Manual component files still compile on their own, so the build is green.

- [ ] **Step 4: Run tests + dev smoke**

Run: `npm test` → PASS. Then `npm run dev`, load the app: header shows title · pill · gear; no Live/Manual tabs; gear opens Settings; Go Live still works (mock on if toggled).

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx src/styles.css
git commit -m "feat(app): single-screen shell with gear settings; remove Live/Manual tabs"
```

---

## Task 5: Delete the Manual surface

**Files:**
- Delete: `src/components/manual/ManualView.tsx`, `src/components/manual/DeviceParametersPanel.tsx`, `src/components/DeviceConfigPanel.tsx`, `src/components/DeviceStatusPanel.tsx`, `src/components/CameraControls.tsx`, `src/components/CapturePanel.tsx`, `src/components/MatchPanel.tsx`, plus any co-located tests.

- [ ] **Step 1: Confirm nothing else imports them**

Run:
```bash
grep -rn "ManualView\|DeviceParametersPanel\|DeviceConfigPanel\|DeviceStatusPanel\|CameraControls\|CapturePanel\|MatchPanel" src/ | grep -v "src/components/manual/\|src/components/CameraControls\|src/components/CapturePanel\|src/components/DeviceConfigPanel\|src/components/DeviceStatusPanel\|src/components/MatchPanel"
```
Expected: no matches outside the files being deleted. (If `JsonViewer` is only used by these, also delete it — check separately.)

- [ ] **Step 2: Delete the files**

```bash
git rm src/components/manual/ManualView.tsx src/components/manual/DeviceParametersPanel.tsx \
  src/components/DeviceConfigPanel.tsx src/components/DeviceStatusPanel.tsx \
  src/components/CameraControls.tsx src/components/CapturePanel.tsx src/components/MatchPanel.tsx
# Delete co-located tests if `grep -rln "ManualView\|CapturePanel" src --include=*.test.tsx` finds any.
```

- [ ] **Step 3: Type-check + tests + build**

Run: `npx tsc -b && npm test && npm run build`
Expected: all green, no dangling imports.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor: delete Manual mode panels (folded into the single-screen UI)"
```

---

## Task 6: Connection server-defaults + connectionSettings migration

**Files:**
- Modify: `src/live/connectionSettings.ts`
- Modify: `src/components/live/LiveView.tsx` (`goLive`, lines ~91-102)
- Test: `src/live/connectionSettings.test.ts`

**Interfaces:**
- Produces: `interface ConnectionSettings { mock: boolean; scenario: MockScenario }`; `migrateConnectionSettings(raw: string | null): ConnectionSettings` (pure, testable); `loadConnectionSettings()`, `saveConnectionSettings()`.

- [ ] **Step 1: Failing test for the pure migration**

Create `src/live/connectionSettings.test.ts`:

```ts
import { migrateConnectionSettings } from "./connectionSettings.ts";

test("null/garbage → defaults", () => {
  expect(migrateConnectionSettings(null)).toEqual({ mock: false, scenario: "good" });
  expect(migrateConnectionSettings("not json")).toEqual({ mock: false, scenario: "good" });
});
test("legacy keys (dllPath/dllDir/pollIntervalMs) are dropped", () => {
  const legacy = JSON.stringify({ mock: true, scenario: "spoof", dllPath: "C:\\x.dll", dllDir: "C:\\", pollIntervalMs: "50" });
  expect(migrateConnectionSettings(legacy)).toEqual({ mock: true, scenario: "spoof" });
});
```

- [ ] **Step 2: Run; verify failure**

Run: `npm test -- connectionSettings`
Expected: FAIL — `migrateConnectionSettings` not exported.

- [ ] **Step 3: Replace `src/live/connectionSettings.ts`**

```ts
import type { MockScenario } from "../api.ts";

const STORAGE_KEY = "facepod-tester.connection";

export interface ConnectionSettings {
  mock: boolean;
  scenario: MockScenario;
}

export const CONNECTION_DEFAULTS: ConnectionSettings = { mock: false, scenario: "good" };

/**
 * Baked-in DLL location for the kiosk (NOT user-editable). `goLive` passes this so Go Live
 * keeps working exactly as before, just without UI config. Optional follow-up: once the
 * server env supplies a DLL default, drop this and the `dllPath` arg.
 */
export const DLL_PATH = "C:\\Users\\Facepod\\Desktop\\FacePODDemo_MattWolfe\\HidFace.dll";

/** Pure: parse stored JSON → settings, dropping legacy dllPath/dllDir/pollIntervalMs. */
export function migrateConnectionSettings(raw: string | null): ConnectionSettings {
  if (!raw) return { ...CONNECTION_DEFAULTS };
  try {
    const p = JSON.parse(raw) as Partial<ConnectionSettings>;
    return {
      mock: typeof p.mock === "boolean" ? p.mock : false,
      scenario: (p.scenario as MockScenario) ?? "good",
    };
  } catch {
    return { ...CONNECTION_DEFAULTS };
  }
}

export function loadConnectionSettings(): ConnectionSettings {
  try {
    return migrateConnectionSettings(localStorage.getItem(STORAGE_KEY));
  } catch {
    return { ...CONNECTION_DEFAULTS };
  }
}

export function saveConnectionSettings(s: ConnectionSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch { /* storage unavailable — keep working in-memory */ }
}
```

- [ ] **Step 4: `goLive` sends server defaults only**

In `src/components/live/LiveView.tsx`, add `DLL_PATH` to the `connectionSettings` import, then in `goLive` replace the connect block (lines ~94-102):

```ts
      const s = loadConnectionSettings();
      await api.connect({
        dllPath: DLL_PATH, // baked-in (non-UI); preserves current Go Live behaviour
        mock: s.mock || undefined,
        mockScenario: s.scenario,
      });
      await api.openCamera({});
```

Remove the now-unused `poll`/`dllPath`/`dllDir` locals.

> **Behaviour preserved — safe to commit without the device.** `goLive` still passes the working DLL path, now as the non-UI `DLL_PATH` constant, so Go Live behaves exactly as before — it's just no longer user-editable. **Optional follow-up (NOT this task):** once you confirm on-device that the kiosk server has its own DLL env default, drop `dllPath: DLL_PATH` to use it and delete the constant.

- [ ] **Step 5: Type-check + tests**

Run: `npx tsc -b && npm test -- connectionSettings`
Expected: green.

- [ ] **Step 6: Commit**

```bash
git add src/live/connectionSettings.ts src/live/connectionSettings.test.ts src/components/live/LiveView.tsx
git commit -m "refactor(connection): drop UI connection config; baked-in DLL constant; shrink connectionSettings to {mock,scenario}"
```

---

## Task 7: Telemetry gauge redesign (+ No-reference, paused/stale)

Replace the `name │ track │ value` grid with header-line-over-full-width-track gauges; "No reference" for Match without a reference; accept a `status` prop for paused/stale dimming.

**Files:**
- Modify (replace): `src/components/live/Telemetry.tsx`
- Modify: `src/styles.css` (remove old `.telem/.tm/.track/.thresh*` blocks; add `.gauge*`)

**Interfaces:**
- Produces: `Telemetry` props gain `status?: "live" | "paused" | "stale"` (default `"live"`).
- Consumes: `barState`, `livenessConfidence`, `livenessConfidenceThreshold` (Task 1).

- [ ] **Step 1: Replace `src/components/live/Telemetry.tsx`**

```tsx
import { barState, livenessConfidence, livenessConfidenceThreshold } from "../../live/logic.ts";
import type { CaptureFrame, LiveThresholds } from "../../live/types.ts";
import type { DeviceParameters } from "../../api.ts";
import type { FreshnessStatus } from "../../live/freshness.ts";

interface Props {
  frame: CaptureFrame | null;
  liveQuality?: number | null;
  thresholds: LiveThresholds;
  hasReference: boolean;
  deviceParams?: DeviceParameters | null;
  status?: FreshnessStatus;
}

function Gauge(
  { name, value, threshold, label, deviceThreshold, emptyLabel = "—" }: {
    name: string;
    value: number | null;
    threshold: number;
    label: string;
    deviceThreshold?: number;
    emptyLabel?: string;
  },
) {
  const b = value === null ? null : barState(value, threshold, true);
  return (
    <div className="gauge">
      <div className="gauge-head">
        <span className="gauge-name">{name}</span>
        <span className={`gauge-val ${b ? b.tone : "muted"}`}>
          {value === null ? emptyLabel : <>{Math.round(value * 100)}<small>%</small></>}
        </span>
      </div>
      <div className="gauge-track">
        {b && <div className={`gauge-fill ${b.tone === "ok" ? "" : b.tone}`} style={{ width: `${b.pct}%` }} />}
        <div className="gauge-thresh" style={{ left: `${threshold * 100}%` }}><span>{label}</span></div>
        {deviceThreshold !== undefined && (
          <div className="gauge-device" style={{ left: `${deviceThreshold * 100}%` }}><span>device</span></div>
        )}
      </div>
    </div>
  );
}

/** Quality / Liveness / Match gauges — all higher-is-better (Liveness = 1 − spoof). */
export function Telemetry(
  { frame, liveQuality, thresholds, hasReference, deviceParams, status = "live" }: Props,
) {
  const livenessMeasured = !!frame && frame.numberOfFaces >= 1 &&
    frame.faceStatus !== "liveness_unmeasured";
  const livenessValue = livenessMeasured ? livenessConfidence(frame!.spoofScore) : null;
  const livenessThreshold = livenessConfidenceThreshold(thresholds.maximalSpoofScore);
  const livenessDeviceThreshold = deviceParams?.recMaxSpoofProbability != null
    ? livenessConfidence(deviceParams.recMaxSpoofProbability)
    : undefined;

  return (
    <div className={`telem ${status}`}>
      <Gauge
        name="Quality" value={liveQuality ?? frame?.quality ?? null}
        threshold={thresholds.minimalQuality}
        label={`min ${Math.round(thresholds.minimalQuality * 100)}`}
        deviceThreshold={deviceParams?.recMinVerifyTemplateQuality}
      />
      <Gauge
        name="Liveness" value={livenessValue} threshold={livenessThreshold}
        label={`min ${Math.round(livenessThreshold * 100)}`}
        deviceThreshold={livenessDeviceThreshold}
      />
      <Gauge
        name="Match" value={hasReference ? (frame?.matchScore ?? null) : null}
        threshold={thresholds.minimalMatchScore}
        label={`min ${Math.round(thresholds.minimalMatchScore * 100)}`}
        deviceThreshold={deviceParams?.recMinMatchScoreL1}
        emptyLabel={hasReference ? "—" : "No reference"}
      />
      {status === "paused" && <p className="hint telem-stale">Paused — start watching to resume.</p>}
      {status === "stale" && <p className="hint telem-stale">No signal — waiting for frames…</p>}
    </div>
  );
}
```

- [ ] **Step 2: Swap the CSS**

In `src/styles.css`, delete the old `/* Telemetry bars */` block (the `.telem`, `.tm`, `.track`, `.fill*`, `.thresh*`, `.tm .val*` rules) and add:

```css
/* Telemetry gauges — header line over a full-width track (all higher-is-better) */
.telem { display: flex; flex-direction: column; gap: 20px; margin-top: 14px; }
.telem.paused, .telem.stale { opacity: 0.55; }
.gauge { display: flex; flex-direction: column; gap: 6px; }
.gauge-head { display: flex; align-items: baseline; justify-content: space-between; }
.gauge-name { font-size: 12px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; color: hsl(var(--muted-foreground)); }
.gauge-val { font-size: 22px; font-weight: 800; font-variant-numeric: tabular-nums; letter-spacing: -.02em; }
.gauge-val.ok { color: hsl(var(--success)); }
.gauge-val.warn { color: hsl(var(--warning)); }
.gauge-val.bad { color: hsl(var(--destructive)); }
.gauge-val.muted { color: hsl(var(--muted-foreground)); font-size: 14px; font-weight: 700; }
.gauge-val small { font-size: 12px; font-weight: 600; color: hsl(var(--muted-foreground)); }
.gauge-track { position: relative; height: 14px; border-radius: 999px; background: hsl(var(--muted)); margin-bottom: 16px; }
.gauge-fill { position: absolute; left: 0; top: 0; bottom: 0; border-radius: 999px; background: hsl(var(--success)); box-shadow: 0 0 12px hsl(var(--success) / .45); transition: width .3s ease, background .3s; }
.gauge-fill.warn { background: hsl(var(--warning)); box-shadow: 0 0 12px hsl(var(--warning) / .45); }
.gauge-fill.bad { background: hsl(var(--destructive)); box-shadow: 0 0 12px hsl(var(--destructive) / .45); }
.gauge-thresh { position: absolute; top: -4px; bottom: -4px; width: 2px; background: hsl(var(--foreground)); box-shadow: 0 0 0 2px hsl(var(--background)); }
.gauge-thresh span { position: absolute; top: -16px; left: 50%; transform: translateX(-50%); font-size: 10px; font-weight: 700; color: hsl(var(--muted-foreground)); font-variant-numeric: tabular-nums; white-space: nowrap; }
.gauge-device { position: absolute; top: -4px; bottom: -4px; width: 0; border-left: 2px dashed hsl(var(--warning)); opacity: .8; }
.gauge-device span { position: absolute; bottom: -15px; left: 50%; transform: translateX(-50%); font-size: 9px; letter-spacing: .04em; color: hsl(var(--warning)); }
.telem-stale { margin-top: 2px; }
```

- [ ] **Step 3: Type-check + tests**

Run: `npx tsc -b && npm test`
Expected: green. (LiveView still passes `verdict` — remove it: see Step 4. If `tsc` flags an unknown `status` default usage, none expected.)

- [ ] **Step 4: Verify the Telemetry call site compiles**

`LiveView` currently renders `<Telemetry ... />` without `verdict` (already removed in `f00e694`). Confirm the call still type-checks; `status` is optional. No change required here yet (real `status` wired in Task 10).

- [ ] **Step 5: Commit**

```bash
git add src/components/live/Telemetry.tsx src/styles.css
git commit -m "feat(telemetry): header-over-track gauges; No-reference + stale states"
```

---

## Task 8: Live layout — gauges below the feed, Frame Data right with its own scroll

**Files:**
- Modify: `src/components/live/LiveView.tsx` (the live-scene JSX, ~line 221-260)
- Modify: `src/styles.css` (`.live-grid` rules)

- [ ] **Step 1: Restructure the live-scene JSX**

Replace the `return (...)` for the live scene in `LiveView.tsx` with feed+gauges left, Frame Data right, dock full-width:

```tsx
  return (
    <div className="live-shell live-grid">
      <div className="live-left">
        <Feed frame={frame} verdict={verdict} guidance={guidance} videoFrame={videoFrame} liveFaces={liveFaces} overlay={overlay} onNaturalSize={setFrameNat} />
        <Telemetry frame={frame} liveQuality={liveSnapshot?.quality ?? null} thresholds={thresholds} hasReference={hasReference} deviceParams={deviceParams ?? null} />
        {deviceParams
          ? (
            <p className="hint">
              Device thresholds shown as the dashed reference tick. <button className="link-btn" onClick={refreshParams}>Refresh</button>
            </p>
          )
          : deviceParamsError
            ? <p className="hint">Device parameters unavailable: {deviceParamsError}</p>
            : null}
        <p className="hint feed-note">
          {guidanceDerived
            ? "Guidance is derived in-UI from face size/status, not HID-measured."
            : "Guidance is from the device's positioning feedback."}
        </p>
      </div>
      <div className="live-right">
        <LiveDataDisclosure
          frame={frame}
          frameNat={frameNat}
          videoDatatype={videoFrame?.datatype ?? null}
          fps={fps}
          brightness={brightness}
          distance={distance}
          hasReference={hasReference}
        />
      </div>
      <div className="live-dock">
        <ActionDock
          watching={watching}
          hasReference={hasReference}
          onToggleWatch={() => setWatching((w) => !w)}
          onPickReference={pickReference}
          onClearReference={() => setRefTemplate(null)}
          onEnd={endSession}
          onUseCurrentFace={useCurrentFace}
          canUseCurrentFace={lastTemplate !== null}
        />
      </div>
    </div>
  );
```

> The `ActionDock` props are unchanged here; the reference-chip + gated `canUseCurrentFace` upgrade lands in Task 10.

- [ ] **Step 2: Replace the `.live-grid` CSS block**

Replace the existing `.live-grid` rules (added in `f00e694`) with feed-priority + independent Frame Data scroll:

```css
/* Two-pane live layout: feed + gauges (left, ~60%), Frame Data (right, own scroll). */
.live-grid {
  display: grid;
  grid-template-columns: 3fr 2fr;
  gap: 16px 20px;
  align-items: start;
}
.live-grid .live-left { min-width: 0; display: flex; flex-direction: column; }
.live-grid .live-right { min-width: 0; }
.live-grid .live-dock { grid-column: 1 / -1; }
/* Feed keeps 9:16 but is height-capped so feed + gauges + dock fit the kiosk; it
   centers in the column rather than stretching to ~60% width (which would be too tall). */
.live-grid .feed {
  aspect-ratio: 9 / 16; height: auto; min-height: 0; max-height: 52vh; max-width: 100%;
  margin: 0 auto;
}
.live-grid .guide { font-size: 15px; padding: 9px 16px; bottom: 16px; }
.live-grid .guide .ar { font-size: 17px; }
.live-grid .feed-note { margin: 8px 2px 0; }
/* Frame Data fills the right column and scrolls within its own height so a long
   payload never compresses the feed/gauges. */
.live-grid .framedata { margin: 0; max-height: calc(100vh - 220px); overflow-y: auto; }
.live-grid .live-right .fd-grid { grid-template-columns: 1fr; }

/* Narrow: stack Feed/gauges → dock → Frame Data; allow page scroll. */
@media (max-width: 560px) {
  .live-grid { grid-template-columns: 1fr; }
  .live-grid .feed { aspect-ratio: auto; height: 40vh; min-height: 260px; max-height: 60vh; }
  .live-grid .framedata { max-height: none; overflow: visible; }
  .live-grid .live-left { order: 0; }
  .live-grid .live-dock { order: 1; }
  .live-grid .live-right { order: 2; }
}
```

> Values (`3fr/2fr`, `52vh`, `calc(100vh - 220px)`) are tuned starting points — verify on the kiosk and adjust so feed + gauges + dock sit above the fold and Frame Data scrolls internally.

- [ ] **Step 3: Type-check + dev smoke**

Run: `npx tsc -b && npm run dev`
Expected: green; gauges sit under the feed, Frame Data is the right pane and scrolls on its own.

- [ ] **Step 4: Commit**

```bash
git add src/components/live/LiveView.tsx src/styles.css
git commit -m "feat(live): feed-priority layout — gauges below feed, Frame Data right with own scroll"
```

---

## Task 9: Frame Data grouped sections

**Files:**
- Modify (replace): `src/components/live/LiveDataDisclosure.tsx`
- Modify: `src/styles.css` (`.fd-group*` styles)

**Interfaces:**
- Produces: `LiveDataDisclosure` gains optional `status?: FreshnessStatus` (default `"live"`) for stale dimming (wired in Task 10).

- [ ] **Step 1: Replace `src/components/live/LiveDataDisclosure.tsx`**

Keep all current fields and the `Row` component; group rows under labeled sections (Face / Capture / Liveness / Match / Stream). Full replacement:

```tsx
import type { ReactNode } from "react";
import type { CaptureFrame } from "../../live/types.ts";
import type { FreshnessStatus } from "../../live/freshness.ts";

interface Props {
  frame: CaptureFrame | null;
  frameNat: { w: number; h: number } | null;
  videoDatatype: string | null;
  fps: number | null;
  brightness: number | null;
  distance: "near" | "ok" | "far" | null;
  hasReference: boolean;
  /** Capture-lane freshness — drives Face/Capture/Liveness/Match groups. */
  captureStatus?: FreshnessStatus;
  /** Video-lane freshness — drives the Stream group. */
  videoStatus?: FreshnessStatus;
}

const DASH = "—";

function Row({ k, v, tone }: { k: string; v: ReactNode; tone?: "ok" | "bad" | "muted" }) {
  return (
    <div className="fd-row">
      <span className="fd-k">{k}</span>
      <span className={`fd-v${tone ? " " + tone : ""}`}>{v}</span>
    </div>
  );
}

function Group(
  { title, status = "live", children }: { title: string; status?: FreshnessStatus; children: ReactNode },
) {
  const tag = status === "paused" ? " · paused" : status === "stale" ? " · no signal" : "";
  return (
    <div className={`fd-group ${status}`}>
      <div className="fd-group-title">{title}<span className="fd-group-tag">{tag}</span></div>
      <div className="fd-rows">{children}</div>
    </div>
  );
}

/** Always-visible, grouped surface of the live device + API output. */
export function LiveDataDisclosure(
  { frame, frameNat, videoDatatype, fps, brightness, distance, hasReference, captureStatus = "live", videoStatus = "live" }: Props,
) {
  const bb = frame?.boundingBox ?? null;
  const fb = frame?.positioningFeedback ?? null;
  const lm = frame?.landmarks ?? null;
  const hasFace = !!frame && frame.numberOfFaces >= 1;
  const livenessMeasured = hasFace && frame!.faceStatus !== "liveness_unmeasured";

  return (
    <section className="framedata">
      <div className="fd-title">
        Frame data <span className="fd-sub">live device + API output</span>
      </div>

      <Group title="Face" status={captureStatus}>
        <Row k="Faces" v={frame ? frame.numberOfFaces : DASH} />
        <Row k="Face status" v={frame?.faceStatus ?? DASH} />
        <Row k="Bounding box" v={bb ? `x ${bb.x}, y ${bb.y}, ${bb.width}×${bb.height}` : DASH} />
        <Row
          k="Landmarks"
          v={lm && lm.length > 0 ? lm.map((l) => `${l.type ?? "?"} (${l.x}, ${l.y})`).join("  ·  ") : DASH}
        />
        <Row
          k="Positioning"
          v={fb ? `raw=${fb.raw} ok=${fb.ok} [${fb.flags.join(", ")}]${fb.unknownBits ? ` unknownBits=${fb.unknownBits}` : ""}` : "— (not reported by device)"}
        />
      </Group>

      <Group title="Capture" status={captureStatus}>
        <Row k="Captured" v={frame ? (frame.isCaptured ? "yes" : "no") : DASH} tone={frame ? (frame.isCaptured ? "ok" : "bad") : "muted"} />
        <Row k="Quality" v={frame ? frame.quality.toFixed(3) : DASH} />
        <Row k="Template" v={frame?.liveTemplate ? `present · ${frame.liveTemplate.length} b64` : DASH} />
      </Group>

      <Group title="Liveness" status={captureStatus}>
        <Row k="Spoof score (lower is better)" v={livenessMeasured ? frame!.spoofScore.toFixed(3) : (frame ? "not measured" : DASH)} />
        <Row
          k="Liveness"
          v={!hasFace ? DASH : !livenessMeasured ? "n/a" : frame!.livenessPassed ? "PASS" : "FAIL"}
          tone={!livenessMeasured ? "muted" : frame!.livenessPassed ? "ok" : "bad"}
        />
      </Group>

      <Group title="Match" status={captureStatus}>
        <Row k="Match score" v={hasReference && frame?.matchScore != null ? frame.matchScore.toFixed(3) : DASH} />
        <Row
          k="Match"
          v={!hasReference || frame?.matchPassed == null ? DASH : frame.matchPassed ? "PASS" : "FAIL"}
          tone={!hasReference || frame?.matchPassed == null ? "muted" : frame.matchPassed ? "ok" : "bad"}
        />
      </Group>

      <Group title="Stream" status={videoStatus}>
        <Row k="Frame size" v={frameNat ? `${frameNat.w}×${frameNat.h}` : DASH} />
        <Row k="Frame type" v={videoDatatype ?? DASH} />
        <Row k="Feed rate" v={fps != null ? `${fps.toFixed(1)} fps` : DASH} />
        <Row k="Brightness" v={brightness != null ? `${Math.round(brightness * 100)}%` : DASH} tone="muted" />
        <Row k="Distance" v={distance ?? DASH} tone="muted" />
      </Group>
    </section>
  );
}
```

- [ ] **Step 2: Group styles**

In `src/styles.css`, the old `.fd-grid`/`.fd-wide` rules are no longer produced. Add:

```css
.fd-group { margin-top: 12px; }
.fd-group:first-of-type { margin-top: 8px; }
.fd-group.paused, .fd-group.stale { opacity: 0.55; }
.fd-group-title {
  font-size: 10px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase;
  color: hsl(var(--muted-foreground)); padding-left: 8px; border-left: 2px solid hsl(var(--primary));
  margin-bottom: 4px;
}
.fd-group-tag { font-size: 9px; font-weight: 600; letter-spacing: 0; text-transform: none; color: hsl(var(--muted-foreground)); margin-left: 6px; }
.fd-rows { display: flex; flex-direction: column; }
```

(The existing `.fd-row`, `.fd-k`, `.fd-v`, `.fd-v.ok/.bad/.muted` rules are reused. The `.live-grid .live-right .fd-grid` override from Task 8 is now dead — remove that one line.)

- [ ] **Step 3: Type-check + dev smoke**

Run: `npx tsc -b && npm run dev`
Expected: Frame Data shows five labeled groups; scrolls within its pane.

- [ ] **Step 4: Commit**

```bash
git add src/components/live/LiveDataDisclosure.tsx src/styles.css
git commit -m "feat(framedata): group rows into Face/Capture/Liveness/Match/Stream"
```

---

## Task 10: Reference chip + gated Use-current-face + freshness wiring

Upgrade the dock reference control (thumbnail/source + Replace + Clear; single stateful watch button), gate "Use current face" with `canUseCurrentFace`, and feed real `status` into Telemetry + Frame Data via a freshness tick.

**Files:**
- Modify: `src/components/live/ActionDock.tsx`
- Modify: `src/components/live/LiveView.tsx` (reference source state; two-lane freshness tick; status wiring)
- Modify: `src/components/live/Feed.tsx` (status badge)
- Modify: `src/styles.css` (`.ref-*` + `.feed-badge` bits)

**Interfaces:**
- Consumes: `canUseCurrentFace` (Task 1), `telemetryStatus` (Task 1).
- `ActionDock` props change to:

```ts
interface ActionDockProps {
  watching: boolean;
  referenceThumb: string | null;   // data URL when set from a photo; null otherwise
  referenceLabel: string | null;   // e.g. "Photo" | "Current face"; null when no reference
  canUseCurrentFace: boolean;
  onToggleWatch: () => void;
  onPickReference: (file: File) => void;
  onClearReference: () => void;
  onEnd: () => void;
  onUseCurrentFace: () => void;
}
```

- [ ] **Step 1: Rewrite `ActionDock.tsx`**

```tsx
import { useRef } from "react";

interface Props {
  watching: boolean;
  referenceThumb: string | null;
  referenceLabel: string | null;
  canUseCurrentFace: boolean;
  onToggleWatch: () => void;
  onPickReference: (file: File) => void;
  onClearReference: () => void;
  onEnd: () => void;
  onUseCurrentFace: () => void;
}

export function ActionDock(
  { watching, referenceThumb, referenceLabel, canUseCurrentFace, onToggleWatch, onPickReference, onClearReference, onEnd, onUseCurrentFace }: Props,
) {
  const fileRef = useRef<HTMLInputElement>(null);
  const hasReference = referenceLabel !== null;
  return (
    <div className="dock">
      <button className="btn primary" onClick={onToggleWatch}>
        {watching ? "Stop watching" : "Start watching"}
      </button>
      <button className="btn" onClick={onEnd}>End session</button>

      <div className="refchip">
        <span className="k">Reference</span>
        {hasReference
          ? (
            <div className="ref-set">
              {referenceThumb
                ? <img className="ref-thumb" src={referenceThumb} alt="reference" />
                : <span className="ref-thumb ref-thumb-face" aria-hidden>☺</span>}
              <span className="ref-src">{referenceLabel}</span>
              <button className="link-btn" onClick={() => fileRef.current?.click()}>Replace photo</button>
              <button className="link-btn" disabled={!canUseCurrentFace} onClick={onUseCurrentFace}>Use current face</button>
              <button className="link-btn" onClick={onClearReference}>Clear</button>
            </div>
          )
          : (
            <div className="ref-set">
              <button className="link-btn" onClick={() => fileRef.current?.click()}>Set from photo…</button>
              <button className="link-btn" disabled={!canUseCurrentFace} onClick={onUseCurrentFace}>Use current face</button>
              {!canUseCurrentFace && <span className="ref-hint">Hold a single face in view at good quality.</span>}
            </div>
          )}
      </div>

      <input
        ref={fileRef} type="file" accept="image/png,image/jpeg" style={{ display: "none" }}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onPickReference(f); e.target.value = ""; }}
      />
    </div>
  );
}
```

- [ ] **Step 2: LiveView — reference state, two-lane freshness, gate, status wiring**

In `src/components/live/LiveView.tsx`:

1. Add imports:
```ts
import { canUseCurrentFace } from "../../live/logic.ts";
import { captureStaleMs, telemetryStatus, videoStatus } from "../../live/freshness.ts";
```
2. Add state (near the other `useState`s):
```ts
  const [refThumb, setRefThumb] = useState<string | null>(null);
  const [refLabel, setRefLabel] = useState<string | null>(null);
  const [frameAt, setFrameAt] = useState<number | null>(null);          // last capture frame
  const [videoFrameAt, setVideoFrameAt] = useState<number | null>(null); // last video frame
  const [watchStartedAt, setWatchStartedAt] = useState<number | null>(null); // for the startup grace
  const [now, setNow] = useState<number>(() => performance.now());
```
3. Gate the **video poll on `watching`** (so Stop watching pauses the feed, matching spec §5.3) — change the existing `useFramePoll({ active: scene === "live", ... })` call to `active: scene === "live" && watching`. Then tick `now` while watching (to detect a stalled stream) and stamp the last video frame:
```ts
  useEffect(() => {
    if (!watching) return;
    const id = setInterval(() => setNow(performance.now()), 1000);
    return () => clearInterval(id);
  }, [watching]);
  useEffect(() => { if (videoFrame) setVideoFrameAt(performance.now()); }, [videoFrame]);
  // On (re)start, reset both lane timestamps and stamp the start, so the grace window
  // applies and a leftover/null age can't flash "No signal" immediately.
  useEffect(() => {
    if (watching) { setFrameAt(null); setVideoFrameAt(null); setWatchStartedAt(performance.now()); }
    else { setWatchStartedAt(null); }
  }, [watching]);
```
4. Record `frameAt` when a new capture frame arrives — extend the existing watch `onFrame`:
```ts
    onFrame: (f) => { setFrame(f); setFrameAt(performance.now()); if (f.liveTemplate) setLastTemplate(f.liveTemplate); },
```
5. Compute the two freshness signals + the status-gated current-face check (near `const hasReference = ...`):
```ts
  const captureAgeMs = frameAt == null ? null : now - frameAt;
  const videoAgeMs = videoFrameAt == null ? null : now - videoFrameAt;
  const sinceStartMs = watchStartedAt == null ? null : now - watchStartedAt;
  // Capture staleness scales with the configurable capture timeout (+ match/processing margin).
  const captureStaleAfterMs = captureStaleMs(thresholds.timeoutMs);
  const captureStatus = telemetryStatus({ watching, captureAgeMs, sinceStartMs, staleAfterMs: captureStaleAfterMs });
  const feedStatus = videoStatus({ active: scene === "live" && watching, videoAgeMs, sinceStartMs });
  // Eligible only when the capture lane is genuinely LIVE (not paused/stale) AND the
  // current frame passes the strict gate — a stalled good frame must not qualify.
  const currentFaceOk = captureStatus === "live" && canUseCurrentFace(frame, thresholds);
```
6. Update `pickReference` to also store the thumbnail/source. In its body, after `setRefTemplate(r.result.template.data);`, add:
```ts
      setRefThumb(`data:image/${read.datatype === "jpg" ? "jpeg" : read.datatype};base64,${read.data}`);
      setRefLabel("Photo");
```
7. Update `useCurrentFace` to re-check the gate (incl. live status) and adopt the CURRENT frame's template:
```ts
  const useCurrentFace = useCallback(() => {
    if (captureStatus === "live" && canUseCurrentFace(frame, thresholds) && frame?.liveTemplate) {
      setRefTemplate(frame.liveTemplate);
      setRefThumb(null);
      setRefLabel("Current face");
    }
  }, [frame, thresholds, captureStatus]);
```
8. Clear reference resets the chip — change the dock's `onClearReference`:
```ts
        onClearReference={() => { setRefTemplate(null); setRefThumb(null); setRefLabel(null); }}
```
9. Pass the two statuses to the Feed, Telemetry, and Frame Data, and the new dock props:
```tsx
        <Feed ... status={feedStatus} />
        <Telemetry ... status={captureStatus} />
        ...
        <LiveDataDisclosure ... captureStatus={captureStatus} videoStatus={feedStatus} />
        ...
        <ActionDock
          watching={watching}
          referenceThumb={refThumb}
          referenceLabel={refLabel}
          canUseCurrentFace={currentFaceOk}
          onToggleWatch={() => setWatching((w) => !w)}
          onPickReference={pickReference}
          onClearReference={() => { setRefTemplate(null); setRefThumb(null); setRefLabel(null); }}
          onEnd={endSession}
          onUseCurrentFace={useCurrentFace}
        />
```
10. In `endSession`, also clear the chip state alongside `setRefTemplate(null)`:
```ts
    setRefTemplate(null);
    setRefThumb(null);
    setRefLabel(null);
    setLastTemplate(null);
```
11. **Feed badge + paused verdict** — in `src/components/live/Feed.tsx`, add `status?: import("../../live/freshness.ts").FreshnessStatus` to `Props`, destructure it (default `"live"`). (a) Render a badge after the verdict chip (before the `{guidance && ...}` block); (b) **gate the existing verdict chip on not-paused** — when watching stops, `frame` is cleared so the verdict defaults to "searching" and the chip would wrongly read "Watching…":
```tsx
      {/* (b) wrap the existing verdict chip: */}
      {status !== "paused" && (
        <div className={`feed-verdict ${verdict.state}`}>
          <span>{vlabel}</span>
          {vreasons && <span className="vr">{vreasons}</span>}
        </div>
      )}
      {/* (a) badge: */}
      {status !== "live" && (
        <div className={`feed-badge ${status}`}>{status === "paused" ? "Paused" : "No signal"}</div>
      )}
```

- [ ] **Step 3: Reference-chip styles**

Append to `src/styles.css`:

```css
.ref-set { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.ref-thumb { width: 34px; height: 34px; border-radius: 8px; object-fit: cover; border: 1px solid hsl(var(--border)); }
.ref-thumb-face { display: inline-flex; align-items: center; justify-content: center; font-size: 18px; background: hsl(var(--muted)); color: hsl(var(--primary)); }
.ref-src { font-size: 13px; font-weight: 700; color: hsl(var(--success)); }
.ref-hint { font-size: 11px; color: hsl(var(--muted-foreground)); }
/* Feed status badge (top-right) for paused / no-signal video lane. */
.feed-badge {
  position: absolute; top: 14px; right: 14px; z-index: 3;
  padding: 4px 10px; border-radius: 999px; font-size: 11px; font-weight: 700;
  text-transform: uppercase; letter-spacing: .06em;
  background: hsl(0 0% 0% / 0.55); border: 1px solid hsl(var(--border)); backdrop-filter: blur(6px);
  color: hsl(var(--muted-foreground));
}
.feed-badge.stale { color: hsl(var(--warning)); border-color: hsl(var(--warning) / 0.5); }
```

- [ ] **Step 4: Type-check + tests + dev smoke**

Run: `npx tsc -b && npm test && npm run dev`
Expected: green. In the app: button reads "Start watching"/"Stop watching"; Match shows "No reference" until a photo is set; setting a photo shows a thumbnail + Replace/Clear; "Use current face" is disabled until a single good face is in view; stopping watch dims gauges to a Paused look; pulling the camera shows "No signal".

- [ ] **Step 5: Commit**

```bash
git add src/components/live/ActionDock.tsx src/components/live/LiveView.tsx src/components/live/Feed.tsx src/styles.css
git commit -m "feat(dock): reference thumbnail + Replace/Clear, gated Use-current-face, paused/stale wiring"
```

---

## Task 11: Final verification + on-device review

**Files:** none (verification only).

- [ ] **Step 1: Full gate**

Run: `npx tsc -b && npm test && npm run build`
Expected: type-check clean, all Vitest green, production build succeeds.

- [ ] **Step 2: Push**

```bash
git push origin feature/live-hud-fixes
```

- [ ] **Step 3: On-device checklist (800×1280 kiosk)**

- Header: title · state pill (+ mock tag) · gear. No Live/Manual tabs.
- Go Live connects to `CAMERA OPEN` **(DLL risk flag from Task 6 — confirm here).**
- Feed + Quality/Liveness/Match gauges + grouped Frame Data all visible at once; only Frame Data scrolls.
- Gauges legible, no label overlap; Match reads "No reference" until a reference is set.
- Reference: Set from photo shows a thumbnail; Replace/Clear work; "Use current face" only enabled with a single good face.
- Stop watching → "Paused" (feed + gauges). A **stalled** (non-throwing) stream → "No signal" — hard to force on real hardware; it's covered by the freshness unit tests. A real **unplug/error** surfaces as the **Error** pill and stops watching (that is Error, not "No signal").
- Settings gear: thresholds edit live; mock toggle note says "next session"; scenario switches mid-session in mock; on narrow it opens as a bottom sheet.

---

## Self-Review

**Spec coverage:**
- §4 layout → Tasks 8, 9. §5.1 header/gear → Task 4. §5.2 feed → unchanged (kept). §5.3 gauges incl. direction + stale → Tasks 7, 10. §5.4 grouped Frame Data + stale → Tasks 9, 10. §5.5 dock/watch button/reference/gate → Task 10. §5.6 settings + apply semantics + capture-timeout wiring → Tasks 2, 3, 4. §6 state/server-defaults → Tasks 4, 6. §7 deletions → Task 5. §8 responsive → Task 8 (+ sheet in Task 3). §9 testing → Tasks 1–2, 11. §10 gauge decision → Task 7. All covered.

**Placeholder scan:** none — every code step shows the code; CSS values flagged as tune-on-device are concrete, not placeholders.

**Type consistency:** `Thresholds` (string `timeoutMs`) is the UI/App type; `LiveThresholds` (numeric optional `timeoutMs`) is the live type; App bridges via `parseTimeoutMs`. `FreshnessStatus` is shared by `freshness.ts`, Telemetry (`status`), Feed (`status`), and LiveDataDisclosure (`captureStatus` + `videoStatus`); LiveView computes `captureStatus` (capture lane) and `feedStatus` (video lane) and passes them by name — Telemetry/Feed get the matching lane, LiveDataDisclosure gets both. `ActionDock` prop set (`referenceThumb`/`referenceLabel`/`canUseCurrentFace` + `onUseCurrentFace` in both reference branches) is consistent between Task 10's interface block, component, and the LiveView call site. App's `SessionStatus` (the `status` prop on LiveView/the pill) is distinct from `FreshnessStatus`.
