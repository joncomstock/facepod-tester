import type { ReactNode } from "react";
import type { CaptureFrame, LiveThresholds, Verdict } from "../../live/types.ts";
import type { FreshnessStatus } from "../../live/freshness.ts";
import type { DeviceParameters } from "../../api.ts";
import { overlayFromFrame } from "../../live/overlayDisplay.ts";
import { Feed } from "./Feed.tsx";
import { Telemetry } from "./Telemetry.tsx";
import { ActionDock } from "./ActionDock.tsx";
import { LiveDataDisclosure } from "./LiveDataDisclosure.tsx";

interface VerifyModeProps {
  frame: CaptureFrame | null;
  verdict: Verdict;
  guidance: string | null;
  guidanceDerived: boolean;
  videoFrame: { datatype: string; data: string } | null;
  liveFaces: number;
  overlay: ReturnType<typeof overlayFromFrame>;
  onNaturalSize: (n: { w: number; h: number }) => void;
  feedStatus: FreshnessStatus;
  captureStatus: FreshnessStatus;
  liveQuality: number | null;
  brightness: number | null;
  distance: "near" | "ok" | "far" | null;
  fps: number | null;
  frameNat: { w: number; h: number } | null;
  videoDatatype: string | null;
  thresholds: LiveThresholds;
  hasReference: boolean;
  deviceParams: DeviceParameters | null;
  deviceParamsError: string | null;
  onRefreshParams: () => void;
  // dock
  watching: boolean;
  referenceThumb: string | null;
  referenceLabel: string | null;
  canUseCurrentFace: boolean;
  onToggleWatch: () => void;
  onPickReference: (f: File) => void;
  onClearReference: () => void;
  onEnd: () => void;
  onUseCurrentFace: () => void;
  // high-res controls slot (filled in Task 5; optional here)
  highResSlot?: ReactNode;
}

/** The Verify-mode live HUD body: feed + overlay + gauges + frame data + dock. */
export function VerifyMode(props: VerifyModeProps) {
  const p = props;
  return (
    <>
      <div className="live-grid">
        <div className="live-left">
          <Feed
            frame={p.frame}
            verdict={p.verdict}
            guidance={p.guidance}
            videoFrame={p.videoFrame}
            liveFaces={p.liveFaces}
            overlay={p.overlay}
            onNaturalSize={p.onNaturalSize}
            status={p.feedStatus}
          />
          {p.highResSlot ?? null}
          <Telemetry
            frame={p.frame}
            liveQuality={p.liveQuality}
            thresholds={p.thresholds}
            hasReference={p.hasReference}
            deviceParams={p.deviceParams}
            status={p.captureStatus}
          />
          <p className="footnote">
            {p.guidanceDerived
              ? "Guidance derived in-UI from face size/status — not HID-measured."
              : "Guidance from the device's positioning feedback."}
            {p.deviceParams
              ? <> Device thresholds shown as the dashed tick. <button className="link-btn" onClick={p.onRefreshParams}>Refresh</button></>
              : p.deviceParamsError
                ? ` Device parameters unavailable: ${p.deviceParamsError}`
                : null}
          </p>
        </div>
        <div className="live-right">
          <LiveDataDisclosure
            frame={p.frame}
            frameNat={p.frameNat}
            videoDatatype={p.videoDatatype}
            fps={p.fps}
            brightness={p.brightness}
            distance={p.distance}
            hasReference={p.hasReference}
            captureStatus={p.captureStatus}
            videoStatus={p.feedStatus}
          />
        </div>
      </div>
      <div className="live-dock">
        <ActionDock
          watching={p.watching}
          referenceThumb={p.referenceThumb}
          referenceLabel={p.referenceLabel}
          canUseCurrentFace={p.canUseCurrentFace}
          onToggleWatch={p.onToggleWatch}
          onPickReference={p.onPickReference}
          onClearReference={p.onClearReference}
          onEnd={p.onEnd}
          onUseCurrentFace={p.onUseCurrentFace}
        />
      </div>
    </>
  );
}
