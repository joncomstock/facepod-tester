import { useCallback, useState } from "react";
import { api, ApiError, type DeviceParameters } from "../api.ts";

/**
 * Session-cached, read-only device parameters. Fetch is non-fatal: a failure
 * sets `error` and leaves `params` null (the UI falls back to operator
 * thresholds and shows an "unavailable" note). `getParameters` requires an
 * open camera — callers fetch only when the camera is open.
 */
export function useDeviceParameters() {
  const [params, setParams] = useState<DeviceParameters | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchParams = useCallback(async () => {
    try {
      const r = await api.getParameters();
      setParams(r.parameters);
      setError(null);
    } catch (e) {
      setParams(null);
      setError(e instanceof ApiError ? e.detail.message : String(e));
    }
  }, []);

  const clearParams = useCallback(() => {
    setParams(null);
    setError(null);
  }, []);

  return { params, error, fetchParams, clearParams };
}
