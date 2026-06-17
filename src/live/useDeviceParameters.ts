import { useCallback, useState } from "react";
import { api, ApiError, type DeviceParameters } from "../api.ts";

/**
 * Session-cached, read-only device parameters. Fetch is non-fatal: a failure
 * sets `error` but preserves the last-good `params` (these are reference-only,
 * so a transient fetch failure should not blank already-loaded device ticks).
 * `getParameters` requires an open camera — callers fetch only when the camera
 * is open.
 */
export function useDeviceParameters() {
  const [params, setParams] = useState<DeviceParameters | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchParams = useCallback(async () => {
    // A capture in flight holds the server's busy lock, so a Refresh that races
    // it gets a transient BusyError. Retry once after a short delay before
    // giving up — the in-flight op clears the lock quickly.
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const r = await api.getParameters();
        setParams(r.parameters);
        setError(null);
        return;
      } catch (e) {
        const isBusy = e instanceof ApiError && e.detail.name === "BusyError";
        if (isBusy && attempt === 0) {
          await new Promise((resolve) => setTimeout(resolve, 150));
          continue;
        }
        // Keep the last-good params (reference-only) and just surface the note.
        setError(e instanceof ApiError ? e.detail.message : String(e));
        return;
      }
    }
  }, []);

  const clearParams = useCallback(() => {
    setParams(null);
    setError(null);
  }, []);

  return { params, error, fetchParams, clearParams };
}
