import { useEffect, useRef, useState } from "react";
import { api, type NormalizedError, toErrorDetail } from "../api.ts";
import { isFreshFrame, nextLastSeq, snapshotForSession } from "./framePoll.ts";
import type { LiveSnapshotState } from "./types.ts";

interface Options {
  active: boolean;
  sessionGeneration: number;
  onError: (e: NormalizedError) => void;
  intervalMs?: number;
  /** Bump to re-arm the poll loop without an `active` toggle (e.g. to resume the
   *  feed after a failed End-session left the retained session paused). */
  restartKey?: number;
}
interface FramePollState {
  videoFrame: { datatype: string; data: string } | null;
  liveSnapshot: LiveSnapshotState | null;
  snapshotAgeMs: number | null;
  /** Rolling feed rate (fresh frames/sec), null until enough samples. */
  fps: number | null;
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
  const [fps, setFps] = useState<number | null>(null);
  const frameTimesRef = useRef<number[]>([]);

  const stopAndDrain = async () => {
    runningRef.current = false;
    abortRef.current?.abort();
    sleepResolveRef.current?.();
    try { await inFlightRef.current; } catch { /* AbortError expected */ }
    // Drop the displayed frame so a stale frame from the old session never lingers.
    setVideoFrame(null);
    setLiveSnapshot(null);
    setSnapshotAgeMs(null);
    setFps(null);
    frameTimesRef.current = [];
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
    frameTimesRef.current = [];
    const loop = async () => {
      while (runningRef.current && ref.current.active) {
        const ac = new AbortController();
        abortRef.current = ac;
        try {
          const p = api.getVideoFrame(lastSeqRef.current, ac.signal);
          inFlightRef.current = p;
          const resp = await p;
          if (!runningRef.current) break;
          // Only advance the IMAGE + overlay alongside a FRESH frame (spec §5.2)...
          if (isFreshFrame(lastSeqRef.current, resp) && resp.frame) {
            lastSeqRef.current = nextLastSeq(lastSeqRef.current, resp);
            setVideoFrame({ datatype: resp.frame.datatype, data: resp.frame.data });
            setLiveSnapshot(snapshotForSession(resp, ref.current.sessionGeneration));
            // Rolling fps over the last ~12 fresh frames (feed rate, a live metric).
            const t = performance.now();
            const times = frameTimesRef.current;
            times.push(t);
            if (times.length > 12) times.shift();
            if (times.length >= 2) {
              const span = times[times.length - 1] - times[0];
              if (span > 0) setFps(((times.length - 1) / span) * 1000);
            }
          }
          // ...but ALWAYS advance the overlay age (server-computed), even on a
          // null-frame response. If frame production stalls, the last overlay must
          // still reach its fade/removal thresholds instead of sticking forever.
          setSnapshotAgeMs(resp.snapshotAgeMs);
        } catch (e) {
          if (!runningRef.current) break; // aborted by stopAndDrain — not an error
          ref.current.onError(toErrorDetail(e));
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
  }, [opts.active, opts.restartKey]);

  return { videoFrame, liveSnapshot, snapshotAgeMs, fps, stopAndDrain: () => stopRef.current() };
}
