/** Pure Live-HUD logic — no React/DOM, fully unit-tested. */
import type { CaptureResult, MatchResult } from "../api.ts";
import type { LiveFrame } from "./types.ts";

/** Fold a capture result (+ optional match) into the HUD's frame shape. */
export function toLiveFrame(
  cap: CaptureResult,
  match?: MatchResult | null,
): LiveFrame {
  return {
    image: cap.image ? { datatype: cap.image.datatype, data: cap.image.data } : null,
    quality: cap.quality,
    spoofScore: cap.liveness.spoofScore,
    livenessPassed: cap.liveness.passed,
    numberOfFaces: cap.numberOfFaces,
    boundingBox: cap.boundingBox ?? null,
    isCaptured: cap.isCaptured,
    faceStatus: cap.faceStatus,
    matchScore: match ? match.matchScore : null,
    matchPassed: match ? match.match : null,
  };
}
