import { expect, test } from "vitest";
import { parseTimeoutMs } from "./settings.ts";

test("parseTimeoutMs: blank/whitespace → undefined", () => {
  expect(parseTimeoutMs("")).toBeUndefined();
  expect(parseTimeoutMs("   ")).toBeUndefined();
});
test("parseTimeoutMs: numeric string → number", () => {
  expect(parseTimeoutMs("2000")).toBe(2000);
});
test("parseTimeoutMs: non-numeric → undefined", () => {
  expect(parseTimeoutMs("abc")).toBeUndefined();
});
