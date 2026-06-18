import { describe, expect, it } from "vitest";
import { mapBox, mapPoint } from "./overlay.ts";

describe("overlay mapping (device raster → 9:16 box percentages)", () => {
  it("maps a box to percentages of the natural frame dims", () => {
    // 1080×1920 device raster, a centered-ish box.
    const b = mapBox({ x: 540, y: 960, width: 270, height: 480 }, 1080, 1920);
    expect(b.leftPct).toBeCloseTo(50);
    expect(b.topPct).toBeCloseTo(50);
    expect(b.widthPct).toBeCloseTo(25);
    expect(b.heightPct).toBeCloseTo(25);
  });
  it("maps a landmark point", () => {
    const p = mapPoint({ x: 270, y: 480 }, 1080, 1920);
    expect(p.leftPct).toBeCloseTo(25);
    expect(p.topPct).toBeCloseTo(25);
  });
});
