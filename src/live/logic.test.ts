import { describe, expect, it } from "vitest";
import type { CaptureResult, MatchResult } from "../api.ts";
import { toLiveFrame } from "./logic.ts";

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
