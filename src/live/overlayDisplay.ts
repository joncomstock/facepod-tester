/** Pure overlay clear/fade policy (spec §5.3). Two distinct triggers:
 *  (1) the freshest snapshot reports no face/box → clear immediately, regardless
 *      of age (no ghost box while an op keeps streaming face-absent snapshots);
 *  (2) snapshots stopped arriving → fade by server-computed snapshotAgeMs. */
import type { CaptureFrame, LiveSnapshotState } from "./types.ts";

export interface OverlayDecision {
  box: { x: number; y: number; width: number; height: number };
  points: { x: number; y: number }[];
  opacity: number;
}

/**
 * Overlay from the finalized capture frame (Lane 2). Used as a fallback when the
 * live snapshot carries no geometry — this firmware returns bbox/landmarks only in
 * the FINAL capture result, not the per-frame intermediate stream. Full opacity;
 * cleared (null) when the frame has no face or no box. The box is in full-frame
 * device pixels, the same raster as the displayed video frame, so it registers 1:1.
 */
export function overlayFromFrame(frame: CaptureFrame | null): OverlayDecision | null {
  if (!frame || frame.numberOfFaces < 1 || !frame.boundingBox) return null;
  return {
    box: frame.boundingBox,
    points: (frame.landmarks ?? []).map((l) => ({ x: l.x, y: l.y })),
    opacity: 1,
  };
}

export function overlayDecision(input: {
  snapshot: LiveSnapshotState | null;
  snapshotAgeMs: number | null;
  fadeStartMs: number;
  removeMs: number;
}): OverlayDecision | null {
  const { snapshot, snapshotAgeMs, fadeStartMs, removeMs } = input;
  // Trigger 1: latest snapshot says there is no face/box → clear now.
  if (!snapshot || snapshot.numberOfFaces < 1 || !snapshot.boundingBox) return null;
  // Trigger 2: snapshot has a box → fade by age.
  const age = snapshotAgeMs ?? 0;
  if (age >= removeMs) return null;
  const opacity = age <= fadeStartMs ? 1 : 1 - (age - fadeStartMs) / (removeMs - fadeStartMs);
  return { box: snapshot.boundingBox, points: snapshot.landmarks ?? [], opacity };
}
