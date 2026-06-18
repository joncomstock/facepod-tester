/** Pure overlay clear/fade policy (spec §5.3). Two distinct triggers:
 *  (1) the freshest snapshot reports no face/box → clear immediately, regardless
 *      of age (no ghost box while an op keeps streaming face-absent snapshots);
 *  (2) snapshots stopped arriving → fade by server-computed snapshotAgeMs. */
import type { LiveSnapshotState } from "./types.ts";

export interface OverlayDecision {
  box: { x: number; y: number; width: number; height: number };
  points: { x: number; y: number }[];
  opacity: number;
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
