import { assert, assertEquals, assertRejects } from "@std/assert";
import {
  DeterministicMockClient,
  isMockScenario,
  type MockScenario,
} from "./mockClient.ts";
import type { FaceImage, LiveSnapshot } from "@eai/hid/facepod";

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

Deno.test("getVideoFrame: stays live under the real poll pattern (-1 then echo last seq)", async () => {
  const c = client("good"); // a FRESH client → its own #frameSeq starts at 0
  const f1 = await c.getVideoFrame(-1n); // first poll: "latest"
  if (!f1) throw new Error("expected a first frame");
  assertEquals(f1.format, "png");
  assert(f1.bytes.length > 0, "frame must carry bytes");
  // useFramePoll then echoes the LAST returned seq on every subsequent poll. Each
  // poll must yield a strictly newer frame — the feed must NOT freeze after frame 1.
  let last = f1.seq;
  for (let i = 0; i < 5; i++) {
    const f = await c.getVideoFrame(last); // echo last seq, exactly as the client does
    if (!f) throw new Error(`feed froze at poll ${i}: got null for cursor ${last}`);
    assert(f.seq > last, `seq must advance: ${last} -> ${f.seq}`);
    last = f.seq;
  }
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
