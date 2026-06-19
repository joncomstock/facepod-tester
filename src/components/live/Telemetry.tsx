import { barState } from "../../live/logic.ts";
import type { CaptureFrame, LiveThresholds, Verdict } from "../../live/types.ts";
import type { DeviceParameters } from "../../api.ts";

interface Props {
  frame: CaptureFrame | null;
  liveQuality?: number | null;
  thresholds: LiveThresholds;
  hasReference: boolean;
  verdict: Verdict;
  deviceParams?: DeviceParameters | null;
}

function Bar(
  { name, value, threshold, higherPasses, label, deviceThreshold }: {
    name: string;
    value: number | null;
    threshold: number;
    higherPasses: boolean;
    label: string;
    deviceThreshold?: number;
  },
) {
  const deviceTick = deviceThreshold !== undefined
    ? <div className="thresh-device" style={{ left: `${deviceThreshold * 100}%` }} data-t="device" />
    : null;
  if (value === null) {
    return (
      <div className="tm">
        <div className="name">{name}</div>
        <div className="track">
          <div className="thresh" style={{ left: `${threshold * 100}%` }} data-t={label} />
          {deviceTick}
        </div>
        <div className="val muted">—</div>
      </div>
    );
  }
  const b = barState(value, threshold, higherPasses);
  return (
    <div className="tm">
      <div className="name">{name}</div>
      <div className="track">
        <div className={`fill ${b.tone === "ok" ? "" : b.tone}`} style={{ width: `${b.pct}%` }} />
        <div className="thresh" style={{ left: `${threshold * 100}%` }} data-t={label} />
        {deviceTick}
      </div>
      <div className={`val ${b.tone === "ok" ? "ok" : b.tone}`}>
        {Math.round(value * 100)}<small>%</small>
      </div>
    </div>
  );
}

/** Three threshold-marker bars + the verdict chip (docs/UI-FEEDBACK.md §4). */
export function Telemetry({ frame, liveQuality, thresholds, hasReference, verdict, deviceParams }: Props) {
  const cls = verdict.state === "accept" ? "accept"
    : verdict.state === "reject" ? "reject"
    : "searching";
  // Liveness is shown as live CONFIDENCE (1 − spoofScore) so higher = more live,
  // consistent with Quality/Match — a raw spoof of 0 (best) was reading as a scary
  // empty "0%". Only when a face was actually scored; unmeasured/no-face → "—".
  const livenessMeasured = !!frame && frame.numberOfFaces >= 1 &&
    frame.faceStatus !== "liveness_unmeasured";
  const livenessValue = livenessMeasured ? 1 - frame!.spoofScore : null;
  const livenessThreshold = 1 - thresholds.maximalSpoofScore;
  const livenessDeviceThreshold = deviceParams?.recMaxSpoofProbability != null
    ? 1 - deviceParams.recMaxSpoofProbability
    : undefined;
  const label = verdict.state === "accept" ? "✓ ACCEPT"
    : verdict.state === "reject" ? "✗ REJECT"
    : verdict.state === "acquiring" ? "Acquiring…"
    : "Watching…";
  return (
    <>
      <div className={`verdict ${cls}`}>
        <span className="big">{label}</span>
        {verdict.reasons.length > 0 && (
          <span className="reason">{verdict.reasons.join(" · ")}</span>
        )}
      </div>
      <div className="telem">
        <Bar name="Quality" value={liveQuality ?? frame?.quality ?? null} threshold={thresholds.minimalQuality} higherPasses label={`min ${Math.round(thresholds.minimalQuality * 100)}`} deviceThreshold={deviceParams?.recMinVerifyTemplateQuality} />
        <Bar name="Liveness" value={livenessValue} threshold={livenessThreshold} higherPasses label={`min ${Math.round(livenessThreshold * 100)}`} deviceThreshold={livenessDeviceThreshold} />
        <Bar name="Match" value={hasReference ? (frame?.matchScore ?? null) : null} threshold={thresholds.minimalMatchScore} higherPasses label={`min ${Math.round(thresholds.minimalMatchScore * 100)}`} deviceThreshold={deviceParams?.recMinMatchScoreL1} />
      </div>
      {!hasReference && <p className="hint">Match needs a reference — set one in the dock below.</p>}
    </>
  );
}
