import { describe, expect, it } from "vitest";
import { api } from "../api.ts";

describe("api.getParameters", () => {
  it("is a callable endpoint", () => {
    expect(typeof api.getParameters).toBe("function");
  });
});
