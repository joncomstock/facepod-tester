/** Shared types for the Live HUD. Pure data — no React/DOM. */
import type { Landmark, PositioningFeedback } from "../api.ts";

export interface LiveThresholds {
  /** Quality passes when value >= this. */
  minimalQuality: number;
  /** Liveness passes when spoof score <= this (lower is more live). */
  maximalSpoofScore: number;
  /** Match passes when score >= this. Only used when a reference is set. */
  minimalMatchScore: number;
}

export interface CaptureFrame {
  /** The detected-face image from the capture result (v1 "feed"). */
  image: { datatype: string; data: string } | null;
  quality: number;
  spoofScore: number;
  livenessPassed: boolean;
  numberOfFaces: number;
  /** Full-frame coords (px) — present in v1 but not drawn (no full frame yet). */
  boundingBox: { x: number; y: number; width: number; height: number } | null;
  isCaptured: boolean;
  faceStatus?: string;
  /** null when no reference template is loaded. */
  matchScore: number | null;
  matchPassed: boolean | null;
  /** Decoded positioning feedback when the device/mock reported it; null otherwise. */
  positioningFeedback: PositioningFeedback | null;
  /** Source-frame landmark points (data only, not drawn in v1). */
  landmarks: Landmark[] | null;
  /** The finalized live template (base64), so a reference can be held without a new op. */
  liveTemplate: string | null;
}

export type VerdictState = "searching" | "acquiring" | "accept" | "reject";

export interface Verdict {
  state: VerdictState;
  /** Failing gate names for a reject, e.g. ["quality", "match"]. */
  reasons: string[];
}

export interface BarView {
  /** Fill width 0–100. */
  pct: number;
  pass: boolean;
  /** ok = passing comfortably, warn = passing within margin, bad = failing. */
  tone: "ok" | "warn" | "bad";
}

/** Per-frame live metadata (Lane 1) — drives overlay/guidance/live-quality/glow.
 *  Mirrors LiveSnapshot but with nulls instead of optionals for stable rendering. */
export interface LiveSnapshotState {
  numberOfFaces: number;
  quality: number | null;
  boundingBox: { x: number; y: number; width: number; height: number } | null;
  landmarks: { type?: string; x: number; y: number }[] | null;
  positioningFeedback: PositioningFeedback | null;
}
