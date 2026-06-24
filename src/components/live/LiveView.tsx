import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, type NormalizedError, type SessionStatus } from "../../api.ts";
import { DLL_PATH, loadConnectionSettings } from "../../live/connectionSettings.ts";
import { readImageFile } from "../../live/readImageFile.ts";
import { useWatchLoop } from "../../live/useWatchLoop.ts";
import { useFramePoll } from "../../live/useFramePoll.ts";
import { overlayDecision, overlayFromFrame } from "../../live/overlayDisplay.ts";
import { canUseCurrentFace, computeVerdict, guidanceFor, guidanceForSnapshot, shouldAdoptSession } from "../../live/logic.ts";
import type { CaptureFrame, LiveThresholds } from "../../live/types.ts";
import { distanceHint, meanLuminance } from "../../live/derived.ts";
import { captureStaleMs, telemetryStatus, videoStatus } from "../../live/freshness.ts";
import type { ModeId } from "../../live/modes.ts";
import { useHighResStill } from "../../live/useHighResStill.ts";
import { ModeSwitch } from "./ModeSwitch.tsx";
import { HighResControls } from "./HighResControls.tsx";
import { VerifyMode } from "./VerifyMode.tsx";
import { IdentifyMode } from "./IdentifyMode.tsx";
import { ConsoleMode } from "./ConsoleMode.tsx";
import { TuneDrawer } from "./TuneDrawer.tsx";

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
  const [tuneOpen, setTuneOpen] = useState(false);
  const [mode, setMode] = useState<ModeId>("verify");
  const [watching, setWatching] = useState(false);
  const [restoredNotice, setRestoredNotice] = useState(false); // one-time "session restored" banner
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
  const adoptedRef = useRef(false); // one-time session adoption (see effect below)

  const hasReference = refTemplate !== null;

  // streamMode: device CAMERA_STREAM_MODE; 0 = RGB, non-zero = IR (read-only display).
  const streamMode = (deviceParams?.streamMode ?? 0) === 0 ? "RGB" : "IR";
  const hr = useHighResStill({
    pauseWatch: () => setWatching(false),
    resumeWatch: () => setWatching(true),
    onError,
  });

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
    active: watching && scene === "live" && mode === "verify",
    refTemplate,
    thresholds,
    onFrame: (f) => { setFrame(f); setFrameAt(performance.now()); },
    onError: (e) => {
      setWatching(false);
      onError(e);
    },
  });

  const { videoFrame, liveSnapshot, snapshotAgeMs, fps, stopAndDrain: stopFrames } = useFramePoll({
    active: scene === "live" && watching && mode === "verify",
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
    setTuneOpen(false);
    hr.discard();         // revoke any held high-res still blob
    setScene("idle");
    onClearParams?.();
    onSessionChange?.();
  }, [watching, onError, onSessionChange, onClearParams, stopFrames, stopWatch]);

  useEffect(() => {
    if (!watching) setFrame(null);
  }, [watching]);

  // Adopt an already-open device session (e.g. after a page reload) into the HUD
  // when status first resolves — as live but PAUSED, never auto-capturing. `status`
  // arrives async from App, so the useState initializer alone leaves the HUD on
  // "idle" while the header reads CAMERA OPEN. One-shot (adoptedRef) so it can't
  // bounce End session back to live: endSession flips scene→idle before the async
  // status refresh reports cameraOpen:false, which a recurring sync would re-adopt.
  useEffect(() => {
    if (adoptedRef.current || !status) return;
    adoptedRef.current = true; // consider adoption exactly once, so End session can't re-adopt
    if (shouldAdoptSession(status, scene)) {
      setScene("live");
      setWatching(false);
      setRestoredNotice(true); // tell the operator the session was restored, not freshly started
      void onFetchParams?.(); // fetch device thresholds (safe: camera open, loop paused) — matches Go Live
    }
  }, [status, scene]);

  // The restore notice is one-time: it auto-dismisses, and clears the moment the
  // operator starts watching (it's no longer relevant once they're capturing).
  useEffect(() => {
    if (!restoredNotice) return;
    if (watching) { setRestoredNotice(false); return; }
    const id = setTimeout(() => setRestoredNotice(false), 6000);
    return () => clearTimeout(id);
  }, [restoredNotice, watching]);

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

  // Prefer the live per-frame box, but fall back to the finalized capture frame's box —
  // this firmware's intermediate stream carries no geometry (same reason the overlay
  // falls back via overlayFromFrame), so without this Distance stays empty even though
  // the capture box is populated and the bbox is drawn on the feed.
  const distance = distanceHint(
    liveSnapshot?.boundingBox ?? frame?.boundingBox ?? null,
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
          <h1 className="idle-title">FacePod Tester</h1>
          <p className="idle-sub">
            Biometric face module diagnostics. Stand a subject in front of the
            camera to begin.
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
          <p className="connect-msg">Bringing the camera online…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="live-shell">
      {restoredNotice && (
        <div className="notice-banner" role="status">
          <div className="notice-main">
            <span className="notice-title">Existing camera session restored</span>
            <span className="notice-sub">Start watching to resume · End session to reconnect</span>
          </div>
          <button className="icon-btn" aria-label="Dismiss notice" onClick={() => setRestoredNotice(false)}>✕</button>
        </div>
      )}
      <ModeSwitch mode={mode} onPick={setMode} />
      {mode === "verify" && (
        <VerifyMode
          frame={frame}
          verdict={verdict}
          guidance={guidance}
          guidanceDerived={guidanceDerived}
          videoFrame={videoFrame}
          liveFaces={liveFaces}
          overlay={overlay}
          onNaturalSize={setFrameNat}
          feedStatus={feedStatus}
          captureStatus={captureStatus}
          liveQuality={liveSnapshot?.quality ?? null}
          brightness={brightness}
          distance={distance}
          fps={fps}
          frameNat={frameNat}
          videoDatatype={videoFrame?.datatype ?? null}
          thresholds={thresholds}
          hasReference={hasReference}
          deviceParams={deviceParams ?? null}
          deviceParamsError={deviceParamsError ?? null}
          onRefreshParams={refreshParams}
          watching={watching}
          referenceThumb={refThumb}
          referenceLabel={refLabel}
          canUseCurrentFace={currentFaceOk}
          onToggleWatch={() => { if (!watching) onError(null); setWatching((w) => !w); }}
          onPickReference={pickReference}
          onClearReference={() => { setRefTemplate(null); setRefThumb(null); setRefLabel(null); }}
          onEnd={endSession}
          onUseCurrentFace={useCurrentFace}
          highResSlot={
            <HighResControls
              active={scene === "live" && watching && mode === "verify"}
              streamMode={streamMode}
              hr={hr}
              captureReq={{
                minimalQuality: thresholds.minimalQuality,
                maximalSpoofScore: thresholds.maximalSpoofScore,
                timeoutMs: thresholds.timeoutMs,
              }}
              onOpenTune={() => setTuneOpen(true)}
            />
          }
        />
      )}
      {mode === "identify" && <IdentifyMode />}
      {mode === "console" && (
        <ConsoleMode
          deviceParams={deviceParams ?? null}
          deviceParamsError={deviceParamsError ?? null}
          onOpenTune={() => setTuneOpen(true)}
        />
      )}
      <TuneDrawer
        open={tuneOpen}
        onClose={() => setTuneOpen(false)}
        deviceParams={deviceParams ?? null}
        narrow={false}
      />
    </div>
  );
}
