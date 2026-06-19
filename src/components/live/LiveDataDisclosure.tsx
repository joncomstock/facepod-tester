import type { ReactNode } from "react";
import type { CaptureFrame } from "../../live/types.ts";

interface Props {
  frame: CaptureFrame | null;
  frameNat: { w: number; h: number } | null;
  videoDatatype: string | null;
  fps: number | null;
  brightness: number | null;
  distance: "near" | "ok" | "far" | null;
  hasReference: boolean;
}

const DASH = "—";

function Row({ k, v, tone }: { k: string; v: ReactNode; tone?: "ok" | "bad" | "muted" }) {
  return (
    <div className="fd-row">
      <span className="fd-k">{k}</span>
      <span className={`fd-v${tone ? " " + tone : ""}`}>{v}</span>
    </div>
  );
}

/**
 * Always-visible 2-column surface of the live device + API output — as much of what
 * the capture/stream report as we can show. Measured (HID) values up top; the feed
 * stream + derived hints below. Wide rows (landmarks/positioning) span both columns.
 */
export function LiveDataDisclosure(
  { frame, frameNat, videoDatatype, fps, brightness, distance, hasReference }: Props,
) {
  const bb = frame?.boundingBox ?? null;
  const fb = frame?.positioningFeedback ?? null;
  const lm = frame?.landmarks ?? null;
  const hasFace = !!frame && frame.numberOfFaces >= 1;
  const livenessMeasured = hasFace && frame!.faceStatus !== "liveness_unmeasured";

  return (
    <section className="framedata">
      <div className="fd-title">
        Frame data <span className="fd-sub">live device + API output</span>
      </div>
      <div className="fd-grid">
        <Row k="Faces" v={frame ? frame.numberOfFaces : DASH} />
        <Row k="Face status" v={frame?.faceStatus ?? DASH} />
        <Row
          k="Captured"
          v={frame ? (frame.isCaptured ? "yes" : "no") : DASH}
          tone={frame ? (frame.isCaptured ? "ok" : "bad") : "muted"}
        />
        <Row k="Quality" v={frame ? frame.quality.toFixed(3) : DASH} />
        <Row
          k="Spoof score"
          v={livenessMeasured ? frame!.spoofScore.toFixed(3) : (frame ? "not measured" : DASH)}
        />
        <Row
          k="Liveness"
          v={!hasFace ? DASH : !livenessMeasured ? "n/a" : frame!.livenessPassed ? "PASS" : "FAIL"}
          tone={!livenessMeasured ? "muted" : frame!.livenessPassed ? "ok" : "bad"}
        />
        <Row
          k="Match score"
          v={hasReference && frame?.matchScore != null ? frame.matchScore.toFixed(3) : DASH}
        />
        <Row
          k="Match"
          v={!hasReference || frame?.matchPassed == null ? DASH : frame.matchPassed ? "PASS" : "FAIL"}
          tone={!hasReference || frame?.matchPassed == null ? "muted" : frame.matchPassed ? "ok" : "bad"}
        />
        <Row k="Bounding box" v={bb ? `x ${bb.x}, y ${bb.y}, ${bb.width}×${bb.height}` : DASH} />
        <Row k="Template" v={frame?.liveTemplate ? `present · ${frame.liveTemplate.length} b64` : DASH} />
        <Row k="Frame size" v={frameNat ? `${frameNat.w}×${frameNat.h}` : DASH} />
        <Row k="Frame type" v={videoDatatype ?? DASH} />
        <Row k="Feed rate" v={fps != null ? `${fps.toFixed(1)} fps` : DASH} />
        <Row
          k="Brightness"
          v={brightness != null ? `${Math.round(brightness * 100)}%` : DASH}
          tone="muted"
        />
        <Row k="Distance" v={distance ?? DASH} tone="muted" />
      </div>
      <div className="fd-wide">
        <span className="fd-k">Landmarks</span>
        <span className="fd-v">
          {lm && lm.length > 0
            ? lm.map((l) => `${l.type ?? "?"} (${l.x}, ${l.y})`).join("   ·   ")
            : DASH}
        </span>
      </div>
      <div className="fd-wide">
        <span className="fd-k">Positioning</span>
        <span className="fd-v">
          {fb
            ? `raw=${fb.raw}  ok=${fb.ok}  [${fb.flags.join(", ")}]${fb.unknownBits ? `  unknownBits=${fb.unknownBits}` : ""}`
            : "— (not reported by device)"}
        </span>
      </div>
    </section>
  );
}
