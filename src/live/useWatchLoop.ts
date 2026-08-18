import { useEffect, useRef } from "react";
import { api, type NormalizedError, toErrorDetail } from "../api.ts";
import { toCaptureFrame } from "./logic.ts";
import type { CaptureFrame, LiveThresholds } from "./types.ts";

interface Options {
  active: boolean;
  refTemplate: string | null;
  thresholds: LiveThresholds;
  onFrame: (f: CaptureFrame) => void;
  onError: (e: NormalizedError) => void;
  intervalMs?: number;
}

/**
 * Host-driven continuous watch (Lane 2): while `active`, repeatedly capture
 * (serialized by the server's #track) and, when a reference is held, match the
 * live template against it; each result is folded into a CaptureFrame for
 * `onFrame`. stopAndDrain() aborts the in-flight op and awaits it — call it
 * BEFORE POST /api/disconnect during teardown.
 */
export function useWatchLoop(opts: Options): { stopAndDrain: () => Promise<void> } {
  const ref = useRef(opts);
  ref.current = opts;
  const runningRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const inFlightRef = useRef<Promise<unknown> | null>(null);

  const stopAndDrain = async () => {
    runningRef.current = false;
    abortRef.current?.abort();
    try { await inFlightRef.current; } catch { /* AbortError expected */ }
  };
  const stopRef = useRef(stopAndDrain);
  stopRef.current = stopAndDrain;

  useEffect(() => {
    if (!opts.active) return;
    runningRef.current = true;

    const loop = async () => {
      while (runningRef.current && ref.current.active) {
        const { thresholds, refTemplate, onFrame, onError } = ref.current;
        const ac = new AbortController();
        abortRef.current = ac;
        try {
          const capP = api.capture({
            minimalQuality: thresholds.minimalQuality,
            maximalSpoofScore: thresholds.maximalSpoofScore,
            // Bound a live capture so the loop stays responsive; default 1500ms.
            timeoutMs: thresholds.timeoutMs ?? 1500,
          }, ac.signal);
          inFlightRef.current = capP;
          const cap = await capP;
          let match = null;
          const live = cap.result.template?.data ?? null;
          if (refTemplate && live) {
            const matchP = api.match({
              template1: refTemplate,
              template2: live,
              minimalMatchScore: thresholds.minimalMatchScore,
            }, ac.signal);
            inFlightRef.current = matchP;
            const m = await matchP;
            match = m.result;
          }
          if (!runningRef.current) break;
          onFrame(toCaptureFrame(cap.result, match));
        } catch (e) {
          if (!runningRef.current) break; // aborted by stopAndDrain — not an error
          const detail = toErrorDetail(e);
          // 409 BusyError is transient (a manual op raced us) — pause and retry.
          if (detail.name !== "BusyError") {
            onError(detail);
            runningRef.current = false;
            break;
          }
        }
        await new Promise((r) => setTimeout(r, ref.current.intervalMs ?? 150));
      }
    };
    void loop().catch(() => {});

    return () => { void stopRef.current(); };
  }, [opts.active]);

  return { stopAndDrain: () => stopRef.current() };
}
