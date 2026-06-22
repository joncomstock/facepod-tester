import { useCallback, useEffect, useState } from "react";
import {
  api,
  ApiError,
  type CameraInfo,
  type CaptureRequest,
  type CaptureResult,
  type ConnectRequest,
  type DeviceInfo,
  type ImageDatatype,
  type MatchResult,
  type MockScenario,
  type NormalizedError,
  type ProcessResult,
  type SessionStatus,
} from "./api.ts";
import { type CaptureThresholds } from "./components/CapturePanel.tsx";
import { LiveView } from "./components/live/LiveView.tsx";
import { ManualView } from "./components/manual/ManualView.tsx";
import { useDeviceParameters } from "./live/useDeviceParameters.ts";

function statePill(status: SessionStatus | null, busy: boolean, error: NormalizedError | null) {
  if (busy) return { cls: "state-busy", label: "Busy" };
  if (error) return { cls: "state-error", label: "Error" };
  if (status?.cameraOpen) return { cls: "state-camera", label: "Camera Open" };
  if (status?.connected) return { cls: "state-connected", label: "Connected" };
  return { cls: "state-disconnected", label: "Disconnected" };
}

export function App() {
  const [status, setStatus] = useState<SessionStatus | null>(null);
  const [error, setError] = useState<NormalizedError | null>(null);
  const [busy, setBusy] = useState(false);

  const [deviceInfo, setDeviceInfo] = useState<DeviceInfo | null>(null);
  const [cameras, setCameras] = useState<CameraInfo[] | null>(null);
  const [captureResult, setCaptureResult] = useState<CaptureResult | null>(null);
  const [referenceResult, setReferenceResult] = useState<ProcessResult | null>(null);
  const [matchResult, setMatchResult] = useState<MatchResult | null>(null);

  const [thresholds, setThresholds] = useState<CaptureThresholds>({
    minimalQuality: 0.7,
    maximalSpoofScore: 0.5,
    minimalMatchScore: 0.7,
    timeoutMs: "",
  });
  const [minimalMatchScore, setMinimalMatchScore] = useState(0.7);

  const [mode, setMode] = useState<"live" | "manual">("live");

  const { params: deviceParams, error: deviceParamsError, fetchParams, clearParams } = useDeviceParameters();

  const refTemplate = referenceResult?.template?.data ?? null;
  const liveTemplate = captureResult?.template?.data ?? null;

  const refreshStatus = useCallback(async () => {
    try {
      setStatus(await api.getStatus());
    } catch {
      setStatus((s) => (s ? { ...s, connected: false } : null));
    }
  }, []);

  useEffect(() => {
    refreshStatus();
  }, [refreshStatus]);

  /** Run an API action with busy/error handling and a status refresh. */
  const run = useCallback(
    async <T,>(fn: () => Promise<T>, after?: (r: T) => void) => {
      setBusy(true);
      setError(null);
      try {
        const r = await fn();
        after?.(r);
      } catch (e) {
        setError(
          e instanceof ApiError
            ? e.detail
            : { name: "Error", message: String(e), httpStatus: 500 },
        );
      } finally {
        await refreshStatus();
        setBusy(false);
      }
    },
    [refreshStatus],
  );

  function captureReq(): CaptureRequest {
    const ms = thresholds.timeoutMs.trim();
    return {
      minimalQuality: thresholds.minimalQuality,
      maximalSpoofScore: thresholds.maximalSpoofScore,
      timeoutMs: ms === "" ? undefined : Number(ms),
    };
  }

  // ---- Handlers ----
  const handleConnect = (req: ConnectRequest) =>
    run(() => api.connect(req), async (res) => {
      setDeviceInfo(res.deviceInfo);
      // Pre-load the camera list so the camera selector is populated.
      try {
        setCameras((await api.getCameras()).cameras);
      } catch { /* non-fatal */ }
    });

  const handleDisconnect = () =>
    run(api.disconnect, () => {
      setDeviceInfo(null);
      setCameras(null);
      setCaptureResult(null);
      setReferenceResult(null);
      setMatchResult(null);
      clearParams();
    });

  const handleSetScenario = (scenario: MockScenario) => run(() => api.setScenario(scenario));

  const handleCapture = () => run(() => api.capture(captureReq()), (r) => setCaptureResult(r.result));

  const handleProcessReference = (image: { image: string; datatype: ImageDatatype }) =>
    run(
      () => api.processImage({ ...image, minimalQuality: thresholds.minimalQuality }),
      (r) => setReferenceResult(r.result),
    );

  const handleMatch = () => {
    if (!refTemplate || !liveTemplate) return;
    run(
      () => api.match({ template1: refTemplate, template2: liveTemplate, minimalMatchScore }),
      (r) => setMatchResult(r.result),
    );
  };

  const handleCaptureAndMatch = (image: { image: string; datatype: ImageDatatype }) =>
    run(
      () => api.captureAndMatch({ ...image, minimalMatchScore, capture: captureReq() }),
      (r) => {
        setReferenceResult(r.result.reference);
        setCaptureResult(r.result.live);
        setMatchResult(r.result.match);
      },
    );

  const pill = statePill(status, busy, error);

  return (
    <div className="app">
      <header className="masthead">
        <h1>FacePod Tester</h1>
        <div className="masthead-status" role="status" aria-live="polite">
          <span className={`state-pill ${pill.cls}`}>
            <span className="dot" />
            {pill.label}
          </span>
          {status?.mock && (
            <span className="mock-tag">
              Mock{status.scenario && status.scenario !== "good" ? ` · ${status.scenario}` : ""}
            </span>
          )}
        </div>
        <div className="mode-toggle" role="tablist" aria-label="View mode">
          <button
            role="tab"
            aria-selected={mode === "live"}
            className={mode === "live" ? "on" : ""}
            onClick={() => setMode("live")}
          >
            Live
          </button>
          <button
            role="tab"
            aria-selected={mode === "manual"}
            className={mode === "manual" ? "on" : ""}
            onClick={() => setMode("manual")}
          >
            Manual
          </button>
        </div>
      </header>

      {error && (
        <div className="error-banner" role="alert">
          <span className="etitle">{error.name}</span>
          <span className="ecode">
            {error.code !== undefined ? `code ${error.code}` : ""}
            {error.status !== undefined ? ` · http ${error.status}` : ""}
            {error.datatype ? ` · datatype ${error.datatype}` : ""}
          </span>
          <div>{error.message}</div>
        </div>
      )}

      {mode === "manual"
        ? (
          <ManualView
            status={status}
            busy={busy}
            deviceInfo={deviceInfo}
            cameras={cameras}
            captureResult={captureResult}
            referenceResult={referenceResult}
            matchResult={matchResult}
            refTemplate={refTemplate}
            liveTemplate={liveTemplate}
            thresholds={thresholds}
            minimalMatchScore={minimalMatchScore}
            onThresholdChange={(patch) => setThresholds((t) => ({ ...t, ...patch }))}
            onMinimalMatchScoreChange={setMinimalMatchScore}
            onConnect={handleConnect}
            onDisconnect={handleDisconnect}
            onSetScenario={handleSetScenario}
            onRefreshInfo={() => run(api.getDeviceInfo, (r) => setDeviceInfo(r.deviceInfo))}
            onRefreshCameras={() => run(api.getCameras, (r) => setCameras(r.cameras))}
            onOpenCamera={(req) => run(() => api.openCamera(req))}
            onCloseCamera={() => run(api.closeCamera)}
            onCapture={handleCapture}
            onProcessReference={handleProcessReference}
            onMatch={handleMatch}
            onCaptureAndMatch={handleCaptureAndMatch}
            deviceParams={deviceParams}
            deviceParamsError={deviceParamsError}
            onFetchParams={fetchParams}
          />
        )
        : (
          <LiveView
            status={status}
            thresholds={{
              minimalQuality: thresholds.minimalQuality,
              maximalSpoofScore: thresholds.maximalSpoofScore,
              minimalMatchScore: minimalMatchScore,
            }}
            onError={setError}
            onSessionChange={refreshStatus}
            deviceParams={deviceParams}
            deviceParamsError={deviceParamsError}
            onFetchParams={fetchParams}
            onClearParams={clearParams}
          />
        )}
    </div>
  );
}
