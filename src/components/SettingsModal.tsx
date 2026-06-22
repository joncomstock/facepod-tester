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

function Num(
  { label, value, onChange, step = 0.05, min = 0, max = 1 }: {
    label: string; value: number; onChange: (n: number) => void;
    step?: number; min?: number; max?: number;
  },
) {
  return (
    <label className="field">
      <span>{label}</span>
      <input
        type="number" value={value} step={step} min={min} max={max}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}

/** Thresholds + mock/scenario. Centered modal on wide, bottom sheet on narrow (CSS). */
export function SettingsModal(
  { open, onClose, thresholds, onThresholdChange, mock, scenario, connected, sessionMock, onMockChange, onScenarioChange }: Props,
) {
  if (!open) return null;
  return (
    <div className="sheet-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label="Settings">
        <div className="sheet-head">
          <h3>Settings</h3>
          <button className="icon-btn" aria-label="Close settings" onClick={onClose}>✕</button>
        </div>
        <div className="sheet-body">
          <div className="settings-group">
            <div className="settings-label">Thresholds</div>
            <Num label="Min quality" value={thresholds.minimalQuality} onChange={(n) => onThresholdChange({ minimalQuality: n })} />
            <Num label="Max spoof" value={thresholds.maximalSpoofScore} onChange={(n) => onThresholdChange({ maximalSpoofScore: n })} />
            <Num label="Min match" value={thresholds.minimalMatchScore} onChange={(n) => onThresholdChange({ minimalMatchScore: n })} />
            <label className="field">
              <span>Capture timeout (ms)</span>
              <input
                type="text" inputMode="numeric" placeholder="default 1500"
                value={thresholds.timeoutMs}
                onChange={(e) => onThresholdChange({ timeoutMs: e.target.value })}
              />
            </label>
            <p className="hint">Higher capture timeout = slower watch loop (each capture waits up to this long).</p>
          </div>

          <div className="settings-group">
            <div className="settings-label">Mock</div>
            <label className="checkbox">
              <input type="checkbox" checked={mock} onChange={(e) => onMockChange(e.target.checked)} />
              Mock mode
            </label>
            <label className="field">
              <span>Scenario</span>
              <select value={scenario} disabled={!(mock || sessionMock)} onChange={(e) => onScenarioChange(e.target.value as MockScenario)}>
                {MOCK_SCENARIOS.map((s) => <option key={s} value={s}>{SCENARIO_LABELS[s]}</option>)}
              </select>
            </label>
            <p className="hint">
              {connected && sessionMock
                ? "Scenario applies immediately. "
                : "Scenario applies next session. "}
              Mock on/off applies next session — after End session → Go Live.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
