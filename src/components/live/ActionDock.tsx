import { useRef } from "react";

interface Props {
  watching: boolean;
  hasReference: boolean;
  onToggleWatch: () => void;
  onPickReference: (file: File) => void;
  onClearReference: () => void;
  onEnd: () => void;
  onUseCurrentFace: () => void;
  canUseCurrentFace: boolean;
}

/** Watch toggle + in-memory reference control (no persistence per constraints). */
export function ActionDock({ watching, hasReference, onToggleWatch, onPickReference, onClearReference, onEnd, onUseCurrentFace, canUseCurrentFace }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <div className="dock">
      <button className="btn primary" onClick={onToggleWatch}>
        {watching ? "Continuous watch · ON" : "Start watching"}
      </button>
      <button className="btn" onClick={onEnd}>End session</button>
      <div className="refchip">
        <span className="k">Reference</span>
        {hasReference
          ? (
            <span className="v">
              ✓ set · in-memory
              <button className="link-btn" onClick={onClearReference}>clear</button>
            </span>
          )
          : (
            <>
              <button className="link-btn" onClick={() => fileRef.current?.click()}>
                Set reference…
              </button>
              <button className="link-btn" disabled={!canUseCurrentFace} onClick={onUseCurrentFace}>
                Use current face
              </button>
            </>
          )}
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg"
        style={{ display: "none" }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onPickReference(f);
          e.target.value = "";
        }}
      />
    </div>
  );
}
