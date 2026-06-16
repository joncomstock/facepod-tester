/** Pure Live-HUD logic — no React/DOM, fully unit-tested. */
import type { CaptureResult, MatchResult } from "../api.ts";
import type { BarView, LiveFrame, LiveThresholds, Verdict } from "./types.ts";

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

/** Width-margin (0–1) within which a passing value is "warn" not "ok". */
const WARN_MARGIN = 0.06;

/** Bar fill + pass/tone for one metric. higherPasses=false means lower passes. */
export function barState(
  value: number,
  threshold: number,
  higherPasses: boolean,
): BarView {
  const pass = higherPasses ? value >= threshold : value <= threshold;
  const margin = Math.abs(value - threshold);
  const tone: BarView["tone"] = pass
    ? (margin < WARN_MARGIN ? "warn" : "ok")
    : "bad";
  return { pct: Math.max(0, Math.min(100, value * 100)), pass, tone };
}

/**
 * Derive the accept/reject verdict from a frame + thresholds. The same gate the
 * tester already computes, expressed as a HUD state machine:
 *   no face → searching; all gates pass + captured → accept;
 *   any hard fail → reject(reasons); otherwise (face, no fail, not captured) → acquiring.
 */
export function computeVerdict(
  frame: LiveFrame,
  t: LiveThresholds,
  hasReference: boolean,
): Verdict {
  if (frame.numberOfFaces < 1) return { state: "searching", reasons: [] };

  const qPass = frame.quality >= t.minimalQuality;
  const lPass = frame.livenessPassed;
  const mPass = hasReference ? frame.matchPassed === true : true;

  const reasons: string[] = [];
  if (!qPass) reasons.push("quality");
  if (!lPass) reasons.push("liveness");
  if (hasReference && frame.matchPassed === false) reasons.push("match");

  if (qPass && lPass && mPass && frame.isCaptured) {
    return { state: "accept", reasons: [] };
  }
  if (reasons.length > 0) return { state: "reject", reasons };
  return { state: "acquiring", reasons: [] };
}

/**
 * DERIVED positioning guidance (NOT HID-measured). The seam does not expose
 * decoded positioning feedback on FFI today (see docs/UI-FEEDBACK.md §3/§7), so
 * we infer a friendly hint from the bounding box + face status. The UI must
 * label this as "derived". Returns null when the subject looks locked.
 */
const MIN_FACE_AREA = 14_400; // px² (≈120×120); below → likely too far. Heuristic.

export function deriveGuidance(frame: LiveFrame): string | null {
  if (frame.numberOfFaces < 1) return "Step in front of the camera";
  const bb = frame.boundingBox;
  if (bb && bb.width * bb.height < MIN_FACE_AREA) return "Move a little closer";
  if (frame.faceStatus === "spoof_suspected") return "Look directly at the camera";
  if (!frame.isCaptured) return "Hold still";
  return null;
}
