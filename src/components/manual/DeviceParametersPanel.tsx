import type { DeviceParameters, SessionStatus } from "../../api.ts";

interface Props {
  status: SessionStatus | null;
  params: DeviceParameters | null;
  onRefresh: () => void;
}

const GROUPS: { title: string; fields: (keyof DeviceParameters)[] }[] = [
  { title: "Recognition", fields: ["recMaxSpoofProbability", "recMinEnrollTemplateQuality", "recMinVerifyTemplateQuality", "recMinMatchScoreL1", "recMinMatchScoreL2", "recMinMatchScoreL3", "faceSelectPolicy", "onlyCenteredFaces", "maxResults", "margin", "captureMode", "captureStabilization"] },
  { title: "Camera", fields: ["cameraEnableHighRes", "cameraSuspend", "cameraIdleTimeoutMs", "cameraEncodingAcceleration", "cameraLowPowerMode", "cameraLowPowerTimeoutMs", "streamMode", "captureImageEncoding", "encodingJpegQuality"] },
  { title: "Geometry", fields: ["minDistance", "maxDistance", "minRoll", "maxRoll", "minPitch", "maxPitch", "minYaw", "maxYaw"] },
  { title: "Exposure", fields: ["dayToNightThreshold", "nightToDayThreshold", "dayToNightViscosity", "nightToDayViscosity", "aeBoundingBoxTimeoutMs"] },
];

/** Read-only device parameters (HFParam reads). Refresh needs an open camera. */
export function DeviceParametersPanel({ status, params, onRefresh }: Props) {
  const cameraOpen = status?.cameraOpen ?? false;
  return (
    <section className="panel">
      <h2>Device Parameters</h2>
      <div className="btn-row" style={{ marginBottom: 12 }}>
        <button className="btn" onClick={onRefresh} disabled={!cameraOpen}>Refresh</button>
        {!cameraOpen && <span className="hint">Open the camera to read parameters.</span>}
      </div>
      {!params
        ? <p className="empty">No parameters loaded.</p>
        : GROUPS.map((g) => (
          <div key={g.title} style={{ marginBottom: 10 }}>
            <div className="modal-section-label" style={{ marginTop: 0 }}>{g.title}</div>
            <div className="kv">
              {g.fields.map((f) => (
                <div key={f}><span className="k">{f}:</span> {String(params[f])}</div>
              ))}
            </div>
          </div>
        ))}
    </section>
  );
}
