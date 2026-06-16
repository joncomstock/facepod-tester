/**
 * Normalize errors thrown by the FacePod library (and our own config errors)
 * into a single JSON envelope the UI can render consistently.
 *
 * The library exposes typed errors — FaceModuleApiError (device error_code /
 * message / httpStatus), NotConnectedError, UnsupportedDatatypeError — which we
 * detect by name so we don't have to import the classes just for instanceof.
 */

import { ConfigError } from "./config.ts";

/** Stable, UI-facing error envelope. */
export interface NormalizedError {
  /** Short machine-ish kind, e.g. "FaceModuleApiError", "ConfigError". */
  name: string;
  message: string;
  /** Device error code from FaceModuleApiError (number) where available. */
  code?: number;
  /** Upstream HTTP status from FaceModuleApiError where available. */
  status?: number;
  /** Offending datatype from UnsupportedDatatypeError where available. */
  datatype?: string;
  /** HTTP status the tester backend should respond with. */
  httpStatus: number;
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Map any thrown value to a {@link NormalizedError}. Recognizes the library's
 * typed errors via their `name` field plus their documented properties.
 */
export function normalizeError(err: unknown): NormalizedError {
  if (!(err instanceof Error)) {
    return {
      name: "Error",
      message: typeof err === "string" ? err : "Unknown error",
      httpStatus: 500,
    };
  }

  const e = err as Error & Record<string, unknown>;

  switch (e.name) {
    case "FaceModuleApiError": {
      const code = num(e.errorCode);
      const status = num(e.httpStatus);
      return {
        name: "FaceModuleApiError",
        // errorMessage carries the device's description; fall back to .message.
        message: str(e.errorMessage) ?? e.message,
        code,
        status,
        // Surface the device's HTTP status when present, else 502 (bad device
        // response from the tester's perspective).
        httpStatus: status ?? 502,
      };
    }

    case "NotConnectedError":
      return {
        name: "NotConnectedError",
        message: e.message,
        // Caller asked for an operation requiring an open camera/connection.
        httpStatus: 409,
      };

    case "BusyError":
      // Another device operation is already in flight; the device + camera
      // context are single-occupancy, so we reject rather than race.
      return { name: "BusyError", message: e.message, httpStatus: 409 };

    case "UnsupportedDatatypeError":
      return {
        name: "UnsupportedDatatypeError",
        message: e.message,
        datatype: str(e.datatype),
        httpStatus: 422,
      };

    case "ConfigError":
      return { name: "ConfigError", message: e.message, httpStatus: 400 };

    default:
      // Includes FFI/native load failures (e.g. HidFace.dll or a co-located
      // dependency missing from the DLL search path).
      return { name: e.name || "Error", message: e.message, httpStatus: 500 };
  }
}

// Re-export so call sites can throw a config error without importing config.ts
// directly when they only need the error type.
export { ConfigError };
