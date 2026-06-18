/**
 * Deterministic in-memory FacePod client for mock mode (FACEPOD_MOCK=true).
 *
 * The library ships `NullFaceModuleClient`, but it returns empty results
 * (no templates, match=false), so it can't exercise the capture→process→match
 * workflow in the UI. This client returns realistic, deterministic data so the
 * full happy path — and, via SCENARIOS, the common failure paths — can be demoed
 * with no hardware. It is NOT a network client and performs no I/O.
 *
 * The active scenario is read through a provider closure on every call, so the
 * session can flip scenarios live (no reconnect). See FacePodSession.
 */

import { decodeBase64 } from "@std/encoding/base64";
import {
  type CameraInfo,
  type CaptureOptions,
  type CaptureResult,
  type DeviceInfo,
  type DeviceParameters,
  type FaceImage,
  FaceModuleApiError,
  type FaceModuleClient,
  type FaceTemplate,
  type LiveSnapshot,
  type MatchOptions,
  type MatchResult,
  type OpenContextOptions,
  type ProcessOptions,
  type ProcessResult,
  type VideoFrame,
} from "@eai/hid/facepod";

/** Selectable mock behaviours for exercising happy + failure paths. */
export const MOCK_SCENARIOS = [
  "good", // high quality, live, templates present, match succeeds
  "low-quality", // quality below threshold → isCaptured false
  "spoof", // high spoof score → liveness FAIL
  "no-face", // 0 faces, no template/image
  "no-match", // good capture but match score below any sane threshold
  "device-error", // capture/process/match throw FaceModuleApiError
  "approach", // ramps quality + bbox across captures (drives the Live HUD demo)
] as const;

export type MockScenario = (typeof MOCK_SCENARIOS)[number];

export function isMockScenario(value: unknown): value is MockScenario {
  return typeof value === "string" &&
    (MOCK_SCENARIOS as readonly string[]).includes(value);
}

// A small valid 1x1 PNG used as a placeholder face image for live captures.
// (Reference processing echoes the uploaded image instead — see processImage.)
const PLACEHOLDER_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

/** Synthetic preview frame: a solid 360×640 (9:16) PNG. Its pixel space is the
 *  coordinate space of the mock bbox/landmarks, so the overlay maps correctly. */
const MOCK_FRAME_W = 360;
const MOCK_FRAME_H = 640;
const MOCK_FRAME_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAWgAAAKACAYAAACxGuKnAAAGyElEQVR42u3UMQ0AAAjAMDSggAv/DsEGCT1qYMciqweAe0IEAIMGwKABDBoAgwYwaAAMGgCDBjBoAAwawKABMGgADBrAoAEwaACDBsCgAQwaAIMGwKABDBoAgwYwaAAMGgCDBjBoAAwawKABMGgAgxYBwKABMGgAgwbAoAEMGgCDBsCgAQwaAIMGMGgADBoAgwYwaAAMGsCgATBoAIMGwKABMGgAgwbAoAEMGgCDBsCgAQwaAIMGMGgADBrAoAEwaAAMGsCgATBoAIMGwKABMGgAgwbAoAEMGgCDBjBoAAwaAIMGMGgADBrAoAEwaAAMGsCgATBoAIMGwKABMGgAgwbAoAEMGgCDBjBoAAwawKABMGgADBrAoAEwaACDBsCgAQwaAIMGwKABDBoAgwYwaAAMGgCDBjBoAAwawKABMGgADBrAoAEwaACDBsCgAQwaAIMGwKABDBoAgwYwaAAMGsCghQAwaAAMGsCgATBoAIMGwKABMGgAgwbAoAEMGgCDBsCgAQwaAIMGMGgADBrAoAEwaAAMGsCgATBoAIMGwKABMGgAgwbAoAEMGgCDBjBoAAwaAIMGMGgADBrAoAEwaAAMGsCgATBoAIMGwKABDBoAgwbAoAEMGgCDBjBoAAwaAIMGMGgADBrAoAEwaAAMGsCgATBoAIMGwKABDBoAgwbAoAEMGgCDBjBoAAwaAIMGMGgADBrAoAEwaACDBsCgATBoAIMGwKABDBoAgwbAoAEMGgCDBjBoAAwawKABMGgADBrAoAEwaACDBsCgATBoAIMGwKABDBoAgwbAoAEMGgCDBjBoAAwawKABMGgADBrAoAEwaACDBsCgATBoAIMGwKABDBoAgwYwaAAMGgCDBjBoAAwawKABMGgADBrAoAEwaACDBsCgAQwaAIMGwKABDBoAgwYwaAAMGgCDBjBoAAwawKABMGgAgxYBwKABMGgAgwbAoAEMGgCDBsCgAQwaAIMGMGgADBoAgwYwaAAMGsCgATBoAIMGwKABMGgAgwbAoAEMGgCDBsCgAQwaAIMGMGgADBrAoAEwaAAMGsCgATBoAIMGwKABMGgAgwbAoAEMGgCDBjBoIQAMGgCDBjBoAAwawKABMGgADBrAoAEwaACDBsCgATBoAIMGwKABDBoAgwYwaAAMGgCDBjBoAAwawKABMGgADBrAoAEwaACDBsCgATBoAIMGwKABDBoAgwYwaAAMGgCDBjBoAAwawKABMGgAgxYBwKABMGgAgwbAoAEMGgCDBsCgAQwaAIMGMGgADBoAgwYwaAAMGsCgATBoAIMGwKABMGgAgwbAoAEMGgCDBsCgAQwaAIMGMGgADBrAoAEwaAAMGsCgATBoAIMGwKABMGgAgwbAoAEMGgCDBjBoIQAMGgCDBjBoAAwawKABMGgADBrAoAEwaACDBsCgATBoAIMGwKABDBoAgwYwaAAMGgCDBjBoAAwawKABMGgADBrAoAEwaACDBsCgAQwaAIMGwKABDBoAgwYwaAAMGgCDBjBoAAwawKABMGgAgwbAoAEwaACDBsCgAQwaAIMGwKABDBoAgwYwaAAMGgCDBjBoAAwawKABMGgAgwbAoAEwaACDBsCgAQwaAIMGwKABDBoAgwYwaAAMGsCgATBoAAwawKABMGgAgwbAoAEwaACDBsCgAQwaAIMGMGgADBoAgwYwaAAMGsCgATBoAAwawKABMGgAgwbAoAEwaACDBsCgAQwaAIMGMGgADBoAgwYwaAAMGsCgATBoAAwawKABMGgAgwbAoAEMGgCDBsCgAQwaAIMGMGgADBoAgwYwaAAMGsCgATBoAIMGwKABMGgAgwbAoAEMGgCDBsCgAQwaAIMGMGgADBrAoEUAMGgADBrAoAEwaACDBsCgATBoAIMGwKABDBoAgwbAoAEMGgCDBjBoAAwawKABMGgADBrAoAEwaACDBsCgATBoAIMGwKABDBoAgwYwaAAMGgCDBjBoAAwawKABMGgADBrAoAEwaACDBsCgAQxaBACDBsCgAQwaAIMGMGgADBoAgwYwaAAMGsCgATBoAAwawKABMGgAgwbAoAEMGgCDBsCgAQwaAIMGMGgADBoAgwYwaAAMGsCgATBoAIMGwKABMGgAgwbAoAEMGgCDBsCgAQwaAIMGMGgADBrAoEUAMGgADBrAoAEwaACDBsCgATBoAIMGwKABDBoAgwbAoAEMGgCDBjBoAAwawKABMGgADBrAoAEwaACDBsCgATBoAIMGwKABDBoAgwYwaAAMGgCDBjBoAAwawKABMGgADBrAoAEwaACDBsCgAX5bX0oiq4f1aGkAAAAASUVORK5CYII=";

// Deterministic template payloads. Distinct ref/live values prove that match
// scoring is genuinely comparing two different templates.
const MOCK_LIVE_TEMPLATE = "MOCK::live-face-template::v1";

function faceTemplate(data: string): FaceTemplate {
  return { modality: "face", datatype: "hftemplate", data };
}

/**
 * Deterministic similarity in [0,1] from two template strings: identical → 1.0,
 * otherwise a stable score based on shared-prefix length. Good enough to drive
 * pass/fail against a UI-supplied minimalMatchScore.
 */
function similarity(a: string, b: string): number {
  if (a === b) return 1;
  const max = Math.max(a.length, b.length) || 1;
  let shared = 0;
  const min = Math.min(a.length, b.length);
  for (let i = 0; i < min && a[i] === b[i]; i++) shared++;
  // Map shared-prefix ratio into a plausible biometric range (~0.85..0.95).
  const ratio = shared / max;
  return Math.round((0.85 + ratio * 0.1) * 1000) / 1000;
}

function passedSpoof(spoofScore: number, maximalSpoofScore?: number): boolean {
  return maximalSpoofScore === undefined
    ? true
    : spoofScore <= maximalSpoofScore;
}

function deviceError(op: string): FaceModuleApiError {
  return new FaceModuleApiError(
    1001,
    `Mock device error during ${op} (scenario: device-error)`,
    500,
  );
}

export class DeterministicMockClient implements FaceModuleClient {
  readonly #scenario: () => MockScenario;
  #approachTick = 0;
  #frameSeq = 0n; // per-instance monotonic preview cursor (declare with the other #fields)

  /** @param scenario provider read on every call, so scenarios switch live. */
  constructor(scenario: () => MockScenario = () => "good") {
    this.#scenario = scenario;
  }

  getInfo(): Promise<DeviceInfo> {
    return Promise.resolve({
      deviceId: "MOCK-FACEPOD-0001",
      deviceRole: ["face"],
      deviceType: "U.ARE.U Face Module (mock)",
      version: "1.0.0.0-mock",
    });
  }

  getCameraList(): Promise<CameraInfo[]> {
    return Promise.resolve([
      { id: "cam0", name: "Mock Front Camera" },
      { id: "cam1", name: "Mock IR Camera" },
    ]);
  }

  getParameters(): Promise<DeviceParameters> {
    // Deterministic device config. Values chosen DISTINCT from the UI defaults
    // (0.7/0.5/0.7) so the reference ticks are visibly offset in the demo.
    return Promise.resolve({
      captureImageEncoding: 1, streamMode: 0, captureMode: 1,
      recMaxSpoofProbability: 0.45, recMinEnrollTemplateQuality: 0.7,
      recMinVerifyTemplateQuality: 0.65,
      recMinMatchScoreL1: 0.8, recMinMatchScoreL2: 0.9, recMinMatchScoreL3: 0.95,
      cameraEnableHighRes: 1, cameraSuspend: 0, cameraIdleTimeoutMs: 30000,
      cameraEncodingAcceleration: 1, cameraLowPowerMode: 0, cameraLowPowerTimeoutMs: 60000,
      faceSelectPolicy: 0,
      minDistance: 0.3, maxDistance: 1.0, minRoll: -15, maxRoll: 15,
      minPitch: -15, maxPitch: 15, minYaw: -15, maxYaw: 15,
      margin: 20, onlyCenteredFaces: 1, maxResults: 1,
      dayToNightThreshold: 30, nightToDayThreshold: 60,
      dayToNightViscosity: 5, nightToDayViscosity: 5,
      aeBoundingBoxTimeoutMs: 2000, captureStabilization: 1, encodingJpegQuality: 90,
    });
  }

  // Pure preview read; mirrors the lib's getVideoFrame (no op-lock, may be called
  // concurrently with captureAndProcess). Model: "-1" = give me the latest (the
  // simulated camera advances and yields its newest frame); a cursor strictly
  // behind the newest = the next-newer frame (no advance); a cursor at/ahead of the
  // newest = null (backpressure, nothing newer than this yet). Matches the probe's
  // "newer-than cursor" / ALREADY_RETURNED semantics.
  getVideoFrame(lastSeq?: bigint): Promise<VideoFrame | null> {
    const cursor = lastSeq ?? -1n;
    if (cursor === -1n) {
      this.#frameSeq += 1n; // "latest" advances the simulated camera
      return Promise.resolve(this.#frame(this.#frameSeq));
    }
    if (cursor < this.#frameSeq) {
      return Promise.resolve(this.#frame(cursor + 1n)); // next-newer (no advance)
    }
    return Promise.resolve(null); // caught up → backpressure
  }

  #frame(seq: bigint): VideoFrame {
    return { bytes: decodeBase64(MOCK_FRAME_PNG_BASE64), format: "png", seq };
  }

  openCameraContext(_opts?: OpenContextOptions): Promise<void> {
    return Promise.resolve();
  }

  closeCameraContext(): Promise<void> {
    return Promise.resolve();
  }

  async captureAndProcess(
    opts: CaptureOptions,
    signal?: AbortSignal,
    onIntermediate?: (snap: LiveSnapshot) => void | Promise<void>,
  ): Promise<CaptureResult> {
    // Stream a few live snapshots (overlay metadata only — never a verdict signal),
    // spaced over an async interval, so the tester exercises the real onIntermediate
    // cadence. Abort promptly if signalled.
    const emit = async (snap: LiveSnapshot) => {
      for (let i = 0; i < 3; i++) {
        if (signal?.aborted) {
          throw Object.assign(new Error("Capture aborted"), { name: "AbortError" });
        }
        await onIntermediate?.(snap);
        await new Promise((r) => setTimeout(r, 30));
      }
    };

    const scenario = this.#scenario();
    if (scenario === "approach") {
      // 16-step loop: 0–2 no face, then quality + box ramp to a lock, then reset.
      const n = this.#approachTick % 16;
      this.#approachTick++;
      if (n < 2) {
        await emit({ numberOfFaces: 0 });
        return Promise.resolve({
          quality: 0,
          numberOfFaces: 0,
          liveness: { spoofScore: 0, passed: true },
          isCaptured: false,
          faceStatus: "no_face",
        });
      }
      const p = Math.min(1, (n - 2) / 9); // approach progress 0..1
      const quality = Math.round((0.2 + p * 0.75) * 100) / 100;
      const spoofScore = Math.round((0.6 - p * 0.5) * 100) / 100;
      const passed = passedSpoof(spoofScore, opts.maximalSpoofScore);
      const side = Math.round(120 + p * 120);
      const captured = quality >= opts.minimalQuality && passed;
      await emit({
        numberOfFaces: 1,
        quality,
        boundingBox: { x: 60, y: 40, width: side, height: Math.round(side * 1.2) },
        landmarks: [
          { type: "left_eye", x: 90, y: 110 },
          { type: "right_eye", x: 170, y: 110 },
          { type: "nose", x: 130, y: 160 },
        ],
        positioningFeedback: captured
          ? { raw: 0, ok: true, flags: [], unknownBits: 0 }
          : { raw: 4, ok: false, flags: ["TURN_RIGHT"], unknownBits: 0 },
      });
      return Promise.resolve({
        quality,
        numberOfFaces: 1,
        template: faceTemplate(MOCK_LIVE_TEMPLATE),
        image: { modality: "face", datatype: "png", data: PLACEHOLDER_PNG_BASE64 },
        liveness: { spoofScore, passed },
        boundingBox: { x: 60, y: 40, width: side, height: Math.round(side * 1.2) },
        landmarks: [
          { type: "left_eye", x: 90, y: 110 },
          { type: "right_eye", x: 170, y: 110 },
          { type: "nose", x: 130, y: 160 },
        ],
        // Synthetic: corrective TURN_RIGHT while framing, OK once locked.
        positioningFeedback: captured
          ? { raw: 0, ok: true, flags: [], unknownBits: 0 }
          : { raw: 4, ok: false, flags: ["TURN_RIGHT"], unknownBits: 0 },
        isCaptured: captured,
        faceStatus: passed ? "ok" : "spoof_suspected",
      });
    }
    if (scenario === "device-error") {
      return Promise.reject(deviceError("captureAndProcess"));
    }

    if (scenario === "no-face") {
      await emit({ numberOfFaces: 0 });
      return Promise.resolve({
        quality: 0,
        numberOfFaces: 0,
        liveness: { spoofScore: 0, passed: true },
        isCaptured: false,
        faceStatus: "no_face",
      });
    }

    const quality = scenario === "low-quality" ? 0.34 : 0.92;
    const spoofScore = scenario === "spoof" ? 0.93 : 0.08;
    const passed = passedSpoof(spoofScore, opts.maximalSpoofScore);
    await emit({
      numberOfFaces: 1,
      quality,
      boundingBox: { x: 40, y: 30, width: 180, height: 220 },
      landmarks: [
        { type: "left_eye", x: 90, y: 110 },
        { type: "right_eye", x: 170, y: 110 },
        { type: "nose", x: 130, y: 160 },
      ],
      positioningFeedback: { raw: 0, ok: true, flags: [], unknownBits: 0 },
    });
    return Promise.resolve({
      quality,
      numberOfFaces: 1,
      template: faceTemplate(MOCK_LIVE_TEMPLATE),
      image: {
        modality: "face",
        datatype: "png",
        data: PLACEHOLDER_PNG_BASE64,
      },
      liveness: { spoofScore, passed },
      boundingBox: { x: 40, y: 30, width: 180, height: 220 },
      landmarks: [
        { type: "left_eye", x: 90, y: 110 },
        { type: "right_eye", x: 170, y: 110 },
        { type: "nose", x: 130, y: 160 },
      ],
      // Steady face is well-positioned; spoof fails on liveness, not geometry.
      positioningFeedback: { raw: 0, ok: true, flags: [], unknownBits: 0 },
      isCaptured: quality >= opts.minimalQuality && passed,
      faceStatus: passed ? "ok" : "spoof_suspected",
    });
  }

  processImage(
    image: FaceImage,
    opts?: ProcessOptions,
  ): Promise<ProcessResult> {
    const scenario = this.#scenario();
    if (scenario === "device-error") {
      return Promise.reject(deviceError("processImage"));
    }

    if (scenario === "no-face") {
      return Promise.resolve({
        quality: 0,
        numberOfFaces: 0,
        isCaptured: false,
        faceStatus: "no_face",
      });
    }

    const quality = scenario === "low-quality" ? 0.34 : 0.88;
    // Derive a stable per-image template so re-processing the same upload yields
    // the same template, and different uploads yield different ones.
    const template = faceTemplate(
      `MOCK::ref::${image.datatype}::${image.data.length}`,
    );
    const minimalQuality = opts?.minimalQuality ?? 0;
    return Promise.resolve({
      quality,
      numberOfFaces: 1,
      template,
      // Echo the uploaded image back so the UI preview shows what was sent.
      faceImage: image,
      boundingBox: { x: 20, y: 20, width: 160, height: 200 },
      landmarks: [
        { type: "left_eye", x: 70, y: 90 },
        { type: "right_eye", x: 150, y: 90 },
      ],
      isCaptured: quality >= minimalQuality,
      faceStatus: "ok",
    });
  }

  matchWithTemplate(
    a: FaceTemplate,
    b: FaceTemplate,
    opts: MatchOptions,
  ): Promise<MatchResult> {
    const scenario = this.#scenario();
    if (scenario === "device-error") {
      return Promise.reject(deviceError("matchWithTemplate"));
    }

    // no-match forces a low score regardless of the templates supplied.
    const matchScore = scenario === "no-match"
      ? 0.28
      : similarity(a.data, b.data);
    return Promise.resolve({
      match: matchScore >= opts.minimalMatchScore,
      matchScore,
    });
  }
}
