import { assert, assertEquals, assertRejects } from "@std/assert";
import {
  type CaptureResult,
  type FaceModuleClient,
  FaceModuleLifecycle,
  FACEPOD_DEFAULTS,
  type VideoFrame,
} from "@eai/hid/facepod";
import { FacePodSession, type LifecycleFactory } from "./facepodSession.ts";
import type { ResolvedConfig } from "./config.ts";

const MOCK_CONFIG: ResolvedConfig = {
  mock: true,
  mockScenario: "good",
};

const frame = (seq: bigint): VideoFrame => ({
  bytes: new Uint8Array([Number(seq)]),
  format: "png",
  seq,
});

/** Minimal client whose getVideoFrame hands back the supplied promises in order. */
function frameClient(frames: Promise<VideoFrame>[]): FaceModuleClient {
  let i = 0;
  return {
    getInfo: () =>
      Promise.resolve({
        deviceId: "SLOW-FRAME",
        deviceRole: [],
        deviceType: "device",
        version: "0.0.0.0",
      }),
    getParameters: () => Promise.resolve({} as never),
    getVideoFrame: () =>
      i < frames.length ? frames[i++] : Promise.resolve(null),
    getCameraList: () => Promise.resolve([]),
    openCameraContext: () => Promise.resolve(),
    closeCameraContext: () => Promise.resolve(),
    captureAndProcess: () =>
      Promise.resolve({
        quality: 0,
        numberOfFaces: 0,
        liveness: { spoofScore: 0, passed: true },
        isCaptured: false,
      }),
    processImage: () =>
      Promise.resolve({ quality: 0, numberOfFaces: 0, isCaptured: false }),
    matchWithTemplate: () => Promise.resolve({ match: false, matchScore: 0 }),
    captureHighRes: () => Promise.resolve({ hasImage: false, quality: 0, numberOfFaces: 0 }),
    setParameters: () => Promise.resolve({ results: {} }),
  };
}

Deno.test("connect/disconnect happy path (mock) toggles connected state", async () => {
  const s = new FacePodSession();
  assertEquals(s.connected, false);

  const info = await s.connect(MOCK_CONFIG);
  assertEquals(info.deviceId, "MOCK-FACEPOD-0001");
  assertEquals(s.connected, true);
  assertEquals(s.status().status, "OK");
  assertEquals(s.status().mock, true);
  // Mock mode reports no live FFI knobs.
  assertEquals(s.status().dllPath, null);

  await s.disconnect();
  assertEquals(s.connected, false);
  assertEquals(s.status().mock, false);
});

Deno.test("openCamera is idempotent (never double-opens)", async () => {
  const s = new FacePodSession();
  await s.connect(MOCK_CONFIG);
  await s.openCamera();
  assertEquals(s.status().cameraOpen, true);
  // Second open must not throw / re-open.
  const r = await s.openCamera();
  assertEquals(r.cameraOpen, true);
  assertEquals(s.status().cameraOpen, true);
  await s.disconnect();
});

Deno.test("setMockScenario switches mock behaviour live (no reconnect)", async () => {
  const s = new FacePodSession();
  await s.connect(MOCK_CONFIG);
  await s.openCamera();

  // good (default): high quality, captured.
  const good = await s.capture({ minimalQuality: 0.5, maximalSpoofScore: 0.5 });
  assertEquals(good.quality, 0.92);
  assertEquals(good.isCaptured, true);
  assertEquals(s.status().scenario, "good");

  // Flip to spoof — next capture fails liveness, no reconnect.
  s.setMockScenario("spoof");
  assertEquals(s.status().scenario, "spoof");
  const spoofed = await s.capture({
    minimalQuality: 0.5,
    maximalSpoofScore: 0.5,
  });
  assertEquals(spoofed.liveness.passed, false);
  assertEquals(spoofed.isCaptured, false);

  // Flip to no-face — no template produced.
  s.setMockScenario("no-face");
  const empty = await s.capture({ minimalQuality: 0.5 });
  assertEquals(empty.numberOfFaces, 0);
  assertEquals(empty.template, undefined);

  await s.disconnect();
});

Deno.test("setMockScenario requires a connected session", () => {
  const s = new FacePodSession();
  let threw = false;
  try {
    s.setMockScenario("spoof");
  } catch (e) {
    threw = true;
    assertEquals((e as Error).name, "NotConnectedError");
  }
  assertEquals(threw, true);
});

Deno.test("concurrent operations are rejected with BusyError (409)", async () => {
  const s = new FacePodSession();
  await s.connect(MOCK_CONFIG);
  await s.openCamera();

  // Fire two captures in the same tick — the busy guard acquires synchronously,
  // so exactly one proceeds and the other is rejected.
  const settled = await Promise.allSettled([
    s.capture({ minimalQuality: 0.5 }),
    s.capture({ minimalQuality: 0.5 }),
  ]);

  const fulfilled = settled.filter((r) => r.status === "fulfilled");
  const rejected = settled.filter((r) => r.status === "rejected");
  assertEquals(fulfilled.length, 1);
  assertEquals(rejected.length, 1);
  assertEquals((rejected[0] as PromiseRejectedResult).reason.name, "BusyError");

  await s.disconnect();
});

Deno.test("failed connect leaves no live session and disposes the client", async () => {
  let closed = false;
  let getInfoCalls = 0;

  // Probe (fp.connect → getInfo) succeeds; the explicit post-connect getInfo
  // throws. The session must NOT end up connected, and must dispose the client.
  const failingClient: FaceModuleClient = {
    getInfo: () => {
      getInfoCalls++;
      if (getInfoCalls === 1) {
        return Promise.resolve({
          deviceId: "probe-ok",
          deviceRole: [],
          deviceType: "device",
          version: "0.0.0.0",
        });
      }
      return Promise.reject(
        Object.assign(new Error("boom"), { name: "FaceModuleApiError" }),
      );
    },
    getCameraList: () => Promise.resolve([]),
    getParameters: () => Promise.resolve({} as never),
    getVideoFrame: () => Promise.resolve(null),
    openCameraContext: () => Promise.resolve(),
    closeCameraContext: () => Promise.resolve(),
    captureAndProcess: () =>
      Promise.resolve({
        quality: 0,
        numberOfFaces: 0,
        liveness: { spoofScore: 0, passed: true },
        isCaptured: false,
      }),
    processImage: () =>
      Promise.resolve({ quality: 0, numberOfFaces: 0, isCaptured: false }),
    matchWithTemplate: () => Promise.resolve({ match: false, matchScore: 0 }),
    captureHighRes: () => Promise.resolve({ hasImage: false, quality: 0, numberOfFaces: 0 }),
    setParameters: () => Promise.resolve({ results: {} }),
    close: () => {
      closed = true;
    },
  };

  // Inject a lifecycle backed by the failing client (transport-agnostic: this
  // exercises the session's cleanup logic, not the FFI factory).
  const factory: LifecycleFactory = () =>
    Promise.resolve(
      new FaceModuleLifecycle({ ...FACEPOD_DEFAULTS }, failingClient),
    );

  const s = new FacePodSession(factory);
  await assertRejects(
    () => s.connect({ mock: false, mockScenario: "good" }),
    Error,
    "boom",
  );

  assertEquals(s.connected, false);
  assertEquals(s.status().status, "disconnected");
  assertEquals(closed, true, "client.close() should have run during cleanup");
});

Deno.test("getParameters returns device parameters when camera open", async () => {
  const s = new FacePodSession();
  await s.connect(MOCK_CONFIG);
  await s.openCamera();
  const p = await s.getParameters();
  assertEquals(p.recMinVerifyTemplateQuality, 0.65);
});

Deno.test("getParameters throws when not connected", async () => {
  const s = new FacePodSession();
  // No connect → #require() throws NotConnectedError.
  await assertRejects(() => s.getParameters());
});

Deno.test("getParameters throws when connected but camera not open", async () => {
  const s = new FacePodSession();
  await s.connect(MOCK_CONFIG);
  // Camera not opened → #requireOpen() throws.
  await assertRejects(() => s.getParameters());
  await s.disconnect();
});

Deno.test("live mode (no override) routes through createFaceModuleFfi (USB/FFI only)", async () => {
  // Off Windows, the real FFI factory fails fast in resolveRealSdk — that error
  // proves the live path goes through createFaceModuleFfi, not any REST client.
  if (Deno.build.os === "windows") return; // would attempt a real HidFace.dll load
  const s = new FacePodSession(); // default factory
  await assertRejects(
    () => s.connect({ mock: false, mockScenario: "good" }),
    Error,
    "requires Windows",
  );
  assertEquals(s.connected, false);
});

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

Deno.test("connect over a live session drains an in-flight capture instead of throwing BusyError", async () => {
  const s = new FacePodSession();
  await s.connect(MOCK_CONFIG);
  await s.openCamera();
  s.setMockScenario("approach");
  const capP = s.capture({ minimalQuality: 0.7 }); // in flight, holds the busy lock
  const info = await s.connect(MOCK_CONFIG); // reconnect over live — must NOT throw BusyError
  assertEquals(info.deviceId, "MOCK-FACEPOD-0001");
  assertEquals(s.connected, true);
  await capP.catch(() => {});
  await s.disconnect();
});

Deno.test("failed reconnect (op wedged past the drain bound) restores #closing so the frame lane recovers", async () => {
  // A capture that never settles within the drain bound forces connect()'s #track to
  // reject with BusyError. connect must NOT leave #closing stuck (it set it true via
  // #quiesceFrameLane, and the callback that resets it never ran) — else the retained
  // live session's feed is dead forever.
  let releaseCap!: () => void;
  const hangingCap = new Promise<CaptureResult>((r) => {
    releaseCap = () =>
      r({
        quality: 0,
        numberOfFaces: 0,
        liveness: { spoofScore: 0, passed: true },
        isCaptured: false,
      });
  });
  const client: FaceModuleClient = {
    getInfo: () =>
      Promise.resolve({
        deviceId: "WEDGED",
        deviceRole: [],
        deviceType: "device",
        version: "0.0.0.0",
      }),
    getParameters: () => Promise.resolve({} as never),
    getVideoFrame: () => Promise.resolve(frame(1n)),
    getCameraList: () => Promise.resolve([]),
    openCameraContext: () => Promise.resolve(),
    closeCameraContext: () => Promise.resolve(),
    captureAndProcess: () => hangingCap, // never settles until released
    processImage: () =>
      Promise.resolve({ quality: 0, numberOfFaces: 0, isCaptured: false }),
    matchWithTemplate: () => Promise.resolve({ match: false, matchScore: 0 }),
    captureHighRes: () => Promise.resolve({ hasImage: false, quality: 0, numberOfFaces: 0 }),
    setParameters: () => Promise.resolve({ results: {} }),
  };
  const factory: LifecycleFactory = () =>
    Promise.resolve(new FaceModuleLifecycle({ ...FACEPOD_DEFAULTS }, client));
  const s = new FacePodSession(factory, { drainOpMs: 50 }); // tiny bound for the test
  await s.connect({ mock: false, mockScenario: "good" });
  await s.openCamera();
  const capP = s.capture({ minimalQuality: 0.5 }); // hangs, holds the busy lock

  // Reconnect: the wedged op won't settle within 50ms → connect's #track BusyErrors.
  await assertRejects(() => s.connect({ mock: false, mockScenario: "good" }), Error);

  // The frame lane must be RESTORED on the retained session — not stuck closed.
  const r = await s.readFrame(-1n);
  assert(r.frame !== null, "frame lane must recover after a failed reconnect");

  releaseCap();
  await capP.catch(() => {});
  await s.disconnect();
});

Deno.test("teardown refuses to dispose while a frame read is still in flight (seam contract)", async () => {
  // A getVideoFrame read that never settles within the frame-drain bound must NOT be
  // disposed under — disconnect retains the session and rejects instead.
  let releaseRead!: () => void;
  const hangingRead = new Promise<VideoFrame>((r) => {
    releaseRead = () => r(frame(1n));
  });
  const client: FaceModuleClient = {
    getInfo: () =>
      Promise.resolve({
        deviceId: "HUNG-READ",
        deviceRole: [],
        deviceType: "device",
        version: "0.0.0.0",
      }),
    getParameters: () => Promise.resolve({} as never),
    getVideoFrame: () => hangingRead, // never settles until released
    getCameraList: () => Promise.resolve([]),
    openCameraContext: () => Promise.resolve(),
    closeCameraContext: () => Promise.resolve(),
    captureAndProcess: () =>
      Promise.resolve({
        quality: 0,
        numberOfFaces: 0,
        liveness: { spoofScore: 0, passed: true },
        isCaptured: false,
      }),
    processImage: () =>
      Promise.resolve({ quality: 0, numberOfFaces: 0, isCaptured: false }),
    matchWithTemplate: () => Promise.resolve({ match: false, matchScore: 0 }),
    captureHighRes: () => Promise.resolve({ hasImage: false, quality: 0, numberOfFaces: 0 }),
    setParameters: () => Promise.resolve({ results: {} }),
  };
  const factory: LifecycleFactory = () =>
    Promise.resolve(new FaceModuleLifecycle({ ...FACEPOD_DEFAULTS }, client));
  const s = new FacePodSession(factory, { drainFrameMs: 50 }); // tiny bound for the test
  await s.connect({ mock: false, mockScenario: "good" });
  await s.openCamera();
  const rp = s.readFrame(-1n); // in flight, never settles

  // Drain bound expires with the read pending → disconnect must reject, NOT dispose.
  await assertRejects(() => s.disconnect(), Error);
  assertEquals(s.connected, true, "session retained — not disposed mid-read");

  releaseRead();
  await rp;
  await s.disconnect(); // now the read has settled → drains and disposes cleanly
  assertEquals(s.connected, false);
});

Deno.test("readFrame propagates a real read failure (records lastError + throws, not a silent 'no frame')", async () => {
  const client: FaceModuleClient = {
    getInfo: () =>
      Promise.resolve({
        deviceId: "READ-ERR",
        deviceRole: [],
        deviceType: "device",
        version: "0.0.0.0",
      }),
    getParameters: () => Promise.resolve({} as never),
    getVideoFrame: () =>
      Promise.reject(
        Object.assign(new Error("frame read boom"), {
          name: "FaceModuleApiError",
        }),
      ),
    getCameraList: () => Promise.resolve([]),
    openCameraContext: () => Promise.resolve(),
    closeCameraContext: () => Promise.resolve(),
    captureAndProcess: () =>
      Promise.resolve({
        quality: 0,
        numberOfFaces: 0,
        liveness: { spoofScore: 0, passed: true },
        isCaptured: false,
      }),
    processImage: () =>
      Promise.resolve({ quality: 0, numberOfFaces: 0, isCaptured: false }),
    matchWithTemplate: () => Promise.resolve({ match: false, matchScore: 0 }),
    captureHighRes: () => Promise.resolve({ hasImage: false, quality: 0, numberOfFaces: 0 }),
    setParameters: () => Promise.resolve({ results: {} }),
  };
  const factory: LifecycleFactory = () =>
    Promise.resolve(new FaceModuleLifecycle({ ...FACEPOD_DEFAULTS }, client));
  const s = new FacePodSession(factory);
  await s.connect({ mock: false, mockScenario: "good" });
  await s.openCamera();

  // A real read failure must PROPAGATE (→ error response → UI onError), not be masked
  // as a silent frame:null. It is also recorded for GET /api/status.
  await assertRejects(() => s.readFrame(-1n), Error, "frame read boom");
  const err = s.status().lastError;
  assert(err !== null, "a thrown read error must be recorded, not silently masked");
  assertEquals(err?.message, "frame read boom");
  await s.disconnect();
});

Deno.test("teardown drains ALL concurrent frame reads, not just the latest", async () => {
  // Read A (issued first) resolves LATE; read B (the latest) resolves immediately.
  // The old single-#inFlightFrame drain awaited only B and would dispose while A's
  // FFI read was still live. Disconnect must wait for A.
  let resolveA!: () => void;
  let aResolved = false;
  const fA = new Promise<VideoFrame>((r) => {
    resolveA = () => {
      aResolved = true;
      r(frame(1n));
    };
  });
  const fB = Promise.resolve(frame(2n));
  const factory: LifecycleFactory = () =>
    Promise.resolve(
      new FaceModuleLifecycle({ ...FACEPOD_DEFAULTS }, frameClient([fA, fB])),
    );
  const s = new FacePodSession(factory);
  await s.connect({ mock: false, mockScenario: "good" });
  await s.openCamera();

  const rA = s.readFrame(-1n); // slow read, in flight
  const rB = s.readFrame(-1n); // latest read, resolves now
  await rB;

  let discDone = false;
  const disc = s.disconnect().then(() => {
    discDone = true;
  });
  await new Promise((r) => setTimeout(r, 50));
  assertEquals(
    discDone,
    false,
    "disconnect must still be draining the earlier read A",
  );
  assertEquals(aResolved, false);

  resolveA();
  await disc;
  await rA;
  assert(discDone && aResolved, "disconnect completes only after A settles");
  assertEquals(s.connected, false);
});

Deno.test("disconnect drains an in-flight capture instead of throwing BusyError", async () => {
  const s = new FacePodSession();
  await s.connect(MOCK_CONFIG);
  await s.openCamera();
  s.setMockScenario("approach"); // mock capture streams over ~90ms, holding #busy
  const capP = s.capture({ minimalQuality: 0.7 }); // in flight, holds the busy lock
  await s.disconnect(); // must NOT throw BusyError — drains the op first, then tears down
  assertEquals(s.connected, false);
  await capP.catch(() => {}); // let the capture settle
});

Deno.test("captureHighRes (mock) returns metadata with an id; no-face -> hasImage:false", async () => {
  const s = new FacePodSession();
  await s.connect(MOCK_CONFIG);
  await s.openCamera();

  const meta = await s.captureHighRes({ minimalQuality: 0.5 });
  assert(meta.hasImage);
  assert(typeof meta.id === "string" && meta.id.length > 0);
  assertEquals(meta.encoding, "png");

  s.setMockScenario("no-face");
  const none = await s.captureHighRes({ minimalQuality: 0.5 });
  assertEquals(none.hasImage, false);
  assertEquals(none.id, undefined);

  await s.disconnect();
});

Deno.test("takeHighResImage is one-shot and cleared on disconnect", async () => {
  const s = new FacePodSession();
  await s.connect(MOCK_CONFIG);
  await s.openCamera();
  const meta = await s.captureHighRes({ minimalQuality: 0.5 });
  assert(meta.id);

  const first = s.takeHighResImage(meta.id!);
  assert(first && first.bytes.length > 0);
  assertEquals(s.takeHighResImage(meta.id!), null); // already fetched

  const again = await s.captureHighRes({ minimalQuality: 0.5 });
  assert(again.id);
  await s.disconnect();
  assertEquals(s.takeHighResImage(again.id!), null); // cleared on teardown
});

Deno.test("captureHighRes keeps multiple ids fetchable (keyed buffer, not latest-only)", async () => {
  const s = new FacePodSession();
  await s.connect(MOCK_CONFIG);
  await s.openCamera();
  const a = await s.captureHighRes({ minimalQuality: 0.5 });
  const b = await s.captureHighRes({ minimalQuality: 0.5 });
  assert(a.id && b.id && a.id !== b.id);
  // Finding Medium-2: a second capture must NOT invalidate the first un-fetched id.
  assert(s.takeHighResImage(a.id!));
  assert(s.takeHighResImage(b.id!));
  await s.disconnect();
});
