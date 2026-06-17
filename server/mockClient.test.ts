import { assert, assertEquals, assertRejects } from "@std/assert";
import {
  DeterministicMockClient,
  isMockScenario,
  type MockScenario,
} from "./mockClient.ts";
import type { FaceImage } from "@eai/hid/facepod";

const REF_IMAGE: FaceImage = {
  modality: "face",
  datatype: "png",
  data: "AAAA",
};

function client(scenario: MockScenario) {
  return new DeterministicMockClient(() => scenario);
}

Deno.test("isMockScenario validates known presets", () => {
  assertEquals(isMockScenario("good"), true);
  assertEquals(isMockScenario("spoof"), true);
  assertEquals(isMockScenario("device-error"), true);
  assertEquals(isMockScenario("nope"), false);
  assertEquals(isMockScenario(undefined), false);
});

Deno.test("good: high quality, live, captured", async () => {
  const r = await client("good").captureAndProcess({
    minimalQuality: 0.5,
    maximalSpoofScore: 0.5,
  });
  assertEquals(r.quality, 0.92);
  assertEquals(r.liveness.passed, true);
  assertEquals(r.isCaptured, true);
  assertEquals(r.template?.data, "MOCK::live-face-template::v1");
});

Deno.test("low-quality: quality below threshold, not captured", async () => {
  const r = await client("low-quality").captureAndProcess({
    minimalQuality: 0.5,
  });
  assertEquals(r.quality, 0.34);
  assertEquals(r.isCaptured, false);
  // template still produced; the failure is quality, not detection
  assertEquals(typeof r.template?.data, "string");
});

Deno.test("spoof: high spoof score fails liveness", async () => {
  const r = await client("spoof").captureAndProcess({
    minimalQuality: 0.5,
    maximalSpoofScore: 0.5,
  });
  assertEquals(r.liveness.spoofScore, 0.93);
  assertEquals(r.liveness.passed, false);
  assertEquals(r.isCaptured, false);
  assertEquals(r.faceStatus, "spoof_suspected");
});

Deno.test("no-face: zero faces, no template/image", async () => {
  const cap = await client("no-face").captureAndProcess({
    minimalQuality: 0.5,
  });
  assertEquals(cap.numberOfFaces, 0);
  assertEquals(cap.template, undefined);
  assertEquals(cap.image, undefined);
  assertEquals(cap.isCaptured, false);

  const proc = await client("no-face").processImage(REF_IMAGE);
  assertEquals(proc.numberOfFaces, 0);
  assertEquals(proc.template, undefined);
});

Deno.test("no-match: good capture but match score below threshold", async () => {
  const c = client("no-match");
  const cap = await c.captureAndProcess({ minimalQuality: 0.5 });
  assertEquals(cap.isCaptured, true); // capture itself succeeds
  const m = await c.matchWithTemplate(
    { modality: "face", datatype: "hftemplate", data: "x" },
    { modality: "face", datatype: "hftemplate", data: "x" },
    { minimalMatchScore: 0.5 },
  );
  assertEquals(m.matchScore, 0.28);
  assertEquals(m.match, false);
});

Deno.test("device-error: capture/process/match reject with FaceModuleApiError", async () => {
  const c = client("device-error");
  await assertRejects(
    () => c.captureAndProcess({ minimalQuality: 0.5 }),
    Error,
  );
  await assertRejects(() => c.processImage(REF_IMAGE), Error);
  await assertRejects(
    () =>
      c.matchWithTemplate(
        { modality: "face", datatype: "hftemplate", data: "a" },
        { modality: "face", datatype: "hftemplate", data: "b" },
        { minimalMatchScore: 0.5 },
      ),
    Error,
  );
  // getInfo/getCameraList still succeed so you can connect, then see the error.
  assertEquals((await c.getInfo()).deviceId, "MOCK-FACEPOD-0001");
});

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

Deno.test("getParameters returns realistic params distinct from UI defaults", async () => {
  const client = new DeterministicMockClient(() => "good");
  const p = await client.getParameters();
  assertEquals(p.recMinVerifyTemplateQuality, 0.65);
  assertEquals(p.recMaxSpoofProbability, 0.45);
  assertEquals(p.recMinMatchScoreL1, 0.8);
  assertEquals(p.encodingJpegQuality, 90);
  // all 34 fields populated (no undefined).
  assertEquals(Object.values(p).some((v) => v === undefined), false);
});
