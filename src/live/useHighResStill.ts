// src/live/useHighResStill.ts
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { api, ApiError, type CaptureRequest, type HighResMeta, type NormalizedError } from "../api.ts";
import { highResFilename, INITIAL_HIGH_RES, nextHighResState, type HighResState } from "./highResStill.ts";

const BUSY_RETRY_ATTEMPTS = 10; // ~10 * 250ms = 2.5s, covers the watch loop's ≤1500ms capture timeout
const BUSY_RETRY_DELAY_MS = 250;

async function captureHighResRidingBusy(req: CaptureRequest): Promise<{ result: HighResMeta }> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= BUSY_RETRY_ATTEMPTS; attempt++) {
    try {
      return await api.captureHighRes(req);
    } catch (e) {
      lastErr = e;
      if (e instanceof ApiError && e.detail.name === "BusyError" && attempt < BUSY_RETRY_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, BUSY_RETRY_DELAY_MS));
        continue;
      }
      throw e;
    }
  }
  throw lastErr; // unreachable, satisfies the type checker
}

interface Options {
  /** Free the device op-lock for the duration of the capture (pause the watch loop). */
  pauseWatch: () => void;
  resumeWatch: () => void;
  onError: (e: NormalizedError) => void;
}

export interface HighResHandle {
  state: HighResState;
  meta: HighResMeta | null;
  url: string | null;
  capture: (req: CaptureRequest) => Promise<void>;
  download: () => void;
  discard: () => void;
}

export function useHighResStill({ pauseWatch, resumeWatch, onError }: Options): HighResHandle {
  const [state, dispatch] = useReducer(nextHighResState, INITIAL_HIGH_RES);
  const [meta, setMeta] = useState<HighResMeta | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const urlRef = useRef<string | null>(null);

  const revoke = useCallback(() => {
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
      setUrl(null);
    }
  }, []);

  const capture = useCallback(async (req: CaptureRequest) => {
    revoke();
    setMeta(null);
    dispatch({ type: "start" });
    pauseWatch();
    try {
      const { result } = await captureHighResRidingBusy(req);
      if (!result.hasImage || !result.id) {
        dispatch({ type: "noFace" });
        return;
      }
      // Eager one-shot fetch: the id can be evicted by TTL/cap pressure, so grab
      // the bytes now while it is provably valid; Preview/Download reuse the Blob.
      const blob = await api.downloadHighResImage(result.id);
      const objectUrl = URL.createObjectURL(blob);
      urlRef.current = objectUrl;
      setUrl(objectUrl);
      setMeta(result);
      dispatch({ type: "ready" });
    } catch (e) {
      const detail = e instanceof ApiError
        ? e.detail
        : { name: "Error", message: String(e), httpStatus: 500 };
      dispatch({ type: "error", message: detail.message });
      onError(detail);
    } finally {
      resumeWatch();
    }
  }, [revoke, pauseWatch, resumeWatch, onError]);

  const download = useCallback(() => {
    if (!urlRef.current || !meta?.id) return;
    const a = document.createElement("a");
    a.href = urlRef.current;
    a.download = highResFilename(meta.id, meta.encoding);
    document.body.appendChild(a);
    a.click();
    a.remove();
  }, [meta]);

  const discard = useCallback(() => {
    revoke();
    setMeta(null);
    dispatch({ type: "discard" });
  }, [revoke]);

  useEffect(() => () => revoke(), [revoke]); // revoke on unmount

  return { state, meta, url, capture, download, discard };
}
