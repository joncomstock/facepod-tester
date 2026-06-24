// src/components/live/HighResControls.tsx
import { useState } from "react";
import type { CaptureRequest } from "../../api.ts";
import { canCaptureHighRes } from "../../live/highResStill.ts";
import type { HighResHandle } from "../../live/useHighResStill.ts";

interface Props {
  active: boolean;                 // verify feed live (camera open + watching + mode verify)
  streamMode: "RGB" | "IR";        // read-only reflection of device CAMERA stream mode
  hr: HighResHandle;
  captureReq: CaptureRequest;      // {minimalQuality, maximalSpoofScore, timeoutMs}
  onOpenTune: () => void;
}

export function HighResControls({ active, streamMode, hr, captureReq, onOpenTune }: Props) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const capturing = hr.state.status === "capturing";
  const canCapture = canCaptureHighRes(active, hr.state.status);

  return (
    <div className="hr-block">
      <div className="hr-controls">
        <div className="hr-seg" role="group" aria-label="Stream mode (read-only)">
          {(["RGB", "IR"] as const).map((opt) => (
            <button
              key={opt}
              className={`hr-seg-btn${streamMode === opt ? " is-on" : ""}`}
              disabled
              title="Switching stream mode is coming in Slice 3"
            >
              {opt}
            </button>
          ))}
        </div>
        <button
          className="hr-grab"
          disabled={!canCapture}
          onClick={() => hr.capture(captureReq)}
        >
          {capturing ? "Capturing…" : "⬡  High-res still"}
        </button>
        {/* Task 8 wires the Tune drawer */}
        <button className="hr-tune" onClick={onOpenTune}>⚙  Tune</button>
      </div>

      {hr.state.status === "no-image" && (
        <div className="hr-note">No high-res image — no face captured. Try again.</div>
      )}

      {hr.state.status === "ready" && hr.meta && (
        <div className="hr-chip">
          <div className="hr-thumb">⬡</div>
          <div className="hr-meta">
            <div className="hr-title">
              High-res still · q{hr.meta.width && hr.meta.height ? `${hr.meta.width}×${hr.meta.height}` : "—"}
            </div>
            <div className="hr-sub">session-only · in memory</div>
          </div>
          <button className="hr-act" onClick={() => setPreviewOpen(true)}>Preview</button>
          <button className="hr-act" onClick={hr.download}>Download</button>
          <button className="hr-act hr-discard" aria-label="Discard still" onClick={hr.discard}>✕</button>
        </div>
      )}

      {previewOpen && hr.state.status === "ready" && hr.url && (
        <div className="hr-preview" onClick={() => setPreviewOpen(false)} role="dialog" aria-label="High-res preview">
          <img src={hr.url} alt="High-res still" />
        </div>
      )}
    </div>
  );
}
