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

export interface PositioningFeedback {
  raw: number;
  ok: boolean;
  flags: string[];
  unknownBits: number;
}

/** Read-only device configuration (HFParam reads). All fields always populated. */
export interface DeviceParameters {
  captureImageEncoding: number;
  streamMode: number;
  captureMode: number;
  recMaxSpoofProbability: number;
  recMinEnrollTemplateQuality: number;
  recMinVerifyTemplateQuality: number;
  recMinMatchScoreL1: number;
  recMinMatchScoreL2: number;
  recMinMatchScoreL3: number;
  cameraEnableHighRes: number;
  cameraSuspend: number;
  cameraIdleTimeoutMs: number;
  cameraEncodingAcceleration: number;
  cameraLowPowerMode: number;
  cameraLowPowerTimeoutMs: number;
  faceSelectPolicy: number;
  minDistance: number;
  maxDistance: number;
  minRoll: number;
  maxRoll: number;
  minPitch: number;
  maxPitch: number;
  minYaw: number;
  maxYaw: number;
  margin: number;
  onlyCenteredFaces: number;
  maxResults: number;
  dayToNightThreshold: number;
  nightToDayThreshold: number;
  dayToNightViscosity: number;
  nightToDayViscosity: number;
  aeBoundingBoxTimeoutMs: number;
  captureStabilization: number;
  encodingJpegQuality: number;
}

/** The safe, reversible subset of parameters the UI may write (mirrors the lib's
 *  DeviceParametersPatch — see docs/parameters-contract.md). */
export type DeviceParametersPatch = Partial<
  Pick<
    DeviceParameters,
    | "streamMode"
    | "minDistance" | "maxDistance"
    | "minRoll" | "maxRoll" | "minPitch" | "maxPitch" | "minYaw" | "maxYaw"
    | "recMinMatchScoreL1" | "recMinMatchScoreL2" | "recMinMatchScoreL3"
  >
>;

export type ParameterWriteStatus = "applied" | "clamped" | "rejected";

export interface ParameterWriteResult {
  requested: number;
  effective: number;
  status: ParameterWriteStatus;
}

export interface SetParametersResult {
  results: Partial<Record<keyof DeviceParametersPatch, ParameterWriteResult>>;
}

export interface CaptureResult {
  quality: number;
  numberOfFaces: number;
  template?: FaceTemplate;
  image?: FaceImage;
  liveness: Liveness;
  boundingBox?: BoundingBox;
  landmarks?: Landmark[];
  positioningFeedback?: PositioningFeedback;
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
  sessionGeneration: number;
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

export interface FrameResponse {
  frame: { datatype: string; data: string; seq: string } | null;
  snapshot: {
    numberOfFaces: number;
    quality?: number;
    boundingBox?: BoundingBox;
    landmarks?: Landmark[];
    positioningFeedback?: PositioningFeedback;
  } | null;
  snapshotAgeMs: number | null;
  captureId: number;
  sessionGeneration: number;
}

export interface HighResMeta {
  hasImage: boolean;
  id?: string;
  width?: number;
  height?: number;
  encoding?: ImageDatatype;
  byteLength?: number;
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

function post<T>(path: string, payload?: unknown, signal?: AbortSignal): Promise<T> {
  return request<T>(path, { method: "POST", body: JSON.stringify(payload ?? {}), signal });
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

  getParameters: () => request<{ parameters: DeviceParameters }>("/api/parameters"),

  setParameters: (patch: DeviceParametersPatch, signal?: AbortSignal) =>
    post<SetParametersResult>("/api/parameters", patch, signal),

  openCamera: (req: {
    cameraId?: string;
    algorithmType?: "on_device";
    reservationTimeoutMs?: number;
  }) => post<{ cameraOpen: true; status: SessionStatus }>("/api/camera/open", req),

  closeCamera: () =>
    post<{ cameraOpen: false; status: SessionStatus }>("/api/camera/close"),

  capture: (req: CaptureRequest, signal?: AbortSignal) =>
    post<{ result: CaptureResult }>("/api/capture", req, signal),

  processImage: (req: {
    image: string;
    datatype: ImageDatatype;
    minimalQuality?: number;
    maximalSpoofScore?: number;
  }) => post<{ result: ProcessResult }>("/api/process-image", req),

  match: (req: { template1: string; template2: string; minimalMatchScore: number }, signal?: AbortSignal) =>
    post<{ result: MatchResult }>("/api/match", req, signal),

  captureAndMatch: (req: {
    image: string;
    datatype: ImageDatatype;
    minimalMatchScore: number;
    capture: CaptureRequest;
  }) => post<{ result: CaptureAndMatchResult }>("/api/capture-and-match", req),

  getVideoFrame: (lastSeq: string, signal?: AbortSignal) =>
    request<FrameResponse>(`/api/video-frame?lastSeq=${encodeURIComponent(lastSeq)}`, { signal }),

  captureHighRes: (req: CaptureRequest, signal?: AbortSignal) =>
    post<{ result: HighResMeta }>("/api/capture-high-res", req, signal),

  /** Binary download — NOT via request<T> (that parses JSON). Sends the gate
   *  header, returns a Blob on an image response, and throws ApiError when the
   *  server returns a JSON error envelope (unknown/evicted id, not-connected). */
  downloadHighResImage: async (id: string): Promise<Blob> => {
    const res = await fetch(`/api/high-res-image/${encodeURIComponent(id)}`, {
      headers: { "x-facepod-tester": "1" },
    });
    const contentType = res.headers.get("content-type") ?? "";
    if (!res.ok || contentType.includes("application/json")) {
      let detail: NormalizedError = { name: "Error", message: `HTTP ${res.status}`, httpStatus: res.status };
      try {
        const body = await res.json();
        if (body?.error) detail = body.error as NormalizedError;
      } catch {
        // non-JSON error body — keep the fallback detail
      }
      throw new ApiError(detail);
    }
    return await res.blob();
  },
};
