import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { CameraInfo, SessionStatus } from "../api.ts";

interface Props {
  status: SessionStatus | null;
  cameras: CameraInfo[] | null;
  busy: boolean;
  onOpen: (req: { cameraId?: string; algorithmType?: "on_device"; reservationTimeoutMs?: number }) => void;
  onClose: () => void;
}

/**
 * Open / close a camera context. Like the connection panel, the rarely-changed
 * knobs (specific camera, algorithm, reservation timeout) live behind a gear;
 * the default is one click to open the device's default camera. Overrides
 * persist to localStorage.
 */
const STORAGE_KEY = "facepod-tester.camera";
const DEFAULTS = { cameraId: "", algorithmType: "" as "" | "on_device", reservationTimeoutMs: "" };
type Settings = typeof DEFAULTS;

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch { /* fall back to defaults */ }
  return { ...DEFAULTS };
}

export function CameraControls({ status, cameras, busy, onOpen, onClose }: Props) {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const connected = status?.connected ?? false;
  const cameraOpen = status?.cameraOpen ?? false;

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch { /* storage unavailable */ }
  }, [settings]);

  useEffect(() => {
    if (!settingsOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSettingsOpen(false);
    };
    globalThis.addEventListener("keydown", onKey);
    return () => globalThis.removeEventListener("keydown", onKey);
  }, [settingsOpen]);

  const patch = (p: Partial<Settings>) => setSettings((s) => ({ ...s, ...p }));

  function open() {
    const ms = settings.reservationTimeoutMs.trim() === "" ? undefined : Number(settings.reservationTimeoutMs);
    onOpen({
      cameraId: settings.cameraId || undefined,
      algorithmType: settings.algorithmType || undefined,
      reservationTimeoutMs: Number.isFinite(ms) ? ms : undefined,
    });
  }

  const camLabel = settings.cameraId
    ? (cameras?.find((c) => c.id === settings.cameraId)?.name ?? settings.cameraId)
    : "device default";

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>03 · Camera Context</h2>
        {connected && (
          <button
            className="icon-btn"
            title="Camera settings"
            aria-label="Camera settings"
            onClick={() => setSettingsOpen(true)}
          >
            ⚙
          </button>
        )}
      </div>

      {!connected && <p className="empty">Connect first.</p>}

      {connected && (
        <div className="connect-cta">
          <div className="btn-row" style={{ marginTop: 0 }}>
            <button className="btn primary lg" onClick={open} disabled={busy || cameraOpen}>
              Open Camera
            </button>
            <button className="btn" onClick={onClose} disabled={busy || !cameraOpen}>
              Close Camera
            </button>
          </div>
          <p className="conn-summary">
            Camera <b>{cameraOpen ? "open" : "closed"}</b> · using <b>{camLabel}</b>
            {" · "}
            <button className="link-btn" onClick={() => setSettingsOpen(true)} disabled={cameraOpen}>edit</button>
          </p>
        </div>
      )}

      {settingsOpen && createPortal(
        <div
          className="modal-overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget) setSettingsOpen(false);
          }}
        >
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="cam-settings-title">
            <div className="modal-head">
              <h3 id="cam-settings-title">Camera Settings</h3>
              <button className="icon-btn" aria-label="Close" title="Close" onClick={() => setSettingsOpen(false)}>
                ✕
              </button>
            </div>

            <div className="modal-body">
              <div className="field">
                <label htmlFor="cam-id">Camera</label>
                <select
                  id="cam-id"
                  value={settings.cameraId}
                  onChange={(e) => patch({ cameraId: e.target.value })}
                  disabled={cameraOpen}
                >
                  <option value="">(device default)</option>
                  {(cameras ?? []).map((c) => <option key={c.id} value={c.id}>{c.name} ({c.id})</option>)}
                </select>
              </div>
              <div className="field-row">
                <div className="field">
                  <label htmlFor="cam-algo">Algorithm type</label>
                  <select
                    id="cam-algo"
                    value={settings.algorithmType}
                    onChange={(e) => patch({ algorithmType: e.target.value as "" | "on_device" })}
                    disabled={cameraOpen}
                  >
                    <option value="">(default)</option>
                    <option value="on_device">on_device</option>
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="cam-reservation">Reservation timeout (ms)</label>
                  <input
                    id="cam-reservation"
                    type="number"
                    min="0"
                    value={settings.reservationTimeoutMs}
                    onChange={(e) => patch({ reservationTimeoutMs: e.target.value })}
                    placeholder="0"
                    disabled={cameraOpen}
                  />
                </div>
              </div>
              {cameraOpen && <p className="hint">Close the camera to change these.</p>}
            </div>

            <div className="modal-foot">
              <button className="link-btn" onClick={() => setSettings({ ...DEFAULTS })} disabled={cameraOpen}>
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
