/**
 * Configuration parsing for the FacePod tester backend.
 *
 * The tester drives the FacePod over the local USB/FFI transport only
 * (createFaceModuleFfi). Two sources feed into a resolved {@link ResolvedConfig}:
 *   1. process env (read once at startup),
 *   2. an optional per-request override sent by the UI on /api/connect.
 *
 * Everything here is pure and synchronous (no I/O) so it is trivially unit
 * testable.
 *
 * Naming convention: the tester's own env vars are FACEPOD_*. For the DLL
 * loader knobs we also accept the library's native HIDFACE_DLL_PATH /
 * HIDFACE_DLL_DIR as a fallback, but FACEPOD_* takes precedence and is the
 * documented form.
 */

import {
  isMockScenario,
  MOCK_SCENARIOS,
  type MockScenario,
} from "@eai/hid/facepod";

/** Raw, untrusted connect input (env-derived base, or a /api/connect body). */
export interface ConnectInput {
  /** Path to HidFace.dll. Falls back to the library's own resolution when unset. */
  dllPath?: string;
  /** Directory added to the DLL search path so co-located deps (ICypher.dll, VC
   *  runtime) resolve. Defaults to the directory of dllPath. */
  dllDir?: string;
  /** Poll interval (ms) while awaiting an async native operation. */
  pollIntervalMs?: number;
  mock?: boolean;
  /** Mock scenario preset (only meaningful when mock is true). */
  mockScenario?: string;
}

/** Fully resolved, validated config ready to build a FacePod session. */
export interface ResolvedConfig {
  dllPath?: string;
  dllDir?: string;
  pollIntervalMs?: number;
  mock: boolean;
  mockScenario: MockScenario;
}

/** Thrown for invalid configuration; carries a clear, user-facing message. */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

function trimmed(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const t = value.trim();
  return t.length === 0 ? undefined : t;
}

/** Parse the boolean-ish env convention used across the tester. */
export function parseBool(value: string | undefined): boolean {
  if (value === undefined) return false;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

/**
 * Validate a poll interval (ms): must be a positive finite number. `label`
 * names the source for the error message (env var vs. request field). Shared by
 * env parsing and request-override resolution so both reject 0/negative/NaN.
 */
function assertValidPollIntervalMs(n: number, label: string): number {
  if (!Number.isFinite(n) || n <= 0) {
    throw new ConfigError(
      `Invalid ${label}. Expected a positive number of milliseconds.`,
    );
  }
  return n;
}

/**
 * Parse a positive-integer-milliseconds env value. Returns undefined when unset;
 * throws {@link ConfigError} when present but not a positive finite number.
 */
export function parsePollIntervalMs(
  value: string | undefined,
): number | undefined {
  const t = trimmed(value);
  if (t === undefined) return undefined;
  return assertValidPollIntervalMs(
    Number(t),
    `FACEPOD_POLL_INTERVAL_MS "${t}"`,
  );
}

/**
 * Read backend config from an env map (defaults to Deno.env). Pure given the
 * map, so tests pass a plain object. FACEPOD_* is the primary convention;
 * HIDFACE_DLL_PATH / HIDFACE_DLL_DIR are honored as a fallback.
 */
export function configFromEnv(
  env: Record<string, string | undefined>,
): ConnectInput {
  return {
    dllPath: trimmed(env.FACEPOD_DLL_PATH) ?? trimmed(env.HIDFACE_DLL_PATH),
    dllDir: trimmed(env.FACEPOD_DLL_DIR) ?? trimmed(env.HIDFACE_DLL_DIR),
    pollIntervalMs: parsePollIntervalMs(env.FACEPOD_POLL_INTERVAL_MS),
    mock: parseBool(env.FACEPOD_MOCK),
    mockScenario: trimmed(env.FACEPOD_MOCK_SCENARIO),
  };
}

/**
 * Merge an env-derived base config with an optional per-request override and
 * validate the result. The override takes precedence field-by-field; a missing
 * override field falls back to env.
 */
export function resolveConfig(
  base: ConnectInput,
  override: ConnectInput = {},
): ResolvedConfig {
  const dllPath = trimmed(override.dllPath) ?? trimmed(base.dllPath);
  const dllDir = trimmed(override.dllDir) ?? trimmed(base.dllDir);
  // The env-derived base is already validated by parsePollIntervalMs, but a
  // request override (from /api/connect) arrives as an unvalidated JSON number —
  // re-check it here so 0/negative/non-finite never reaches the native poller.
  const rawPoll = override.pollIntervalMs ?? base.pollIntervalMs;
  const pollIntervalMs = rawPoll === undefined
    ? undefined
    : assertValidPollIntervalMs(rawPoll, `pollIntervalMs "${rawPoll}"`);
  const mock = override.mock ?? base.mock ?? false;

  const rawScenario = trimmed(override.mockScenario) ??
    trimmed(base.mockScenario);
  let mockScenario: MockScenario = "good";
  if (rawScenario !== undefined) {
    if (!isMockScenario(rawScenario)) {
      throw new ConfigError(
        `Invalid mock scenario "${rawScenario}". Expected one of: ${
          MOCK_SCENARIOS.join(", ")
        }.`,
      );
    }
    mockScenario = rawScenario;
  }

  return { dllPath, dllDir, pollIntervalMs, mock, mockScenario };
}

/** The Vite dev server port (see vite.config.ts). */
export const VITE_DEV_PORT = 5174;

/**
 * Build the CORS allow-list for the local API. Intentionally narrow: only the
 * Vite dev origin and the backend's own origin, on loopback hosts. This is a
 * local hardware-control API with no auth — a wildcard CORS would let any
 * webpage in the operator's browser drive the device.
 */
export function allowedOrigins(port: number): string[] {
  const origins: string[] = [];
  for (const host of ["localhost", "127.0.0.1"]) {
    origins.push(`http://${host}:${VITE_DEV_PORT}`);
    origins.push(`http://${host}:${port}`);
  }
  return origins;
}
