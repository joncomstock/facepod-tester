/** All user-tunable gates, edited in the Settings modal. timeoutMs is kept as a
 *  string for the text input ("" = use the default). */
export interface Thresholds {
  minimalQuality: number;
  maximalSpoofScore: number;
  minimalMatchScore: number;
  timeoutMs: string;
}

export const DEFAULT_THRESHOLDS: Thresholds = {
  minimalQuality: 0.7,
  maximalSpoofScore: 0.5,
  minimalMatchScore: 0.7,
  timeoutMs: "",
};

/** Parse the capture-timeout input → ms, or undefined when blank/invalid. */
export function parseTimeoutMs(timeoutMs: string): number | undefined {
  const t = timeoutMs.trim();
  if (t === "") return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}
