# FacePod Live Video Feed + Detection Overlay — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render a real full-frame live camera feed (source A = `getVideoFrame`) with a bounding-box + landmark detection overlay and per-frame live telemetry in the FacePod tester's Live HUD, consuming the Phase 1 `@eai/hid/facepod` seam unmodified.

**Architecture:** Two browser-owned lanes. **Lane 1** (feed): a ~8 fps poll of `GET /api/video-frame` whose response carries the newest frame pixels *plus* the server's latest intermediate snapshot (bbox/landmarks/quality/positioning). **Lane 2** (capture): the existing `useWatchLoop` short-capture-then-match loop, now forwarding `onIntermediate` into a server-side `latestSnapshot` buffer and providing liveness/match/verdict at capture cadence. The server's `getVideoFrame` bypasses the session busy-lock (`#track`) and is gated against teardown; two strictly separate client state shapes (`LiveSnapshotState` for live overlay/quality; `CaptureFrame` for the authoritative verdict) keep live data out of the fail-closed verdict.

**Tech Stack:** Deno + Hono backend (`server/`), React 18 + Vite frontend (`src/`). Backend tests: `Deno.test` + `@std/assert`. Frontend tests: Vitest in **`node` env (no jsdom)** — unit-test pure functions only; React components/hooks are verified by mock-mode E2E in the browser.

## Global Constraints

- **Do NOT modify hardware-libs** — consume `@eai/hid/facepod` as published (local-path import `../hardware-libs/hid/facepod/mod.ts`).
- **FFI-only** — no REST/NetHFAPI; no browser `getUserMedia`/UVC (camera held exclusively). REST-only metrics are derived-and-labeled or dropped.
- **Fail closed** — liveness/match/verdict ride **final `CaptureResult` only**; never show a pass the device didn't measure.
- **No biometric data-at-rest** — frame bytes in memory only, never logged/cached/written to disk; reference template in-memory, session-only; no enroll/records/galleries.
- **CSRF gate** on every `/api/*` route, including the new frame endpoint (`x-facepod-tester` header; GET needs only the header, not JSON content-type).
- **`seq` is a `bigint`** — string-encoded across HTTP both directions; never narrowed to `number`.
- **Portrait 800×1280, touch** — big tap targets, vertical stack, modal config.
- **Branch:** `feature/consume-phase2-video` (already created off `main`).
- **Commits carry NO Claude/AI attribution** — author solely as Jon; no `Co-Authored-By` Claude. PR bodies must not link internal `docs/superpowers/` paths.
- Backend test command: `deno test --allow-env --allow-read server/`. Type-check: `deno check server/main.ts`. Frontend tests: `npm test` (from repo root; runs `vitest run`).

---

## File Structure

**Backend (`server/`)**
- `mockClient.ts` (modify) — implement `getVideoFrame`; make `captureAndProcess` stream multiple intermediate snapshots over async intervals and honor `signal`. Add a known-size (360×640) mock frame whose pixel space matches the synthetic bbox/landmark coords (lockstep).
- `facepodSession.ts` (modify) — `readFrame()` (bypasses `#track`, frame-gate guarded); `latestSnapshot` buffer + `#captureId` + `#sessionGeneration`; `capture()`/`captureAndMatch()` accept+forward `signal` and `onIntermediate`; `#quiesceFrameLane()` teardown drain.
- `videoFramePayload.ts` (create) — pure `toFramePayload(read)` shaping a `FrameRead` into the discriminated JSON (base64 bytes, string seq).
- `main.ts` (modify) — `GET /api/video-frame` route wiring `session.readFrame` → `toFramePayload`, passing `c.req.raw.signal` into `capture`/`capture-and-match`.

**Frontend (`src/`)**
- `live/types.ts` (modify) — add `LiveSnapshotState`; rename `LiveFrame` → `CaptureFrame` (Task 4).
- `api.ts` (modify) — add `FrameResponse` type + `api.getVideoFrame(lastSeq)`.
- `live/overlay.ts` (create) — pure device-coord → percentage mapping for the 9:16 box.
- `live/overlayDisplay.ts` (create) — pure overlay clear/fade decision (the two triggers).
- `live/framePoll.ts` (create) — pure `lastSeq` advance + freshness + session-guard reducer.
- `live/useFramePoll.ts` (create) — React hook: Lane 1 poll loop with `stopAndDrain`.
- `live/useWatchLoop.ts` (modify) — add `AbortController` + `stopAndDrain` (Task 4).
- `components/live/Feed.tsx` (modify) — full-frame image in a 9:16 box + percentage overlay (bbox + 5 landmark dots) + fade.
- `components/live/Telemetry.tsx` (modify) — quality bar ← live snapshot; liveness/match/verdict ← `CaptureFrame` (Task 4).
- `components/live/LiveView.tsx` (modify) — wire `useFramePoll`, compute overlay decision, reorder `endSession` teardown.
- `components/live/ActionDock.tsx` (modify) — "Use current face → reference" button (Task 5).
- `styles.css` (modify) — 9:16 media box; overlay percentage positioning; drop `.bbox` 0.5s transition; derived-hints row (Task 6).

---

## Task 0: Mock seam parity — restore green

The tester does not compile against the Phase 1 seam: `DeterministicMockClient` doesn't implement `getVideoFrame` (`deno check` fails with TS2345 at `facepodSession.ts:119` and TS2420 at `mockClient.ts:92`). This task restores green and makes the mock genuinely exercise the live feed (frame seq + backpressure) and streaming capture (multiple async intermediate snapshots + abort), staying lockstep with real data.

**Files:**
- Modify: `server/mockClient.ts`
- Test: `server/mockClient.test.ts`

**Interfaces:**
- Consumes: `FaceModuleClient` (`@eai/hid/facepod`) — now includes `getVideoFrame(lastSeq?: bigint): Promise<VideoFrame|null>` and `captureAndProcess(opts, signal?, onIntermediate?)`.
- Produces: a `DeterministicMockClient` that satisfies the full interface; a `MOCK_FRAME` constant (`datatype:"png"`, 360×640) used by `getVideoFrame`.

- [ ] **Step 1: Write the failing tests**

Add to `server/mockClient.test.ts`:

```ts
import type { LiveSnapshot } from "@eai/hid/facepod";

Deno.test("getVideoFrame: latest advances; behind-cursor walks; caught-up backpressures", async () => {
  const c = client("good"); // a FRESH client → its own #frameSeq starts at 0
  const f1 = await c.getVideoFrame(-1n); // "latest" advances the simulated camera
  if (!f1) throw new Error("expected a frame for lastSeq=-1");
  assertEquals(f1.format, "png");
  assert(f1.bytes.length > 0, "frame must carry bytes");
  // A second "latest" poll advances again → strictly newer seq (monotonic).
  const f2 = await c.getVideoFrame(-1n);
  if (!f2) throw new Error("expected a newer frame");
  assert(f2.seq > f1.seq, `seq must advance: ${f1.seq} -> ${f2.seq}`);
  // A cursor AT the newest → null (backpressure: nothing newer than this yet).
  assertEquals(await c.getVideoFrame(f2.seq), null);
  // A cursor BEHIND the newest → the next newer frame (strict "newer than" filter).
  const f3 = await c.getVideoFrame(f1.seq);
  if (!f3) throw new Error("expected a next-newer frame for a behind cursor");
  assert(f3.seq > f1.seq, "a behind cursor must yield a newer frame");
});

Deno.test("captureAndProcess: streams several intermediate snapshots", async () => {
  const c = client("approach");
  const snaps: LiveSnapshot[] = [];
  const r = await c.captureAndProcess(
    { minimalQuality: 0.7, maximalSpoofScore: 0.5 },
    undefined,
    (s) => { snaps.push(s); },
  );
  assert(snaps.length >= 3, `expected >=3 intermediate snapshots, got ${snaps.length}`);
  // Intermediate snapshots carry live overlay metadata, never a verdict signal.
  assert(snaps.every((s) => typeof s.numberOfFaces === "number"), "numberOfFaces always present");
  assert("liveness" in r, "final result carries liveness");
});

Deno.test("captureAndProcess: aborts promptly when signalled", async () => {
  const c = client("approach");
  const ac = new AbortController();
  const p = c.captureAndProcess({ minimalQuality: 0.7 }, ac.signal, () => ac.abort());
  await assertRejects(() => p, Error); // AbortError surfaces as a rejection
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `deno test --allow-env --allow-read server/mockClient.test.ts`
Expected: FAIL — `getVideoFrame` is not a function / `captureAndProcess` ignores the callback (and `deno check server/main.ts` still reports the 2 missing-method errors).

- [ ] **Step 3: Add the mock frame constant + `getVideoFrame`**

In `server/mockClient.ts`, add the import of `VideoFrame` and `LiveSnapshot` to the existing type import block:

```ts
  type LiveSnapshot,
  type VideoFrame,
```

Add near the other constants (the 360×640 PNG matches the synthetic bbox/landmark coordinate space below — lockstep):

```ts
/** Synthetic preview frame: a solid 360×640 (9:16) PNG. Its pixel space is the
 *  coordinate space of the mock bbox/landmarks, so the overlay maps correctly. */
const MOCK_FRAME_W = 360;
const MOCK_FRAME_H = 640;
const MOCK_FRAME_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAWgAAAKACAYAAACxGuKnAAAGyElEQVR42u3UMQ0AAAjAMDSggAv/DsEGCT1qYMciqweAe0IEAIMGwKABDBoAgwYwaAAMGgCDBjBoAAwawKABMGgADBrAoAEwaACDBsCgAQwaAIMGwKABDBoAgwYwaAAMGgCDBjBoAAwawKABMGgADBrAoAEwaACDBsCgAQwaAIMGwKABDBoAgwYwaAAMGsCgRQAwaAAMGsCgATBoAIMGwKABMGgAgwbAoAEMGgCDBsCgAQwaAIMGMGgADBrAoAEwaAAMGsCgATBoAIMGwKABMGgAgwbAoAEMGgCDBjBoAAwaAIMGMGgADBrAoAEwaAAMGsCgATBoAIMGwKABMGgAgwbAoAEMGgCDBjBoAAwawKABMGgADBrAoAEwaACDBsCgAQwaAIMGwKABDBoAgwYwaAAMGgCDBjBoAAwawKABMGgADBrAoAEwaACDBsCgAQwaAIMGwKABDBoAgwYwaAAMGsCghQAwaAAMGsCgATBoAIMGwKABMGgAgwbAoAEMGgCDBsCgAQwaAIMGMGgADBrAoAEwaAAMGsCgATBoAIMGwKABMGgAgwbAoAEMGgCDBjBoAAwaAIMGMGgADBrAoAEwaAAMGsCgATBoAIMGwKABDBoAgwbAoAEMGgCDBjBoAAwaAIMGMGgADBrAoAEwaAAMGsCgATBoAIMGwKABDBoAgwbAoAEMGgCDBjBoAAwaAIMGMGgADBrAoAEwaACDBsCgATBoAIMGwKABDBoAgwbAoAEMGgCDBjBoAAwawKABMGgADBrAoAEwaACDBsCgATBoAIMGwKABDBoAgwbAoAEMGgCDBjBoAAwawKABMGgADBrAoAEwaACDBsCgATBoAIMGwKABDBoAgwYwaAAMGgCDBjBoAAwawKABMGgADBrAoAEwaACDBsCgAQwaAIMGwKABDBoAgwYwaAAMGgCDBjBoAAwawKABMGgAgxYBwKABMGgAgwbAoAEMGgCDBsCgAQwaAIMGMGgADBoAgwYwaAAMGsCgATBoAIMGwKABMGgAgwbAoAEMGgCDBsCgAQwaAIMGMGgADBrAoAEwaAAMGsCgATBoAIMGwKABMGgAgwbAoAEMGgCDBjBoEQAMGgCDBjBoAAwawKABMGgADBrAoAEwaACDBsCgATBoAIMGwKABDBoAgwYwaAAMGgCDBjBoAAwawKABMGgADBrAoAEwaACDBsCgATBoAIMGwKABDBoAgwYwaAAMGgCDBjBoAAwawKABMGgAgxYBwKABMGgAgwbAoAEMGgCDBsCgAQwaAIMGMGgADBoAgwYwaAAMGsCgATBoAIMGwKABMGgAgwbAoAEMGgCDBsCgAQwaAIMGMGgADBrAoAEwaAAMGsCgATBoAIMGwKABMGgAgwbAoAEMGgCDBjBoIQAMGgCDBjBoAAwawKABMGgADBrAoAEwaACDBsCgATBoAIMGwKABDBoAgwYwaAAMGgCDBjBoAAwawKABMGgADBrAoAEwaACDBsCgAQwaAIMGwKABDBoAgwYwaAAMGgCDBjBoAAwawKABMGgAgwbAoAEwaACDBsCgAQwaAIMGwKABDBoAgwYwaAAMGgCDBjBoAAwawKABMGgAgwbAoAEwaACDBsCgAQwaAIMGwKABDBoAgwYwaAAMGsCgATBoAAwawKABMGgAgwbAoAEwaACDBsCgAQwaAIMGMGgADBoAgwYwaAAMGsCgATBoAAwawKABMGgAgwbAoAEwaACDBsCgAQwaAIMGMGgADBoAgwYwaAAMGsCgATBoAAwawKABMGgAgwbAoAEMGgCDBsCgAQwaAIMGMGgADBoAgwYwaAAMGsCgATBoAIMGwKABMGgAgwbAoAEMGgCDBsCgAQwaAIMGMGgADBrAoEUAMGgADBrAoAEwaACDBsCgATBoAIMGwKABDBoAgwbAoAEMGgCDBjBoAAwawKABMGgADBrAoAEwaACDBsCgATBoAIMGwKABDBoAgwYwaAAMGgCDBjBoAAwawKABMGgADBrAoAEwaACDBsCgAQxaBACDBsCgAQwaAIMGMGgADBoAgwYwaAAMGsCgATBoAAwawKABMGgAgwbAoAEMGgCDBsCgAQwaAIMGMGgADBoAgwYwaAAMGsCgATBoAIMGwKABMGgAgwbAoAEMGgCDBsCgAQwaAIMGMGgADBrAoEUAMGgADBrAoAEwaACDBsCgATBoAIMGwKABDBoAgwbAoAEMGgCDBjBoAAwawKABMGgADBrAoAEwaACDBsCgATBoAIMGwKABDBoAgwYwaAAMGgCDBjBoAAwawKABMGgADBrAoAEwaACDBsCgAX5bX0oiq4f1aGkAAAAASUVORK5CYII=";
```

Add the method (and a per-instance frame cursor) inside `DeterministicMockClient` (place beside `getParameters`). The cursor is an **instance field, NOT module-level**, so each client/session has its own monotonic seq and tests don't leak state into each other:

```ts
  #frameSeq = 0n; // per-instance monotonic preview cursor (declare with the other #fields)

  // Pure preview read; mirrors the lib's getVideoFrame (no op-lock, may be called
  // concurrently with captureAndProcess). Model: "-1" = give me the latest (the
  // simulated camera advances and yields its newest frame); a cursor strictly
  // behind the newest = the next-newer frame (no advance); a cursor at/ahead of the
  // newest = null (backpressure, nothing newer than this yet). Matches the probe's
  // "newer-than cursor" / ALREADY_RETURNED semantics.
  getVideoFrame(lastSeq?: bigint): Promise<VideoFrame | null> {
    const cursor = lastSeq ?? -1n;
    if (cursor === -1n) {
      this.#frameSeq += 1n; // "latest" advances the simulated camera
      return Promise.resolve(this.#frame(this.#frameSeq));
    }
    if (cursor < this.#frameSeq) {
      return Promise.resolve(this.#frame(cursor + 1n)); // next-newer (no advance)
    }
    return Promise.resolve(null); // caught up → backpressure
  }

  #frame(seq: bigint): VideoFrame {
    return { bytes: decodeBase64(MOCK_FRAME_PNG_BASE64), format: "png", seq };
  }
```

Add the base64 decode import at the top (the dependency is already pinned in `deno.jsonc`):

```ts
import { decodeBase64 } from "@std/encoding/base64";
```

- [ ] **Step 4: Make `captureAndProcess` stream intermediates + honor abort**

Change the method signature in `DeterministicMockClient` and stream snapshots. Replace the existing `captureAndProcess(opts, _signal?)` signature line with:

```ts
  async captureAndProcess(
    opts: CaptureOptions,
    signal?: AbortSignal,
    onIntermediate?: (snap: LiveSnapshot) => void | Promise<void>,
  ): Promise<CaptureResult> {
```

At the very top of the method body (before the scenario branches), add a small streaming preamble that emits a few intermediate snapshots derived from the eventual result, spaced by async ticks, and aborts cleanly:

```ts
    // Stream a few live snapshots (overlay metadata only — never a verdict signal),
    // spaced over an async interval, so the tester exercises the real onIntermediate
    // cadence. Abort promptly if signalled.
    const emit = async (snap: LiveSnapshot) => {
      for (let i = 0; i < 3; i++) {
        if (signal?.aborted) {
          throw Object.assign(new Error("Capture aborted"), { name: "AbortError" });
        }
        await onIntermediate?.(snap);
        await new Promise((r) => setTimeout(r, 30));
      }
    };
```

Then, in each branch that currently returns a result with a face, call `await emit({...})` with the snapshot subset *before* returning the final `CaptureResult`. For the `approach` (face-present) branch use:

```ts
      await emit({
        numberOfFaces: 1,
        quality,
        boundingBox: { x: 60, y: 40, width: side, height: Math.round(side * 1.2) },
        landmarks: [
          { type: "left_eye", x: 90, y: 110 },
          { type: "right_eye", x: 170, y: 110 },
          { type: "nose", x: 130, y: 160 },
        ],
        positioningFeedback: captured
          ? { raw: 0, ok: true, flags: [], unknownBits: 0 }
          : { raw: 4, ok: false, flags: ["TURN_RIGHT"], unknownBits: 0 },
      });
```

For the steady `good`/`low-quality`/`spoof` branch (the final `return` block), add before it:

```ts
      await emit({
        numberOfFaces: 1,
        quality,
        boundingBox: { x: 40, y: 30, width: 180, height: 220 },
        landmarks: [
          { type: "left_eye", x: 90, y: 110 },
          { type: "right_eye", x: 170, y: 110 },
          { type: "nose", x: 130, y: 160 },
        ],
        positioningFeedback: { raw: 0, ok: true, flags: [], unknownBits: 0 },
      });
```

For the `no-face` scenario branch, emit a face-absent snapshot (this drives the overlay's immediate-clear path) before returning:

```ts
      await emit({ numberOfFaces: 0 });
```

For the **`approach` scenario's own early no-face steps** (the `if (n < 2) { return ... }` block at `mockClient.ts:154-161`), add the same face-absent emit before its return:

```ts
      if (n < 2) {
        await emit({ numberOfFaces: 0 });
        return Promise.resolve({
          quality: 0,
          numberOfFaces: 0,
          liveness: { spoofScore: 0, passed: true },
          isCaptured: false,
          faceStatus: "no_face",
        });
      }
```

This is **required** for the two new tests, which use a fresh `client("approach")` whose first call has `n=0` and would otherwise return before any `emit` fires (no snapshots, and the abort callback never runs). Leave `device-error` (rejects before emitting) unchanged. All mock coordinates lie within 360×640, matching `MOCK_FRAME`.

- [ ] **Step 5: Run tests + type-check to verify green**

Run: `deno test --allow-env --allow-read server/`
Expected: PASS (all existing mock/session tests + the 3 new ones). Note: `setMockScenario`/`approach` tests still pass because intermediates are additive and the final results are unchanged.

Run: `deno check server/main.ts`
Expected: PASS (the 2 missing-method errors are gone).

- [ ] **Step 6: Commit**

```bash
git add server/mockClient.ts server/mockClient.test.ts
git commit -m "feat(mock): implement getVideoFrame + streaming onIntermediate seam parity"
```

---

## Task 1: Server frame lane — session `readFrame`, buffer, gate, signal threading

Add the device-side plumbing in `FacePodSession`: a `readFrame()` that bypasses `#track` and is gated against teardown; the `latestSnapshot` buffer fed by `onIntermediate`; `#captureId`/`#sessionGeneration`; `signal` + `onIntermediate` forwarding through `capture()`/`captureAndMatch()`; and `#quiesceFrameLane()` for teardown drain.

**Files:**
- Modify: `server/facepodSession.ts`
- Modify: `src/api.ts` (add `sessionGeneration` to the `SessionStatus` type — needed by Task 3's frame poll)
- Test: `server/facepodSession.test.ts`

**Interfaces:**
- Consumes: `FaceModuleLifecycle.device.getVideoFrame`, `device.captureAndProcess(opts, signal?, onIntermediate?)` (`@eai/hid/facepod`); `VideoFrame`, `LiveSnapshot` types.
- Produces:
  - `interface FrameRead { frame: VideoFrame | null; snapshot: LiveSnapshot | null; snapshotAgeMs: number | null; captureId: number; sessionGeneration: number }`
  - `FacePodSession.readFrame(lastSeq?: bigint): Promise<FrameRead>` — bypasses `#track`; returns `{ frame: null, ... }` when `#closing`.
  - `FacePodSession.capture(params, signal?)` and `captureAndMatch(params, signal?)` — now accept an optional `AbortSignal`.
  - `FacePodSession.sessionGeneration: number` (getter) for status/diagnostics.

- [ ] **Step 1: Write the failing tests**

Add to `server/facepodSession.test.ts`:

```ts
Deno.test("readFrame returns a frame in mock and advances seq", async () => {
  const s = new FacePodSession();
  await s.connect(MOCK_CONFIG);
  await s.openCamera();
  const r1 = await s.readFrame(-1n);
  if (!r1.frame) throw new Error("expected a frame");
  assertEquals(r1.frame.format, "png");
  assertEquals(typeof r1.sessionGeneration, "number");
  // No capture has run yet → no snapshot buffered.
  assertEquals(r1.snapshot, null);
  assertEquals(r1.snapshotAgeMs, null);
  await s.disconnect();
});

Deno.test("readFrame populates latestSnapshot after a capture writes it", async () => {
  const s = new FacePodSession();
  await s.connect(MOCK_CONFIG);
  await s.openCamera();
  s.setMockScenario("approach");
  await s.capture({ minimalQuality: 0.7 }); // streams onIntermediate → buffer
  const r = await s.readFrame(-1n);
  assert(r.snapshot !== null, "snapshot should be buffered after a capture");
  assert(r.snapshotAgeMs !== null && r.snapshotAgeMs >= 0, "age computed server-side");
  await s.disconnect();
});

Deno.test("sessionGeneration increments across reconnects (readFrame + status)", async () => {
  const s = new FacePodSession();
  await s.connect(MOCK_CONFIG);
  const g1 = (await s.readFrame(-1n)).sessionGeneration;
  assertEquals(s.status().sessionGeneration, g1); // status mirrors the live generation
  await s.connect(MOCK_CONFIG); // reconnect over a live session
  const g2 = (await s.readFrame(-1n)).sessionGeneration;
  assert(g2 > g1, `generation must advance: ${g1} -> ${g2}`);
  assertEquals(s.status().sessionGeneration, g2);
  await s.disconnect();
});

Deno.test("readFrame returns null frame once closing (teardown gate)", async () => {
  const s = new FacePodSession();
  await s.connect(MOCK_CONFIG);
  await s.openCamera();
  await s.disconnect(); // flips #closing then disposes
  const r = await s.readFrame(-1n);
  assertEquals(r.frame, null); // not connected / closing → no frame, no throw
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `deno test --allow-env --allow-read server/facepodSession.test.ts`
Expected: FAIL — `s.readFrame is not a function`.

- [ ] **Step 3: Add fields, the frame-gate, and the buffer**

In `server/facepodSession.ts`, add the imports `LiveSnapshot`, `VideoFrame` to the `@eai/hid/facepod` import block. Add the exported type near the top (after the existing interfaces):

```ts
export interface FrameRead {
  frame: VideoFrame | null;
  snapshot: LiveSnapshot | null;
  snapshotAgeMs: number | null;
  captureId: number;
  sessionGeneration: number;
}
```

Add private fields to the class (beside the existing `#busy` etc.):

```ts
  #closing = false;
  #framesInFlight = 0;
  #inFlightFrame: Promise<unknown> | null = null;
  #captureId = 0;
  #sessionGeneration = 0;
  #latestSnapshot:
    | { snapshot: LiveSnapshot; captureId: number; monotonicAtWrite: number }
    | null = null;
```

Add a getter:

```ts
  get sessionGeneration(): number {
    return this.#sessionGeneration;
  }
```

Also surface it on status **now** (Task 3's frame poll needs the client to know the live generation, or its snapshot session-guard would discard every snapshot). Add `sessionGeneration: number;` to the `SessionStatus` interface in `server/facepodSession.ts` and include `sessionGeneration: this.#sessionGeneration` in the object `status()` returns. Mirror the field on the client type: add `sessionGeneration: number;` to the `SessionStatus` interface in `src/api.ts`.

- [ ] **Step 4: Implement `readFrame` (bypasses `#track`, synchronous gate)**

Add the method (do NOT route it through `#track`):

```ts
  /**
   * Pull the newest preview frame (Lane 1). Bypasses #track exactly like the lib
   * client bypasses its own op-lock, so the feed runs concurrently with an
   * in-flight capture. The check-and-increment below is SYNCHRONOUS (before any
   * await) so a read cannot slip past #closing after the teardown drain observed
   * zero in-flight reads. Returns a null frame (never throws) when closing/not open.
   */
  async readFrame(lastSeq?: bigint): Promise<FrameRead> {
    const base = {
      snapshot: this.#latestSnapshot?.snapshot ?? null,
      snapshotAgeMs: this.#latestSnapshot
        ? performance.now() - this.#latestSnapshot.monotonicAtWrite
        : null,
      captureId: this.#latestSnapshot?.captureId ?? this.#captureId,
      sessionGeneration: this.#sessionGeneration,
    };
    if (this.#closing || !this.#fp || !this.#fp.device.isOpen) {
      return { frame: null, ...base };
    }
    this.#framesInFlight++; // synchronous: paired with the #closing check above
    const p = this.#fp.device.getVideoFrame(lastSeq);
    this.#inFlightFrame = p;
    try {
      const frame = await p;
      // Recompute snapshot/age AFTER the await so the buffer is current.
      return {
        frame,
        snapshot: this.#latestSnapshot?.snapshot ?? null,
        snapshotAgeMs: this.#latestSnapshot
          ? performance.now() - this.#latestSnapshot.monotonicAtWrite
          : null,
        captureId: this.#latestSnapshot?.captureId ?? this.#captureId,
        sessionGeneration: this.#sessionGeneration,
      };
    } catch {
      return { frame: null, ...base };
    } finally {
      this.#framesInFlight--;
      if (this.#framesInFlight === 0) this.#inFlightFrame = null;
    }
  }
```

- [ ] **Step 5: Thread `onIntermediate` + `signal` through `capture()`/`captureAndMatch()`**

Replace the existing `capture(params)` method body so it accepts a signal, clears+stamps the buffer at op start, and forwards both extras. The op-start bookkeeping runs **inside** the `#track` callback (after the busy-lock is acquired) so a rejected busy capture never clears the live buffer:

```ts
  capture(params: CaptureParams, signal?: AbortSignal): Promise<CaptureResult> {
    return this.#track(() => {
      const captureId = ++this.#captureId;
      this.#latestSnapshot = null; // clear at op start: no prior-op snapshot lingers
      return this.#require().device.captureAndProcess(
        {
          minimalQuality: params.minimalQuality,
          maximalSpoofScore: params.maximalSpoofScore,
          timeoutMs: params.timeoutMs,
        },
        signal,
        (snap) => {
          this.#latestSnapshot = {
            snapshot: snap,
            captureId,
            monotonicAtWrite: performance.now(),
          };
        },
      );
    });
  }
```

In `captureAndMatch(params)`, change the signature to `captureAndMatch(params: CaptureAndMatchParams, signal?: AbortSignal)` and, in the body, before the `captureAndProcess` call, add the same op-start bookkeeping and pass `signal` + an `onIntermediate` writer:

```ts
      const captureId = ++this.#captureId;
      this.#latestSnapshot = null;
      const live = await fp.device.captureAndProcess(
        {
          minimalQuality: params.capture.minimalQuality,
          maximalSpoofScore: params.capture.maximalSpoofScore,
          timeoutMs: params.capture.timeoutMs,
        },
        signal,
        (snap) => {
          this.#latestSnapshot = {
            snapshot: snap,
            captureId,
            monotonicAtWrite: performance.now(),
          };
        },
      );
```

- [ ] **Step 6: `#sessionGeneration` bump + `#quiesceFrameLane` teardown drain**

In `connect()`, after the line `this.#fp = fp;` (session successfully adopted), add:

```ts
      this.#sessionGeneration++;
      this.#closing = false; // a fresh session re-opens the frame lane
      this.#latestSnapshot = null;
```

Add the quiesce helper:

```ts
  /**
   * Stop the frame lane before dispose: flip #closing (synchronously blocks new
   * reads via readFrame's gate), then await the single in-flight read, BOUNDED by
   * a timeout so a wedged device read can't wedge teardown. At most one read is in
   * flight (clients poll sequentially + the synchronous gate), so awaiting the
   * retained promise is sufficient.
   */
  async #quiesceFrameLane(): Promise<void> {
    this.#closing = true;
    const inflight = this.#inFlightFrame;
    if (!inflight) return;
    await Promise.race([
      inflight.catch(() => {}),
      new Promise((r) => setTimeout(r, 500)),
    ]);
  }
```

Call it on the graceful paths only. In `disconnect()`:

```ts
  async disconnect(): Promise<void> {
    await this.#quiesceFrameLane();
    await this.#track(() => this.#teardown());
  }
```

And in `connect()`, before the existing `await this.#teardown();` that tears down a prior session, add `await this.#quiesceFrameLane();`. Leave `forceDispose()` as-is: it calls `#teardown()` directly and must NOT await the drain (emergency release) — but set `this.#closing = true;` synchronously as its first line so new reads stop immediately.

- [ ] **Step 7: Run tests to verify green**

Run: `deno test --allow-env --allow-read server/facepodSession.test.ts`
Expected: PASS (4 new tests + all existing).

Run: `deno check server/main.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add server/facepodSession.ts src/api.ts server/facepodSession.test.ts
git commit -m "feat(server): frame-lane readFrame, latestSnapshot buffer, signal threading, teardown drain"
```

---

## Task 2: `GET /api/video-frame` endpoint + payload shaping + client method

Expose the frame lane over HTTP behind the CSRF gate, with a discriminated response and string-encoded `seq`. Extract the JSON shaping into a pure, tested helper.

**Files:**
- Create: `server/videoFramePayload.ts`
- Create: `server/videoFramePayload.test.ts`
- Modify: `server/main.ts`
- Modify: `server/security.test.ts` (add a gate assertion for the new path)
- Modify: `src/api.ts`

**Interfaces:**
- Consumes: `FrameRead` (Task 1); `session.readFrame`; `session.capture(params, signal)` / `captureAndMatch(params, signal)`.
- Produces:
  - `interface FramePayload { frame: { datatype: string; data: string; seq: string } | null; snapshot: LiveSnapshot | null; snapshotAgeMs: number | null; captureId: number; sessionGeneration: number }`
  - `toFramePayload(read: FrameRead): FramePayload`
  - `api.getVideoFrame(lastSeq: string): Promise<FrameResponse>` (frontend), `FrameResponse` mirroring `FramePayload`.

- [ ] **Step 1: Write the failing payload test**

Create `server/videoFramePayload.test.ts`:

```ts
import { assertEquals } from "@std/assert";
import { encodeBase64 } from "@std/encoding/base64";
import { toFramePayload } from "./videoFramePayload.ts";

Deno.test("toFramePayload: encodes bytes to base64 and seq to string", () => {
  const bytes = new Uint8Array([1, 2, 3, 4]);
  const p = toFramePayload({
    frame: { bytes, format: "jpg", seq: 42n },
    snapshot: { numberOfFaces: 1, quality: 0.8 },
    snapshotAgeMs: 12.5,
    captureId: 7,
    sessionGeneration: 2,
  });
  if (p.frame === null) throw new Error("expected a frame");
  assertEquals(p.frame.datatype, "jpg");
  assertEquals(p.frame.seq, "42"); // string-encoded bigint, never narrowed
  assertEquals(p.frame.data, encodeBase64(bytes));
  assertEquals(p.snapshotAgeMs, 12.5);
});

Deno.test("toFramePayload: null frame stays discriminated", () => {
  const p = toFramePayload({
    frame: null,
    snapshot: null,
    snapshotAgeMs: null,
    captureId: 0,
    sessionGeneration: 1,
  });
  assertEquals(p.frame, null);
  assertEquals(p.snapshot, null);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `deno test --allow-env --allow-read server/videoFramePayload.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the pure shaper**

Create `server/videoFramePayload.ts`:

```ts
/**
 * Pure shaping of a FrameRead into the JSON wire payload for GET /api/video-frame.
 * Frame bytes → base64; the i64 seq → string (never narrowed to a JS number);
 * the discriminated `frame: null` case is preserved. No I/O.
 */
import { encodeBase64 } from "@std/encoding/base64";
import type { LiveSnapshot } from "@eai/hid/facepod";
import type { FrameRead } from "./facepodSession.ts";

export interface FramePayload {
  frame: { datatype: string; data: string; seq: string } | null;
  snapshot: LiveSnapshot | null;
  snapshotAgeMs: number | null;
  captureId: number;
  sessionGeneration: number;
}

export function toFramePayload(read: FrameRead): FramePayload {
  return {
    frame: read.frame
      ? {
        datatype: read.frame.format,
        data: encodeBase64(read.frame.bytes),
        seq: read.frame.seq.toString(),
      }
      : null,
    snapshot: read.snapshot,
    snapshotAgeMs: read.snapshotAgeMs,
    captureId: read.captureId,
    sessionGeneration: read.sessionGeneration,
  };
}
```

- [ ] **Step 4: Run to verify green**

Run: `deno test --allow-env --allow-read server/videoFramePayload.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the route + thread the request signal into captures**

In `server/main.ts`, add the import:

```ts
import { toFramePayload } from "./videoFramePayload.ts";
```

Add the route (place beside the other GETs, e.g. after `/api/parameters`). `lastSeq` is parsed from the query string into a `bigint`; an absent/invalid value means "latest":

```ts
app.get(
  "/api/video-frame",
  handle(async (c) => {
    const raw = c.req.query("lastSeq");
    let lastSeq: bigint | undefined;
    try {
      lastSeq = raw != null && raw !== "" ? BigInt(raw) : undefined;
    } catch {
      lastSeq = undefined; // malformed cursor → treat as "latest"
    }
    const read = await session.readFrame(lastSeq);
    return c.json(toFramePayload(read));
  }),
);
```

Thread the request abort signal into the two capture routes so a client abort tears the device op down (best-effort; see plan note). In the `/api/capture` handler, change the call to:

```ts
    const result = await session.capture({
      minimalQuality: requireNum(body.minimalQuality, "minimalQuality"),
      maximalSpoofScore: num(body.maximalSpoofScore),
      timeoutMs: num(body.timeoutMs),
    }, c.req.raw.signal);
```

In the `/api/capture-and-match` handler, pass `c.req.raw.signal` as the second argument to `session.captureAndMatch({...}, c.req.raw.signal)`.

- [ ] **Step 6: Add the CSRF gate assertion for the new path**

Add to `server/security.test.ts`:

```ts
Deno.test("gate: video-frame GET needs only the custom header (no JSON CT)", () => {
  // Missing header → rejected.
  assertEquals(
    checkRequestGate({ method: "GET", path: "/api/video-frame" })?.httpStatus,
    403,
  );
  // Header present, no content-type → allowed (GET needs no JSON CT).
  assertEquals(
    checkRequestGate({
      method: "GET",
      path: "/api/video-frame",
      testerHeader: "1",
    }),
    null,
  );
});
```

- [ ] **Step 7: Add the frontend client method**

In `src/api.ts`, add the type (near the other envelopes):

```ts
export interface FrameResponse {
  frame: { datatype: string; data: string; seq: string } | null;
  snapshot: {
    numberOfFaces: number;
    quality?: number;
    boundingBox?: BoundingBox;
    landmarks?: Landmark[];
    positioningFeedback?: PositioningFeedback;
  } | null;
  snapshotAgeMs: number | null;
  captureId: number;
  sessionGeneration: number;
}
```

Add to the `api` object (it accepts an `AbortSignal` so `useFramePoll` can cancel an in-flight poll on teardown — `request` already spreads `...init` into `fetch`, so the `signal` propagates):

```ts
  getVideoFrame: (lastSeq: string, signal?: AbortSignal) =>
    request<FrameResponse>(`/api/video-frame?lastSeq=${encodeURIComponent(lastSeq)}`, { signal }),
```

- [ ] **Step 8: Run all backend tests + type-checks to verify green**

Run: `deno test --allow-env --allow-read server/`
Expected: PASS (new payload + gate tests + all existing).

Run: `deno check server/main.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add server/videoFramePayload.ts server/videoFramePayload.test.ts server/main.ts server/security.test.ts src/api.ts
git commit -m "feat(server): GET /api/video-frame endpoint, payload shaping, client method"
```

---

## Task 3: Client frame lane + full-frame feed + overlay

Add the Lane 1 poll hook and the pure overlay logic, and render the full frame with a percentage-mapped bbox + landmark overlay inside a 9:16 box. Pure functions are unit-tested; the hook + component are verified by mock-mode E2E. This task is **additive** — it does not rename `LiveFrame` (that is Task 4).

**Testing note (reconciles spec §8):** §8 lists "`useFramePoll` de-dup + drain" and "`stopAndDrain` ordering" as unit tests. Vitest runs in **node env with no jsdom** (`vite.config.ts`), so a React hook cannot be rendered/unit-tested here. The de-dup + `lastSeq`-advance logic is therefore extracted into the pure `framePoll.ts` (`isFreshFrame`/`nextLastSeq`/`snapshotForSession`) and unit-tested; the hook *orchestration* (timer, AbortController drain, teardown ordering) is verified by the Step 9 mock-mode E2E (End session with no console errors / no use-after-dispose) — this is a deliberate, documented substitution, not a skipped requirement.

**Files:**
- Modify: `src/live/types.ts` (add `LiveSnapshotState`, additive)
- Create: `src/live/overlay.ts`
- Create: `src/live/overlay.test.ts`
- Create: `src/live/overlayDisplay.ts`
- Create: `src/live/overlayDisplay.test.ts`
- Create: `src/live/framePoll.ts`
- Create: `src/live/framePoll.test.ts`
- Create: `src/live/useFramePoll.ts`
- Modify: `src/components/live/Feed.tsx`
- Modify: `src/components/live/LiveView.tsx`
- Modify: `src/styles.css`

**Interfaces:**
- Consumes: `api.getVideoFrame`, `FrameResponse` (Task 2).
- Produces:
  - `LiveSnapshotState` (client type, below).
  - `overlay.ts`: `mapBox(box, naturalW, naturalH): PctBox`, `mapPoint(p, naturalW, naturalH): PctPoint`; `interface PctBox { leftPct; topPct; widthPct; heightPct }`, `interface PctPoint { leftPct; topPct }`.
  - `overlayDisplay.ts`: `overlayDecision(input): OverlayDecision | null` where `OverlayDecision { box: BoundingBox; points: {x,y}[]; opacity: number }`.
  - `framePoll.ts`: `nextLastSeq(prev, resp)`, `isFreshFrame(prevSeq, resp)`, `snapshotForSession(resp, currentGeneration)`.
  - `useFramePoll(opts)`: `{ videoFrame, liveSnapshot, snapshotAgeMs, stopAndDrain }`.

- [ ] **Step 1: Add the client type + write the pure-logic failing tests**

In `src/live/types.ts` add (additive — leave `LiveFrame` untouched here):

```ts
/** Per-frame live metadata (Lane 1) — drives overlay/guidance/live-quality/glow.
 *  Mirrors LiveSnapshot but with nulls instead of optionals for stable rendering. */
export interface LiveSnapshotState {
  numberOfFaces: number;
  quality: number | null;
  boundingBox: { x: number; y: number; width: number; height: number } | null;
  landmarks: { type?: string; x: number; y: number }[] | null;
  positioningFeedback: PositioningFeedback | null;
}
```

Create `src/live/overlay.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { mapBox, mapPoint } from "./overlay.ts";

describe("overlay mapping (device raster → 9:16 box percentages)", () => {
  it("maps a box to percentages of the natural frame dims", () => {
    // 1080×1920 device raster, a centered-ish box.
    const b = mapBox({ x: 540, y: 960, width: 270, height: 480 }, 1080, 1920);
    expect(b.leftPct).toBeCloseTo(50);
    expect(b.topPct).toBeCloseTo(50);
    expect(b.widthPct).toBeCloseTo(25);
    expect(b.heightPct).toBeCloseTo(25);
  });
  it("maps a landmark point", () => {
    const p = mapPoint({ x: 270, y: 480 }, 1080, 1920);
    expect(p.leftPct).toBeCloseTo(25);
    expect(p.topPct).toBeCloseTo(25);
  });
});
```

Create `src/live/overlayDisplay.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { overlayDecision } from "./overlayDisplay.ts";
import type { LiveSnapshotState } from "./types.ts";

const withFace: LiveSnapshotState = {
  numberOfFaces: 1,
  quality: 0.8,
  boundingBox: { x: 40, y: 30, width: 180, height: 220 },
  landmarks: [{ x: 90, y: 110 }],
  positioningFeedback: null,
};
const opts = { fadeStartMs: 750, removeMs: 1500 };

describe("overlayDecision", () => {
  it("clears immediately when the freshest snapshot has no box (trigger 1)", () => {
    const noFace: LiveSnapshotState = { ...withFace, numberOfFaces: 0, boundingBox: null };
    expect(overlayDecision({ snapshot: noFace, snapshotAgeMs: 0, ...opts })).toBeNull();
  });
  it("shows full opacity within the inter-op gap", () => {
    const d = overlayDecision({ snapshot: withFace, snapshotAgeMs: 200, ...opts });
    expect(d?.opacity).toBe(1);
    expect(d?.box).toEqual(withFace.boundingBox);
  });
  it("fades between fadeStart and remove (trigger 2)", () => {
    const d = overlayDecision({ snapshot: withFace, snapshotAgeMs: 1125, ...opts });
    expect(d?.opacity).toBeGreaterThan(0);
    expect(d?.opacity).toBeLessThan(1);
  });
  it("removes after the remove threshold", () => {
    expect(overlayDecision({ snapshot: withFace, snapshotAgeMs: 2000, ...opts })).toBeNull();
  });
  it("clears when there is no snapshot at all", () => {
    expect(overlayDecision({ snapshot: null, snapshotAgeMs: null, ...opts })).toBeNull();
  });
});
```

Create `src/live/framePoll.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { isFreshFrame, nextLastSeq, snapshotForSession } from "./framePoll.ts";
import type { FrameResponse } from "../api.ts";

const resp = (over: Partial<FrameResponse>): FrameResponse => ({
  frame: null, snapshot: null, snapshotAgeMs: null, captureId: 0, sessionGeneration: 1, ...over,
});

describe("framePoll reducers", () => {
  it("advances lastSeq on a fresh frame, holds it on null", () => {
    expect(nextLastSeq("-1", resp({ frame: { datatype: "png", data: "x", seq: "5" } }))).toBe("5");
    expect(nextLastSeq("5", resp({ frame: null }))).toBe("5"); // cannot stick or skip
  });
  it("treats a repeated seq as not fresh (de-dup)", () => {
    expect(isFreshFrame("5", resp({ frame: { datatype: "png", data: "x", seq: "5" } }))).toBe(false);
    expect(isFreshFrame("5", resp({ frame: { datatype: "png", data: "x", seq: "6" } }))).toBe(true);
  });
  it("discards a snapshot from a different session generation", () => {
    const r = resp({ snapshot: { numberOfFaces: 1 }, sessionGeneration: 2 });
    expect(snapshotForSession(r, 1)).toBeNull(); // stale session
    expect(snapshotForSession(r, 2)).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test`
Expected: FAIL — `overlay.ts` / `overlayDisplay.ts` / `framePoll.ts` modules not found.

- [ ] **Step 3: Implement the pure modules**

Create `src/live/overlay.ts`:

```ts
/** Pure device-raster → percentage mapping. The feed renders in a box whose
 *  aspect ratio equals the frame's (9:16), so a coordinate maps to a simple
 *  percentage of the natural pixel dimension — no letterbox/crop offsets. */
export interface PctBox { leftPct: number; topPct: number; widthPct: number; heightPct: number }
export interface PctPoint { leftPct: number; topPct: number }

export function mapBox(
  box: { x: number; y: number; width: number; height: number },
  naturalW: number,
  naturalH: number,
): PctBox {
  return {
    leftPct: (box.x / naturalW) * 100,
    topPct: (box.y / naturalH) * 100,
    widthPct: (box.width / naturalW) * 100,
    heightPct: (box.height / naturalH) * 100,
  };
}

export function mapPoint(
  p: { x: number; y: number },
  naturalW: number,
  naturalH: number,
): PctPoint {
  return { leftPct: (p.x / naturalW) * 100, topPct: (p.y / naturalH) * 100 };
}
```

Create `src/live/overlayDisplay.ts`:

```ts
/** Pure overlay clear/fade policy (spec §5.3). Two distinct triggers:
 *  (1) the freshest snapshot reports no face/box → clear immediately, regardless
 *      of age (no ghost box while an op keeps streaming face-absent snapshots);
 *  (2) snapshots stopped arriving → fade by server-computed snapshotAgeMs. */
import type { LiveSnapshotState } from "./types.ts";

export interface OverlayDecision {
  box: { x: number; y: number; width: number; height: number };
  points: { x: number; y: number }[];
  opacity: number;
}

export function overlayDecision(input: {
  snapshot: LiveSnapshotState | null;
  snapshotAgeMs: number | null;
  fadeStartMs: number;
  removeMs: number;
}): OverlayDecision | null {
  const { snapshot, snapshotAgeMs, fadeStartMs, removeMs } = input;
  // Trigger 1: latest snapshot says there is no face/box → clear now.
  if (!snapshot || snapshot.numberOfFaces < 1 || !snapshot.boundingBox) return null;
  // Trigger 2: snapshot has a box → fade by age.
  const age = snapshotAgeMs ?? 0;
  if (age >= removeMs) return null;
  const opacity = age <= fadeStartMs ? 1 : 1 - (age - fadeStartMs) / (removeMs - fadeStartMs);
  return { box: snapshot.boundingBox, points: snapshot.landmarks ?? [], opacity };
}
```

Create `src/live/framePoll.ts`:

```ts
/** Pure reducers for the Lane 1 poll. lastSeq is a string (the i64 bigint is never
 *  narrowed). A snapshot from a different session generation is discarded. */
import type { FrameResponse } from "../api.ts";
import type { LiveSnapshotState } from "./types.ts";

export function nextLastSeq(prev: string, resp: FrameResponse): string {
  return resp.frame ? resp.frame.seq : prev; // hold on null — cannot stick or skip
}

export function isFreshFrame(prevSeq: string, resp: FrameResponse): boolean {
  return resp.frame != null && resp.frame.seq !== prevSeq;
}

export function snapshotForSession(
  resp: FrameResponse,
  currentGeneration: number,
): LiveSnapshotState | null {
  if (resp.sessionGeneration !== currentGeneration) return null; // stale session
  const s = resp.snapshot;
  if (!s) return null;
  return {
    numberOfFaces: s.numberOfFaces,
    quality: s.quality ?? null,
    boundingBox: s.boundingBox ?? null,
    landmarks: s.landmarks ?? null,
    positioningFeedback: s.positioningFeedback ?? null,
  };
}
```

- [ ] **Step 4: Run to verify the pure modules pass**

Run: `npm test`
Expected: PASS (overlay, overlayDisplay, framePoll suites).

- [ ] **Step 5: Implement the `useFramePoll` hook**

Create `src/live/useFramePoll.ts`:

```ts
import { useEffect, useRef, useState } from "react";
import { api, ApiError, type NormalizedError } from "../api.ts";
import { isFreshFrame, nextLastSeq, snapshotForSession } from "./framePoll.ts";
import type { LiveSnapshotState } from "./types.ts";

interface Options {
  active: boolean;
  sessionGeneration: number;
  onError: (e: NormalizedError) => void;
  intervalMs?: number;
}
interface FramePollState {
  videoFrame: { datatype: string; data: string } | null;
  liveSnapshot: LiveSnapshotState | null;
  snapshotAgeMs: number | null;
  stopAndDrain: () => Promise<void>;
}

/**
 * Lane 1 feed poller. Polls GET /api/video-frame, de-dups by seq, and exposes the
 * newest frame + the server's latest snapshot. stopAndDrain() aborts the in-flight
 * request and awaits it — call this BEFORE POST /api/disconnect (teardown order).
 */
export function useFramePoll(opts: Options): FramePollState {
  const ref = useRef(opts);
  ref.current = opts;
  const runningRef = useRef(false);
  const lastSeqRef = useRef("-1");
  const abortRef = useRef<AbortController | null>(null);
  const inFlightRef = useRef<Promise<unknown> | null>(null);

  const [videoFrame, setVideoFrame] = useState<{ datatype: string; data: string } | null>(null);
  const [liveSnapshot, setLiveSnapshot] = useState<LiveSnapshotState | null>(null);
  const [snapshotAgeMs, setSnapshotAgeMs] = useState<number | null>(null);

  const stopAndDrain = async () => {
    runningRef.current = false;
    abortRef.current?.abort();
    try { await inFlightRef.current; } catch { /* AbortError expected */ }
  };
  const stopRef = useRef(stopAndDrain);
  stopRef.current = stopAndDrain;

  useEffect(() => {
    if (!opts.active) return;
    runningRef.current = true;
    const loop = async () => {
      while (runningRef.current && ref.current.active) {
        const ac = new AbortController();
        abortRef.current = ac;
        try {
          const p = api.getVideoFrame(lastSeqRef.current, ac.signal);
          inFlightRef.current = p;
          const resp = await p;
          if (!runningRef.current) break;
          // Only advance the overlay alongside a FRESH frame (spec §5.2).
          if (isFreshFrame(lastSeqRef.current, resp) && resp.frame) {
            lastSeqRef.current = nextLastSeq(lastSeqRef.current, resp);
            setVideoFrame({ datatype: resp.frame.datatype, data: resp.frame.data });
            setLiveSnapshot(snapshotForSession(resp, ref.current.sessionGeneration));
            setSnapshotAgeMs(resp.snapshotAgeMs);
          }
        } catch (e) {
          if (!runningRef.current) break; // aborted by stopAndDrain — not an error
          const detail = e instanceof ApiError
            ? e.detail
            : { name: "Error", message: String(e), httpStatus: 500 } as NormalizedError;
          ref.current.onError(detail);
          runningRef.current = false;
          break;
        }
        await new Promise((r) => setTimeout(r, ref.current.intervalMs ?? 125));
      }
    };
    void loop().catch(() => {});
    return () => { void stopRef.current(); };
  }, [opts.active]);

  return { videoFrame, liveSnapshot, snapshotAgeMs, stopAndDrain: () => stopRef.current() };
}
```

- [ ] **Step 6: Update `Feed.tsx` to render the full frame + percentage overlay**

Replace the contents of `src/components/live/Feed.tsx`:

```tsx
import { useState } from "react";
import type { LiveFrame, Verdict } from "../../live/types.ts";
import { mapBox, mapPoint } from "../../live/overlay.ts";

interface Props {
  frame: LiveFrame | null;
  verdict: Verdict;
  guidance: string | null;
  /** Lane 1 full-frame feed (base64). */
  videoFrame?: { datatype: string; data: string } | null;
  /** Live present/searching glow from the per-frame snapshot face count. */
  liveFaces?: number;
  /** Overlay to draw on the full frame: device-raster coords + opacity (or null). */
  overlay?: { box: { x: number; y: number; width: number; height: number }; points: { x: number; y: number }[]; opacity: number } | null;
}

function imgSrc(datatype: string, data: string): string {
  return `data:image/${datatype === "jpg" ? "jpeg" : datatype};base64,${data}`;
}

/** The viewfinder: full live frame in a 9:16 box with a bbox + landmark overlay
 *  mapped from the frame's natural pixel dims (no cover-crop, no transform). */
export function Feed({ frame, verdict, guidance, videoFrame = null, liveFaces, overlay = null }: Props) {
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null);
  const img = videoFrame ?? frame?.image ?? null;
  const locked = verdict.state === "accept";
  const present = liveFaces != null ? liveFaces >= 1 : verdict.state !== "searching";
  const box = overlay && nat ? mapBox(overlay.box, nat.w, nat.h) : null;
  return (
    <div className={`feed ${locked ? "locked" : present ? "present" : "searching"}`}>
      <div className="feed-media">
        {img
          ? (
            <img
              className="feed-img"
              src={imgSrc(img.datatype, img.data)}
              alt="live face"
              onLoad={(e) => setNat({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
            />
          )
          : <div className="feed-empty" />}
        {box && (
          <div className="overlay" style={{ opacity: overlay!.opacity }}>
            <div
              className="bbox"
              style={{ left: `${box.leftPct}%`, top: `${box.topPct}%`, width: `${box.widthPct}%`, height: `${box.heightPct}%` }}
            />
            {nat && overlay!.points.map((p, i) => {
              const pt = mapPoint(p, nat.w, nat.h);
              return <div key={i} className="lmk" style={{ left: `${pt.leftPct}%`, top: `${pt.topPct}%` }} />;
            })}
          </div>
        )}
      </div>
      <div className="grain" />
      <div className="scan" />
      <div className="bracket tl" /><div className="bracket tr" />
      <div className="bracket bl" /><div className="bracket br" />
      {guidance && (
        <div className="guide"><span className="ar">⌖</span>{guidance}</div>
      )}
    </div>
  );
}
```

- [ ] **Step 7: Wire `useFramePoll` + overlay decision into `LiveView`**

In `src/components/live/LiveView.tsx`, add imports:

```ts
import { useFramePoll } from "../../live/useFramePoll.ts";
import { overlayDecision } from "../../live/overlayDisplay.ts";
```

Inside the component, after the existing `useWatchLoop({...})` call, add the frame poll (active whenever the camera is live — Lane 1 is independent of `watching`). Pass the **live** `status?.sessionGeneration` (Task 1 added it to `SessionStatus`); it must equal the generation the server stamps on each frame, or `snapshotForSession` would discard every snapshot and the overlay would never draw:

```ts
  const { videoFrame, liveSnapshot, snapshotAgeMs, stopAndDrain: stopFrames } = useFramePoll({
    active: scene === "live",
    sessionGeneration: status?.sessionGeneration ?? 0,
    onError,
  });
  const overlay = overlayDecision({ snapshot: liveSnapshot, snapshotAgeMs, fadeStartMs: 750, removeMs: 1500 });
```

Update the `<Feed .../>` render to pass the new props:

```tsx
      <Feed frame={frame} verdict={verdict} guidance={guidance} videoFrame={videoFrame} liveFaces={liveSnapshot?.numberOfFaces} overlay={overlay} />
```

In `endSession`, stop the frame lane first (full teardown reordering lands in Task 4; here just ensure polling stops before disconnect):

```ts
    await stopFrames();
```

as the first line of `endSession` (before `await api.disconnect()`).

- [ ] **Step 8: Add the 9:16 media box + overlay CSS; drop the smearing transition**

In `src/styles.css`, modify the `.feed` / `.feed-img` rules and add overlay rules. Replace the `.feed-img` rule and add the media box:

```css
.feed-media { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; }
/* The frame's own aspect ratio (1080×1920 ≡ 9:16). Image fills it with no cover-crop,
   so the overlay (sibling, percentage-positioned) registers 1:1 — no offset math. */
.feed-media > .feed-img, .feed-media > .overlay {
  position: absolute; height: 100%; aspect-ratio: 9 / 16; left: 50%; transform: translateX(-50%);
}
.feed-img { object-fit: contain; opacity: 0.92; }
.overlay { pointer-events: none; }
.lmk { position: absolute; width: 10px; height: 10px; margin: -5px 0 0 -5px; border-radius: 50%;
  background: hsl(var(--success)); box-shadow: 0 0 10px hsl(var(--success) / 0.6); }
```

Change the existing `.bbox` rule to use percentage positioning and **remove the 0.5s transition** (it smears a per-frame overlay):

```css
.bbox { position: absolute; border: 2.5px solid hsl(var(--success)); border-radius: 12px;
  box-shadow: 0 0 18px hsl(var(--success) / 0.45); }
```

(Delete the old `.bbox { ... transition: left .5s ...; }` declaration. The landmark dots `.lmk` have no transition, so they don't trail either.)

- [ ] **Step 9: Verify type-check, tests, and mock-mode E2E**

Run: `npm test`
Expected: PASS (pure-logic suites).

Run: `npm run build` (from repo root — this is `tsc -b && vite build`; it type-checks all of `src`)
Expected: no type errors.

Manual mock E2E: start `deno task dev:mock` and `npm run dev`, open the UI, Go Live, set scenario to **approach**, Start watching. Expected: the 360×640 mock frame renders as the feed; a green bbox + **3 landmark dots** (the mock emits 3: eyes + nose; the real device emits 5) track on the frame and clear when the scenario reports no face; no ghost box. The overlay renders however many points the snapshot carries, so 3-in-mock / 5-on-device both work.

- [ ] **Step 10: Commit**

```bash
git add src/live/types.ts src/live/overlay.ts src/live/overlay.test.ts src/live/overlayDisplay.ts src/live/overlayDisplay.test.ts src/live/framePoll.ts src/live/framePoll.test.ts src/live/useFramePoll.ts src/components/live/Feed.tsx src/components/live/LiveView.tsx src/styles.css
git commit -m "feat(live): Lane 1 frame poll + full-frame feed with bbox/landmark overlay"
```

---

## Task 4: Telemetry streaming split + teardown (`LiveFrame` → `CaptureFrame` rename)

Split state cleanly: the **live quality bar** streams from `LiveSnapshotState`; **liveness/match/verdict** stay on the final-result `CaptureFrame` (the renamed `LiveFrame`). Add `stopAndDrain` to `useWatchLoop`, reorder `endSession` to drain both lanes before disconnect, and surface `sessionGeneration` so the snapshot session-guard becomes live.

**Files:**
- Modify: `src/live/types.ts` (rename `LiveFrame` → `CaptureFrame`)
- Modify: `src/live/logic.ts` (`toLiveFrame` → `toCaptureFrame`; param/return types)
- Modify: `src/live/logic.test.ts` (update names)
- Modify: `src/live/useWatchLoop.ts` (AbortController + `stopAndDrain`; type rename)
- Modify: `src/components/live/Telemetry.tsx` (live quality source; type rename)
- Modify: `src/components/live/Feed.tsx` (type rename only — `LiveFrame` → `CaptureFrame`)
- Modify: `src/components/live/LiveDataDisclosure.tsx` (type rename only — `LiveFrame` → `CaptureFrame`)
- Modify: `src/components/live/LiveView.tsx` (teardown order; live quality; type rename)

**Interfaces:**
- Consumes: `LiveSnapshotState` (Task 3); `useFramePoll` (Task 3); `session.sessionGeneration` + `SessionStatus.sessionGeneration` (Task 1).
- Produces: `CaptureFrame` (renamed type); `toCaptureFrame(...)`; `useWatchLoop` returning `{ stopAndDrain }`.

(`SessionStatus.sessionGeneration` was already added on both server and client in Task 1 — this task does not re-add it.)

- [ ] **Step 1: Write/Update the failing tests**

Update `src/live/logic.test.ts`: replace `import type { LiveFrame, ... }` with `import type { CaptureFrame, ... }`, every `LiveFrame` annotation with `CaptureFrame`, and every `toLiveFrame(` call with `toCaptureFrame(`. The assertions are unchanged.

- [ ] **Step 2: Run to verify they fail**

Run: `npm test` → FAIL (`toCaptureFrame`/`CaptureFrame` not exported).

- [ ] **Step 3: Rename the type and the mapper across EVERY referencing file**

`tsconfig.json` has `"include": ["src"]` with `strict: true`, so `npm run build` type-checks all of `src` — a single missed reference fails the build. `grep -rn "LiveFrame\|toLiveFrame" src/` returns hits in **seven** non-test files; rename in all of them:

- `src/live/types.ts` — `export interface LiveFrame {` → `export interface CaptureFrame {` (leave all fields; the `liveTemplate` field is added in Task 5).
- `src/live/logic.ts` — `export function toLiveFrame(` → `export function toCaptureFrame(`; return type `): LiveFrame {` → `): CaptureFrame {`; the `import type { ... LiveFrame ... }`; and every `LiveFrame` annotation in `computeVerdict`, `deriveGuidance`, `guidanceFor`.
- `src/live/useWatchLoop.ts` — `import { toLiveFrame }` → `toCaptureFrame`; `import type { LiveFrame, ... }` → `CaptureFrame`; `onFrame: (f: LiveFrame) => void` → `CaptureFrame`; the `onFrame(toLiveFrame(...))` call → `toCaptureFrame`.
- `src/components/live/Telemetry.tsx` — `import type { LiveFrame, ... }` → `CaptureFrame`; the `frame: LiveFrame | null` prop.
- `src/components/live/Feed.tsx` — `import type { LiveFrame, Verdict }` → `CaptureFrame`; the `frame: LiveFrame | null` prop. **(This file was rewritten in Task 3 and still imports `LiveFrame` — it MUST be renamed here or the build fails.)**
- `src/components/live/LiveDataDisclosure.tsx` — `import type { LiveFrame }` → `CaptureFrame`; the `{ frame: LiveFrame | null }` annotation. **(Untouched by Tasks 0–3, so easy to miss — it is the second orphan that fails `tsc -b`.)**
- `src/components/live/LiveView.tsx` — `import type { LiveFrame, LiveThresholds }` → `CaptureFrame`; `useState<LiveFrame | null>(null)` → `CaptureFrame`.

Also update `src/live/logic.test.ts` per Step 1 (already covered).

- [ ] **Step 4: Update `useWatchLoop` — rename + AbortController + `stopAndDrain`**

In `src/live/useWatchLoop.ts`: change the import/annotations `LiveFrame` → `CaptureFrame` and `toLiveFrame` → `toCaptureFrame`. **Also change the function's return-type annotation** from `export function useWatchLoop(opts: Options): void {` to `export function useWatchLoop(opts: Options): { stopAndDrain: () => Promise<void> } {` — the hook now returns a value, so the `: void` annotation must change or `tsc` fails. Add an `AbortController` threaded into the fetch and a `stopAndDrain`. Replace the hook body's refs + return with:

```ts
  const runningRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const inFlightRef = useRef<Promise<unknown> | null>(null);

  const stopAndDrain = async () => {
    runningRef.current = false;
    abortRef.current?.abort();
    try { await inFlightRef.current; } catch { /* abort/expected */ }
  };
  const stopRef = useRef(stopAndDrain);
  stopRef.current = stopAndDrain;
```

Wrap each `api.capture(...)` / `api.match(...)` call so its promise is retained (`inFlightRef.current = p; const cap = await p;`) and pass the abort signal via a new `signal` option on the api methods (add `signal?: AbortSignal` to `api.capture`/`api.match` in `src/api.ts`, forwarding it as `fetch`'s `signal`). Return `{ stopAndDrain: () => stopRef.current() }` from the hook, and in the effect cleanup call `void stopRef.current()` instead of only flipping the boolean.

In `src/api.ts`, extend `request`/`post` to accept and pass a `signal`. Minimal change: add an optional 2nd arg to `post` and the capture/match wrappers:

```ts
function post<T>(path: string, payload?: unknown, signal?: AbortSignal): Promise<T> {
  return request<T>(path, { method: "POST", body: JSON.stringify(payload ?? {}), signal });
}
```

and `capture: (req, signal?) => post<{ result: CaptureResult }>("/api/capture", req, signal)` (same for `match`).

- [ ] **Step 5: Telemetry split + live quality + teardown order in `LiveView`**

In `src/components/live/Telemetry.tsx`: change `import type { LiveFrame, ... }` → `CaptureFrame`; add a prop `liveQuality?: number | null`; change the Quality `<Bar>` `value` to `value={liveQuality ?? frame?.quality ?? null}` so it streams from the live snapshot when present, falling back to the final-result quality. Liveness/Match/verdict bars stay on `frame` (`CaptureFrame`) — unchanged.

In `src/components/live/LiveView.tsx`:
- Capture the watch-loop drain: `const { stopAndDrain: stopWatch } = useWatchLoop({...});` (already returns `{ stopAndDrain }` after Step 4).
- Pass live quality to Telemetry: `<Telemetry ... liveQuality={liveSnapshot?.quality ?? null} />`.
- Replace `endSession`'s body order with the authoritative teardown sequence:

```ts
  const endSession = useCallback(async () => {
    setWatching(false);
    await stopFrames();   // 1. stop Lane 1, await in-flight frame request
    await stopWatch();    // 2. abort + drain Lane 2 (capture/match)
    try {
      await api.disconnect(); // 3. server flips #closing, drains frame-reads, disposes
    } catch (e) {
      onError(e instanceof ApiError ? e.detail : { name: "Error", message: String(e), httpStatus: 500 });
    }
    setFrame(null);       // 4. clear client state
    setRefTemplate(null);
    setScene("idle");
    onClearParams?.();
    onSessionChange?.();
  }, [onError, onSessionChange, onClearParams, stopFrames, stopWatch]);
```

- [ ] **Step 6: Run all tests + type-check + mock E2E**

Run: `deno test --allow-env --allow-read server/` → PASS (unchanged — Task 4 touches no server files).
Run: `npm test` → PASS (renamed logic suite + Task 3 suites).
Run: `npm run build` → no type errors.
Manual mock E2E: Go Live + approach + watch; the **Quality** bar updates smoothly per-frame (live), while **Liveness/Match/verdict** update per capture op. End session: no console errors; reconnect works (generation advances; stale snapshots dropped).

- [ ] **Step 7: Commit**

```bash
git add src/live/types.ts src/live/logic.ts src/live/logic.test.ts src/live/useWatchLoop.ts src/components/live/Telemetry.tsx src/components/live/Feed.tsx src/components/live/LiveDataDisclosure.tsx src/components/live/LiveView.tsx src/api.ts
git commit -m "feat(live): stream live quality from snapshot, split CaptureFrame verdict, drain both lanes on teardown"
```

---

## Task 5: Capture-and-hold reference (separate — does not block 1–4)

Add a kiosk-friendly "Use current face → reference" that reuses the **latest finalized template** already held from Lane 2 — it does NOT launch another capture op (no contention). Keep the existing upload path.

**Files:**
- Modify: `src/components/live/ActionDock.tsx`
- Modify: `src/components/live/LiveView.tsx`

**Interfaces:**
- Consumes: the most recent finalized `CaptureFrame` template (already produced by `useWatchLoop`'s capture).
- Produces: `ActionDock` prop `onUseCurrentFace: () => void` and `canUseCurrentFace: boolean`.

- [ ] **Step 1: Expose the finalized live template on `CaptureFrame`**

`CaptureFrame` does not currently carry the raw live template (only `matchScore`/`matchPassed`). Add it. In `src/live/types.ts`, add to `CaptureFrame`:

```ts
  /** The finalized live template (base64), so a reference can be held without a new op. */
  liveTemplate: string | null;
```

In `src/live/logic.ts`, set it in `toCaptureFrame`:

```ts
    liveTemplate: cap.template?.data ?? null,
```

(Add it alongside the other mapped fields. Existing `logic.test.ts` cases still pass — the new field is `null` in the no-template case and a string when a template is present; add `expect(f.liveTemplate).toBe("LIVE")` to the first `toCaptureFrame` test to lock it in.)

- [ ] **Step 2: Retain the latest finalized template + add the handler in `LiveView`**

In `src/components/live/LiveView.tsx`, add state `const [lastTemplate, setLastTemplate] = useState<string | null>(null);`. Change the `useWatchLoop` `onFrame` to also record the template:

```ts
    onFrame: (f) => { setFrame(f); if (f.liveTemplate) setLastTemplate(f.liveTemplate); },
```

Add a handler that **reuses** the held template (no new device op):

```ts
  const useCurrentFace = useCallback(() => {
    if (lastTemplate) setRefTemplate(lastTemplate);
  }, [lastTemplate]);
```

Clear `lastTemplate` in `endSession` (alongside the other clears): `setLastTemplate(null);`.

- [ ] **Step 3: Add the button to `ActionDock`**

In `src/components/live/ActionDock.tsx`, add props `onUseCurrentFace: () => void;` and `canUseCurrentFace: boolean;`. In the `refchip` (the not-`hasReference` branch), add beside "Set reference…":

```tsx
            <button className="link-btn" disabled={!canUseCurrentFace} onClick={onUseCurrentFace}>
              Use current face
            </button>
```

Pass the props from `LiveView`'s `<ActionDock ... onUseCurrentFace={useCurrentFace} canUseCurrentFace={lastTemplate !== null} />`.

- [ ] **Step 4: Verify (mock E2E) + commit**

Manual mock E2E: Go Live + good scenario + watch; "Use current face" becomes enabled once a capture finalizes; tapping it sets the reference and the Match bar activates — without a visible extra capture. Clear reference and disconnect both wipe it (in-memory only).

Run: `npm run build` → no type errors.

```bash
git add src/components/live/ActionDock.tsx src/components/live/LiveView.tsx
git commit -m "feat(live): capture-and-hold reference reusing the last finalized template"
```

---

## Task 6: Derived brightness/distance hints (separate — does not block 1–4)

Browser-side, throttled, clearly labeled "derived, not HID-measured", visually separate from the measured telemetry bars.

**Files:**
- Create: `src/live/derived.ts`
- Create: `src/live/derived.test.ts`
- Create: `src/components/live/DerivedHints.tsx`
- Modify: `src/components/live/Feed.tsx` (add `onNaturalSize` callback)
- Modify: `src/components/live/LiveView.tsx`
- Modify: `src/styles.css`

**Interfaces:**
- Consumes: the rendered frame pixels (via an offscreen canvas) and `LiveSnapshotState.boundingBox`.
- Produces: `meanLuminance(rgba: Uint8ClampedArray): number` (0–1); `distanceHint(box, frameArea): "near"|"ok"|"far"|null`; `<DerivedHints brightness distance />`.

- [ ] **Step 1: Write the failing pure-logic tests**

Create `src/live/derived.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { distanceHint, meanLuminance } from "./derived.ts";

describe("derived hints (pure)", () => {
  it("computes mean luminance 0–1 from RGBA", () => {
    const white = new Uint8ClampedArray([255, 255, 255, 255, 255, 255, 255, 255]);
    expect(meanLuminance(white)).toBeCloseTo(1);
    const black = new Uint8ClampedArray([0, 0, 0, 255, 0, 0, 0, 255]);
    expect(meanLuminance(black)).toBeCloseTo(0);
  });
  it("classifies distance from bbox area fraction", () => {
    expect(distanceHint({ x: 0, y: 0, width: 10, height: 10 }, 1_000_000)).toBe("far");
    expect(distanceHint({ x: 0, y: 0, width: 900, height: 1600 }, 1080 * 1920)).toBe("near");
    expect(distanceHint(null, 1)).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test` → FAIL (module not found).

- [ ] **Step 3: Implement `derived.ts`**

```ts
/** DERIVED-only hints (NOT HID-measured). Brightness = mean Rec.601 luma off the
 *  rendered frame; distance = bbox-area fraction proxy. Both must be labeled. */
export function meanLuminance(rgba: Uint8ClampedArray): number {
  let sum = 0, n = 0;
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    sum += (0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2]) / 255;
    n++;
  }
  return n === 0 ? 0 : sum / n;
}

export function distanceHint(
  box: { x: number; y: number; width: number; height: number } | null,
  frameArea: number,
): "near" | "ok" | "far" | null {
  if (!box || frameArea <= 0) return null;
  const frac = (box.width * box.height) / frameArea;
  if (frac < 0.05) return "far";
  if (frac > 0.35) return "near";
  return "ok";
}
```

- [ ] **Step 4: Run to verify green**

Run: `npm test` → PASS.

- [ ] **Step 5: Add the `DerivedHints` component + throttled computation**

Create `src/components/live/DerivedHints.tsx`:

```tsx
interface Props { brightness: number | null; distance: "near" | "ok" | "far" | null }

/** Visually distinct from the measured bars — these are inferred in-UI. */
export function DerivedHints({ brightness, distance }: Props) {
  if (brightness == null && distance == null) return null;
  return (
    <div className="derived">
      <span className="derived-tag">Derived · not HID-measured</span>
      {brightness != null && <span className="derived-item">Brightness {Math.round(brightness * 100)}%</span>}
      {distance != null && <span className="derived-item">Distance: {distance}</span>}
    </div>
  );
}
```

First, let `Feed` report the frame's natural dimensions up so `LiveView` can compute the frame area for the distance proxy. In `src/components/live/Feed.tsx`, add an optional prop `onNaturalSize?: (s: { w: number; h: number }) => void;` and call it from the existing `onLoad` handler right after `setNat(...)`:

```tsx
              onLoad={(e) => {
                const s = { w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight };
                setNat(s);
                onNaturalSize?.(s);
              }}
```

In `src/components/live/LiveView.tsx`, add imports and state:

```ts
import { distanceHint, meanLuminance } from "../../live/derived.ts";
import { DerivedHints } from "./DerivedHints.tsx";
```

```ts
  const [brightness, setBrightness] = useState<number | null>(null);
  const [frameNat, setFrameNat] = useState<{ w: number; h: number } | null>(null);
  const frameTickRef = useRef(0);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
```

Add a throttled brightness effect (every 8th frame; samples a downscaled 32×57 canvas to bound CPU) keyed on `videoFrame`:

```ts
  useEffect(() => {
    if (!videoFrame) return;
    if (frameTickRef.current++ % 8 !== 0) return; // throttle: ~1 of 8 frames
    const img = new Image();
    img.onload = () => {
      const cv = (canvasRef.current ??= document.createElement("canvas"));
      cv.width = 32; cv.height = 57; // tiny, ~9:16; just for a luminance estimate
      const ctx = cv.getContext("2d", { willReadFrequently: true });
      if (!ctx) return;
      ctx.drawImage(img, 0, 0, cv.width, cv.height);
      setBrightness(meanLuminance(ctx.getImageData(0, 0, cv.width, cv.height).data));
    };
    img.src = `data:image/${videoFrame.datatype === "jpg" ? "jpeg" : videoFrame.datatype};base64,${videoFrame.data}`;
  }, [videoFrame]);

  const distance = distanceHint(
    liveSnapshot?.boundingBox ?? null,
    frameNat ? frameNat.w * frameNat.h : 0,
  );
```

Pass `onNaturalSize={setFrameNat}` on the existing `<Feed .../>`, and render the hints below the telemetry block:

```tsx
      <DerivedHints brightness={brightness} distance={distance} />
```

- [ ] **Step 6: Add minimal styling**

In `src/styles.css`:

```css
.derived { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin-top: 8px;
  padding: 8px 12px; border: 1px dashed hsl(var(--border)); border-radius: 10px;
  background: hsl(var(--muted) / 0.4); }
.derived-tag { font-size: 11px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase;
  color: hsl(var(--muted-foreground)); }
.derived-item { font-size: 13px; color: hsl(var(--foreground)); }
```

- [ ] **Step 7: Verify + commit**

Run: `npm test` → PASS. Run: `npm run build` → no type errors.
Manual mock E2E: the derived row appears, clearly labeled, separate from the measured bars; values update at a throttled cadence (not every frame).

```bash
git add src/live/derived.ts src/live/derived.test.ts src/components/live/DerivedHints.tsx src/components/live/Feed.tsx src/components/live/LiveView.tsx src/styles.css
git commit -m "feat(live): derived brightness/distance hints (labeled, not HID-measured)"
```

---

## Final verification (after all tasks)

- [ ] `deno test --allow-env --allow-read server/` → all PASS
- [ ] `deno check server/main.ts` → PASS
- [ ] `npm test` → all PASS
- [ ] `npm run build` → no type errors
- [ ] Mock-mode E2E (the primary dev path): `deno task dev:mock` + `npm run dev` → Go Live → **approach** scenario → Start watching. Confirm: full-frame feed renders; bbox + landmark overlay (3 dots in mock, 5 on device) tracks on the frame and clears immediately on no-face (no ghost box); Quality bar streams live; Liveness/Match/verdict update per op (fail-closed); positioning guidance updates live; capture-and-hold sets a reference with no extra capture; derived hints labeled and throttled; End session drains cleanly (no console errors), reconnect advances the generation.
- [ ] On-device verification (operator-run, separate): real ~8 fps feed at 1080×1920; overlay registration correct on the live frame; teardown drains with no use-after-dispose; measure base64 throughput/CPU and note whether the binary-endpoint fallback is warranted.
