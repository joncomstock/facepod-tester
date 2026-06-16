import type { LiveFrame, Verdict } from "../../live/types.ts";

interface Props {
  frame: LiveFrame | null;
  verdict: Verdict;
  guidance: string | null;
  /** Phase 2 (HFGetVideoFrame) extension points — inert in v1. */
  videoFrame?: { datatype: string; data: string } | null;
  overlayBox?: { x: number; y: number; width: number; height: number } | null;
}

function imgSrc(datatype: string, data: string): string {
  return `data:image/${datatype === "jpg" ? "jpeg" : datatype};base64,${data}`;
}

/**
 * The viewfinder. v1 shows the live detected-face image (refreshed by the watch
 * loop) inside a framed reticle with a detection-state glow. `videoFrame` /
 * `overlayBox` are reserved for the Phase 2 full-frame feed + tracking box.
 */
export function Feed({ frame, verdict, guidance, videoFrame = null, overlayBox = null }: Props) {
  const img = videoFrame ?? frame?.image ?? null;
  const locked = verdict.state === "accept";
  const present = verdict.state !== "searching";
  return (
    <div className={`feed ${locked ? "locked" : present ? "present" : "searching"}`}>
      {img
        ? <img className="feed-img" src={imgSrc(img.datatype, img.data)} alt="live face" />
        : <div className="feed-empty" />}
      <div className="grain" />
      <div className="scan" />
      <div className="bracket tl" /><div className="bracket tr" />
      <div className="bracket bl" /><div className="bracket br" />
      {overlayBox && (
        <div
          className="bbox"
          style={{
            left: `${overlayBox.x}px`,
            top: `${overlayBox.y}px`,
            width: `${overlayBox.width}px`,
            height: `${overlayBox.height}px`,
          }}
        />
      )}
      {guidance && (
        <div className="guide"><span className="ar">⌖</span>{guidance}</div>
      )}
    </div>
  );
}
