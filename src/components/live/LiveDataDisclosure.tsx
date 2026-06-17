import type { LiveFrame } from "../../live/types.ts";

/** Read-only data surface: bbox, landmarks, raw positioning bits (no overlay). */
export function LiveDataDisclosure({ frame }: { frame: LiveFrame | null }) {
  if (!frame) return null;
  const bb = frame.boundingBox;
  const fb = frame.positioningFeedback;
  return (
    <details className="json live-data">
      <summary>Frame data</summary>
      <div className="kv">
        <div><span className="k">Faces:</span> {frame.numberOfFaces}</div>
        <div>
          <span className="k">Bounding box:</span>{" "}
          {bb ? `x=${bb.x} y=${bb.y} w=${bb.width} h=${bb.height}` : "—"}
        </div>
        <div>
          <span className="k">Landmarks:</span>{" "}
          {frame.landmarks && frame.landmarks.length > 0
            ? `${frame.landmarks.length} — ${frame.landmarks.map((l) => `${l.type ?? "?"}(${l.x},${l.y})`).join(", ")}`
            : "—"}
        </div>
        <div>
          <span className="k">Positioning:</span>{" "}
          {fb
            ? `raw=${fb.raw} ok=${fb.ok} flags=[${fb.flags.join(", ")}]${fb.unknownBits ? ` unknownBits=${fb.unknownBits}` : ""}`
            : "— (not reported)"}
        </div>
      </div>
    </details>
  );
}
