import { describe, expect, it } from "vitest";
import { isFreshFrame, nextLastSeq, snapshotForSession } from "./framePoll.ts";
import type { FrameResponse } from "../api.ts";

const resp = (over: Partial<FrameResponse>): FrameResponse => ({
  frame: null, snapshot: null, snapshotAgeMs: null, captureId: 0, sessionGeneration: 1, ...over,
});

describe("framePoll reducers", () => {
  it("advances lastSeq on a fresh frame, holds it on null", () => {
    expect(nextLastSeq("-1", resp({ frame: { datatype: "png", data: "x", seq: "5" } }))).toBe("5");
    expect(nextLastSeq("5", resp({ frame: null }))).toBe("5"); // cannot stick or skip
  });
  it("treats a repeated seq as not fresh (de-dup)", () => {
    expect(isFreshFrame("5", resp({ frame: { datatype: "png", data: "x", seq: "5" } }))).toBe(false);
    expect(isFreshFrame("5", resp({ frame: { datatype: "png", data: "x", seq: "6" } }))).toBe(true);
  });
  it("discards a snapshot from a different session generation", () => {
    const r = resp({ snapshot: { numberOfFaces: 1 }, sessionGeneration: 2 });
    expect(snapshotForSession(r, 1)).toBeNull(); // stale session
    expect(snapshotForSession(r, 2)).not.toBeNull();
  });
  it("accepts any snapshot when the client generation is not yet synced (0)", () => {
    const r = resp({ snapshot: { numberOfFaces: 1 }, sessionGeneration: 1 });
    expect(snapshotForSession(r, 0)).not.toBeNull(); // no prior session to filter
  });
});
