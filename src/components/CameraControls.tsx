import { useState } from "react";
import type { CameraInfo, SessionStatus } from "../api.ts";

interface Props {
  status: SessionStatus | null;
  cameras: CameraInfo[] | null;
  busy: boolean;
  onOpen: (req: { cameraId?: string; algorithmType?: "on_device"; reservationTimeoutMs?: number }) => void;
  onClose: () => void;
}

/** Step 3: open / close a camera context. */
export function CameraControls({ status, cameras, busy, onOpen, onClose }: Props) {
  const [cameraId, setCameraId] = useState("");
  const [algorithmType, setAlgorithmType] = useState<"" | "on_device">("");
  const [reservationTimeoutMs, setReservationTimeoutMs] = useState("");

  const connected = status?.connected ?? false;
  const cameraOpen = status?.cameraOpen ?? false;

  function open() {
    const ms = reservationTimeoutMs.trim() === "" ? undefined : Number(reservationTimeoutMs);
    onOpen({
      cameraId: cameraId || undefined,
      algorithmType: algorithmType || undefined,
      reservationTimeoutMs: Number.isFinite(ms) ? ms : undefined,
    });
  }

  return (
    <section className="panel">
      <h2>03 · Camera Context</h2>

      {!connected && <p className="empty">Connect first.</p>}

      {connected && (
        <>
          <div className="field">
            <label htmlFor="cam-id">Camera</label>
            <select id="cam-id" value={cameraId} onChange={(e) => setCameraId(e.target.value)} disabled={cameraOpen}>
              <option value="">(device default)</option>
              {(cameras ?? []).map((c) => (
                <option key={c.id} value={c.id}>{c.name} ({c.id})</option>
              ))}
            </select>
          </div>

          <div className="field-row">
            <div className="field">
              <label htmlFor="cam-algo">Algorithm type</label>
              <select
                id="cam-algo"
                value={algorithmType}
                onChange={(e) => setAlgorithmType(e.target.value as "" | "on_device")}
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
                value={reservationTimeoutMs}
                onChange={(e) => setReservationTimeoutMs(e.target.value)}
                placeholder="0"
                disabled={cameraOpen}
              />
            </div>
          </div>

          <div className="btn-row">
            <button className="btn primary" onClick={open} disabled={busy || cameraOpen}>Open Camera</button>
            <button className="btn" onClick={onClose} disabled={busy || !cameraOpen}>Close Camera</button>
          </div>
          <p className="hint">Camera is currently <b>{cameraOpen ? "open" : "closed"}</b>.</p>
        </>
      )}
    </section>
  );
}
