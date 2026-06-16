import { assertEquals, assertThrows } from "@std/assert";
import {
  allowedOrigins,
  ConfigError,
  configFromEnv,
  parseBool,
  parsePollIntervalMs,
  resolveConfig,
  VITE_DEV_PORT,
} from "./config.ts";

Deno.test("parseBool: accepts common truthy spellings", () => {
  for (const t of ["1", "true", "TRUE", "yes", "on"]) {
    assertEquals(parseBool(t), true);
  }
  for (const f of ["0", "false", "", undefined, "nope"]) {
    assertEquals(parseBool(f), false);
  }
});

Deno.test("parsePollIntervalMs: parses positive numbers, rejects invalid", () => {
  assertEquals(parsePollIntervalMs(undefined), undefined);
  assertEquals(parsePollIntervalMs("  "), undefined);
  assertEquals(parsePollIntervalMs("33"), 33);
  assertThrows(
    () => parsePollIntervalMs("0"),
    ConfigError,
    "FACEPOD_POLL_INTERVAL_MS",
  );
  assertThrows(
    () => parsePollIntervalMs("-5"),
    ConfigError,
    "FACEPOD_POLL_INTERVAL_MS",
  );
  assertThrows(
    () => parsePollIntervalMs("fast"),
    ConfigError,
    "FACEPOD_POLL_INTERVAL_MS",
  );
});

Deno.test("configFromEnv: maps FACEPOD_* FFI env keys", () => {
  const cfg = configFromEnv({
    FACEPOD_DLL_PATH: "C:\\hid\\HidFace.dll",
    FACEPOD_DLL_DIR: "C:\\hid",
    FACEPOD_POLL_INTERVAL_MS: "50",
    FACEPOD_MOCK: "true",
    FACEPOD_MOCK_SCENARIO: "spoof",
  });
  assertEquals(cfg.dllPath, "C:\\hid\\HidFace.dll");
  assertEquals(cfg.dllDir, "C:\\hid");
  assertEquals(cfg.pollIntervalMs, 50);
  assertEquals(cfg.mock, true);
  assertEquals(cfg.mockScenario, "spoof");
});

Deno.test("configFromEnv: HIDFACE_* are honored as a fallback", () => {
  const cfg = configFromEnv({
    HIDFACE_DLL_PATH: "C:\\native\\HidFace.dll",
    HIDFACE_DLL_DIR: "C:\\native",
  });
  assertEquals(cfg.dllPath, "C:\\native\\HidFace.dll");
  assertEquals(cfg.dllDir, "C:\\native");
});

Deno.test("configFromEnv: FACEPOD_* takes precedence over HIDFACE_*", () => {
  const cfg = configFromEnv({
    FACEPOD_DLL_PATH: "C:\\facepod\\HidFace.dll",
    HIDFACE_DLL_PATH: "C:\\native\\HidFace.dll",
  });
  assertEquals(cfg.dllPath, "C:\\facepod\\HidFace.dll");
});

Deno.test("resolveConfig: defaults to live with no FFI knobs when nothing supplied", () => {
  const resolved = resolveConfig({}, {});
  assertEquals(resolved.mock, false);
  assertEquals(resolved.dllPath, undefined);
  assertEquals(resolved.dllDir, undefined);
  assertEquals(resolved.pollIntervalMs, undefined);
  assertEquals(resolved.mockScenario, "good");
});

Deno.test("resolveConfig: override beats env field-by-field", () => {
  const base = configFromEnv({
    FACEPOD_DLL_PATH: "C:\\env\\HidFace.dll",
    FACEPOD_POLL_INTERVAL_MS: "20",
  });
  const resolved = resolveConfig(base, {
    dllDir: "C:\\override",
    pollIntervalMs: 80,
  });
  // dllPath falls back to env; dllDir + pollIntervalMs come from the override.
  assertEquals(resolved.dllPath, "C:\\env\\HidFace.dll");
  assertEquals(resolved.dllDir, "C:\\override");
  assertEquals(resolved.pollIntervalMs, 80);
});

Deno.test("resolveConfig: mock flag flows from env and override", () => {
  assertEquals(
    resolveConfig(configFromEnv({ FACEPOD_MOCK: "true" }), {}).mock,
    true,
  );
  assertEquals(resolveConfig({}, { mock: true }).mock, true);
});

Deno.test("resolveConfig: scenario defaults to good and validates", () => {
  assertEquals(resolveConfig({}, {}).mockScenario, "good");
  assertEquals(
    resolveConfig({}, { mockScenario: "spoof" }).mockScenario,
    "spoof",
  );
  // env-derived scenario flows through
  assertEquals(
    resolveConfig(configFromEnv({ FACEPOD_MOCK_SCENARIO: "no-face" }), {})
      .mockScenario,
    "no-face",
  );
  // override beats env
  assertEquals(
    resolveConfig(configFromEnv({ FACEPOD_MOCK_SCENARIO: "no-face" }), {
      mockScenario: "good",
    })
      .mockScenario,
    "good",
  );
});

Deno.test("resolveConfig: rejects non-positive pollIntervalMs override", () => {
  // The UI's min={1} is not a trust boundary — a direct /api/connect request can
  // send any JSON number, so the server must reject 0/negative/non-finite.
  for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assertThrows(
      () => resolveConfig({}, { pollIntervalMs: bad }),
      ConfigError,
      "pollIntervalMs",
    );
  }
  // A valid positive override still flows through.
  assertEquals(resolveConfig({}, { pollIntervalMs: 25 }).pollIntervalMs, 25);
});

Deno.test("resolveConfig: rejects unknown scenario", () => {
  assertThrows(
    () => resolveConfig({}, { mockScenario: "explode" }),
    ConfigError,
    "Invalid mock scenario",
  );
});

Deno.test("allowedOrigins: only loopback dev + backend origins, never wildcard", () => {
  const origins = allowedOrigins(8787);
  assertEquals(origins.includes("*"), false);
  assertEquals(origins.includes(`http://localhost:${VITE_DEV_PORT}`), true);
  assertEquals(origins.includes("http://127.0.0.1:5174"), true);
  assertEquals(origins.includes("http://localhost:8787"), true);
  assertEquals(origins.includes("http://127.0.0.1:8787"), true);
  // A malicious external origin must not be present.
  assertEquals(origins.includes("https://evil.example"), false);
  // No non-loopback hosts.
  assertEquals(
    origins.every((o) => o.includes("localhost") || o.includes("127.0.0.1")),
    true,
  );
});
