import { useState } from "react";
import {
  type ConnectRequest,
  MOCK_SCENARIOS,
  type MockScenario,
  SCENARIO_LABELS,
  type SessionStatus,
} from "../api.ts";

interface Props {
  status: SessionStatus | null;
  busy: boolean;
  onConnect: (req: ConnectRequest) => void;
  onDisconnect: () => void;
  onSetScenario: (scenario: MockScenario) => void;
}

/** Step 1: choose mock vs live (USB/FFI), optionally override the DLL knobs, and connect. */
export function DeviceConfigPanel(
  { status, busy, onConnect, onDisconnect, onSetScenario }: Props,
) {
  const [mock, setMock] = useState(false);
  const [scenario, setScenario] = useState<MockScenario>("good");
  const [dllPath, setDllPath] = useState("");
  const [dllDir, setDllDir] = useState("");
  const [pollIntervalMs, setPollIntervalMs] = useState("");

  const connected = status?.connected ?? false;
  const isMock = status?.mock ?? false;
  // Scenario applies pre-connect (when opting into mock) or live once mocked.
  const showScenario = (mock && !connected) || (connected && isMock);
  const scenarioValue = connected && status?.scenario ? status.scenario : scenario;
  // Live FFI knobs only matter when not in mock mode.
  const showLiveConfig = !mock && !connected;

  function changeScenario(value: MockScenario) {
    setScenario(value);
    if (connected && isMock) onSetScenario(value); // live switch, no reconnect
  }

  function submit() {
    const poll = pollIntervalMs.trim();
    onConnect({
      dllPath: dllPath.trim() || undefined,
      dllDir: dllDir.trim() || undefined,
      pollIntervalMs: poll === "" ? undefined : Number(poll),
      mock: mock || undefined,
      mockScenario: scenario,
    });
  }

  return (
    <section className="panel">
      <h2>01 · Connection</h2>

      <div className="field checkbox">
        <input id="mockchk" type="checkbox" checked={mock} onChange={(e) => setMock(e.target.checked)} disabled={connected} />
        <label htmlFor="mockchk" style={{ margin: 0 }}>Mock mode (deterministic fake device, no hardware)</label>
      </div>

      {showLiveConfig && (
        <>
          <p className="hint">
            Live transport: <b>USB / Deno FFI</b>. Leave these blank to use the env defaults
            (<code>FACEPOD_DLL_PATH</code> / <code>FACEPOD_DLL_DIR</code> / <code>FACEPOD_POLL_INTERVAL_MS</code>).
          </p>
          <div className="field">
            <label htmlFor="cfg-dllpath">HidFace.dll path (optional)</label>
            <input
              id="cfg-dllpath"
              type="text"
              value={dllPath}
              onChange={(e) => setDllPath(e.target.value)}
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
                value={dllDir}
                onChange={(e) => setDllDir(e.target.value)}
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
                value={pollIntervalMs}
                onChange={(e) => setPollIntervalMs(e.target.value)}
                placeholder="33"
                disabled={connected}
              />
            </div>
          </div>
        </>
      )}

      {showScenario && (
        <div className="field">
          <label htmlFor="cfg-scenario">
            Mock scenario {connected && isMock ? "(switches live)" : "(initial)"}
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
      )}

      {connected && (
        <p className="hint">
          Connected via <b>{isMock ? "mock" : "USB / FFI"}</b>
          {!isMock && status?.dllPath ? ` · ${status.dllPath}` : ""}.
        </p>
      )}

      <div className="btn-row">
        {!connected
          ? (
            <button className="btn primary" onClick={submit} disabled={busy}>
              Connect
            </button>
          )
          : (
            <button className="btn danger" onClick={onDisconnect} disabled={busy}>
              Disconnect
            </button>
          )}
      </div>
    </section>
  );
}
