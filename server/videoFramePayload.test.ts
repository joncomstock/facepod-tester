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
