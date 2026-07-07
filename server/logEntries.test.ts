import { assert, assertEquals, assertThrows } from "@std/assert";
import { parseLogQuery, toLogEntries } from "./logEntries.ts";

Deno.test("toLogEntries parses JSON lines and preserves malformed lines", () => {
  const e = toLogEntries(['{"a":1}', "[secure] not json", "{bad"]);
  assertEquals(e[0].parsed, { a: 1 });
  assertEquals(e[0].parseError, undefined);
  assert(e[1].parseError); // non-JSON secureEvents line stays visible
  assert(e[2].parseError); // malformed line stays visible
});

Deno.test("parseLogQuery defaults, clamps, and rejects bad input", () => {
  assertEquals(parseLogQuery(undefined, undefined), { cursor: 0, limit: 500 });
  assertEquals(parseLogQuery("500", "99999"), { cursor: 500, limit: 1000 });
  assertThrows(() => parseLogQuery("-1", undefined), Error, "cursor");
  assertThrows(() => parseLogQuery(undefined, "abc"), Error, "limit");
});
