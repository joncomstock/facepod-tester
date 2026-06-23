import { expect, test } from "vitest";
import { migrateConnectionSettings } from "./connectionSettings.ts";

test("null/garbage → defaults", () => {
  expect(migrateConnectionSettings(null)).toEqual({ mock: false, scenario: "good" });
  expect(migrateConnectionSettings("not json")).toEqual({ mock: false, scenario: "good" });
});
test("legacy keys (dllPath/dllDir/pollIntervalMs) are dropped", () => {
  const legacy = JSON.stringify({ mock: true, scenario: "spoof", dllPath: "C:\\x.dll", dllDir: "C:\\", pollIntervalMs: "50" });
  expect(migrateConnectionSettings(legacy)).toEqual({ mock: true, scenario: "spoof" });
});
