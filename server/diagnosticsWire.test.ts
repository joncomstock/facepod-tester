import { assertEquals } from "@std/assert";
import { toDiagnosticsWire } from "./diagnosticsWire.ts";

Deno.test("toDiagnosticsWire hex-encodes bytes + lengths", () => {
  const w = toDiagnosticsWire({
    ok: true,
    match: true,
    sent: new Uint8Array([0x00, 0xff, 0x10]),
    received: new Uint8Array([0x00, 0xff, 0x10]),
  });
  assertEquals(w.sentHex, "00ff10");
  assertEquals(w.receivedHex, "00ff10");
  assertEquals(w.sentLen, 3);
  assertEquals(w.ok, true);
});
