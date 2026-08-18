import { useCallback, useEffect, useState } from "react";
import { api, type MockScenario, type NormalizedError, type SessionStatus, toErrorDetail } from "./api.ts";
import { DEFAULT_THRESHOLDS, parseTimeoutMs, type Thresholds } from "./settings.ts";
import { LiveView } from "./components/live/LiveView.tsx";
import { SettingsModal } from "./components/SettingsModal.tsx";
import { useDeviceParameters } from "./live/useDeviceParameters.ts";
import { loadConnectionSettings, saveConnectionSettings } from "./live/connectionSettings.ts";

// No "Busy" state (spec §5.1, revised): the continuous watch loop holds the server's op
// lock almost constantly, so a Busy pill would be permanently lit. The connect transition
// is shown by LiveView's full-screen "Bringing the camera online…" scene.
function statePill(status: SessionStatus | null, error: NormalizedError | null) {
  if (error) return { cls: "state-error", label: "Error" };
  if (status?.cameraOpen) return { cls: "state-camera", label: "Camera Open" };
  if (status?.connected) return { cls: "state-connected", label: "Connected" };
  return { cls: "state-disconnected", label: "Disconnected" };
}

export function App() {
  const [status, setStatus] = useState<SessionStatus | null>(null);
  const [error, setError] = useState<NormalizedError | null>(null);
  const [thresholds, setThresholds] = useState<Thresholds>(DEFAULT_THRESHOLDS);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const initial = loadConnectionSettings();
  const [mock, setMock] = useState<boolean>(initial.mock);
  const [scenario, setScenario] = useState<MockScenario>(initial.scenario);

  const { params: deviceParams, error: deviceParamsError, fetchParams, clearParams } = useDeviceParameters();

  const refreshStatus = useCallback(async () => {
    try {
      setStatus(await api.getStatus());
    } catch {
      setStatus((s) => (s ? { ...s, connected: false } : null));
    }
  }, []);

  useEffect(() => { refreshStatus(); }, [refreshStatus]);

  // Persist mock/scenario; apply scenario live only while connected in mock mode.
  const onMockChange = useCallback((next: boolean) => {
    setMock(next);
    // Spread the current settings so this satisfies the connectionSettings type both before
    // Task 6 (legacy dll/poll fields still required) and after (shrunk to {mock,scenario}).
    saveConnectionSettings({ ...loadConnectionSettings(), mock: next, scenario });
  }, [scenario]);

  const onScenarioChange = useCallback((next: MockScenario) => {
    setScenario(next);
    saveConnectionSettings({ ...loadConnectionSettings(), mock, scenario: next });
    if (status?.connected && status?.mock) {
      api.setScenario(next)
        .then((res) => setStatus(res.status))
        .catch((e) =>
          setError(toErrorDetail(e))
        );
    }
  }, [mock, status]);

  const pill = statePill(status, error);

  return (
    <div className="app">
      <header className="masthead">
        <h1>FacePod Tester</h1>
        <div className="masthead-status" role="status" aria-live="polite">
          <span className={`state-pill ${pill.cls}`}>
            <span className="dot" />
            {pill.label}
          </span>
          {status?.mock && (
            <span className="mock-tag">
              Mock{status.scenario && status.scenario !== "good" ? ` · ${status.scenario}` : ""}
            </span>
          )}
        </div>
        <button className="icon-btn settings-btn" aria-label="Settings" onClick={() => setSettingsOpen(true)}>⚙</button>
      </header>

      {error && (
        <div className="error-banner" role="alert">
          <span className="etitle">{error.name}</span>
          <span className="ecode">
            {error.code !== undefined ? `code ${error.code}` : ""}
            {error.status !== undefined ? ` · http ${error.status}` : ""}
            {error.datatype ? ` · datatype ${error.datatype}` : ""}
          </span>
          <div>{error.message}</div>
        </div>
      )}

      <LiveView
        status={status}
        thresholds={{
          minimalQuality: thresholds.minimalQuality,
          maximalSpoofScore: thresholds.maximalSpoofScore,
          minimalMatchScore: thresholds.minimalMatchScore,
          timeoutMs: parseTimeoutMs(thresholds.timeoutMs),
        }}
        onError={setError}
        onSessionChange={refreshStatus}
        deviceParams={deviceParams}
        deviceParamsError={deviceParamsError}
        onFetchParams={fetchParams}
        onClearParams={clearParams}
      />

      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        thresholds={thresholds}
        onThresholdChange={(patch) => setThresholds((t) => ({ ...t, ...patch }))}
        mock={mock}
        scenario={scenario}
        connected={!!status?.connected}
        sessionMock={!!status?.mock}
        onMockChange={onMockChange}
        onScenarioChange={onScenarioChange}
      />
    </div>
  );
}
