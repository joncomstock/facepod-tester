import { describe, expect, it } from "vitest";
import { captureStaleMs, telemetryStatus, videoStatus } from "./freshness.ts";

describe("freshness", () => {
  it("telemetryStatus: not watching → paused", () => {
    expect(telemetryStatus({ watching: false, captureAgeMs: 10, sinceStartMs: null })).toBe("paused");
  });

  it("telemetryStatus: warming up (no frame yet, within grace) → live, not a false No-signal", () => {
    expect(telemetryStatus({ watching: true, captureAgeMs: null, sinceStartMs: 200, staleAfterMs: 3000 })).toBe("live");
  });

  it("telemetryStatus: no frame past grace → stale", () => {
    expect(telemetryStatus({ watching: true, captureAgeMs: null, sinceStartMs: 99999, staleAfterMs: 3000 })).toBe("stale");
  });

  it("telemetryStatus: fresh frame → live; old frame past threshold → stale", () => {
    expect(telemetryStatus({ watching: true, captureAgeMs: 100, sinceStartMs: 5000, staleAfterMs: 3000 })).toBe("live");
    expect(telemetryStatus({ watching: true, captureAgeMs: 99999, sinceStartMs: 99999, staleAfterMs: 3000 })).toBe("stale");
  });

  it("videoStatus: inactive → paused; warming up → live; stalled (non-throwing) → stale", () => {
    expect(videoStatus({ active: false, videoAgeMs: 10, sinceStartMs: null })).toBe("paused");
    expect(videoStatus({ active: true, videoAgeMs: null, sinceStartMs: 100 })).toBe("live");
    // A stalled-but-not-erroring stream is the real "No signal" case (not a hardware unplug).
    expect(videoStatus({ active: true, videoAgeMs: 9999, sinceStartMs: 9999 })).toBe("stale");
  });

  it("captureStaleMs scales with the configured capture timeout (+ margin)", () => {
    expect(captureStaleMs(undefined)).toBe(3000);
    expect(captureStaleMs(4000)).toBe(5500);
  });
});
