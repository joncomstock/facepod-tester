import { barState, livenessConfidence, livenessConfidenceThreshold } from "../../live/logic.ts";
import type { CaptureFrame, LiveThresholds } from "../../live/types.ts";
import type { DeviceParameters } from "../../api.ts";
import type { FreshnessStatus } from "../../live/freshness.ts";

interface Props {
  frame: CaptureFrame | null;
  liveQuality?: number | null;
  thresholds: LiveThresholds;
  hasReference: boolean;
  deviceParams?: DeviceParameters | null;
  status?: FreshnessStatus;
}

function Gauge(
  { name, value, threshold, label, deviceThreshold, emptyLabel = "—" }: {
    name: string;
    value: number | null;
    threshold: number;
    label: string;
    deviceThreshold?: number;
    emptyLabel?: string;
  },
) {
  const b = value === null ? null : barState(value, threshold, true);
  return (
    <div className="gauge">
      <div className="gauge-head">
        <span className="gauge-name">{name}</span>
        <span className={`gauge-val ${b ? b.tone : "muted"}`}>
          {value === null ? emptyLabel : <>{Math.round(value * 100)}<small>%</small></>}
        </span>
      </div>
      <div className="gauge-track">
        {b && <div className={`gauge-fill ${b.tone === "ok" ? "" : b.tone}`} style={{ width: `${b.pct}%` }} />}
        <div className="gauge-thresh" style={{ left: `${threshold * 100}%` }}><span>{label}</span></div>
        {deviceThreshold !== undefined && (
          <div className="gauge-device" style={{ left: `${deviceThreshold * 100}%` }}><span>device</span></div>
        )}
      </div>
    </div>
  );
}

/** Quality / Liveness / Match gauges — all higher-is-better (Liveness = 1 − spoof). */
export function Telemetry(
  { frame, liveQuality, thresholds, hasReference, deviceParams, status = "live" }: Props,
) {
  // Gate on the score's own presence, not on the faceStatus string. The score IS the
  // measurement; the string was a proxy for it, and a proxy decouples silently — feeding
  // an unmeasured score to `1 - spoofScore` renders the gauge as NaN%.
  const livenessValue = frame && frame.numberOfFaces >= 1 && frame.spoofScore != null
    ? livenessConfidence(frame.spoofScore)
    : null;
  const livenessThreshold = livenessConfidenceThreshold(thresholds.maximalSpoofScore);
  const livenessDeviceThreshold = deviceParams?.recMaxSpoofProbability != null
    ? livenessConfidence(deviceParams.recMaxSpoofProbability)
    : undefined;

  return (
    <div className={`telem ${status}`}>
      <Gauge
        name="Quality" value={liveQuality ?? frame?.quality ?? null}
        threshold={thresholds.minimalQuality}
        label={`min ${Math.round(thresholds.minimalQuality * 100)}`}
        deviceThreshold={deviceParams?.recMinVerifyTemplateQuality}
      />
      <Gauge
        name="Liveness" value={livenessValue} threshold={livenessThreshold}
        label={`min ${Math.round(livenessThreshold * 100)}`}
        deviceThreshold={livenessDeviceThreshold}
      />
      <Gauge
        name="Match" value={hasReference ? (frame?.matchScore ?? null) : null}
        threshold={thresholds.minimalMatchScore}
        label={`min ${Math.round(thresholds.minimalMatchScore * 100)}`}
        deviceThreshold={deviceParams?.recMinMatchScoreL1}
        emptyLabel={hasReference ? "—" : "No reference"}
      />
      {status === "paused" && <p className="hint telem-stale">Paused — start watching to resume.</p>}
      {status === "stale" && <p className="hint telem-stale">No signal — waiting for frames…</p>}
    </div>
  );
}
