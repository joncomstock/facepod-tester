import { useRef } from "react";

interface Props {
  watching: boolean;
  referenceThumb: string | null;
  referenceLabel: string | null;
  canUseCurrentFace: boolean;
  onToggleWatch: () => void;
  onPickReference: (file: File) => void;
  onClearReference: () => void;
  onEnd: () => void;
  onUseCurrentFace: () => void;
}

export function ActionDock(
  { watching, referenceThumb, referenceLabel, canUseCurrentFace, onToggleWatch, onPickReference, onClearReference, onEnd, onUseCurrentFace }: Props,
) {
  const fileRef = useRef<HTMLInputElement>(null);
  const hasReference = referenceLabel !== null;
  const isPhoto = referenceThumb !== null;

  return (
    <div className="dock">
      <div className="dock-row">
        {/* Cyan call-to-action when stopped; quiet when the loop is already running. */}
        <button className={`btn watch${watching ? "" : " primary"}`} onClick={onToggleWatch}>
          {watching ? "Stop watching" : "Start watching"}
        </button>
        <button className="btn danger end" onClick={onEnd}>End session</button>
      </div>

      {/* The whole match workflow lives inline here — no separate screen. */}
      <div className="refbox">
        <div className="refbox-label">Reference</div>
        {hasReference
          ? (
            <div className="ref-set">
              {isPhoto
                ? <img className="ref-thumb" src={referenceThumb!} alt="reference" />
                : <span className="ref-thumb ref-thumb-face" aria-hidden>FACE</span>}
              <div className="ref-meta">
                <div className="ref-title">{isPhoto ? "Uploaded photo" : "Current face"}</div>
                <div className="ref-sub">{isPhoto ? "session-only · in memory" : "captured live · in memory"}</div>
              </div>
              <div className="ref-actions">
                <button className="btn ref-btn" onClick={() => fileRef.current?.click()}>Replace</button>
                <button className="btn ref-btn" disabled={!canUseCurrentFace} onClick={onUseCurrentFace}>Use current</button>
                <button className="btn danger ref-btn" onClick={onClearReference}>Clear</button>
              </div>
            </div>
          )
          : (
            <>
              <div className="ref-set">
                <button className="btn ref-set-btn" onClick={() => fileRef.current?.click()}>Set from photo…</button>
                <button
                  className={`btn ref-set-btn${canUseCurrentFace ? " primary" : ""}`}
                  disabled={!canUseCurrentFace}
                  onClick={onUseCurrentFace}
                >
                  Use current face
                </button>
              </div>
              {!canUseCurrentFace && (
                <p className="ref-hint">Hold a single face in view at good quality to use it as the reference.</p>
              )}
            </>
          )}
      </div>

      <input
        ref={fileRef} type="file" accept="image/png,image/jpeg" style={{ display: "none" }}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onPickReference(f); e.target.value = ""; }}
      />
    </div>
  );
}
