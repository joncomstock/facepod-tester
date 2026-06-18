/** Pure reducers for the Lane 1 poll. lastSeq is a string (the i64 bigint is never
 *  narrowed). A snapshot from a different session generation is discarded. */
import type { FrameResponse } from "../api.ts";
import type { LiveSnapshotState } from "./types.ts";

export function nextLastSeq(prev: string, resp: FrameResponse): string {
  return resp.frame ? resp.frame.seq : prev; // hold on null — cannot stick or skip
}

export function isFreshFrame(prevSeq: string, resp: FrameResponse): boolean {
  return resp.frame != null && resp.frame.seq !== prevSeq;
}

export function snapshotForSession(
  resp: FrameResponse,
  currentGeneration: number,
): LiveSnapshotState | null {
  // currentGeneration 0 = the client hasn't synced the live generation yet (the
  // brief window right after connect, before status refreshes) — there is no prior
  // session to filter, so accept. Otherwise discard cross-session snapshots.
  if (currentGeneration !== 0 && resp.sessionGeneration !== currentGeneration) return null;
  const s = resp.snapshot;
  if (!s) return null;
  return {
    numberOfFaces: s.numberOfFaces,
    quality: s.quality ?? null,
    boundingBox: s.boundingBox ?? null,
    landmarks: s.landmarks ?? null,
    positioningFeedback: s.positioningFeedback ?? null,
  };
}
