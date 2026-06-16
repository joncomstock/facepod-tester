import { useCallback, useState } from "react";
import { api, ApiError, type NormalizedError, type SessionStatus } from "../../api.ts";
import { loadConnectionSettings } from "../../live/connectionSettings.ts";
import { readImageFile } from "../../live/readImageFile.ts";
import { useWatchLoop } from "../../live/useWatchLoop.ts";
import { computeVerdict, deriveGuidance } from "../../live/logic.ts";
import type { LiveFrame, LiveThresholds } from "../../live/types.ts";
import { Feed } from "./Feed.tsx";
import { Telemetry } from "./Telemetry.tsx";
import { ActionDock } from "./ActionDock.tsx";

type Scene = "idle" | "connecting" | "live";

interface Props {
  status: SessionStatus | null;
  thresholds: LiveThresholds;
  onError: (e: NormalizedError) => void;
  onSessionChange?: () => void;
}

/** The Live HUD: one-tap Go Live → continuous watch → telemetry + verdict. */
export function LiveView({ status, thresholds, onError, onSessionChange }: Props) {
  const [scene, setScene] = useState<Scene>(status?.cameraOpen ? "live" : "idle");
  const [watching, setWatching] = useState(false);
  const [frame, setFrame] = useState<LiveFrame | null>(null);
  const [refTemplate, setRefTemplate] = useState<string | null>(null);

  const hasReference = refTemplate !== null;
  const verdict = frame
    ? computeVerdict(frame, thresholds, hasReference)
    : { state: "searching" as const, reasons: [] };
  const guidance = frame ? deriveGuidance(frame) : "Step in front of the camera";

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
          <p className="target">Transport <b>USB / FFI</b> · default camera</p>
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
      <Feed frame={frame} verdict={verdict} guidance={guidance} />
      <Telemetry frame={frame} thresholds={thresholds} hasReference={hasReference} verdict={verdict} />
      <ActionDock
        watching={watching}
        hasReference={hasReference}
        onToggleWatch={() => setWatching((w) => !w)}
        onPickReference={pickReference}
        onClearReference={() => setRefTemplate(null)}
      />
      <p className="hint">Guidance is derived in-UI from face size/status, not HID-measured.</p>
    </div>
  );
}
