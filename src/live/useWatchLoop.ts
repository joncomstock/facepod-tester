import { useEffect, useRef } from "react";
import { api, ApiError, type NormalizedError } from "../api.ts";
import { toLiveFrame } from "./logic.ts";
import type { LiveFrame, LiveThresholds } from "./types.ts";

interface Options {
  active: boolean;
  refTemplate: string | null;
  thresholds: LiveThresholds;
  onFrame: (f: LiveFrame) => void;
  onError: (e: NormalizedError) => void;
  intervalMs?: number;
}

/**
 * Host-driven continuous watch (docs/UI-FEEDBACK.md §3, loop shape 2): while
 * `active`, repeatedly capture (serialized — never overlap the single device
 * context) and, when a reference template is held, match the live template
 * against it. Each result is folded into a LiveFrame and handed to `onFrame`.
 * A device error stops the loop and is reported via `onError`.
 */
export function useWatchLoop(opts: Options): void {
  // Keep latest opts in a ref so the loop reads fresh values without re-arming.
  const ref = useRef(opts);
  ref.current = opts;
  const runningRef = useRef(false);

  useEffect(() => {
    if (!opts.active) return;
    runningRef.current = true;

    const loop = async () => {
      while (runningRef.current && ref.current.active) {
        const { thresholds, refTemplate, onFrame, onError } = ref.current;
        try {
          const cap = await api.capture({
            minimalQuality: thresholds.minimalQuality,
            maximalSpoofScore: thresholds.maximalSpoofScore,
            timeoutMs: 1500, // bound a live capture so the loop stays responsive
          });
          let match = null;
          const live = cap.result.template?.data ?? null;
          if (refTemplate && live) {
            const m = await api.match({
              template1: refTemplate,
              template2: live,
              minimalMatchScore: thresholds.minimalMatchScore,
            });
            match = m.result;
          }
          if (!runningRef.current) break;
          onFrame(toLiveFrame(cap.result, match));
        } catch (e) {
          const detail = e instanceof ApiError
            ? e.detail
            : { name: "Error", message: String(e), httpStatus: 500 } as NormalizedError;
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

    return () => {
      runningRef.current = false;
    };
  }, [opts.active]);
}
