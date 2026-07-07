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

function toHex(b: Uint8Array): string {
  let s = "";
  for (const x of b) s += x.toString(16).padStart(2, "0");
  return s;
}

export function toDiagnosticsWire(r: DiagnosticsResult): DiagnosticsWire {
  return {
    ok: r.ok,
    match: r.match,
    sentHex: toHex(r.sent),
    receivedHex: toHex(r.received),
    sentLen: r.sent.length,
    receivedLen: r.received.length,
  };
}
