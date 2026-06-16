import { assertEquals, assertRejects } from "@std/assert";
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
