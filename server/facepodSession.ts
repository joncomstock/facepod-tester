/**
 * Single in-memory FacePod session manager.
 *
 * The tester maintains at most ONE live FaceModuleLifecycle at a time. This
 * module centralizes its lifecycle so the route handlers stay thin:
 *   - connect() disposes any prior session before creating a new one,
 *   - openCamera() is idempotent so a double-click never double-opens a context,
 *   - disconnect()/dispose() always close the camera first,
 *   - every device op records lastError (for GET /api/status) and re-throws.
 *
 * The live transport is USB over Deno FFI only (createFaceModuleFfi). Mock mode
 * is the single non-hardware path and drives a FaceModuleLifecycle with the
 * deterministic in-memory client.
 */

import {
  type CaptureResult,
  createFaceModuleFfi,
  type DeviceInfo,
  type DeviceParameters,
  type FaceImage,
  FaceModuleLifecycle,
  FaceModuleStatusCodes,
  FACEPOD_DEFAULTS,
  type ImageDatatype,
  type MatchResult,
  type ProcessResult,
} from "@eai/hid/facepod";

import { ConfigError, type ResolvedConfig } from "./config.ts";
import { DeterministicMockClient, type MockScenario } from "./mockClient.ts";
import { type NormalizedError, normalizeError } from "./errors.ts";

export interface SessionStatus {
  connected: boolean;
  cameraOpen: boolean;
  busy: boolean;
  status: FaceModuleStatusCodes | "disconnected";
  /** Live FFI loader knobs (null in mock mode / when relying on env defaults). */
  dllPath: string | null;
  dllDir: string | null;
  pollIntervalMs: number | null;
  mock: boolean;
  scenario: MockScenario | null;
  lastError: NormalizedError | null;
}

export interface CaptureParams {
  minimalQuality: number;
  maximalSpoofScore?: number;
  timeoutMs?: number;
}

export interface CaptureAndMatchParams {
  reference: FaceImage;
  capture: CaptureParams;
  minimalMatchScore: number;
}

export interface CaptureAndMatchResult {
  reference: ProcessResult;
  live: CaptureResult;
  match: MatchResult;
}

/** Throw a 409-mapped "not connected" error (no live lifecycle). */
function notConnected(): never {
  const e = new Error(
    "FacePod is not connected. Connect first via POST /api/connect.",
  );
  e.name = "NotConnectedError";
  throw e;
}

/** Throw a 409-mapped "busy" error (another op is already in flight). */
function busy(): never {
  const e = new Error(
    "FacePod is busy with another operation. Try again shortly.",
  );
  e.name = "BusyError";
  throw e;
}

/**
 * Builds + returns a (not-yet-connected) FaceModuleLifecycle for a config.
 * Injectable so tests can substitute a lifecycle backed by a fake client.
 */
export type LifecycleFactory = (
  config: ResolvedConfig,
) => Promise<FaceModuleLifecycle>;

export class FacePodSession {
  #fp: FaceModuleLifecycle | null = null;
  #dllPath: string | null = null;
  #dllDir: string | null = null;
  #pollIntervalMs: number | null = null;
  #mock = false;
  #cameraOpen = false;
  #busy = false;
  #lastError: NormalizedError | null = null;
  #mockScenario: MockScenario = "good";
  readonly #makeLifecycle: LifecycleFactory;

  constructor(makeLifecycle?: LifecycleFactory) {
    this.#makeLifecycle = makeLifecycle ??
      ((config) => Promise.resolve(this.#defaultLifecycle(config)));
  }

  /**
   * Default factory. Live mode builds the USB/FFI transport (createFaceModuleFfi)
   * only — there is no REST path. Mock mode drives a FaceModuleLifecycle with the
   * deterministic in-memory client, whose scenario is read live via a closure so
   * scenario switches need no reconnect.
   */
  #defaultLifecycle(config: ResolvedConfig): FaceModuleLifecycle {
    if (config.mock) {
      return new FaceModuleLifecycle(
        { ...FACEPOD_DEFAULTS },
        new DeterministicMockClient(() => this.#mockScenario),
      );
    }
    return createFaceModuleFfi({
      dllPath: config.dllPath,
      dllDir: config.dllDir,
      pollIntervalMs: config.pollIntervalMs,
    });
  }

  get connected(): boolean {
    return this.#fp !== null;
  }

  status(): SessionStatus {
    return {
      connected: this.connected,
      cameraOpen: this.#fp ? this.#fp.device.isOpen : false,
      busy: this.#busy,
      status: this.#fp ? this.#fp.status : "disconnected",
      dllPath: this.#dllPath,
      dllDir: this.#dllDir,
      pollIntervalMs: this.#pollIntervalMs,
      mock: this.#mock,
      scenario: this.#mock ? this.#mockScenario : null,
      lastError: this.#lastError,
    };
  }

  /**
   * Run a device op exclusively: reject (409 BusyError) if one is already in
   * flight, else hold the busy lock for its duration. The guard check + set are
   * synchronous (before any await), so two calls in the same tick can't both
   * acquire it — this serializes the single physical device/camera context.
   */
  async #track<T>(fn: () => Promise<T>): Promise<T> {
    if (this.#busy) busy();
    this.#busy = true;
    try {
      const result = await fn();
      this.#lastError = null;
      return result;
    } catch (err) {
      this.#lastError = normalizeError(err);
      throw err;
    } finally {
      this.#busy = false;
    }
  }

  #require(): FaceModuleLifecycle {
    if (!this.#fp) notConnected();
    return this.#fp;
  }

  /** Dispose any existing session, then create + connect a new one. */
  async connect(config: ResolvedConfig): Promise<DeviceInfo> {
    return await this.#track(async () => {
      // Hold the busy lock across teardown + build so a prior session is never
      // torn down only to then reject the new connect on a race.
      await this.#teardown();
      this.#mockScenario = config.mockScenario; // read live by the mock client
      const fp = await this.#makeLifecycle(config);
      let info: DeviceInfo;
      try {
        await fp.connect();
        // Resolve device info BEFORE adopting the lifecycle: if this throws we
        // must not leave a "connected" session behind.
        info = await fp.device.getInfo();
      } catch (err) {
        await fp.dispose().catch(() => {});
        throw err;
      }
      this.#fp = fp;
      this.#dllPath = config.mock ? null : (config.dllPath ?? null);
      this.#dllDir = config.mock ? null : (config.dllDir ?? null);
      this.#pollIntervalMs = config.mock
        ? null
        : (config.pollIntervalMs ?? null);
      this.#mock = config.mock;
      this.#cameraOpen = false;
      return info;
    });
  }

  /** Close camera (if open) and dispose the lifecycle. Rejects if busy. */
  async disconnect(): Promise<void> {
    await this.#track(() => this.#teardown());
  }

  /**
   * Unguarded teardown used by shutdown — bypasses the busy lock so the process
   * can always release the device even mid-operation (Ctrl-C / SIGTERM).
   */
  async forceDispose(): Promise<void> {
    await this.#teardown().catch(() => {});
  }

  /**
   * Switch the active mock scenario at runtime — takes effect on the next
   * capture/process/match with no reconnect. Only valid while connected in mock.
   */
  setMockScenario(scenario: MockScenario): { scenario: MockScenario } {
    if (!this.#fp) notConnected();
    if (!this.#mock) {
      throw new ConfigError(
        "Mock scenarios only apply when connected in mock mode.",
      );
    }
    this.#mockScenario = scenario;
    return { scenario };
  }

  /** Best-effort dispose of the current lifecycle and clear session state. */
  async #teardown(): Promise<void> {
    const fp = this.#fp;
    if (!fp) return;
    this.#fp = null; // prevent reentrancy / further use during teardown
    try {
      await fp.dispose(); // best-effort: closes camera then releases client
    } finally {
      this.#dllPath = null;
      this.#dllDir = null;
      this.#pollIntervalMs = null;
      this.#mock = false;
      this.#cameraOpen = false;
    }
  }

  getInfo(): Promise<DeviceInfo> {
    return this.#track(() => this.#require().device.getInfo());
  }

  getCameras() {
    return this.#track(() => this.#require().device.getCameraList());
  }

  getParameters(): Promise<DeviceParameters> {
    return this.#track(() => this.#require().device.getParameters());
  }

  /** Idempotent: opening an already-open camera is a no-op (never double-open). */
  async openCamera(opts?: {
    cameraId?: string;
    algorithmType?: "on_device";
    reservationTimeoutMs?: number;
  }): Promise<{ cameraOpen: true }> {
    return await this.#track(async () => {
      const fp = this.#require();
      if (!fp.device.isOpen) {
        await fp.device.openCamera(opts);
      }
      this.#cameraOpen = true;
      return { cameraOpen: true } as const;
    });
  }

  async closeCamera(): Promise<{ cameraOpen: false }> {
    return await this.#track(async () => {
      const fp = this.#require();
      await fp.device.closeCamera(); // library-idempotent
      this.#cameraOpen = false;
      return { cameraOpen: false } as const;
    });
  }

  capture(params: CaptureParams): Promise<CaptureResult> {
    return this.#track(() =>
      this.#require().device.captureAndProcess({
        minimalQuality: params.minimalQuality,
        maximalSpoofScore: params.maximalSpoofScore,
        timeoutMs: params.timeoutMs,
      })
    );
  }

  processImage(
    data: string,
    datatype: ImageDatatype,
    opts?: { minimalQuality?: number; maximalSpoofScore?: number },
  ): Promise<ProcessResult> {
    const image: FaceImage = { modality: "face", datatype, data };
    return this.#track(() => this.#require().device.processImage(image, opts));
  }

  match(
    template1: string,
    template2: string,
    minimalMatchScore: number,
  ): Promise<MatchResult> {
    return this.#track(() =>
      this.#require().device.matchWithTemplate(
        { modality: "face", datatype: "hftemplate", data: template1 },
        { modality: "face", datatype: "hftemplate", data: template2 },
        { minimalMatchScore },
      )
    );
  }

  /** Process a reference image, capture a live face, and match the two. */
  captureAndMatch(
    params: CaptureAndMatchParams,
  ): Promise<CaptureAndMatchResult> {
    return this.#track(async () => {
      const fp = this.#require();
      const reference = await fp.device.processImage(params.reference, {
        minimalQuality: params.capture.minimalQuality,
        maximalSpoofScore: params.capture.maximalSpoofScore,
      });
      const live = await fp.device.captureAndProcess({
        minimalQuality: params.capture.minimalQuality,
        maximalSpoofScore: params.capture.maximalSpoofScore,
        timeoutMs: params.capture.timeoutMs,
      });
      if (!reference.template) {
        throw new Error(
          "Reference image produced no template (no face detected?).",
        );
      }
      if (!live.template) {
        throw new Error(
          "Live capture produced no template (no face detected?).",
        );
      }
      const match = await fp.device.matchWithTemplate(
        reference.template,
        live.template,
        { minimalMatchScore: params.minimalMatchScore },
      );
      return { reference, live, match };
    });
  }
}
