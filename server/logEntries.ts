import type { DiagnosticLogCode } from "@eai/hid/facepod";

/** One log line, JSON-parsed when possible; a malformed or non-JSON line stays
 *  visible via raw + parseError instead of failing the whole fetch. */
export interface LogEntry {
  raw: string;
  parsed?: unknown;
  parseError?: string;
}

/** The wire response for GET /api/logs. */
export interface LogPage {
  code: DiagnosticLogCode;
  entries: LogEntry[];
  nextCursor: number | null;
  truncated: boolean;
  byteLength: number;
  sourceByteLength: number;
  truncatedBytes: number;
}

export function toLogEntries(lines: string[]): LogEntry[] {
  return lines.map((raw) => {
    try {
      return { raw, parsed: JSON.parse(raw) };
    } catch (err) {
      return { raw, parseError: (err as Error).message };
    }
  });
}

const LOG_PAGE_DEFAULT_LIMIT = 500;
const LOG_PAGE_MAX_LIMIT = 1000;

export interface LogQuery {
  cursor: number;
  limit: number;
}

function parseNonNegInt(
  raw: string | undefined,
  field: string,
  dflt: number,
): number {
  if (raw === undefined || raw === "") return dflt;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) {
    throw Object.assign(
      new Error(`Invalid "${field}": must be a non-negative integer.`),
      { name: "ConfigError" },
    );
  }
  return n;
}

/** Parse + validate the ?cursor=&limit= query. Invalid → ConfigError (→ 400).
 *  limit is clamped to [1, LOG_PAGE_MAX_LIMIT]. */
export function parseLogQuery(
  cursorRaw: string | undefined,
  limitRaw: string | undefined,
): LogQuery {
  const cursor = parseNonNegInt(cursorRaw, "cursor", 0);
  const limit = Math.max(
    1,
    Math.min(
      parseNonNegInt(limitRaw, "limit", LOG_PAGE_DEFAULT_LIMIT),
      LOG_PAGE_MAX_LIMIT,
    ),
  );
  return { cursor, limit };
}
