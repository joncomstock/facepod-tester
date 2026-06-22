/** Live = fresh data flowing; paused = intentionally stopped; stale = expected but stalled. */
export type FreshnessStatus = "live" | "paused" | "stale";

const DEFAULT_STALE_MS = 2500;

/**
 * Capture-lane stale threshold derived from the configurable capture timeout: a single
 * capture can take up to timeoutMs, plus a match + loop-interval + processing margin. A
 * fixed window would wrongly flag a normal long capture as stale.
 */
export function captureStaleMs(timeoutMs: number | undefined): number {
  return (timeoutMs ?? 1500) + 1500;
}

/**
 * Capture-telemetry freshness (gauges + measured Frame Data). A just-(re)started watch with
 * no frame yet is "live" during the grace window — not a false "stale" — and the caller must
 * reset the age timestamp on start so a leftover age can't trip it. graceMs defaults to the
 * stale window.
 */
export function telemetryStatus(
  i: { watching: boolean; captureAgeMs: number | null; sinceStartMs: number | null; staleAfterMs?: number; graceMs?: number },
): FreshnessStatus {
  if (!i.watching) return "paused";
  const stale = i.staleAfterMs ?? DEFAULT_STALE_MS;
  const grace = i.graceMs ?? stale;
  if (i.captureAgeMs == null) {
    return i.sinceStartMs != null && i.sinceStartMs <= grace ? "live" : "stale";
  }
  return i.captureAgeMs > stale ? "stale" : "live";
}

/** Video-stream freshness (the feed). Same grace treatment on (re)start. */
export function videoStatus(
  i: { active: boolean; videoAgeMs: number | null; sinceStartMs: number | null; staleAfterMs?: number; graceMs?: number },
): FreshnessStatus {
  if (!i.active) return "paused";
  const stale = i.staleAfterMs ?? DEFAULT_STALE_MS;
  const grace = i.graceMs ?? stale;
  if (i.videoAgeMs == null) {
    return i.sinceStartMs != null && i.sinceStartMs <= grace ? "live" : "stale";
  }
  return i.videoAgeMs > stale ? "stale" : "live";
}
