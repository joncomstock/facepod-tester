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
  return (
    <div className="dock">
      <button className="btn primary" onClick={onToggleWatch}>
        {watching ? "Stop watching" : "Start watching"}
      </button>
      <button className="btn" onClick={onEnd}>End session</button>

      <div className="refchip">
        <span className="k">Reference</span>
        {hasReference
          ? (
            <div className="ref-set">
              {referenceThumb
                ? <img className="ref-thumb" src={referenceThumb} alt="reference" />
                : <span className="ref-thumb ref-thumb-face" aria-hidden>☺</span>}
              <span className="ref-src">{referenceLabel}</span>
              <button className="link-btn" onClick={() => fileRef.current?.click()}>Replace photo</button>
              <button className="link-btn" disabled={!canUseCurrentFace} onClick={onUseCurrentFace}>Use current face</button>
              <button className="link-btn" onClick={onClearReference}>Clear</button>
            </div>
          )
          : (
            <div className="ref-set">
              <button className="link-btn" onClick={() => fileRef.current?.click()}>Set from photo…</button>
              <button className="link-btn" disabled={!canUseCurrentFace} onClick={onUseCurrentFace}>Use current face</button>
              {!canUseCurrentFace && <span className="ref-hint">Hold a single face in view at good quality.</span>}
            </div>
          )}
      </div>

      <input
        ref={fileRef} type="file" accept="image/png,image/jpeg" style={{ display: "none" }}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onPickReference(f); e.target.value = ""; }}
      />
    </div>
  );
}
