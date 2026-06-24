import { ComingSoon } from "./ComingSoon.tsx";
import type { DeviceParameters } from "../../api.ts";

interface Props {
  open: boolean;
  onClose: () => void;
  deviceParams: DeviceParameters | null;
  narrow: boolean;
}

export function TuneDrawer({ open, onClose, deviceParams, narrow }: Props) {
  if (!open) return null;
  const p = deviceParams;
  const rows: Array<[string, string]> = p
    ? [
        ["Pose limit (yaw)", `±${p.maxYaw}°`],
        ["Stream mode", p.streamMode === 0 ? "RGB" : "IR"],
        ["Stabilization", p.captureStabilization ? "on" : "off"],
        ["High-res capture", p.cameraEnableHighRes ? "on" : "off"],
        ["JPEG quality", String(p.encodingJpegQuality)],
      ]
    : [];
  return (
    <div className="tune-overlay" onClick={onClose}>
      <div
        className={`tune-panel${narrow ? " is-sheet" : ""}`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Tune device parameters"
      >
        <div className="tune-head">
          <div>
            <div className="tune-title">Tune</div>
            <div className="tune-sub">Live parameter values — read-only for now.</div>
          </div>
          <button className="icon-btn" aria-label="Close" onClick={onClose}>✕</button>
        </div>
        <ComingSoon slice={3}>Writing parameters to the running device arrives in Slice 3.</ComingSoon>
        {p ? (
          <div className="tune-rows">
            {rows.map(([k, v]) => (
              <div className="tune-row" key={k}>
                <span>{k}</span>
                <span className="tune-v">{v}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="params-empty">Go Live to read device parameters.</div>
        )}
      </div>
    </div>
  );
}
