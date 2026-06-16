import type { CameraInfo, DeviceInfo, SessionStatus } from "../api.ts";
import { JsonViewer } from "./JsonViewer.tsx";

interface Props {
  status: SessionStatus | null;
  deviceInfo: DeviceInfo | null;
  cameras: CameraInfo[] | null;
  busy: boolean;
  onRefreshInfo: () => void;
  onRefreshCameras: () => void;
}

/** Step 2: show device info + camera list. */
export function DeviceStatusPanel(
  { status, deviceInfo, cameras, busy, onRefreshInfo, onRefreshCameras }: Props,
) {
  const connected = status?.connected ?? false;

  return (
    <section className="panel">
      <h2>02 · Device &amp; Cameras</h2>

      {!connected && <p className="empty">Connect to query the device.</p>}

      {connected && (
        <>
          <div className="btn-row" style={{ marginBottom: 12 }}>
            <button className="btn" onClick={onRefreshInfo} disabled={busy}>Get Device Info</button>
            <button className="btn" onClick={onRefreshCameras} disabled={busy}>Get Cameras</button>
          </div>

          {deviceInfo
            ? (
              <div className="kv">
                <div><span className="k">Device ID:</span> {deviceInfo.deviceId}</div>
                <div><span className="k">Type:</span> {deviceInfo.deviceType}</div>
                <div><span className="k">Version:</span> {deviceInfo.version}</div>
                <div><span className="k">Roles:</span> {deviceInfo.deviceRole.join(", ") || "—"}</div>
              </div>
            )
            : <p className="empty">No device info loaded yet.</p>}

          {cameras && (
            <p className="hint" style={{ marginTop: 10 }}>
              {cameras.length} camera{cameras.length === 1 ? "" : "s"}:{" "}
              {cameras.map((c) => `${c.name} (${c.id})`).join(", ") || "none reported"}
            </p>
          )}

          <JsonViewer value={deviceInfo ?? undefined} label="Device info JSON" />
          <JsonViewer value={cameras ?? undefined} label="Cameras JSON" />
        </>
      )}
    </section>
  );
}
