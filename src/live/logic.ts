/** Pure Live-HUD logic — no React/DOM, fully unit-tested. */
import type { CaptureResult, MatchResult, PositioningFeedback } from "../api.ts";
import type { BarView, CaptureFrame, LiveSnapshotState, LiveThresholds, Verdict } from "./types.ts";

/** Fold a capture result (+ optional match) into the HUD's frame shape. */
export function toCaptureFrame(
  cap: CaptureResult,
  match?: MatchResult | null,
): CaptureFrame {
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
    positioningFeedback: cap.positioningFeedback ?? null,
    landmarks: cap.landmarks ?? null,
    liveTemplate: cap.template?.data ?? null,
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
  frame: CaptureFrame,
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

/** Guidance shown when no face is detected; also the breadcrumb's "neutral" text. */
export const NO_FACE_GUIDANCE = "Step in front of the camera";

export function deriveGuidance(frame: CaptureFrame): string | null {
  if (frame.numberOfFaces < 1) return NO_FACE_GUIDANCE;
  const bb = frame.boundingBox;
  if (bb && bb.width * bb.height < MIN_FACE_AREA) return "Move a little closer";
  if (frame.faceStatus === "spoof_suspected") return "Look directly at the camera";
  if (!frame.isCaptured) return "Hold still";
  return null;
}

/** Friendly string per known positioning bit. */
const POSITIONING_TEXT: Record<string, string> = {
  GET_CLOSER: "Move closer",
  MOVE_AWAY: "Move back",
  TURN_RIGHT: "Turn right",
  TURN_LEFT: "Turn left",
  LIFT_HEAD: "Lift your head",
  LOWER_HEAD: "Lower your head",
  TILT_RIGHT: "Tilt right",
  TILT_LEFT: "Tilt left",
};

/** Map decoded positioning flags to friendly strings (unknownBits excluded). */
export function positioningGuidance(fb: PositioningFeedback): string[] {
  return fb.flags.map((f) => POSITIONING_TEXT[f]).filter((s): s is string => Boolean(s));
}

/**
 * Guidance for the HUD. Prefers REAL device positioning feedback when present
 * (derived=false); otherwise falls back to the bbox/faceStatus heuristic
 * (derived=true). Real "ok" + not-captured → "Hold still"; real "ok" + captured → null.
 */
export function guidanceFor(frame: CaptureFrame): { text: string | null; derived: boolean } {
  const fb = frame.positioningFeedback;
  if (fb && frame.numberOfFaces >= 1) {
    if (!fb.ok) {
      const parts = positioningGuidance(fb);
      return { text: parts.length ? parts.join(" · ") : "Hold still", derived: false };
    }
    return { text: frame.isCaptured ? null : "Hold still", derived: false };
  }
  return { text: deriveGuidance(frame), derived: true };
}

/**
 * PER-FRAME guidance from the live snapshot (Lane 1), so guidance tracks the subject
 * in real time instead of at capture cadence. When there IS live data the snapshot is
 * AUTHORITATIVE — including the "well-positioned" case, where it returns text:null to
 * clear any stale correction left over from the last finalized capture (otherwise an
 * old "Turn right" lingers after the live snapshot reports positioning is good).
 *
 * Returns null ONLY when there is no live signal to act on (no snapshot, or a face is
 * present but the device gave no positioning bits) — then the caller falls back to the
 * capture-frame guidance, which alone knows the locked/acquiring nuance (isCaptured
 * lives on the finalized CaptureFrame, not the live snapshot).
 */
export function guidanceForSnapshot(
  snap: LiveSnapshotState | null,
): { text: string | null; derived: boolean } | null {
  if (!snap) return null;
  // A geometry-less snapshot (no faces, quality, bbox, or positioning) carries NO
  // live signal: this firmware's intermediate results stream only operation status,
  // never per-frame geometry. Defer to the capture-frame guidance rather than
  // falsely asserting "no face" while a finalized capture clearly found one.
  const hasSignal = snap.numberOfFaces >= 1 || snap.quality != null ||
    snap.boundingBox != null || snap.positioningFeedback != null;
  if (!hasSignal) return null;
  if (snap.numberOfFaces < 1) {
    return { text: NO_FACE_GUIDANCE, derived: true };
  }
  const fb = snap.positioningFeedback;
  if (fb) {
    if (!fb.ok) {
      const parts = positioningGuidance(fb);
      return { text: parts.length ? parts.join(" · ") : "Hold still", derived: false };
    }
    return { text: null, derived: false }; // well-positioned → clear any stale correction
  }
  return null; // face present but no live positioning → fall back to capture guidance
}

/** Live confidence (0–1) = 1 − spoofScore, so higher = more live (gauge-friendly). */
export function livenessConfidence(spoofScore: number): number {
  return 1 - spoofScore;
}

/** The confidence value a Liveness gauge passes at, derived from the max-spoof gate. */
export function livenessConfidenceThreshold(maximalSpoofScore: number): number {
  return 1 - maximalSpoofScore;
}

/**
 * Strict gate for adopting the CURRENT live frame as a match reference: exactly one
 * face, a finalized template, quality at/above the gate, and liveness measured AND
 * passing. Prevents a stale/low-quality cached template from qualifying.
 */
export function canUseCurrentFace(
  frame: CaptureFrame | null,
  t: LiveThresholds,
): boolean {
  if (!frame) return false;
  return (
    frame.numberOfFaces === 1 &&
    frame.liveTemplate != null &&
    frame.quality >= t.minimalQuality &&
    frame.faceStatus !== "liveness_unmeasured" &&
    frame.livenessPassed === true
  );
}

/**
 * Should an already-open device session be adopted into the live HUD on load?
 * True only when the backend reports an open camera and the HUD is still idle.
 * The caller does this exactly once per mount (a ref), which is what keeps End
 * session from bouncing back to live: it flips scene→idle before the async status
 * refresh reports cameraOpen:false, and a repeated check would otherwise re-adopt.
 */
export function shouldAdoptSession(
  status: { cameraOpen: boolean } | null,
  scene: "idle" | "connecting" | "live",
): boolean {
  return !!status?.cameraOpen && scene === "idle";
}

/**
 * Carried state for the "why did the face drop?" breadcrumb. `reason` is the last
 * actionable correction seen while a face was present; `lastPresentAt` is when the
 * face was last seen (the persistence countdown anchor); `seen` gates the breadcrumb
 * so it never shows before any face has appeared.
 */
export interface FaceLostCarry {
  reason: string | null;
  lastPresentAt: number | null;
  seen: boolean;
}

export const initialFaceLostCarry: FaceLostCarry = { reason: null, lastPresentAt: null, seen: false };

/** How long (ms) a face-loss breadcrumb lingers after the face disappears. */
export const FACE_LOST_WINDOW_MS = 5000;

/**
 * When the device suddenly reports no face, the bare "Step in front of the camera"
 * hides WHY it dropped (e.g. the head tilted out of the detection envelope). This
 * folds the latest observation into the carry and, for a few seconds after a loss,
 * surfaces the last correction instead — so a subject understands what to fix.
 *
 * Pure and idempotent for a fixed `now` (safe to call during render). The caller
 * supplies the normally-computed `baseGuidance`; this only overrides it post-loss.
 */
export function faceLostGuidance(
  carry: FaceLostCarry,
  opts: { facePresent: boolean; baseGuidance: string | null; now: number; windowMs?: number },
): { text: string | null; carry: FaceLostCarry } {
  const windowMs = opts.windowMs ?? FACE_LOST_WINDOW_MS;
  if (opts.facePresent) {
    // Remember an actionable correction; keep the prior one when currently well-positioned.
    const reason = opts.baseGuidance && opts.baseGuidance !== NO_FACE_GUIDANCE
      ? opts.baseGuidance
      : carry.reason;
    return { text: opts.baseGuidance, carry: { reason, lastPresentAt: opts.now, seen: true } };
  }
  if (carry.seen && carry.lastPresentAt != null && opts.now - carry.lastPresentAt < windowMs) {
    return {
      text: carry.reason ? `Face lost — ${carry.reason}` : "Face lost — moved out of view?",
      carry,
    };
  }
  // Window elapsed (or no face ever seen): revert to base guidance and forget the stale reason.
  return { text: opts.baseGuidance, carry: initialFaceLostCarry };
}
