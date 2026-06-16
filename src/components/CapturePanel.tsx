import type { CaptureResult, SessionStatus } from "../api.ts";
import { JsonViewer } from "./JsonViewer.tsx";

export interface CaptureThresholds {
  minimalQuality: number;
  maximalSpoofScore: number;
  timeoutMs: string; // kept as string for an optional numeric input
}

interface Props {
  status: SessionStatus | null;
  busy: boolean;
  thresholds: CaptureThresholds;
  onThresholdChange: (patch: Partial<CaptureThresholds>) => void;
  result: CaptureResult | null;
  onCapture: () => void;
}

function imgSrc(datatype: string, data: string): string {
  return `data:image/${datatype === "jpg" ? "jpeg" : datatype};base64,${data}`;
}

/** One accept-gate row: a threshold check the tester evaluates against the result. */
function Gate({ label, detail, pass }: { label: string; detail: string; pass: boolean }) {
  return (
    <li className={`gate ${pass ? "pass" : "fail"}`}>
      <span className="gate-mark">{pass ? "✓" : "✗"}</span>
      <span className="gate-label">{label}</span>
      <span className="gate-detail">{detail}</span>
    </li>
  );
}

/** Step 04: capture a live face and show every field the FFI seam returns. */
export function CapturePanel(
  { status, busy, thresholds, onThresholdChange, result, onCapture }: Props,
) {
  const cameraOpen = status?.cameraOpen ?? false;

  // Accept gate — derived in the tester from the fields HID returns + the
  // thresholds you set. These are NOT extra HID metrics; they are pass/fail
  // checks on the real result values.
  const qualityPass = result ? result.quality >= thresholds.minimalQuality : false;
  const livenessPass = result ? result.liveness.passed : false;
  const capturedPass = result ? result.isCaptured : false;
  const accepted = qualityPass && livenessPass && capturedPass;

  return (
    <section className="panel">
      <h2>04 · Live Capture</h2>

      <div className="field-row">
        <div className="field">
          <label htmlFor="cap-quality">minimalQuality (0–1)</label>
          <input
            id="cap-quality"
            type="number"
            min="0"
            max="1"
            step="0.05"
            value={thresholds.minimalQuality}
            onChange={(e) => onThresholdChange({ minimalQuality: Number(e.target.value) })}
          />
        </div>
        <div className="field">
          <label htmlFor="cap-spoof">maximalSpoofScore (0–1)</label>
          <input
            id="cap-spoof"
            type="number"
            min="0"
            max="1"
            step="0.05"
            value={thresholds.maximalSpoofScore}
            onChange={(e) => onThresholdChange({ maximalSpoofScore: Number(e.target.value) })}
          />
        </div>
        <div className="field">
          <label htmlFor="cap-timeout">timeoutMs (optional)</label>
          <input
            id="cap-timeout"
            type="number"
            value={thresholds.timeoutMs}
            onChange={(e) => onThresholdChange({ timeoutMs: e.target.value })}
            placeholder="device default"
          />
        </div>
      </div>

      <div className="btn-row">
        <button className="btn primary" onClick={onCapture} disabled={busy || !cameraOpen}>
          Capture Live Face
        </button>
      </div>
      {!cameraOpen && <p className="hint">Open the camera first.</p>}

      {result && (
        <>
          <div className="metrics">
            <div className="metric">
              <div className="k">Quality</div>
              <div className={`v ${qualityPass ? "ok" : "bad"}`}>{result.quality.toFixed(2)}</div>
            </div>
            <div className="metric">
              <div className="k">Spoof score</div>
              <div className={`v ${livenessPass ? "ok" : "bad"}`}>
                {result.liveness.spoofScore.toFixed(2)}
              </div>
            </div>
            <div className="metric">
              <div className="k">Liveness</div>
              <div className={`v ${livenessPass ? "ok" : "bad"}`}>
                {livenessPass ? "PASS" : "FAIL"}
              </div>
            </div>
            <div className="metric">
              <div className="k">Faces</div>
              <div className="v">{result.numberOfFaces}</div>
            </div>
            <div className="metric">
              <div className="k">Captured</div>
              <div className={`v ${capturedPass ? "ok" : "bad"}`}>
                {result.isCaptured ? "YES" : "NO"}
              </div>
            </div>
          </div>

          <div className="gate-card">
            <div className="gate-head">
              <span>Accept gate</span>
              <span className={`gate-verdict ${accepted ? "ok" : "bad"}`}>
                {accepted ? "ACCEPT" : "REJECT"}
              </span>
            </div>
            <ul className="gate-list">
              <Gate
                label="Quality ≥ minimalQuality"
                detail={`${result.quality.toFixed(2)} ≥ ${thresholds.minimalQuality}`}
                pass={qualityPass}
              />
              <Gate
                label="Liveness (spoof ≤ maximalSpoofScore)"
                detail={`${result.liveness.spoofScore.toFixed(2)} ≤ ${thresholds.maximalSpoofScore}`}
                pass={livenessPass}
              />
              <Gate label="isCaptured" detail={String(result.isCaptured)} pass={capturedPass} />
            </ul>
            <p className="hint">
              Evaluated by the tester against the thresholds above. Match score is a
              separate gate in step 05.
            </p>
          </div>

          <div className="face-preview">
            {result.image && (
              <figure>
                <img src={imgSrc(result.image.datatype, result.image.data)} alt="captured face" />
                <figcaption>Captured face ({result.image.datatype})</figcaption>
              </figure>
            )}
            <div className="kv">
              <div>
                <span className="k">Template:</span>{" "}
                <span className={`template-chip ${result.template ? "present" : "absent"}`}>
                  {result.template ? `present (${result.template.datatype})` : "none"}
                </span>
              </div>
              <div>
                <span className="k">faceStatus:</span> {result.faceStatus ?? "—"}
              </div>
              <div>
                <span className="k">Bounding box:</span>{" "}
                {result.boundingBox
                  ? `x=${result.boundingBox.x} y=${result.boundingBox.y} w=${result.boundingBox.width} h=${result.boundingBox.height}`
                  : "—"}
              </div>
              <div>
                <span className="k">Image:</span>{" "}
                {result.image ? `present (${result.image.datatype})` : "none"}
              </div>
            </div>
          </div>

          <p className="hint">
            All fields above are what the USB/FFI seam returns. The HID HF API capture
            result does not expose lighting uniformity, brightness, or a measured
            distance — those are not shown.
          </p>

          <JsonViewer value={result} label="Capture result JSON" />
        </>
      )}
    </section>
  );
}
