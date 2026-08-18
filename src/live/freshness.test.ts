import { describe, expect, it } from "vitest";
import { captureStaleMs, freshnessStatus } from "./freshness.ts";

describe("freshness", () => {
  it("inactive → paused", () => {
    expect(freshnessStatus({ active: false, ageMs: 10, sinceStartMs: null })).toBe("paused");
  });

  it("warming up (no data yet, within grace) → live, not a false No-signal", () => {
    expect(freshnessStatus({ active: true, ageMs: null, sinceStartMs: 200, staleAfterMs: 3000 })).toBe("live");
  });

  it("no data past grace → stale", () => {
    expect(freshnessStatus({ active: true, ageMs: null, sinceStartMs: 99999, staleAfterMs: 3000 })).toBe("stale");
  });

  it("fresh data → live; old data past threshold → stale", () => {
    expect(freshnessStatus({ active: true, ageMs: 100, sinceStartMs: 5000, staleAfterMs: 3000 })).toBe("live");
    expect(freshnessStatus({ active: true, ageMs: 99999, sinceStartMs: 99999, staleAfterMs: 3000 })).toBe("stale");
  });

  it("falls back to DEFAULT_STALE_MS when no staleAfterMs is given", () => {
    expect(freshnessStatus({ active: true, ageMs: 9999, sinceStartMs: 9999 })).toBe("stale");
  });

  it("captureStaleMs scales with the configured capture timeout (+ margin)", () => {
    expect(captureStaleMs(undefined)).toBe(3000);
    expect(captureStaleMs(4000)).toBe(5500);
  });
});
