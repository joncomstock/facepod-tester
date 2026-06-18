import { useEffect, useRef, useState } from "react";
import { api, ApiError, type NormalizedError } from "../api.ts";
import { isFreshFrame, nextLastSeq, snapshotForSession } from "./framePoll.ts";
import type { LiveSnapshotState } from "./types.ts";

interface Options {
  active: boolean;
  sessionGeneration: number;
  onError: (e: NormalizedError) => void;
  intervalMs?: number;
}
interface FramePollState {
  videoFrame: { datatype: string; data: string } | null;
  liveSnapshot: LiveSnapshotState | null;
  snapshotAgeMs: number | null;
  stopAndDrain: () => Promise<void>;
}

/**
 * Lane 1 feed poller. Polls GET /api/video-frame, de-dups by seq, and exposes the
 * newest frame + the server's latest snapshot. stopAndDrain() aborts the in-flight
 * request and awaits it — call this BEFORE POST /api/disconnect (teardown order).
 */
export function useFramePoll(opts: Options): FramePollState {
  const ref = useRef(opts);
  ref.current = opts;
  const runningRef = useRef(false);
  const lastSeqRef = useRef("-1");
  const abortRef = useRef<AbortController | null>(null);
  const inFlightRef = useRef<Promise<unknown> | null>(null);
  const sleepResolveRef = useRef<(() => void) | null>(null);

  const [videoFrame, setVideoFrame] = useState<{ datatype: string; data: string } | null>(null);
  const [liveSnapshot, setLiveSnapshot] = useState<LiveSnapshotState | null>(null);
  const [snapshotAgeMs, setSnapshotAgeMs] = useState<number | null>(null);

  const stopAndDrain = async () => {
    runningRef.current = false;
    abortRef.current?.abort();
    sleepResolveRef.current?.();
    try { await inFlightRef.current; } catch { /* AbortError expected */ }
    // Drop the displayed frame so a stale frame from the old session never lingers.
    setVideoFrame(null);
    setLiveSnapshot(null);
    setSnapshotAgeMs(null);
  };
  const stopRef = useRef(stopAndDrain);
  stopRef.current = stopAndDrain;

  useEffect(() => {
    if (!opts.active) return;
    runningRef.current = true;
    // Reset the cursor on every (re)activation. The poll lane reactivates after a
    // reconnect (scene goes idle→live), and a new session's seq can restart BELOW
    // the previous cursor — keeping the old cursor would make the server return
    // "nothing newer" forever and freeze the feed.
    lastSeqRef.current = "-1";
    const loop = async () => {
      while (runningRef.current && ref.current.active) {
        const ac = new AbortController();
        abortRef.current = ac;
        try {
          const p = api.getVideoFrame(lastSeqRef.current, ac.signal);
          inFlightRef.current = p;
          const resp = await p;
          if (!runningRef.current) break;
          // Only advance the overlay alongside a FRESH frame (spec §5.2).
          if (isFreshFrame(lastSeqRef.current, resp) && resp.frame) {
            lastSeqRef.current = nextLastSeq(lastSeqRef.current, resp);
            setVideoFrame({ datatype: resp.frame.datatype, data: resp.frame.data });
            setLiveSnapshot(snapshotForSession(resp, ref.current.sessionGeneration));
            setSnapshotAgeMs(resp.snapshotAgeMs);
          }
        } catch (e) {
          if (!runningRef.current) break; // aborted by stopAndDrain — not an error
          const detail = e instanceof ApiError
            ? e.detail
            : { name: "Error", message: String(e), httpStatus: 500 } as NormalizedError;
          ref.current.onError(detail);
          runningRef.current = false;
          break;
        }
        await new Promise<void>((resolve) => {
          const id = setTimeout(resolve, ref.current.intervalMs ?? 125);
          sleepResolveRef.current = () => { clearTimeout(id); resolve(); };
        });
        sleepResolveRef.current = null;
      }
    };
    void loop().catch(() => {});
    return () => { void stopRef.current(); };
  }, [opts.active]);

  return { videoFrame, liveSnapshot, snapshotAgeMs, stopAndDrain: () => stopRef.current() };
}
