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
import { DeviceConfigPanel } from "./components/DeviceConfigPanel.tsx";
import { DeviceStatusPanel } from "./components/DeviceStatusPanel.tsx";
import { CameraControls } from "./components/CameraControls.tsx";
import { CapturePanel, type CaptureThresholds } from "./components/CapturePanel.tsx";
import { MatchPanel } from "./components/MatchPanel.tsx";

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
    timeoutMs: "",
  });
  const [minimalMatchScore, setMinimalMatchScore] = useState(0.7);

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
        <span className="sub">Local hardware test utility · HID U.ARE.U Face Module</span>
      </header>

      <div className="status-strip" role="status" aria-live="polite">
        <span className={`state-pill ${pill.cls}`}>
          <span className="dot" />
          {pill.label}
        </span>
        <div className="status-meta">
          <span><b>Transport:</b> {status?.mock ? "Mock" : "USB / FFI"}</span>
          {!status?.mock && status?.dllPath && <span><b>DLL:</b> {status.dllPath}</span>}
          <span><b>Camera:</b> {status?.cameraOpen ? "open" : "closed"}</span>
          {status?.mock && (
            <span className="mock-tag">
              Mock{status.scenario && status.scenario !== "good" ? ` · ${status.scenario}` : ""}
            </span>
          )}
        </div>
      </div>

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

      <div className="grid">
        <DeviceConfigPanel
          status={status}
          busy={busy}
          onConnect={handleConnect}
          onDisconnect={handleDisconnect}
          onSetScenario={handleSetScenario}
        />
        <DeviceStatusPanel
          status={status}
          deviceInfo={deviceInfo}
          cameras={cameras}
          busy={busy}
          onRefreshInfo={() => run(api.getDeviceInfo, (r) => setDeviceInfo(r.deviceInfo))}
          onRefreshCameras={() => run(api.getCameras, (r) => setCameras(r.cameras))}
        />
        <CameraControls
          status={status}
          cameras={cameras}
          busy={busy}
          onOpen={(req) => run(() => api.openCamera(req))}
          onClose={() => run(api.closeCamera)}
        />
        <CapturePanel
          status={status}
          busy={busy}
          thresholds={thresholds}
          onThresholdChange={(patch) => setThresholds((t) => ({ ...t, ...patch }))}
          result={captureResult}
          onCapture={handleCapture}
        />
        <MatchPanel
          status={status}
          busy={busy}
          minimalMatchScore={minimalMatchScore}
          onMinimalMatchScoreChange={setMinimalMatchScore}
          referenceResult={referenceResult}
          refTemplate={refTemplate}
          liveTemplate={liveTemplate}
          matchResult={matchResult}
          onProcessReference={handleProcessReference}
          onMatch={handleMatch}
          onCaptureAndMatch={handleCaptureAndMatch}
        />
      </div>

      <p className="hint" style={{ marginTop: 24 }}>
        Workflow: connect → device info / cameras → open camera → upload &amp; process reference →
        capture live face → match → close camera → disconnect.
      </p>
    </div>
  );
}
