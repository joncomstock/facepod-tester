import { describe, expect, it } from "vitest";
import { isComingSoon, MODES, modeDef, sliceLabel, type ModeId } from "./modes.ts";

describe("modes", () => {
  it("lists verify, identify, console in switch order", () => {
    expect(MODES.map((m) => m.id)).toEqual(["verify", "identify", "console"]);
  });

  it("verify is live (no slice, not coming soon)", () => {
    expect(modeDef("verify").slice).toBeNull();
    expect(isComingSoon("verify")).toBe(false);
    expect(sliceLabel("verify")).toBeNull();
  });

  it("identify is deferred to Slice 4", () => {
    expect(isComingSoon("identify")).toBe(true);
    expect(sliceLabel("identify")).toBe("Coming soon — Slice 4");
  });

  it("console is deferred to Slice 2", () => {
    expect(isComingSoon("console")).toBe(true);
    expect(sliceLabel("console")).toBe("Coming soon — Slice 2");
  });

  it("modeDef throws on an unknown id", () => {
    expect(() => modeDef("nope" as ModeId)).toThrow(/unknown mode/);
  });
});
