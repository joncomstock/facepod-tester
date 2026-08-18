import { encodeHex } from "@std/encoding/hex";
import type { DiagnosticsResult } from "@eai/hid/facepod";

/** JSON-safe diagnostics shape (bytes → hex; the lib keeps Uint8Array). */
export interface DiagnosticsWire {
  ok: boolean;
  match: boolean;
  sentHex: string;
  receivedHex: string;
  sentLen: number;
  receivedLen: number;
}

export function toDiagnosticsWire(r: DiagnosticsResult): DiagnosticsWire {
  return {
    ok: r.ok,
    match: r.match,
    sentHex: encodeHex(r.sent),
    receivedHex: encodeHex(r.received),
    sentLen: r.sent.length,
    receivedLen: r.received.length,
  };
}
