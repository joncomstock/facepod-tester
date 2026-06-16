import { useState } from "react";
import type { ImageDatatype, MatchResult, ProcessResult, SessionStatus } from "../api.ts";
import { JsonViewer } from "./JsonViewer.tsx";
import { readImageFile, type ReadImageOk } from "../live/readImageFile.ts";

interface Props {
  status: SessionStatus | null;
  busy: boolean;
  minimalMatchScore: number;
  onMinimalMatchScoreChange: (v: number) => void;
  referenceResult: ProcessResult | null;
  refTemplate: string | null;
  liveTemplate: string | null;
  matchResult: MatchResult | null;
  onProcessReference: (image: { image: string; datatype: ImageDatatype }) => void;
  onMatch: () => void;
  onCaptureAndMatch: (image: { image: string; datatype: ImageDatatype }) => void;
}

/** Step 05: upload + process a reference image, then match it to the live capture. */
export function MatchPanel(props: Props) {
  const {
    status, busy, minimalMatchScore, onMinimalMatchScoreChange,
    referenceResult, refTemplate, liveTemplate, matchResult,
    onProcessReference, onMatch, onCaptureAndMatch,
  } = props;

  const [ref, setRef] = useState<ReadImageOk | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  const cameraOpen = status?.cameraOpen ?? false;
  const canMatch = !!refTemplate && !!liveTemplate;

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    setFileError(null);
    const file = e.target.files?.[0];
    if (!file) return;
    const result = await readImageFile(file);
    if ("error" in result) {
      setFileError(result.error);
      setRef(null);
    } else {
      setRef(result);
    }
  }

  return (
    <section className="panel span-2">
      <h2>05 · Reference &amp; Match</h2>

      <div className="field-row">
        <div className="field" style={{ flex: 2 }}>
          <label htmlFor="match-file">Reference face image (PNG / JPEG)</label>
          <input id="match-file" type="file" accept="image/png,image/jpeg" onChange={onFile} />
        </div>
        <div className="field">
          <label htmlFor="match-score">minimalMatchScore (0–1)</label>
          <input
            id="match-score"
            type="number" min="0" max="1" step="0.05"
            value={minimalMatchScore}
            onChange={(e) => onMinimalMatchScoreChange(Number(e.target.value))}
          />
        </div>
      </div>

      {fileError && <p className="hint" style={{ color: "hsl(var(--destructive))" }}>{fileError}</p>}

      <div className="btn-row">
        <button
          className="btn"
          disabled={busy || !cameraOpen || !ref}
          onClick={() => ref && onProcessReference({ image: ref.data, datatype: ref.datatype })}
        >
          Process Reference → Template
        </button>
        <button className="btn" disabled={busy || !canMatch} onClick={onMatch}>
          Match Reference ↔ Live
        </button>
        <button
          className="btn primary"
          disabled={busy || !cameraOpen || !ref}
          onClick={() => ref && onCaptureAndMatch({ image: ref.data, datatype: ref.datatype })}
        >
          Capture &amp; Match (combined)
        </button>
      </div>
      {!cameraOpen && <p className="hint">Open the camera to process / capture.</p>}

      <div className="face-preview" style={{ marginTop: 14 }}>
        {ref && (
          <figure>
            <img src={ref.previewUrl} alt="reference upload" />
            <figcaption>Uploaded ({ref.fileName})</figcaption>
          </figure>
        )}
        {referenceResult?.faceImage && (
          <figure>
            <img
              src={`data:image/${referenceResult.faceImage.datatype === "jpg" ? "jpeg" : referenceResult.faceImage.datatype};base64,${referenceResult.faceImage.data}`}
              alt="processed reference face"
            />
            <figcaption>Detected face (quality {referenceResult.quality.toFixed(2)})</figcaption>
          </figure>
        )}
      </div>

      <div className="hint">
        Reference template:{" "}
        <span className={`template-chip ${refTemplate ? "present" : "absent"}`}>
          {refTemplate ? "present" : "none — process a reference"}
        </span>
        {"  "}
        Live template:{" "}
        <span className={`template-chip ${liveTemplate ? "present" : "absent"}`}>
          {liveTemplate ? "present" : "none — capture a live face (step 04)"}
        </span>
      </div>

      {matchResult && (
        <>
          <div className={`verdict ${matchResult.match ? "pass" : "fail"}`} style={{ marginTop: 14 }}>
            {matchResult.match ? "✓ MATCH" : "✗ NO MATCH"}
          </div>
          <div className="metrics">
            <div className="metric">
              <div className="k">Match score</div>
              <div className={`v ${matchResult.match ? "ok" : "bad"}`}>{matchResult.matchScore.toFixed(3)}</div>
            </div>
            <div className="metric">
              <div className="k">Threshold</div>
              <div className="v">{minimalMatchScore.toFixed(2)}</div>
            </div>
          </div>
          <JsonViewer value={matchResult} label="Match result JSON" />
        </>
      )}

      <JsonViewer value={referenceResult ?? undefined} label="Reference (processImage) result JSON" />
    </section>
  );
}
