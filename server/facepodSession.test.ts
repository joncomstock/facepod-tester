import { assert, assertEquals, assertRejects } from "@std/assert";
import {
  type FaceModuleClient,
  FaceModuleLifecycle,
  FACEPOD_DEFAULTS,
} from "@eai/hid/facepod";
import { FacePodSession, type LifecycleFactory } from "./facepodSession.ts";
import type { ResolvedConfig } from "./config.ts";

const MOCK_CONFIG: ResolvedConfig = {
  mock: true,
  mockScenario: "good",
};

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
