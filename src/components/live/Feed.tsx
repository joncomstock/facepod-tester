import { useState } from "react";
import type { CaptureFrame, Verdict } from "../../live/types.ts";
import { mapBox, mapPoint } from "../../live/overlay.ts";

interface Props {
  frame: CaptureFrame | null;
  verdict: Verdict;
  guidance: string | null;
  /** Lane 1 full-frame feed (base64). */
  videoFrame?: { datatype: string; data: string } | null;
  /** Live present/searching glow from the per-frame snapshot face count. */
  liveFaces?: number;
  /** Overlay to draw on the full frame: device-raster coords + opacity (or null). */
  overlay?: { box: { x: number; y: number; width: number; height: number }; points: { x: number; y: number }[]; opacity: number } | null;
  /** Called once when the image's natural dimensions are first known. */
  onNaturalSize?: (s: { w: number; h: number }) => void;
}

function imgSrc(datatype: string, data: string): string {
  return `data:image/${datatype === "jpg" ? "jpeg" : datatype};base64,${data}`;
}

/** The viewfinder: full live frame in a 9:16 box with a bbox + landmark overlay
 *  mapped from the frame's natural pixel dims (no cover-crop, no transform). */
export function Feed({ frame, verdict, guidance, videoFrame = null, liveFaces, overlay = null, onNaturalSize }: Props) {
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null);
  const img = videoFrame ?? frame?.image ?? null;
  const locked = verdict.state === "accept";
  const present = liveFaces != null ? liveFaces >= 1 : verdict.state !== "searching";
  const box = overlay && nat ? mapBox(overlay.box, nat.w, nat.h) : null;
  const vlabel = verdict.state === "accept" ? "✓ ACCEPT"
    : verdict.state === "reject" ? "✗ REJECT"
    : verdict.state === "acquiring" ? "Acquiring…"
    : "Watching…";
  const vreasons = verdict.reasons.length > 0 ? verdict.reasons.join(" · ") : null;
  return (
    <div className={`feed ${locked ? "locked" : present ? "present" : "searching"}`}>
      <div className="feed-media">
        {img
          ? (
            <img
              className="feed-img"
              src={imgSrc(img.datatype, img.data)}
              alt="live face"
              onLoad={(e) => {
                const s = { w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight };
                setNat(s);
                onNaturalSize?.(s);
              }}
            />
          )
          : <div className="feed-empty" />}
        {box && (
          <div className="overlay" style={{ opacity: overlay!.opacity }}>
            <div
              className="bbox"
              style={{ left: `${box.leftPct}%`, top: `${box.topPct}%`, width: `${box.widthPct}%`, height: `${box.heightPct}%` }}
            />
            {nat && overlay!.points.map((p, i) => {
              const pt = mapPoint(p, nat.w, nat.h);
              return <div key={i} className="lmk" style={{ left: `${pt.leftPct}%`, top: `${pt.topPct}%` }} />;
            })}
          </div>
        )}
      </div>
      <div className="grain" />
      <div className="scan" />
      <div className="bracket tl" /><div className="bracket tr" />
      <div className="bracket bl" /><div className="bracket br" />
      <div className={`feed-verdict ${verdict.state}`}>
        <span>{vlabel}</span>
        {vreasons && <span className="vr">{vreasons}</span>}
      </div>
      {guidance && (
        <div className="guide"><span className="ar">⌖</span>{guidance}</div>
      )}
    </div>
  );
}
