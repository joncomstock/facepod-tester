import { describe, expect, it } from "vitest";
import type { CaptureResult, MatchResult } from "../api.ts";
import { barState, computeVerdict, deriveGuidance, guidanceFor, positioningGuidance, toLiveFrame } from "./logic.ts";
import type { LiveFrame, LiveThresholds } from "./types.ts";

const baseCapture: CaptureResult = {
  quality: 0.92,
  numberOfFaces: 1,
  template: { modality: "face", datatype: "hftemplate", data: "LIVE" },
  image: { modality: "face", datatype: "png", data: "AAAA" },
  liveness: { spoofScore: 0.08, passed: true },
  boundingBox: { x: 40, y: 30, width: 180, height: 220 },
  isCaptured: true,
  faceStatus: "ok",
};

describe("toLiveFrame", () => {
  it("maps a capture result into a LiveFrame with no match", () => {
    const f = toLiveFrame(baseCapture);
    expect(f.image).toEqual({ datatype: "png", data: "AAAA" });
    expect(f.quality).toBe(0.92);
    expect(f.spoofScore).toBe(0.08);
    expect(f.livenessPassed).toBe(true);
    expect(f.numberOfFaces).toBe(1);
    expect(f.boundingBox).toEqual({ x: 40, y: 30, width: 180, height: 220 });
    expect(f.isCaptured).toBe(true);
    expect(f.matchScore).toBeNull();
    expect(f.matchPassed).toBeNull();
  });

  it("includes match fields when a match result is supplied", () => {
    const match: MatchResult = { match: true, matchScore: 0.9 };
    const f = toLiveFrame(baseCapture, match);
    expect(f.matchScore).toBe(0.9);
    expect(f.matchPassed).toBe(true);
  });

  it("nulls image/boundingBox when absent", () => {
    const f = toLiveFrame({
      quality: 0,
      numberOfFaces: 0,
      liveness: { spoofScore: 0, passed: true },
      isCaptured: false,
    });
    expect(f.image).toBeNull();
    expect(f.boundingBox).toBeNull();
  });
});

const T: LiveThresholds = {
  minimalQuality: 0.7,
  maximalSpoofScore: 0.5,
  minimalMatchScore: 0.7,
};

function frame(over: Partial<LiveFrame> = {}): LiveFrame {
  return {
    image: null,
    quality: 0.92,
    spoofScore: 0.08,
    livenessPassed: true,
    numberOfFaces: 1,
    boundingBox: { x: 0, y: 0, width: 200, height: 240 },
    isCaptured: true,
    matchScore: null,
    matchPassed: null,
    positioningFeedback: null,
    landmarks: null,
    ...over,
  };
}

const baseFrame = {
  image: null, quality: 0.9, spoofScore: 0.1, livenessPassed: true,
  numberOfFaces: 1, boundingBox: { x: 0, y: 0, width: 200, height: 240 },
  isCaptured: false, faceStatus: "ok", matchScore: null, matchPassed: null,
  positioningFeedback: null, landmarks: null,
};

describe("barState", () => {
  it("passes comfortably above threshold (higher passes)", () => {
    expect(barState(0.92, 0.7, true)).toEqual({ pct: 92, pass: true, tone: "ok" });
  });
  it("warns within margin of threshold", () => {
    expect(barState(0.73, 0.7, true).tone).toBe("warn");
  });
  it("fails below threshold (higher passes)", () => {
    expect(barState(0.5, 0.7, true)).toEqual({ pct: 50, pass: false, tone: "bad" });
  });
  it("passes when lower is better (spoof)", () => {
    expect(barState(0.08, 0.5, false)).toEqual({ pct: 8, pass: true, tone: "ok" });
  });
  it("clamps pct to 0..100", () => {
    expect(barState(1.4, 0.7, true).pct).toBe(100);
    expect(barState(-0.2, 0.7, true).pct).toBe(0);
  });
});

describe("computeVerdict", () => {
  it("searching when no face", () => {
    expect(computeVerdict(frame({ numberOfFaces: 0 }), T, false).state).toBe("searching");
  });
  it("accept when quality+liveness+captured pass and no reference", () => {
    expect(computeVerdict(frame(), T, false).state).toBe("accept");
  });
  it("reject lists failing gates", () => {
    const v = computeVerdict(frame({ quality: 0.4, livenessPassed: false }), T, false);
    expect(v.state).toBe("reject");
    expect(v.reasons).toEqual(["quality", "liveness"]);
  });
  it("requires match when a reference is set", () => {
    const ok = computeVerdict(frame({ matchScore: 0.9, matchPassed: true }), T, true);
    expect(ok.state).toBe("accept");
    const bad = computeVerdict(frame({ matchScore: 0.3, matchPassed: false }), T, true);
    expect(bad.state).toBe("reject");
    expect(bad.reasons).toEqual(["match"]);
  });
  it("acquiring when face present, nothing failing, but not captured", () => {
    expect(computeVerdict(frame({ isCaptured: false }), T, false).state).toBe("acquiring");
  });
});

describe("deriveGuidance", () => {
  it("prompts to step in when no face", () => {
    expect(deriveGuidance(frame({ numberOfFaces: 0 }))).toBe("Step in front of the camera");
  });
  it("prompts closer when the face box is small", () => {
    expect(deriveGuidance(frame({ boundingBox: { x: 0, y: 0, width: 80, height: 90 } })))
      .toBe("Move a little closer");
  });
  it("prompts to look at camera on spoof suspicion", () => {
    expect(deriveGuidance(frame({ faceStatus: "spoof_suspected" })))
      .toBe("Look directly at the camera");
  });
  it("asks to hold still when face is present but not captured", () => {
    expect(deriveGuidance(frame({ isCaptured: false }))).toBe("Hold still");
  });
  it("returns null when locked (captured, good size)", () => {
    expect(deriveGuidance(frame())).toBeNull();
  });
});

describe("positioningGuidance", () => {
  it("maps each known flag to a friendly string", () => {
    expect(positioningGuidance({ raw: 4, ok: false, flags: ["TURN_RIGHT"], unknownBits: 0 }))
      .toEqual(["Turn right"]);
    expect(positioningGuidance({ raw: 1, ok: false, flags: ["GET_CLOSER"], unknownBits: 0 }))
      .toEqual(["Move closer"]);
  });
  it("returns multiple strings for multiple flags", () => {
    expect(positioningGuidance({ raw: 36, ok: false, flags: ["LOWER_HEAD", "TURN_RIGHT"], unknownBits: 0 }))
      .toEqual(["Lower your head", "Turn right"]);
  });
  it("returns [] when ok", () => {
    expect(positioningGuidance({ raw: 0, ok: true, flags: [], unknownBits: 0 })).toEqual([]);
  });
  it("ignores unknownBits in the text", () => {
    expect(positioningGuidance({ raw: 256, ok: false, flags: [], unknownBits: 256 })).toEqual([]);
  });
});

describe("guidanceFor", () => {
  it("uses real feedback (not derived) when present and correcting", () => {
    const f = { ...baseFrame, positioningFeedback: { raw: 4, ok: false, flags: ["TURN_RIGHT"], unknownBits: 0 } };
    expect(guidanceFor(f)).toEqual({ text: "Turn right", derived: false });
  });
  it("says Hold still (real) when ok but not captured", () => {
    const f = { ...baseFrame, positioningFeedback: { raw: 0, ok: true, flags: [], unknownBits: 0 }, isCaptured: false };
    expect(guidanceFor(f)).toEqual({ text: "Hold still", derived: false });
  });
  it("returns null text (real) when ok and captured", () => {
    const f = { ...baseFrame, positioningFeedback: { raw: 0, ok: true, flags: [], unknownBits: 0 }, isCaptured: true };
    expect(guidanceFor(f)).toEqual({ text: null, derived: false });
  });
  it("falls back to derived when no feedback present", () => {
    const f = { ...baseFrame, numberOfFaces: 0, positioningFeedback: null };
    expect(guidanceFor(f)).toEqual({ text: "Step in front of the camera", derived: true });
  });
});
