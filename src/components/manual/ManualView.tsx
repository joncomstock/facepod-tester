import {
  type CameraInfo,
  type CaptureResult,
  type ConnectRequest,
  type DeviceInfo,
  type ImageDatatype,
  type MatchResult,
  type MockScenario,
  type ProcessResult,
  type SessionStatus,
} from "../../api.ts";
import { DeviceConfigPanel } from "../DeviceConfigPanel.tsx";
import { DeviceStatusPanel } from "../DeviceStatusPanel.tsx";
import { CameraControls } from "../CameraControls.tsx";
import { CapturePanel, type CaptureThresholds } from "../CapturePanel.tsx";
import { MatchPanel } from "../MatchPanel.tsx";

interface Props {
  status: SessionStatus | null;
  busy: boolean;
  deviceInfo: DeviceInfo | null;
  cameras: CameraInfo[] | null;
  captureResult: CaptureResult | null;
  referenceResult: ProcessResult | null;
  matchResult: MatchResult | null;
  refTemplate: string | null;
  liveTemplate: string | null;
  thresholds: CaptureThresholds;
  minimalMatchScore: number;
  onThresholdChange: (patch: Partial<CaptureThresholds>) => void;
  onMinimalMatchScoreChange: (v: number) => void;
  onConnect: (req: ConnectRequest) => void;
  onDisconnect: () => void;
  onSetScenario: (s: MockScenario) => void;
  onRefreshInfo: () => void;
  onRefreshCameras: () => void;
  onOpenCamera: (req: { cameraId?: string; algorithmType?: "on_device"; reservationTimeoutMs?: number }) => void;
  onCloseCamera: () => void;
  onCapture: () => void;
  onProcessReference: (image: { image: string; datatype: ImageDatatype }) => void;
  onMatch: () => void;
  onCaptureAndMatch: (image: { image: string; datatype: ImageDatatype }) => void;
}

/** The original step-by-step panels (01–05) preserved as the manual/debug surface. */
export function ManualView(p: Props) {
  return (
    <>
      <div className="grid">
        <DeviceConfigPanel
          status={p.status}
          busy={p.busy}
          onConnect={p.onConnect}
          onDisconnect={p.onDisconnect}
          onSetScenario={p.onSetScenario}
        />
        <DeviceStatusPanel
          status={p.status}
          deviceInfo={p.deviceInfo}
          cameras={p.cameras}
          busy={p.busy}
          onRefreshInfo={p.onRefreshInfo}
          onRefreshCameras={p.onRefreshCameras}
        />
        <CameraControls
          status={p.status}
          cameras={p.cameras}
          busy={p.busy}
          onOpen={p.onOpenCamera}
          onClose={p.onCloseCamera}
        />
        <CapturePanel
          status={p.status}
          busy={p.busy}
          thresholds={p.thresholds}
          onThresholdChange={p.onThresholdChange}
          result={p.captureResult}
          onCapture={p.onCapture}
        />
        <MatchPanel
          status={p.status}
          busy={p.busy}
          minimalMatchScore={p.minimalMatchScore}
          onMinimalMatchScoreChange={p.onMinimalMatchScoreChange}
          referenceResult={p.referenceResult}
          refTemplate={p.refTemplate}
          liveTemplate={p.liveTemplate}
          matchResult={p.matchResult}
          onProcessReference={p.onProcessReference}
          onMatch={p.onMatch}
          onCaptureAndMatch={p.onCaptureAndMatch}
        />
      </div>
      <p className="hint" style={{ marginTop: 24 }}>
        Workflow: connect → device info / cameras → open camera → upload &amp; process reference →
        capture live face → match → close camera → disconnect.
      </p>
    </>
  );
}
