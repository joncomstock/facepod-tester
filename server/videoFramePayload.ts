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
