import { describe, expect, it } from "vitest";
import { overlayDecision } from "./overlayDisplay.ts";
import type { LiveSnapshotState } from "./types.ts";

const withFace: LiveSnapshotState = {
  numberOfFaces: 1,
  quality: 0.8,
  boundingBox: { x: 40, y: 30, width: 180, height: 220 },
  landmarks: [{ x: 90, y: 110 }],
  positioningFeedback: null,
};
const opts = { fadeStartMs: 750, removeMs: 1500 };

describe("overlayDecision", () => {
  it("clears immediately when the freshest snapshot has no box (trigger 1)", () => {
    const noFace: LiveSnapshotState = { ...withFace, numberOfFaces: 0, boundingBox: null };
    expect(overlayDecision({ snapshot: noFace, snapshotAgeMs: 0, ...opts })).toBeNull();
  });
  it("shows full opacity within the inter-op gap", () => {
    const d = overlayDecision({ snapshot: withFace, snapshotAgeMs: 200, ...opts });
    expect(d?.opacity).toBe(1);
    expect(d?.box).toEqual(withFace.boundingBox);
  });
  it("fades between fadeStart and remove (trigger 2)", () => {
    const d = overlayDecision({ snapshot: withFace, snapshotAgeMs: 1125, ...opts });
    expect(d?.opacity).toBeGreaterThan(0);
    expect(d?.opacity).toBeLessThan(1);
  });
  it("removes after the remove threshold", () => {
    expect(overlayDecision({ snapshot: withFace, snapshotAgeMs: 2000, ...opts })).toBeNull();
  });
  it("clears when there is no snapshot at all", () => {
    expect(overlayDecision({ snapshot: null, snapshotAgeMs: null, ...opts })).toBeNull();
  });
});
