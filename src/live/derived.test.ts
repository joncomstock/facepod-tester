import { describe, expect, it } from "vitest";
import { distanceHint, meanLuminance } from "./derived.ts";

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
});
