import { useCallback, useEffect, useState } from "react";
import { api, ApiError, type NormalizedError, type SessionStatus } from "../../api.ts";
import { loadConnectionSettings } from "../../live/connectionSettings.ts";
import { readImageFile } from "../../live/readImageFile.ts";
import { useWatchLoop } from "../../live/useWatchLoop.ts";
import { useFramePoll } from "../../live/useFramePoll.ts";
import { overlayDecision } from "../../live/overlayDisplay.ts";
import { computeVerdict, guidanceFor } from "../../live/logic.ts";
import type { LiveFrame, LiveThresholds } from "../../live/types.ts";
import { Feed } from "./Feed.tsx";
import { Telemetry } from "./Telemetry.tsx";
import { ActionDock } from "./ActionDock.tsx";
import { LiveDataDisclosure } from "./LiveDataDisclosure.tsx";

type Scene = "idle" | "connecting" | "live";

interface Props {
  status: SessionStatus | null;
  thresholds: LiveThresholds;
  onError: (e: NormalizedError) => void;
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
  const [frame, setFrame] = useState<LiveFrame | null>(null);
  const [refTemplate, setRefTemplate] = useState<string | null>(null);

  const hasReference = refTemplate !== null;
  const verdict = frame
    ? computeVerdict(frame, thresholds, hasReference)
    : { state: "searching" as const, reasons: [] };
  const g = frame ? guidanceFor(frame) : { text: "Step in front of the camera", derived: true };
  const guidance = g.text;
  const guidanceDerived = g.derived;

  useWatchLoop({
    active: watching && scene === "live",
    refTemplate,
    thresholds,
    onFrame: setFrame,
    onError: (e) => {
      setWatching(false);
      onError(e);
    },
  });

  const { videoFrame, liveSnapshot, snapshotAgeMs, stopAndDrain: stopFrames } = useFramePoll({
    active: scene === "live",
    sessionGeneration: status?.sessionGeneration ?? 0,
    onError,
  });
  const overlay = overlayDecision({ snapshot: liveSnapshot, snapshotAgeMs, fadeStartMs: 750, removeMs: 1500 });

  const refreshParams = useCallback(async () => {
    setWatching(false);          // free the device lock
    await onFetchParams?.();
    setWatching(true);
  }, [onFetchParams]);

  const goLive = useCallback(async () => {
    setScene("connecting");
    try {
      const s = loadConnectionSettings();
      const poll = s.pollIntervalMs.trim();
      await api.connect({
        dllPath: s.dllPath.trim() || undefined,
        dllDir: s.dllDir.trim() || undefined,
        pollIntervalMs: poll === "" ? undefined : Number(poll),
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
    await stopFrames();
    try {
      await api.disconnect();
    } catch (e) {
      onError(e instanceof ApiError ? e.detail : { name: "Error", message: String(e), httpStatus: 500 });
    }
    setWatching(false);
    setFrame(null);
    setRefTemplate(null);
    setScene("idle");
    onClearParams?.();
    onSessionChange?.();
  }, [onError, onSessionChange, onClearParams, stopFrames]);

  useEffect(() => {
    if (!watching) setFrame(null);
  }, [watching]);

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
          <p className="target">Transport <b>{loadConnectionSettings().mock ? "Mock" : "USB / FFI"}</b> · default camera</p>
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
    <div className="live-shell">
      <Feed frame={frame} verdict={verdict} guidance={guidance} videoFrame={videoFrame} liveFaces={liveSnapshot?.numberOfFaces} overlay={overlay} />
      <Telemetry frame={frame} thresholds={thresholds} hasReference={hasReference} verdict={verdict} deviceParams={deviceParams ?? null} />
      <ActionDock
        watching={watching}
        hasReference={hasReference}
        onToggleWatch={() => setWatching((w) => !w)}
        onPickReference={pickReference}
        onClearReference={() => setRefTemplate(null)}
        onEnd={endSession}
      />
      {deviceParams
        ? (
          <p className="hint">
            Device thresholds shown as the dashed reference tick. <button className="link-btn" onClick={refreshParams}>Refresh</button>
          </p>
        )
        : deviceParamsError
          ? <p className="hint">Device parameters unavailable: {deviceParamsError}</p>
          : null}
      <LiveDataDisclosure frame={frame} />
      <p className="hint">
        {guidanceDerived
          ? "Guidance is derived in-UI from face size/status, not HID-measured."
          : "Guidance is from the device's positioning feedback."}
      </p>
    </div>
  );
}
