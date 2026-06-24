import { MODES, type ModeId } from "../../live/modes.ts";

interface Props {
  mode: ModeId;
  onPick: (m: ModeId) => void;
}

/** Verify / Identify / Console selector. All tabs clickable; deferred tabs lead
 *  to a coming-soon surface (gating handled by the rendered mode, not here). */
export function ModeSwitch({ mode, onPick }: Props) {
  return (
    <div className="mode-switch" role="tablist" aria-label="Mode">
      {MODES.map((m) => (
        <button
          key={m.id}
          role="tab"
          aria-selected={mode === m.id}
          className={`mode-tab${mode === m.id ? " is-active" : ""}`}
          onClick={() => onPick(m.id)}
        >
          {m.label}
        </button>
      ))}
    </div>
  );
}
