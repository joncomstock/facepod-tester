/**
 * Typed client for the FacePod tester backend.
 *
 * All device communication happens server-side; this module only speaks the
 * local JSON API. Types mirror the FacePod library's result shapes so the UI
 * can render them faithfully. Errors arrive as a normalized envelope and are
 * surfaced as {@link ApiError}.
 */

// ---- Mirrored library types ----------------------------------------------

export type ImageDatatype = "png" | "jpg" | "jpeg";

export const MOCK_SCENARIOS = [
  "good",
  "low-quality",
  "spoof",
  "no-face",
  "no-match",
  "device-error",
  "approach",
] as const;
export type MockScenario = (typeof MOCK_SCENARIOS)[number];

/** Human-readable labels for the scenario selector. */
export const SCENARIO_LABELS: Record<MockScenario, string> = {
  "good": "Good face (pass)",
  "low-quality": "Low quality",
  "spoof": "Spoof detected",
  "no-face": "No face",
  "no-match": "No match",
  "device-error": "Device error",
  "approach": "Approaching face (live demo)",
};

export interface DeviceInfo {
  deviceId: string;
  deviceRole: string[];
  deviceType: string;
  version: string;
}

export interface CameraInfo {
  id: string;
  name: string;
}

export interface FaceTemplate {
  modality: string;
  datatype: string;
  data: string;
}

export interface FaceImage {
  modality: string;
  datatype: ImageDatatype;
  data: string;
}

export interface Liveness {
  spoofScore: number;
  passed: boolean;
}

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Landmark {
  type?: string;
  x: number;
  y: number;
}

export interface CaptureResult {
  quality: number;
  numberOfFaces: number;
  template?: FaceTemplate;
  image?: FaceImage;
  liveness: Liveness;
  boundingBox?: BoundingBox;
  landmarks?: Landmark[];
  isCaptured: boolean;
  faceStatus?: string;
}

export interface ProcessResult {
  quality: number;
  numberOfFaces: number;
  template?: FaceTemplate;
  faceImage?: FaceImage;
  boundingBox?: BoundingBox;
  landmarks?: Landmark[];
  isCaptured: boolean;
  faceStatus?: string;
}

export interface MatchResult {
  match: boolean;
  matchScore: number;
}

// ---- Backend envelopes -----------------------------------------------------

export interface SessionStatus {
  connected: boolean;
  cameraOpen: boolean;
  busy: boolean;
  status: string;
  dllPath: string | null;
  dllDir: string | null;
  pollIntervalMs: number | null;
  mock: boolean;
  scenario: MockScenario | null;
  lastError: NormalizedError | null;
}

export interface NormalizedError {
  name: string;
  message: string;
  code?: number;
  status?: number;
  datatype?: string;
  httpStatus: number;
}

export interface ConnectRequest {
  /** Path to HidFace.dll (live mode). Defaults to env / library resolution. */
  dllPath?: string;
  /** DLL search directory for co-located deps (live mode). */
  dllDir?: string;
  /** Poll interval (ms) for async native ops (live mode). */
  pollIntervalMs?: number;
  mock?: boolean;
  mockScenario?: MockScenario;
}

export interface CaptureRequest {
  minimalQuality: number;
  maximalSpoofScore?: number;
  timeoutMs?: number;
}

export interface CaptureAndMatchResult {
  reference: ProcessResult;
  live: CaptureResult;
  match: MatchResult;
}

/** Error carrying the backend's normalized envelope. */
export class ApiError extends Error {
  readonly detail: NormalizedError;
  constructor(detail: NormalizedError) {
    super(detail.message);
    this.name = detail.name || "ApiError";
    this.detail = detail;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      // The backend gates /api/* on this custom header (a CSRF defense a simple
      // cross-site request cannot set) plus a JSON content-type. See security.ts.
      headers: {
        "content-type": "application/json",
        "x-facepod-tester": "1",
        ...init?.headers,
      },
    });
  } catch (err) {
    // Backend unreachable (not started, wrong port).
    throw new ApiError({
      name: "NetworkError",
      message: `Cannot reach backend: ${(err as Error).message}. Is the Deno server running?`,
      httpStatus: 0,
    });
  }

  const text = await res.text();
  const body = text ? JSON.parse(text) : {};

  if (!res.ok) {
    const detail: NormalizedError = body?.error ?? {
      name: "Error",
      message: `HTTP ${res.status}`,
      httpStatus: res.status,
    };
    throw new ApiError(detail);
  }
  return body as T;
}

function post<T>(path: string, payload?: unknown): Promise<T> {
  return request<T>(path, {
    method: "POST",
    body: JSON.stringify(payload ?? {}),
  });
}

export const api = {
  getStatus: () => request<SessionStatus>("/api/status"),

  connect: (req: ConnectRequest) =>
    post<{ deviceInfo: DeviceInfo; status: SessionStatus }>("/api/connect", req),

  disconnect: () => post<{ status: SessionStatus }>("/api/disconnect"),

  setScenario: (scenario: MockScenario) =>
    post<{ scenario: MockScenario; status: SessionStatus }>("/api/mock/scenario", { scenario }),

  getDeviceInfo: () => request<{ deviceInfo: DeviceInfo }>("/api/device-info"),

  getCameras: () => request<{ cameras: CameraInfo[] }>("/api/cameras"),

  openCamera: (req: {
    cameraId?: string;
    algorithmType?: "on_device";
    reservationTimeoutMs?: number;
  }) => post<{ cameraOpen: true; status: SessionStatus }>("/api/camera/open", req),

  closeCamera: () =>
    post<{ cameraOpen: false; status: SessionStatus }>("/api/camera/close"),

  capture: (req: CaptureRequest) =>
    post<{ result: CaptureResult }>("/api/capture", req),

  processImage: (req: {
    image: string;
    datatype: ImageDatatype;
    minimalQuality?: number;
    maximalSpoofScore?: number;
  }) => post<{ result: ProcessResult }>("/api/process-image", req),

  match: (req: { template1: string; template2: string; minimalMatchScore: number }) =>
    post<{ result: MatchResult }>("/api/match", req),

  captureAndMatch: (req: {
    image: string;
    datatype: ImageDatatype;
    minimalMatchScore: number;
    capture: CaptureRequest;
  }) => post<{ result: CaptureAndMatchResult }>("/api/capture-and-match", req),
};
