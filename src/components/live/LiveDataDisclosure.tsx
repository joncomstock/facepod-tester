import type { ReactNode } from "react";
import type { CaptureFrame } from "../../live/types.ts";
import type { FreshnessStatus } from "../../live/freshness.ts";
import { estimatePose } from "../../live/pose3d.ts";

interface Props {
  frame: CaptureFrame | null;
  frameNat: { w: number; h: number } | null;
  videoDatatype: string | null;
  fps: number | null;
  brightness: number | null;
  distance: "near" | "ok" | "far" | null;
  hasReference: boolean;
  /** Capture-lane freshness — drives Face/Capture/Liveness/Match groups. */
  captureStatus?: FreshnessStatus;
  /** Video-lane freshness — drives the Stream group. */
  videoStatus?: FreshnessStatus;
}

const DASH = "—";

/** Format a derived angle (deg) for display; null → em-dash. */
const degp = (x: number | null) => (x == null ? DASH : `${x.toFixed(1)}°`);

function Row({ k, v, tone, note }: { k: string; v: ReactNode; tone?: "ok" | "bad" | "muted"; note?: string }) {
  // Empty (em-dash) values default to muted so the no-face state reads calm, not a wall of bright dashes.
  const cls = tone ?? (v === DASH ? "muted" : undefined);
  return (
    <div className="fd-row">
      <span className="fd-k">{k}</span>
      <span className="fd-val">
        <span className={`fd-v${cls ? " " + cls : ""}`}>{v}</span>
        {note && <span className="fd-note">{note}</span>}
      </span>
    </div>
  );
}

/** A multi-value field rendered as a label row over an indented, left-bordered list
 *  of mono key→value pairs (e.g. Bounding box → origin/size, Landmarks → per-point). */
function Block({ k, note, pairs }: { k: string; note?: string; pairs: { a: string; b: string }[] }) {
  return (
    <div className="fd-block">
      <div className="fd-block-head">
        <span className="fd-k">{k}</span>
        {note && <span className="fd-note">{note}</span>}
      </div>
      <div className="fd-pairs">
        {pairs.map((p, i) => (
          <div className="fd-pair" key={i}>
            <span className="fd-pa">{p.a}</span>
            <span className="fd-pb">{p.b}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Group(
  { title, status = "live", children }: { title: string; status?: FreshnessStatus; children: ReactNode },
) {
  const tag = status === "paused" ? " · paused" : status === "stale" ? " · no signal" : "";
  return (
    <div className={`fd-group ${status}`}>
      <div className="fd-group-title">{title}<span className="fd-group-tag">{tag}</span></div>
      <div className="fd-rows">{children}</div>
    </div>
  );
}

/** Always-visible, grouped surface of the live device + API output. */
export function LiveDataDisclosure(
  { frame, frameNat, videoDatatype, fps, brightness, distance, hasReference, captureStatus = "live", videoStatus = "live" }: Props,
) {
  const bb = frame?.boundingBox ?? null;
  const fb = frame?.positioningFeedback ?? null;
  const lm = frame?.landmarks ?? null;
  const pose = estimatePose(lm, frameNat);
  const hasFace = !!frame && frame.numberOfFaces >= 1;
  const livenessMeasured = hasFace && frame!.faceStatus !== "liveness_unmeasured";
  const headTag = captureStatus === "paused"
    ? "paused"
    : (captureStatus === "stale" || videoStatus === "stale")
    ? "no signal"
    : "live";

  return (
    <section className="framedata">
      <div className="fd-head">
        <span className="fd-title">Frame data</span>
        <span className="fd-headtag">{headTag}</span>
      </div>

      <div className="fd-scroll">
      <Group title="Face" status={captureStatus}>
        <Row k="Faces" v={frame ? frame.numberOfFaces : DASH} />
        <Row k="Face status" v={frame?.faceStatus ?? DASH} />
        {bb
          ? (
            <Block
              k="Bounding box"
              pairs={[
                { a: "origin", b: `${bb.x}, ${bb.y}` },
                { a: "size", b: `${bb.width} × ${bb.height}` },
              ]}
            />
          )
          : <Row k="Bounding box" v={DASH} />}
        {lm && lm.length > 0
          ? (
            <Block
              k="Landmarks"
              note={`${lm.length} pts`}
              pairs={lm.map((l) => ({ a: l.type ?? "?", b: `${l.x}, ${l.y}` }))}
            />
          )
          : <Row k="Landmarks" v={DASH} />}
        {pose
          ? (
            <Block
              k="Pose"
              note={pose.method === "3d" ? "3D fit · derived" : "2D est · derived"}
              pairs={[
                { a: "roll", b: degp(pose.roll) },
                { a: "yaw", b: degp(pose.yaw) },
                { a: "pitch", b: degp(pose.pitch) },
              ]}
            />
          )
          : <Row k="Pose" v={DASH} tone="muted" note="derived from landmarks" />}
        <Row
          k="Positioning"
          v={fb ? `raw=${fb.raw} ok=${fb.ok} [${fb.flags.join(", ")}]${fb.unknownBits ? ` unknownBits=${fb.unknownBits}` : ""}` : DASH}
        />
      </Group>

      <Group title="Capture" status={captureStatus}>
        <Row k="Captured" v={frame ? (frame.isCaptured ? "yes" : "no") : DASH} tone={frame ? (frame.isCaptured ? "ok" : "bad") : "muted"} />
        <Row k="Quality" v={frame ? frame.quality.toFixed(3) : DASH} />
        <Row k="Template" v={frame?.liveTemplate ? `present · ${frame.liveTemplate.length} b64` : DASH} />
      </Group>

      <Group title="Liveness" status={captureStatus}>
        <Row k="Spoof score" v={livenessMeasured ? frame!.spoofScore.toFixed(3) : (frame ? "not measured" : DASH)} note="lower is better" />
        <Row
          k="Liveness"
          v={!hasFace ? DASH : !livenessMeasured ? "n/a" : frame!.livenessPassed ? "PASS" : "FAIL"}
          tone={!livenessMeasured ? "muted" : frame!.livenessPassed ? "ok" : "bad"}
        />
      </Group>

      <Group title="Match" status={captureStatus}>
        <Row k="Match score" v={hasReference && frame?.matchScore != null ? frame.matchScore.toFixed(3) : DASH} />
        <Row
          k="Match"
          v={!hasReference || frame?.matchPassed == null ? DASH : frame.matchPassed ? "PASS" : "FAIL"}
          tone={!hasReference || frame?.matchPassed == null ? "muted" : frame.matchPassed ? "ok" : "bad"}
        />
      </Group>

      <Group title="Stream" status={videoStatus}>
        <Row k="Frame size" v={frameNat ? `${frameNat.w}×${frameNat.h}` : DASH} />
        <Row k="Frame type" v={videoDatatype ?? DASH} />
        <Row k="Feed rate" v={fps != null ? `${fps.toFixed(1)} fps` : DASH} />
        <Row k="Brightness" v={brightness != null ? `${Math.round(brightness * 100)}%` : DASH} tone="muted" note="derived, not HID-measured" />
        <Row k="Distance" v={distance ?? DASH} tone="muted" note="derived, not HID-measured" />
      </Group>
      </div>
    </section>
  );
}
