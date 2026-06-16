/**
 * CSRF request gating for the local API.
 *
 * CORS alone does NOT protect this unauthenticated hardware-control API: a
 * "simple" cross-site request (an HTML form POST, or a `fetch(..., {mode:
 * "no-cors"})` with a text/plain body) is still delivered to the server and
 * executes side effects — CORS only hides the *response* from the attacker.
 *
 * So we gate mutating/side-effecting routes on conditions a drive-by page
 * cannot satisfy:
 *   1. A custom request header (`X-FacePod-Tester`). Setting any custom header
 *      cross-origin forces a CORS preflight, which our allow-list denies; a
 *      form / no-cors / <img> request cannot set it at all.
 *   2. `Content-Type: application/json` on requests with a body. application/json
 *      is not a CORS "simple" content-type, so it likewise forces a preflight.
 *
 * Both are fully controlled by the same-origin UI (see src/api.ts), so this adds
 * no friction to legitimate use while blocking cross-site writes before any
 * device action runs.
 */

export const TESTER_HEADER = "x-facepod-tester";

/** Path exempt from gating (readiness probe, no side effects). */
const EXEMPT_PATHS = new Set(["/api/health"]);

export interface GateInput {
  method: string;
  path: string;
  testerHeader?: string | null;
  contentType?: string | null;
}

export interface GateRejection {
  name: string;
  message: string;
  httpStatus: number;
}

/**
 * Decide whether to allow a request. Returns `null` to allow, or a rejection to
 * send back. Pure — no I/O — so it is unit tested directly.
 */
export function checkRequestGate(input: GateInput): GateRejection | null {
  const method = input.method.toUpperCase();

  // Let the CORS layer answer preflight; never gate it.
  if (method === "OPTIONS") return null;
  if (EXEMPT_PATHS.has(input.path)) return null;

  // (1) Custom header — blocks simple cross-site requests on every method.
  if (!input.testerHeader) {
    return {
      name: "Forbidden",
      message:
        "Missing X-FacePod-Tester header. This local API only accepts requests from the FacePod Tester UI.",
      httpStatus: 403,
    };
  }

  // (2) Mutations must be JSON.
  if (method !== "GET" && method !== "HEAD") {
    const ct = (input.contentType ?? "").toLowerCase();
    if (!ct.includes("application/json")) {
      return {
        name: "UnsupportedMediaType",
        message: "Content-Type must be application/json.",
        httpStatus: 415,
      };
    }
  }

  return null;
}
