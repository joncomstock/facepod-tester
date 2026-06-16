import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  type ConnectRequest,
  MOCK_SCENARIOS,
  type MockScenario,
  SCENARIO_LABELS,
  type SessionStatus,
} from "../api.ts";
import {
  CONNECTION_DEFAULTS as DEFAULTS,
  type ConnectionSettings as Settings,
  loadConnectionSettings as loadSettings,
  saveConnectionSettings,
} from "../live/connectionSettings.ts";

interface Props {
  status: SessionStatus | null;
  busy: boolean;
  onConnect: (req: ConnectRequest) => void;
  onDisconnect: () => void;
  onSetScenario: (scenario: MockScenario) => void;
}

/**
 * Connection settings. The DLL path/dir/poll knobs almost never change on a
 * given kiosk, so they live behind a Settings modal with a baked-in default —
 * the main panel is just a prominent Connect action. Settings persist to
 * localStorage so an operator's overrides survive reloads; they are applied at
 * connect time (transport can't change while connected).
 */

function basename(path: string): string {
  const parts = path.trim().split(/[\\/]/);
  return parts[parts.length - 1] || path.trim();
}

export function DeviceConfigPanel(
  { status, busy, onConnect, onDisconnect, onSetScenario }: Props,
) {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const connected = status?.connected ?? false;
  const isMock = status?.mock ?? false;
  const scenarioValue: MockScenario = connected && status?.scenario ? status.scenario : settings.scenario;

  // Persist whenever settings change so overrides survive a reload.
  useEffect(() => {
    saveConnectionSettings(settings);
  }, [settings]);

  // Close the modal on Escape.
  useEffect(() => {
    if (!settingsOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSettingsOpen(false);
    };
    globalThis.addEventListener("keydown", onKey);
    return () => globalThis.removeEventListener("keydown", onKey);
  }, [settingsOpen]);

  const patch = (p: Partial<Settings>) => setSettings((s) => ({ ...s, ...p }));

  function changeScenario(value: MockScenario) {
    patch({ scenario: value });
    if (connected && isMock) onSetScenario(value); // live switch, no reconnect
  }

  function submit() {
    const poll = settings.pollIntervalMs.trim();
    onConnect({
      dllPath: settings.dllPath.trim() || undefined,
      dllDir: settings.dllDir.trim() || undefined,
      pollIntervalMs: poll === "" ? undefined : Number(poll),
      mock: settings.mock || undefined,
      mockScenario: settings.scenario,
    });
  }

  const dllLabel = settings.dllPath.trim() ? basename(settings.dllPath) : "env default";

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>01 · Connection</h2>
        <button
          className="icon-btn"
          title="Connection settings"
          aria-label="Connection settings"
          onClick={() => setSettingsOpen(true)}
        >
          ⚙
        </button>
      </div>

      {!connected
        ? (
          <div className="connect-cta">
            <button className="btn primary lg" onClick={submit} disabled={busy}>
              Connect
            </button>
            <p className="conn-summary">
              {settings.mock
                ? <>Mock mode · <b>{SCENARIO_LABELS[settings.scenario]}</b></>
                : (
                  <>
                    Transport <b>USB / FFI</b> · DLL <b title={settings.dllPath}>{dllLabel}</b>
                  </>
                )}
              {" · "}
              <button className="link-btn" onClick={() => setSettingsOpen(true)}>edit</button>
            </p>
          </div>
        )
        : (
          <div className="connect-cta">
            <p className="conn-summary">
              Connected via <b>{isMock ? "Mock" : "USB / FFI"}</b>
              {isMock ? <> · <b>{SCENARIO_LABELS[scenarioValue]}</b></> : ""}.
            </p>
            <button className="btn danger" onClick={onDisconnect} disabled={busy}>
              Disconnect
            </button>
          </div>
        )}

      {settingsOpen && createPortal(
        <div
          className="modal-overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget) setSettingsOpen(false);
          }}
        >
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="conn-settings-title">
            <div className="modal-head">
              <h3 id="conn-settings-title">Connection Settings</h3>
              <button className="icon-btn" aria-label="Close" title="Close" onClick={() => setSettingsOpen(false)}>
                ✕
              </button>
            </div>

            <div className="modal-body">
              <div className="field checkbox" style={{ marginBottom: 4 }}>
                <input
                  id="mockchk"
                  type="checkbox"
                  checked={settings.mock}
                  onChange={(e) => patch({ mock: e.target.checked })}
                  disabled={connected}
                />
                <label htmlFor="mockchk" style={{ margin: 0 }}>
                  Mock mode (deterministic fake device, no hardware)
                </label>
              </div>

              {!settings.mock && (
                <>
                  <div className="modal-section-label">Live transport — USB / Deno FFI</div>
                  <p className="hint" style={{ marginTop: 0 }}>
                    Leave the path blank to use the server env default (<code>FACEPOD_DLL_PATH</code>).
                  </p>
                  <div className="field">
                    <label htmlFor="cfg-dllpath">HidFace.dll path</label>
                    <input
                      id="cfg-dllpath"
                      type="text"
                      value={settings.dllPath}
                      onChange={(e) => patch({ dllPath: e.target.value })}
                      placeholder="C:\\path\\to\\HidFace.dll"
                      disabled={connected}
                    />
                  </div>
                  <div className="field-row">
                    <div className="field">
                      <label htmlFor="cfg-dlldir">DLL search dir (optional)</label>
                      <input
                        id="cfg-dlldir"
                        type="text"
                        value={settings.dllDir}
                        onChange={(e) => patch({ dllDir: e.target.value })}
                        placeholder="(defaults to the DLL's directory)"
                        disabled={connected}
                      />
                    </div>
                    <div className="field">
                      <label htmlFor="cfg-poll">Poll interval (ms, optional)</label>
                      <input
                        id="cfg-poll"
                        type="number"
                        min={1}
                        value={settings.pollIntervalMs}
                        onChange={(e) => patch({ pollIntervalMs: e.target.value })}
                        placeholder="33"
                        disabled={connected}
                      />
                    </div>
                  </div>
                </>
              )}

              {settings.mock && (
                <>
                  <div className="modal-section-label">Mock</div>
                  <div className="field">
                    <label htmlFor="cfg-scenario">
                      Scenario {connected && isMock ? "(switches live)" : "(initial)"}
                    </label>
                    <select
                      id="cfg-scenario"
                      value={scenarioValue}
                      onChange={(e) => changeScenario(e.target.value as MockScenario)}
                      disabled={busy}
                    >
                      {MOCK_SCENARIOS.map((s) => <option key={s} value={s}>{SCENARIO_LABELS[s]}</option>)}
                    </select>
                  </div>
                </>
              )}

              {connected && (
                <p className="hint">
                  Transport can't change while connected — disconnect first to edit live knobs.
                </p>
              )}
            </div>

            <div className="modal-foot">
              <button
                className="link-btn"
                onClick={() => setSettings({ ...DEFAULTS })}
                disabled={connected}
              >
                Reset to defaults
              </button>
              <button className="btn primary" onClick={() => setSettingsOpen(false)}>
                Done
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </section>
  );
}
