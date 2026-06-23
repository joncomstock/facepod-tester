import type { MockScenario } from "../api.ts";

const STORAGE_KEY = "facepod-tester.connection";

export interface ConnectionSettings {
  mock: boolean;
  scenario: MockScenario;
}

export const CONNECTION_DEFAULTS: ConnectionSettings = { mock: false, scenario: "good" };

/**
 * Baked-in DLL location for the kiosk (NOT user-editable). `goLive` passes this so Go Live
 * keeps working exactly as before, just without UI config. Optional follow-up: once the
 * server env supplies a DLL default, drop this and the `dllPath` arg.
 */
export const DLL_PATH = "C:\\Users\\Facepod\\Desktop\\FacePODDemo_MattWolfe\\HidFace.dll";

/** Pure: parse stored JSON → settings, dropping legacy dllPath/dllDir/pollIntervalMs. */
export function migrateConnectionSettings(raw: string | null): ConnectionSettings {
  if (!raw) return { ...CONNECTION_DEFAULTS };
  try {
    const p = JSON.parse(raw) as Partial<ConnectionSettings>;
    return {
      mock: typeof p.mock === "boolean" ? p.mock : false,
      scenario: (p.scenario as MockScenario) ?? "good",
    };
  } catch {
    return { ...CONNECTION_DEFAULTS };
  }
}

export function loadConnectionSettings(): ConnectionSettings {
  try {
    return migrateConnectionSettings(localStorage.getItem(STORAGE_KEY));
  } catch {
    return { ...CONNECTION_DEFAULTS };
  }
}

export function saveConnectionSettings(s: ConnectionSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch { /* storage unavailable — keep working in-memory */ }
}
