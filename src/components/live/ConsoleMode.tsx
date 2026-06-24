import { ComingSoon } from "./ComingSoon.tsx";
import type { DeviceParameters } from "../../api.ts";

interface Props {
  deviceParams: DeviceParameters | null;
  deviceParamsError: string | null;
  onOpenTune: () => void;
}

export function ConsoleMode({ deviceParams, deviceParamsError, onOpenTune }: Props) {
  const rows: Array<[string, string]> = deviceParams
    ? [
        ["Stream mode", deviceParams.streamMode === 0 ? "RGB" : "IR"],
        ["Capture mode", String(deviceParams.captureMode)],
        ["Min yaw / Max yaw", `${deviceParams.minYaw} / ${deviceParams.maxYaw}`],
        ["Stabilization", deviceParams.captureStabilization ? "on" : "off"],
        ["High-res capture", deviceParams.cameraEnableHighRes ? "on" : "off"],
        ["JPEG quality", String(deviceParams.encodingJpegQuality)],
      ]
    : [];

  return (
    <div className="mode-pane console-pane">
      <div className="console-params">
        <div className="params-head">
          <span className="pane-eyebrow">Device parameters</span>
          <button className="tune-link" onClick={onOpenTune}>⚙ Tune…</button>
        </div>
        {deviceParams ? (
          <div className="params-grid">
            {rows.map(([k, v]) => (
              <div className="param-row" key={k}>
                <span>{k}</span>
                <span className="param-v">{v}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="params-empty">
            {deviceParamsError
              ? `Parameters unavailable: ${deviceParamsError}`
              : "Go Live to read device parameters."}
          </div>
        )}
      </div>
      <ComingSoon slice={2}>
        Echo, reboot, on-device DB reset, and the live device-log stream need the
        diagnostics backend (Slice 2).
      </ComingSoon>
      <div className="console-actions" aria-disabled="true">
        <button className="diag-btn" disabled>Echo / comms test</button>
        <button className="diag-btn" disabled>↻ Reboot device</button>
        <button className="diag-btn" disabled>⌫ Reset on-device DB</button>
      </div>
    </div>
  );
}
