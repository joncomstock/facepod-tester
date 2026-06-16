import { assertEquals } from "@std/assert";
import { normalizeError } from "./errors.ts";
import {
  FaceModuleApiError,
  NotConnectedError,
  UnsupportedDatatypeError,
} from "@eai/hid/facepod";
import { ConfigError } from "./config.ts";

Deno.test("normalizeError: FaceModuleApiError surfaces code + status", () => {
  const n = normalizeError(new FaceModuleApiError(42, "device blew up", 503));
  assertEquals(n.name, "FaceModuleApiError");
  assertEquals(n.message, "device blew up");
  assertEquals(n.code, 42);
  assertEquals(n.status, 503);
  assertEquals(n.httpStatus, 503);
});

Deno.test("normalizeError: FaceModuleApiError without http status maps to 502", () => {
  const n = normalizeError(new FaceModuleApiError(7, "bad code"));
  assertEquals(n.code, 7);
  assertEquals(n.status, undefined);
  assertEquals(n.httpStatus, 502);
});

Deno.test("normalizeError: NotConnectedError maps to 409", () => {
  const n = normalizeError(new NotConnectedError());
  assertEquals(n.name, "NotConnectedError");
  assertEquals(n.httpStatus, 409);
});

Deno.test("normalizeError: BusyError maps to 409", () => {
  const n = normalizeError(
    Object.assign(new Error("busy"), { name: "BusyError" }),
  );
  assertEquals(n.name, "BusyError");
  assertEquals(n.httpStatus, 409);
});

Deno.test("normalizeError: UnsupportedDatatypeError carries datatype, maps to 422", () => {
  const n = normalizeError(new UnsupportedDatatypeError("iso19794-5:2011"));
  assertEquals(n.name, "UnsupportedDatatypeError");
  assertEquals(n.datatype, "iso19794-5:2011");
  assertEquals(n.httpStatus, 422);
});

Deno.test("normalizeError: ConfigError maps to 400", () => {
  const n = normalizeError(new ConfigError("bad config"));
  assertEquals(n.name, "ConfigError");
  assertEquals(n.httpStatus, 400);
});

Deno.test("normalizeError: duck-typed errors via name field", () => {
  // Route handlers throw Object.assign(new Error(), { name: "..." }) — verify
  // normalization keys off name, not instanceof.
  const dt = Object.assign(new Error("nope"), {
    name: "UnsupportedDatatypeError",
    datatype: "bmp",
  });
  assertEquals(normalizeError(dt).httpStatus, 422);
  assertEquals(normalizeError(dt).datatype, "bmp");
});

Deno.test("normalizeError: unknown Error maps to 500", () => {
  const n = normalizeError(new Error("kaboom"));
  assertEquals(n.name, "Error");
  assertEquals(n.httpStatus, 500);
});

Deno.test("normalizeError: non-Error values", () => {
  assertEquals(normalizeError("string failure").message, "string failure");
  assertEquals(normalizeError(undefined).message, "Unknown error");
  assertEquals(normalizeError(undefined).httpStatus, 500);
});
