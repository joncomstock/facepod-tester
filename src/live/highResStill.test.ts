// src/live/highResStill.test.ts
import { describe, expect, it } from "vitest";
import {
  canCaptureHighRes,
  highResFilename,
  INITIAL_HIGH_RES,
  nextHighResState,
} from "./highResStill.ts";

describe("highResStill state machine", () => {
  it("starts idle", () => {
    expect(INITIAL_HIGH_RES).toEqual({ status: "idle", message: null });
  });

  it("start → capturing", () => {
    expect(nextHighResState(INITIAL_HIGH_RES, { type: "start" }).status).toBe("capturing");
  });

  it("ready → ready, noFace → no-image, discard → idle", () => {
    const capturing = { status: "capturing" as const, message: null };
    expect(nextHighResState(capturing, { type: "ready" }).status).toBe("ready");
    expect(nextHighResState(capturing, { type: "noFace" }).status).toBe("no-image");
    expect(nextHighResState(capturing, { type: "discard" }).status).toBe("idle");
  });

  it("error carries a message", () => {
    const s = nextHighResState(INITIAL_HIGH_RES, { type: "error", message: "device gone" });
    expect(s).toEqual({ status: "error", message: "device gone" });
  });
});

describe("canCaptureHighRes", () => {
  it("allows capture when active and not already capturing", () => {
    expect(canCaptureHighRes(true, "idle")).toBe(true);
    expect(canCaptureHighRes(true, "ready")).toBe(true);
  });
  it("blocks when inactive or mid-capture", () => {
    expect(canCaptureHighRes(false, "idle")).toBe(false);
    expect(canCaptureHighRes(true, "capturing")).toBe(false);
  });
});

describe("highResFilename", () => {
  it("defaults to .png", () => {
    expect(highResFilename("abc", undefined)).toBe("facepod-highres-abc.png");
    expect(highResFilename("abc", "png")).toBe("facepod-highres-abc.png");
  });
  it("maps jpg/jpeg to .jpg", () => {
    expect(highResFilename("x", "jpg")).toBe("facepod-highres-x.jpg");
    expect(highResFilename("x", "jpeg")).toBe("facepod-highres-x.jpg");
  });
});
