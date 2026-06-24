/**
 * FacePod tester backend — Hono HTTP server.
 *
 * Owns ALL FacePod communication (the live transport is USB over Deno FFI via
 * the Deno-native library, so the browser must not talk to it directly).
 * Exposes a thin local JSON API consumed by the Vite frontend.
 *
 * Run:  deno task dev         (live: USB/FFI — needs --allow-ffi + HidFace.dll)
 *       deno task dev:mock    (no hardware needed)
 */

import { Hono } from "@hono/hono";
import { cors } from "@hono/hono/cors";
import { serveStatic } from "@hono/hono/deno";
import type { Context } from "@hono/hono";

import {
  allowedOrigins,
  configFromEnv,
  type ConnectInput,
  resolveConfig,
} from "./config.ts";
import { normalizeError } from "./errors.ts";
import { checkRequestGate, TESTER_HEADER } from "./security.ts";
import { FacePodSession } from "./facepodSession.ts";
import { isMockScenario, MOCK_SCENARIOS } from "./mockClient.ts";
import { toFramePayload } from "./videoFramePayload.ts";
import type { DeviceParametersPatch, ImageDatatype } from "@eai/hid/facepod";

const session = new FacePodSession();

// Base config from env, read once at startup. /api/connect may override per call.
// A `--mock` CLI flag forces mock mode too — it's the cross-platform equivalent
// of FACEPOD_MOCK=true (the POSIX env-prefix form breaks under cmd.exe, and this
// tester runs on the Windows device).
const envConfig: ConnectInput = configFromEnv(Deno.env.toObject());
if (Deno.args.includes("--mock")) envConfig.mock = true;

// Loopback-only port. The server binds 127.0.0.1 (below) so it is never exposed
// on the LAN; this is an unauthenticated local hardware-control API.
const port = Number(Deno.env.get("PORT") ?? "8787");

const app = new Hono();

// Frontend talks to us same-origin via the Vite proxy. CORS is locked to the
// loopback dev/backend origins ONLY — a wildcard would let any page in the
// operator's browser drive the device (no auth on this API).
app.use("/api/*", cors({ origin: allowedOrigins(port) }));

// CORS headers alone don't stop "simple" cross-site requests from reaching the
// server and triggering device actions. Gate every /api/* route on a custom
// header + JSON content-type, which a drive-by page cannot satisfy. See
// security.ts. Runs after CORS (so preflight is handled) and before any route.
app.use("/api/*", async (c, next) => {
  const rejection = checkRequestGate({
    method: c.req.method,
    path: c.req.path,
    testerHeader: c.req.header(TESTER_HEADER),
    contentType: c.req.header("content-type"),
  });
  if (rejection) {
    return c.json({ error: rejection }, rejection.httpStatus as 403);
  }
  await next();
});

/** Wrap a handler so any thrown value becomes a normalized error envelope. */
function handle(fn: (c: Context) => Promise<Response> | Response) {
  return async (c: Context): Promise<Response> => {
    try {
      return await fn(c);
    } catch (err) {
      const n = normalizeError(err);
      return c.json({ error: n }, n.httpStatus as 400);
    }
  };
}

async function readJson(c: Context): Promise<Record<string, unknown>> {
  try {
    const body = await c.req.json();
    return (body ?? {}) as Record<string, unknown>;
  } catch {
    return {};
  }
}

const VALID_DATATYPES: readonly ImageDatatype[] = ["png", "jpg", "jpeg"];

function asImageDatatype(value: unknown): ImageDatatype {
  const v = String(value ?? "").toLowerCase();
  if ((VALID_DATATYPES as readonly string[]).includes(v)) {
    return v as ImageDatatype;
  }
  throw Object.assign(
    new Error(
      `Unsupported image datatype "${value}". Expected one of: ${
        VALID_DATATYPES.join(", ")
      }.`,
    ),
    { name: "UnsupportedDatatypeError", datatype: String(value ?? "") },
  );
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function requireNum(value: unknown, field: string): number {
  const n = num(value);
  if (n === undefined) {
    throw Object.assign(
      new Error(`Missing or invalid numeric field "${field}".`),
      {
        name: "ConfigError",
      },
    );
  }
  return n;
}

function requireStr(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw Object.assign(
      new Error(`Missing or invalid string field "${field}".`),
      {
        name: "ConfigError",
      },
    );
  }
  return value;
}

// ---- Routes ---------------------------------------------------------------

app.get("/api/health", (c) => c.json({ ok: true }));

app.get("/api/status", (c) => c.json(session.status()));

app.post(
  "/api/connect",
  handle(async (c) => {
    const body = await readJson(c);
    const override: ConnectInput = {
      dllPath: typeof body.dllPath === "string" ? body.dllPath : undefined,
      dllDir: typeof body.dllDir === "string" ? body.dllDir : undefined,
      pollIntervalMs: typeof body.pollIntervalMs === "number"
        ? body.pollIntervalMs
        : undefined,
      // mock can be forced from env; allow the UI to opt in too.
      mock: typeof body.mock === "boolean" ? body.mock : undefined,
      mockScenario: typeof body.mockScenario === "string"
        ? body.mockScenario
        : undefined,
    };
    const resolved = resolveConfig(envConfig, override);
    const info = await session.connect(resolved);
    return c.json({ deviceInfo: info, status: session.status() });
  }),
);

app.post(
  "/api/disconnect",
  handle(async (c) => {
    await session.disconnect();
    return c.json({ status: session.status() });
  }),
);

app.get(
  "/api/device-info",
  handle(async (c) => c.json({ deviceInfo: await session.getInfo() })),
);

app.get(
  "/api/cameras",
  handle(async (c) => c.json({ cameras: await session.getCameras() })),
);

app.get(
  "/api/parameters",
  handle(async (c) => c.json({ parameters: await session.getParameters() })),
);

app.get(
  "/api/video-frame",
  handle(async (c) => {
    const raw = c.req.query("lastSeq");
    let lastSeq: bigint | undefined;
    try {
      lastSeq = raw != null && raw !== "" ? BigInt(raw) : undefined;
    } catch {
      lastSeq = undefined; // malformed cursor → treat as "latest"
    }
    const read = await session.readFrame(lastSeq);
    return c.json(toFramePayload(read));
  }),
);

app.post(
  "/api/camera/open",
  handle(async (c) => {
    const body = await readJson(c);
    const result = await session.openCamera({
      cameraId: typeof body.cameraId === "string" ? body.cameraId : undefined,
      algorithmType: body.algorithmType === "on_device"
        ? "on_device"
        : undefined,
      reservationTimeoutMs: num(body.reservationTimeoutMs),
    });
    return c.json({ ...result, status: session.status() });
  }),
);

app.post(
  "/api/camera/close",
  handle(async (c) => {
    const result = await session.closeCamera();
    return c.json({ ...result, status: session.status() });
  }),
);

app.post(
  "/api/capture",
  handle(async (c) => {
    const body = await readJson(c);
    const result = await session.capture({
      minimalQuality: requireNum(body.minimalQuality, "minimalQuality"),
      maximalSpoofScore: num(body.maximalSpoofScore),
      timeoutMs: num(body.timeoutMs),
    }, c.req.raw.signal);
    return c.json({ result });
  }),
);

app.post(
  "/api/process-image",
  handle(async (c) => {
    const body = await readJson(c);
    const data = requireStr(body.image, "image");
    const datatype = asImageDatatype(body.datatype);
    const result = await session.processImage(data, datatype, {
      minimalQuality: num(body.minimalQuality),
      maximalSpoofScore: num(body.maximalSpoofScore),
    });
    return c.json({ result });
  }),
);

app.post(
  "/api/match",
  handle(async (c) => {
    const body = await readJson(c);
    const result = await session.match(
      requireStr(body.template1, "template1"),
      requireStr(body.template2, "template2"),
      requireNum(body.minimalMatchScore, "minimalMatchScore"),
    );
    return c.json({ result });
  }),
);

app.post(
  "/api/mock/scenario",
  handle((c) =>
    readJson(c).then((body) => {
      if (!isMockScenario(body.scenario)) {
        throw Object.assign(
          new Error(
            `Invalid scenario "${body.scenario}". Expected one of: ${
              MOCK_SCENARIOS.join(", ")
            }.`,
          ),
          { name: "ConfigError" },
        );
      }
      const result = session.setMockScenario(body.scenario);
      return c.json({ ...result, status: session.status() });
    })
  ),
);

app.post(
  "/api/capture-and-match",
  handle(async (c) => {
    const body = await readJson(c);
    const capture = (body.capture ?? {}) as Record<string, unknown>;
    const result = await session.captureAndMatch({
      reference: {
        modality: "face",
        datatype: asImageDatatype(body.datatype),
        data: requireStr(body.image, "image"),
      },
      capture: {
        minimalQuality: requireNum(
          capture.minimalQuality,
          "capture.minimalQuality",
        ),
        maximalSpoofScore: num(capture.maximalSpoofScore),
        timeoutMs: num(capture.timeoutMs),
      },
      minimalMatchScore: requireNum(
        body.minimalMatchScore,
        "minimalMatchScore",
      ),
    }, c.req.raw.signal);
    return c.json({ result });
  }),
);

app.post(
  "/api/capture-high-res",
  handle(async (c) => {
    const body = await readJson(c);
    const result = await session.captureHighRes({
      minimalQuality: requireNum(body.minimalQuality, "minimalQuality"),
      maximalSpoofScore: num(body.maximalSpoofScore),
      timeoutMs: num(body.timeoutMs),
    }, c.req.raw.signal);
    return c.json({ result });
  }),
);

app.post(
  "/api/parameters",
  handle(async (c) => {
    const body = await readJson(c);
    // Pass through every finite-number field; the lib facade refuses non-allowlisted
    // keys loudly (→ 422), so we do NOT silently pre-filter to the allowlist here.
    const patch: Record<string, number> = {};
    for (const [k, v] of Object.entries(body)) {
      if (typeof v === "number" && Number.isFinite(v)) patch[k] = v;
    }
    const result = await session.setParameters(patch as DeviceParametersPatch);
    return c.json(result);
  }),
);

app.get(
  "/api/high-res-image/:id",
  handle((c) => {
    const id = c.req.param("id") ?? "";
    const img = session.takeHighResImage(id);
    if (!img) {
      // JSON error envelope (NOT image bytes) — the client's downloadHighResImage
      // detects this via res.ok / content-type and throws ApiError.
      return c.json(
        { error: { name: "NotFoundError", message: "High-res image not found (unknown or already-fetched id).", httpStatus: 404 } },
        404,
      );
    }
    const contentType = img.format === "jpg" || img.format === "jpeg" ? "image/jpeg" : "image/png";
    return new Response(img.bytes as unknown as BodyInit, { headers: { "content-type": contentType } });
  }),
);

// Optionally serve a built frontend (deno task build in src/ → dist/). When dist
// is absent (the common dev case), we just skip it and rely on the Vite server.
let distAvailable = false;
try {
  const stat = await Deno.stat("./dist/index.html");
  distAvailable = stat.isFile;
} catch {
  distAvailable = false;
}
if (distAvailable) {
  app.use("/*", serveStatic({ root: "./dist" }));
  app.get("/*", serveStatic({ path: "./dist/index.html" })); // SPA fallback
}

// ---- Server + graceful shutdown ------------------------------------------

const server = Deno.serve({
  port,
  hostname: "127.0.0.1", // loopback only — do not expose on the network
  onListen: ({ hostname, port }) => {
    const mode = envConfig.mock ? "MOCK" : "LIVE";
    console.log(
      `FacePod tester backend [${mode}] listening on http://${hostname}:${port}`,
    );
    if (distAvailable) console.log("Serving built frontend from ./dist");
  },
}, app.fetch);

async function shutdown() {
  console.log("\nShutting down — disposing FacePod session…");
  await session.forceDispose(); // unguarded: release the device even mid-op
  await server.shutdown().catch(() => {});
  Deno.exit(0);
}

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  try {
    Deno.addSignalListener(sig, shutdown);
  } catch {
    // SIGTERM is unavailable on some platforms; ignore.
  }
}
