import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, type NormalizedError, type SessionStatus } from "../../api.ts";
import { DLL_PATH, loadConnectionSettings } from "../../live/connectionSettings.ts";
import { readImageFile } from "../../live/readImageFile.ts";
import { useWatchLoop } from "../../live/useWatchLoop.ts";
import { useFramePoll } from "../../live/useFramePoll.ts";
import { overlayDecision, overlayFromFrame } from "../../live/overlayDisplay.ts";
import { canUseCurrentFace, computeVerdict, guidanceFor, guidanceForSnapshot } from "../../live/logic.ts";
import type { CaptureFrame, LiveThresholds } from "../../live/types.ts";
import { distanceHint, meanLuminance } from "../../live/derived.ts";
import { captureStaleMs, telemetryStatus, videoStatus } from "../../live/freshness.ts";
import { Feed } from "./Feed.tsx";
import { Telemetry } from "./Telemetry.tsx";
import { ActionDock } from "./ActionDock.tsx";
import { LiveDataDisclosure } from "./LiveDataDisclosure.tsx";

type Scene = "idle" | "connecting" | "live";

interface Props {
  status: SessionStatus | null;
  thresholds: LiveThresholds;
  onError: (e: NormalizedError | null) => void;
  onSessionChange?: () => void;
  deviceParams?: import("../../api.ts").DeviceParameters | null;
  deviceParamsError?: string | null;
  onFetchParams?: () => Promise<void>;
  onClearParams?: () => void;
}

/** The Live HUD: one-tap Go Live → continuous watch → telemetry + verdict. */
export function LiveView({ status, thresholds, onError, onSessionChange, deviceParams, deviceParamsError, onFetchParams, onClearParams }: Props) {
  const [scene, setScene] = useState<Scene>(status?.cameraOpen ? "live" : "idle");
  const [watching, setWatching] = useState(false);
  const [frame, setFrame] = useState<CaptureFrame | null>(null);
  const [refTemplate, setRefTemplate] = useState<string | null>(null);
  const [brightness, setBrightness] = useState<number | null>(null);
  const [frameNat, setFrameNat] = useState<{ w: number; h: number } | null>(null);
  const [feedEpoch, setFeedEpoch] = useState(0); // bump to re-arm the frame poll
  const [refThumb, setRefThumb] = useState<string | null>(null);
  const [refLabel, setRefLabel] = useState<string | null>(null);
  const [frameAt, setFrameAt] = useState<number | null>(null);          // last capture frame
  const [videoFrameAt, setVideoFrameAt] = useState<number | null>(null); // last video frame
  const [watchStartedAt, setWatchStartedAt] = useState<number | null>(null); // for the startup grace
  const [now, setNow] = useState<number>(() => performance.now());
  const frameTickRef = useRef(0);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const hasReference = refTemplate !== null;

  const captureAgeMs = frameAt == null ? null : now - frameAt;
  const videoAgeMs = videoFrameAt == null ? null : now - videoFrameAt;
  const sinceStartMs = watchStartedAt == null ? null : now - watchStartedAt;
  // Capture staleness scales with the configurable capture timeout (+ match/processing margin).
  const captureStaleAfterMs = captureStaleMs(thresholds.timeoutMs);
  const captureStatus = telemetryStatus({ watching, captureAgeMs, sinceStartMs, staleAfterMs: captureStaleAfterMs });
  const feedStatus = videoStatus({ active: scene === "live" && watching, videoAgeMs, sinceStartMs });
  // Eligible only when the capture lane is genuinely LIVE (not paused/stale) AND the
  // current frame passes the strict gate — a stalled good frame must not qualify.
  const currentFaceOk = captureStatus === "live" && canUseCurrentFace(frame, thresholds);

  const verdict = frame
    ? computeVerdict(frame, thresholds, hasReference)
    : { state: "searching" as const, reasons: [] };

  const { stopAndDrain: stopWatch } = useWatchLoop({
    active: watching && scene === "live",
    refTemplate,
    thresholds,
    onFrame: (f) => { setFrame(f); setFrameAt(performance.now()); },
    onError: (e) => {
      setWatching(false);
      onError(e);
    },
  });

  const { videoFrame, liveSnapshot, snapshotAgeMs, fps, stopAndDrain: stopFrames } = useFramePoll({
    active: scene === "live" && watching,
    sessionGeneration: status?.sessionGeneration ?? 0,
    onError,
    restartKey: feedEpoch,
  });
  // Overlay source: prefer the real-time live snapshot (when a firmware streams
  // per-frame geometry); otherwise fall back to the finalized capture frame, whose
  // bbox/landmarks ARE populated. This firmware's intermediate stream carries no
  // geometry, so without the fallback the box never draws (it updates at capture
  // cadence ~per op, not per video frame).
  const overlay = overlayDecision({ snapshot: liveSnapshot, snapshotAgeMs, fadeStartMs: 750, removeMs: 1500 })
    ?? overlayFromFrame(frame);
  // Face presence for the glow: either lane seeing a face counts (the live snapshot
  // is empty on this firmware, so the capture frame carries presence).
  const liveFaces = Math.max(liveSnapshot?.numberOfFaces ?? 0, frame?.numberOfFaces ?? 0);

  // Positioning guidance prefers the PER-FRAME live snapshot (Lane 1); a live
  // corrective ("Turn right", "Move closer") updates in real time. Only when the
  // live snapshot has no correction do we fall back to the capture-frame guidance,
  // which alone knows the locked/acquiring nuance (isCaptured is capture-cadence).
  const live = guidanceForSnapshot(liveSnapshot);
  const g = frame ? guidanceFor(frame) : { text: "Step in front of the camera", derived: true };
  const guidance = live ? live.text : g.text;
  const guidanceDerived = live ? live.derived : g.derived;

  const refreshParams = useCallback(async () => {
    setWatching(false);          // free the device lock
    await onFetchParams?.();
    setWatching(true);
  }, [onFetchParams]);

  const goLive = useCallback(async () => {
    onError(null); // clear any stale error pill immediately on retry
    setScene("connecting");
    try {
      const s = loadConnectionSettings();
      await api.connect({
        dllPath: DLL_PATH, // baked-in (non-UI); preserves current Go Live behaviour
        mock: s.mock || undefined,
        mockScenario: s.scenario,
      });
      await api.openCamera({});
      await onFetchParams?.(); // params need an open camera; loop not started yet → no lock contention
      onSessionChange?.();
      setScene("live");
      setWatching(true);
    } catch (e) {
      setScene("idle");
      onError(
        e instanceof ApiError ? e.detail : { name: "Error", message: String(e), httpStatus: 500 },
      );
    }
  }, [onError]);

  const endSession = useCallback(async () => {
    const wasWatching = watching;
    setWatching(false);
    await stopFrames();   // 1. stop Lane 1, await in-flight frame request
    await stopWatch();    // 2. abort + drain Lane 2 (capture/match)
    try {
      await api.disconnect(); // 3. server flips #closing, drains frame-reads, disposes
    } catch (e) {
      // The server intentionally RETAINS the live device when a lane can't drain (a
      // wedged op/read) — it did not disconnect. Surface the error, don't falsely show
      // idle, and RESUME the lanes so the retained session isn't left frozen: restore
      // the prior watch state and re-arm the frame poll (scene stays "live", so the
      // poll won't re-arm on its own without bumping restartKey).
      onError(e instanceof ApiError ? e.detail : { name: "Error", message: String(e), httpStatus: 500 });
      onSessionChange?.(); // refresh the status strip — it still reads connected
      setWatching(wasWatching);
      setFeedEpoch((n) => n + 1);
      return;
    }
    setFrame(null);       // 4. clear client state (only after a real disconnect)
    setRefTemplate(null);
    setRefThumb(null);
    setRefLabel(null);
    setScene("idle");
    onClearParams?.();
    onSessionChange?.();
  }, [watching, onError, onSessionChange, onClearParams, stopFrames, stopWatch]);

  useEffect(() => {
    if (!watching) setFrame(null);
  }, [watching]);

  useEffect(() => {
    if (!watching) return;
    const id = setInterval(() => setNow(performance.now()), 1000);
    return () => clearInterval(id);
  }, [watching]);
  useEffect(() => { if (videoFrame) setVideoFrameAt(performance.now()); }, [videoFrame]);
  // On (re)start, reset both lane timestamps and stamp the start, so the grace window
  // applies and a leftover/null age can't flash "No signal" immediately.
  useEffect(() => {
    if (watching) { setFrameAt(null); setVideoFrameAt(null); setWatchStartedAt(performance.now()); }
    else { setWatchStartedAt(null); }
  }, [watching]);

  useEffect(() => {
    if (!videoFrame) return;
    if (frameTickRef.current++ % 8 !== 0) return; // throttle: ~1 of 8 frames
    const img = new Image();
    img.onload = () => {
      const cv = (canvasRef.current ??= document.createElement("canvas"));
      cv.width = 32; cv.height = 57; // tiny, ~9:16; just for a luminance estimate
      const ctx = cv.getContext("2d", { willReadFrequently: true });
      if (!ctx) return;
      ctx.drawImage(img, 0, 0, cv.width, cv.height);
      setBrightness(meanLuminance(ctx.getImageData(0, 0, cv.width, cv.height).data));
    };
    img.src = `data:image/${videoFrame.datatype === "jpg" ? "jpeg" : videoFrame.datatype};base64,${videoFrame.data}`;
  }, [videoFrame]);

  const distance = distanceHint(
    liveSnapshot?.boundingBox ?? null,
    frameNat ? frameNat.w * frameNat.h : 0,
  );

  const useCurrentFace = useCallback(() => {
    if (captureStatus === "live" && canUseCurrentFace(frame, thresholds) && frame?.liveTemplate) {
      setRefTemplate(frame.liveTemplate);
      setRefThumb(null);
      setRefLabel("Current face");
    }
  }, [frame, thresholds, captureStatus]);

  const pickReference = useCallback(async (file: File) => {
    const read = await readImageFile(file);
    if ("error" in read) {
      onError({ name: "ReferenceError", message: read.error, httpStatus: 400 });
      return;
    }
    try {
      const r = await api.processImage({
        image: read.data,
        datatype: read.datatype,
        minimalQuality: thresholds.minimalQuality,
      });
      if (!r.result.template) {
        onError({ name: "ReferenceError", message: "No face found in reference image.", httpStatus: 422 });
        return;
      }
      setRefTemplate(r.result.template.data);
      setRefThumb(`data:image/${read.datatype === "jpg" ? "jpeg" : read.datatype};base64,${read.data}`);
      setRefLabel("Photo");
    } catch (e) {
      onError(e instanceof ApiError ? e.detail : { name: "Error", message: String(e), httpStatus: 500 });
    }
  }, [onError, thresholds.minimalQuality]);

  if (scene === "idle") {
    return (
      <div className="live-shell">
        <div className="center-scene">
          <div className="idle-mark"><span className="m" /></div>
          <h1 className="idle-title">Ready when you are</h1>
          <p className="idle-sub">
            Tap to bring the camera online and start watching for a face. No setup —
            the device default is pre-configured.
          </p>
          <button className="go" onClick={goLive}>Go Live</button>
        </div>
      </div>
    );
  }

  if (scene === "connecting") {
    return (
      <div className="live-shell">
        <div className="center-scene">
          <div className="ring" />
          <h1 className="idle-title" style={{ fontSize: 26 }}>Bringing the camera online…</h1>
          <p className="idle-sub">Connecting to the module and opening the default camera.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="live-shell live-grid">
      <div className="live-left">
        <Feed frame={frame} verdict={verdict} guidance={guidance} videoFrame={videoFrame} liveFaces={liveFaces} overlay={overlay} onNaturalSize={setFrameNat} status={feedStatus} />
        <Telemetry frame={frame} liveQuality={liveSnapshot?.quality ?? null} thresholds={thresholds} hasReference={hasReference} deviceParams={deviceParams ?? null} status={captureStatus} />
        {deviceParams
          ? (
            <p className="hint">
              Device thresholds shown as the dashed reference tick. <button className="link-btn" onClick={refreshParams}>Refresh</button>
            </p>
          )
          : deviceParamsError
            ? <p className="hint">Device parameters unavailable: {deviceParamsError}</p>
            : null}
        <p className="hint feed-note">
          {guidanceDerived
            ? "Guidance is derived in-UI from face size/status, not HID-measured."
            : "Guidance is from the device's positioning feedback."}
        </p>
      </div>
      <div className="live-right">
        <LiveDataDisclosure
          frame={frame}
          frameNat={frameNat}
          videoDatatype={videoFrame?.datatype ?? null}
          fps={fps}
          brightness={brightness}
          distance={distance}
          hasReference={hasReference}
          captureStatus={captureStatus}
          videoStatus={feedStatus}
        />
      </div>
      <div className="live-dock">
        <ActionDock
          watching={watching}
          referenceThumb={refThumb}
          referenceLabel={refLabel}
          canUseCurrentFace={currentFaceOk}
          onToggleWatch={() => { if (!watching) onError(null); setWatching((w) => !w); }}
          onPickReference={pickReference}
          onClearReference={() => { setRefTemplate(null); setRefThumb(null); setRefLabel(null); }}
          onEnd={endSession}
          onUseCurrentFace={useCurrentFace}
        />
      </div>
    </div>
  );
}
