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
 * Freshness of one lane (capture telemetry or the video feed), from its last-data age.
 *
 * A just-(re)started lane with no data yet is "live" during the grace window — not a false
 * "stale" — so the caller MUST reset the age timestamp on start, or a leftover age trips it.
 * graceMs defaults to the stale window.
 */
export function freshnessStatus(
  i: { active: boolean; ageMs: number | null; sinceStartMs: number | null; staleAfterMs?: number; graceMs?: number },
): FreshnessStatus {
  if (!i.active) return "paused";
  const stale = i.staleAfterMs ?? DEFAULT_STALE_MS;
  const grace = i.graceMs ?? stale;
  if (i.ageMs == null) {
    return i.sinceStartMs != null && i.sinceStartMs <= grace ? "live" : "stale";
  }
  return i.ageMs > stale ? "stale" : "live";
}
