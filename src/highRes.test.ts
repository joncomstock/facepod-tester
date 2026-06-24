import { describe, expect, it, vi, afterEach } from "vitest";
import { api, ApiError } from "./api.ts";

afterEach(() => vi.restoreAllMocks());

describe("downloadHighResImage", () => {
  it("returns a Blob for an image response", async () => {
    const blob = new Blob([new Uint8Array([0x89, 0x50])], { type: "image/png" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(blob, { status: 200, headers: { "content-type": "image/png" } }),
    ));
    const out = await api.downloadHighResImage("abc");
    expect(out).toBeInstanceOf(Blob);
    expect(out.type).toContain("image/png");
  });

  it("throws ApiError when the server returns a JSON error envelope", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { name: "NotFoundError", message: "gone", httpStatus: 404 } }), {
        status: 404,
        headers: { "content-type": "application/json" },
      }),
    ));
    await expect(api.downloadHighResImage("missing")).rejects.toBeInstanceOf(ApiError);
  });
});
