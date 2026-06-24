import { describe, expect, it } from "vitest";
import { distanceHint, meanLuminance, poseFromLandmarks } from "./derived.ts";

describe("derived hints (pure)", () => {
  it("computes mean luminance 0–1 from RGBA", () => {
    const white = new Uint8ClampedArray([255, 255, 255, 255, 255, 255, 255, 255]);
    expect(meanLuminance(white)).toBeCloseTo(1);
    const black = new Uint8ClampedArray([0, 0, 0, 255, 0, 0, 0, 255]);
    expect(meanLuminance(black)).toBeCloseTo(0);
  });
  it("classifies distance from bbox area fraction", () => {
    expect(distanceHint({ x: 0, y: 0, width: 10, height: 10 }, 1_000_000)).toBe("far");
    expect(distanceHint({ x: 0, y: 0, width: 900, height: 1600 }, 1080 * 1920)).toBe("near");
    expect(distanceHint(null, 1)).toBeNull();
  });

  it("estimates a neutral pose (~0°) from symmetric, level landmarks", () => {
    const p = poseFromLandmarks([
      { type: "left_eye", x: 40, y: 100 },
      { type: "right_eye", x: 60, y: 100 },
      { type: "nose", x: 50, y: 120 }, // centered, between eye- and mouth-line midpoint
      { type: "mouth_left", x: 42, y: 140 },
      { type: "mouth_right", x: 58, y: 140 },
    ])!;
    expect(p.roll).toBeCloseTo(0);
    expect(p.yaw).toBeCloseTo(0);
    expect(p.pitch).toBeCloseTo(0);
  });

  it("reads roll from the eye-line tilt (sign-stable regardless of eye labeling)", () => {
    // image-right eye sits 20px lower than the left over a 20px span → +45°
    const tilted = poseFromLandmarks([
      { type: "left_eye", x: 40, y: 100 },
      { type: "right_eye", x: 60, y: 120 },
      { type: "nose", x: 50, y: 130 },
    ])!;
    expect(tilted.roll).toBeCloseTo(45);
  });

  it("reads yaw sign from the nose offset relative to the eye midpoint", () => {
    const right = poseFromLandmarks([
      { type: "left_eye", x: 40, y: 100 },
      { type: "right_eye", x: 60, y: 100 },
      { type: "nose", x: 58, y: 120 }, // nose right of center → +yaw
    ])!;
    expect(right.yaw!).toBeGreaterThan(0);
    expect(right.pitch).toBeNull(); // no mouth landmarks → pitch unavailable
  });

  it("returns null without both eyes, and on empty/absent input", () => {
    expect(poseFromLandmarks([{ type: "nose", x: 50, y: 120 }])).toBeNull();
    expect(poseFromLandmarks([])).toBeNull();
    expect(poseFromLandmarks(null)).toBeNull();
  });
});
