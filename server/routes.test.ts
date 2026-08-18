import { assert, assertEquals } from "@std/assert";
import { createApp } from "./main.ts";
import { FacePodSession } from "./facepodSession.ts";

const H = { "x-facepod-tester": "1", "content-type": "application/json" };

async function mockApp() {
  const s = new FacePodSession();
  await s.connect({ mock: true, mockScenario: "good" } as never); // shape of MOCK_CONFIG
  await s.openCamera();
  return createApp(s);
}

Deno.test("GET /api/diagnostics -> 200 hex echo", async () => {
  const res = await (await mockApp()).request("/api/diagnostics", {
    headers: H,
  });
  assertEquals(res.status, 200);
  const b = await res.json();
  assertEquals(b.ok, true);
  assert(typeof b.sentHex === "string");
});

Deno.test("GET /api/logs -> 200 entries + nextCursor", async () => {
  const res = await (await mockApp()).request(
    "/api/logs?code=hfapi&cursor=0&limit=500",
    { headers: H },
  );
  assertEquals(res.status, 200);
  const b = await res.json();
  assertEquals(b.code, "hfapi");
  assertEquals(b.entries.length, 500);
  assertEquals(b.nextCursor, 500);
});

Deno.test("GET /api/logs -> 422 on unknown/destructive code", async () => {
  const res = await (await mockApp()).request("/api/logs?code=reboot", {
    headers: H,
  });
  assertEquals(res.status, 422);
});

// parseLogQuery is the SINGLE place the page limit is bounded (the session no longer
// re-clamps), so the hard max has to be proven here. The mock channel is 1201 lines, so an
// unclamped 99999 would return all of them.
Deno.test("GET /api/logs clamps an over-max limit to the hard max", async () => {
  const res = await (await mockApp()).request(
    "/api/logs?code=hfapi&cursor=0&limit=99999",
    { headers: H },
  );
  assertEquals(res.status, 200);
  const b = await res.json();
  assertEquals(b.entries.length, 1000); // LOG_PAGE_MAX_LIMIT, not 1201
});

Deno.test("GET /api/logs -> 400 on bad cursor/limit", async () => {
  const app = await mockApp();
  assertEquals(
    (await app.request("/api/logs?code=hfapi&cursor=-1", { headers: H }))
      .status,
    400,
  );
  assertEquals(
    (await app.request("/api/logs?code=hfapi&limit=abc", { headers: H }))
      .status,
    400,
  );
});

Deno.test("new routes are behind the security-header gate", async () => {
  // No x-facepod-tester header → gated. Assert the SAME status security.test.ts expects.
  const res = await (await mockApp()).request("/api/diagnostics");
  assert(res.status >= 400 && res.status < 500);
});
