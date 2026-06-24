/** Mode definitions for the FacePod Tester shell. Pure data + helpers — no React. */

export type ModeId = "verify" | "identify" | "console";

export interface ModeDef {
  id: ModeId;
  label: string;
  /** Capability slice that backs this mode; null when it's built/enabled today. */
  slice: number | null;
}

/** Display order = the mode switch order. */
export const MODES: ModeDef[] = [
  { id: "verify", label: "Verify", slice: null },
  { id: "identify", label: "Identify", slice: 4 },
  { id: "console", label: "Console", slice: 2 },
];

export function modeDef(id: ModeId): ModeDef {
  const def = MODES.find((m) => m.id === id);
  if (!def) throw new Error(`unknown mode: ${id}`);
  return def;
}

/** A mode is "coming soon" when a backing slice is still pending (slice != null). */
export function isComingSoon(id: ModeId): boolean {
  return modeDef(id).slice !== null;
}

/** Banner label for a deferred mode, or null when the mode is live. */
export function sliceLabel(id: ModeId): string | null {
  const { slice } = modeDef(id);
  return slice === null ? null : `Coming soon — Slice ${slice}`;
}
