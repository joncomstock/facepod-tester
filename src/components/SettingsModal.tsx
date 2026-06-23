import { type MouseEvent, useEffect, useRef } from "react";
import { MOCK_SCENARIOS, SCENARIO_LABELS, type MockScenario } from "../api.ts";
import type { Thresholds } from "../settings.ts";

interface Props {
  open: boolean;
  onClose: () => void;
  thresholds: Thresholds;
  onThresholdChange: (patch: Partial<Thresholds>) => void;
  mock: boolean;
  scenario: MockScenario;
  connected: boolean;
  sessionMock: boolean;
  onMockChange: (mock: boolean) => void;
  onScenarioChange: (s: MockScenario) => void;
}

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
const round2 = (v: number) => +v.toFixed(2);

function Stepper(
  { label, value, onDec, onInc }: { label: string; value: string; onDec: () => void; onInc: () => void },
) {
  return (
    <div className="stepper-row">
      <span className="stepper-label">{label}</span>
      <div className="stepper">
        <button className="step-btn" aria-label={`Decrease ${label}`} onClick={onDec}>−</button>
        <span className="step-val">{value}</span>
        <button className="step-btn" aria-label={`Increase ${label}`} onClick={onInc}>+</button>
      </div>
    </div>
  );
}

/** Thresholds + mock/scenario. Centered modal on wide, bottom sheet on narrow (CSS). */
export function SettingsModal(
  { open, onClose, thresholds, onThresholdChange, mock, scenario, connected, sessionMock, onMockChange, onScenarioChange }: Props,
) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  // Drive the native <dialog> from the `open` prop. showModal() gives us the
  // Tab/Shift+Tab focus trap, Escape-to-dismiss, an inert background, initial focus
  // into the dialog, and focus restore to the trigger — all for free, no bespoke trap.
  useEffect(() => {
    const d = dialogRef.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    else if (!open && d.open) d.close();
  }, [open]);

  // Sync React state whenever the dialog is dismissed natively (Escape) or
  // programmatically. `open` is already false when WE drove the close(), so this
  // only fires onClose for native dismissals — no loop.
  const syncClose = () => { if (open) onClose(); };

  // Backdrop click → close: a click that lands on the <dialog> element itself but
  // outside the panel's rendered box (i.e. on the ::backdrop).
  const onBackdropClick = (e: MouseEvent<HTMLDialogElement>) => {
    const d = dialogRef.current;
    if (!d || e.target !== d) return;
    const r = d.getBoundingClientRect();
    const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    if (!inside) onClose();
  };

  // Capture timeout is stored as a string ("" = device default 1500). The stepper
  // operates on the effective number and writes an explicit value.
  const timeoutNum = thresholds.timeoutMs.trim() === "" ? 1500 : Number(thresholds.timeoutMs);
  const safeTimeout = Number.isFinite(timeoutNum) ? timeoutNum : 1500;

  return (
    <dialog ref={dialogRef} className="sheet" aria-label="Settings" onClose={syncClose} onClick={onBackdropClick}>
      <div className="sheet-head">
        <h3>Settings</h3>
        <button className="icon-btn" aria-label="Close settings" onClick={onClose}>✕</button>
      </div>
      <div className="sheet-body">
        <div className="settings-group">
          <div className="settings-label">Thresholds</div>
          <Stepper
            label="Min quality"
            value={`${Math.round(thresholds.minimalQuality * 100)}%`}
            onDec={() => onThresholdChange({ minimalQuality: clamp(round2(thresholds.minimalQuality - 0.05), 0, 1) })}
            onInc={() => onThresholdChange({ minimalQuality: clamp(round2(thresholds.minimalQuality + 0.05), 0, 1) })}
          />
          <Stepper
            label="Max spoof"
            value={thresholds.maximalSpoofScore.toFixed(2)}
            onDec={() => onThresholdChange({ maximalSpoofScore: clamp(round2(thresholds.maximalSpoofScore - 0.05), 0, 1) })}
            onInc={() => onThresholdChange({ maximalSpoofScore: clamp(round2(thresholds.maximalSpoofScore + 0.05), 0, 1) })}
          />
          <Stepper
            label="Min match"
            value={`${Math.round(thresholds.minimalMatchScore * 100)}%`}
            onDec={() => onThresholdChange({ minimalMatchScore: clamp(round2(thresholds.minimalMatchScore - 0.05), 0, 1) })}
            onInc={() => onThresholdChange({ minimalMatchScore: clamp(round2(thresholds.minimalMatchScore + 0.05), 0, 1) })}
          />
          <Stepper
            label="Capture timeout"
            value={`${safeTimeout} ms`}
            onDec={() => onThresholdChange({ timeoutMs: String(clamp(safeTimeout - 250, 250, 10000)) })}
            onInc={() => onThresholdChange({ timeoutMs: String(clamp(safeTimeout + 250, 250, 10000)) })}
          />
          <p className="hint">Higher capture timeout = slower watch loop (each capture waits up to this long).</p>
        </div>

        <div className="settings-divider" />

        <div className="settings-group">
          <div className="settings-row">
            <div>
              <div className="settings-label">Mock mode</div>
              <div className="settings-sub">Applies on next session</div>
            </div>
            <button
              className={`switch${mock ? " on" : ""}`}
              role="switch"
              aria-checked={mock}
              aria-label="Mock mode"
              onClick={() => onMockChange(!mock)}
            >
              <span className="switch-knob" />
            </button>
          </div>

          <div className="settings-sub">
            Scenario {connected && sessionMock ? "— applies immediately" : "— applies next session"}
          </div>
          <div className="scenario-grid" role="group" aria-label="Mock scenario">
            {MOCK_SCENARIOS.map((s) => (
              <button
                key={s}
                className={`scenario-btn${scenario === s ? " active" : ""}`}
                aria-pressed={scenario === s}
                aria-label={SCENARIO_LABELS[s]}
                onClick={() => onScenarioChange(s)}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      </div>
    </dialog>
  );
}
