import { assertEquals } from "@std/assert";
import { checkRequestGate } from "./security.ts";

Deno.test("gate: allows health probe without header", () => {
  assertEquals(checkRequestGate({ method: "GET", path: "/api/health" }), null);
});

Deno.test("gate: allows preflight (OPTIONS) through to CORS layer", () => {
  assertEquals(
    checkRequestGate({ method: "OPTIONS", path: "/api/connect" }),
    null,
  );
});

Deno.test("gate: rejects mutating request without the custom header (CSRF)", () => {
  // Simulates a drive-by form/no-cors POST: no X-FacePod-Tester header.
  const r = checkRequestGate({
    method: "POST",
    path: "/api/connect",
    contentType: "text/plain",
  });
  assertEquals(r?.httpStatus, 403);
  assertEquals(r?.name, "Forbidden");
});

Deno.test("gate: rejects GET reads without the custom header too", () => {
  const r = checkRequestGate({ method: "GET", path: "/api/cameras" });
  assertEquals(r?.httpStatus, 403);
});

Deno.test("gate: rejects non-JSON content-type on mutations (415)", () => {
  const r = checkRequestGate({
    method: "POST",
    path: "/api/connect",
    testerHeader: "1",
    contentType: "text/plain",
  });
  assertEquals(r?.httpStatus, 415);
  assertEquals(r?.name, "UnsupportedMediaType");
});

Deno.test("gate: allows a proper UI request (header + JSON)", () => {
  assertEquals(
    checkRequestGate({
      method: "POST",
      path: "/api/connect",
      testerHeader: "1",
      contentType: "application/json",
    }),
    null,
  );
});

Deno.test("gate: allows GET with header (no content-type needed)", () => {
  assertEquals(
    checkRequestGate({ method: "GET", path: "/api/status", testerHeader: "1" }),
    null,
  );
});
