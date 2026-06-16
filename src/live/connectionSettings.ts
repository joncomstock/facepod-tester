import type { MockScenario } from "../api.ts";

const STORAGE_KEY = "facepod-tester.connection";

export interface ConnectionSettings {
  mock: boolean;
  scenario: MockScenario;
  dllPath: string;
  dllDir: string;
  pollIntervalMs: string;
}

/** Baked-in defaults for this kiosk. Blank dllPath → server env default. */
export const CONNECTION_DEFAULTS: ConnectionSettings = {
  mock: false,
  scenario: "good",
  dllPath: "C:\\Users\\Facepod\\Desktop\\FacePODDemo_MattWolfe\\HidFace.dll",
  dllDir: "",
  pollIntervalMs: "",
};

export function loadConnectionSettings(): ConnectionSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...CONNECTION_DEFAULTS, ...(JSON.parse(raw) as Partial<ConnectionSettings>) };
  } catch { /* corrupt/unavailable storage → defaults */ }
  return { ...CONNECTION_DEFAULTS };
}

export function saveConnectionSettings(s: ConnectionSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch { /* storage unavailable — keep working in-memory */ }
}
