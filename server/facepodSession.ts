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
  type LiveSnapshot,
  type MatchResult,
  type ProcessResult,
  type VideoFrame,
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
  sessionGeneration: number;
}

export interface FrameRead {
  frame: VideoFrame | null;
  snapshot: LiveSnapshot | null;
  snapshotAgeMs: number | null;
  captureId: number;
  sessionGeneration: number;
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
  #closing = false;
  #framesInFlight = 0;
  #inFlightFrame: Promise<unknown> | null = null;
  #inFlightOp: Promise<unknown> | null = null;
  #captureId = 0;
  #sessionGeneration = 0;
  #latestSnapshot:
    | { snapshot: LiveSnapshot; captureId: number; monotonicAtWrite: number }
    | null = null;
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

  get sessionGeneration(): number {
    return this.#sessionGeneration;
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
      sessionGeneration: this.#sessionGeneration,
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
    // Wrap fn() so a synchronous throw is promoted to a rejected promise;
    // this guarantees the finally block always runs and #busy is always cleared.
    const p: Promise<T> = new Promise((res, rej) => {
      try {
        fn().then(res, rej);
      } catch (err) {
        rej(err);
      }
    });
    this.#inFlightOp = p;
    try {
      const result = await p;
      this.#lastError = null;
      return result;
    } catch (err) {
      this.#lastError = normalizeError(err);
      throw err;
    } finally {
      this.#busy = false;
      if (this.#inFlightOp === p) this.#inFlightOp = null;
    }
  }

  #require(): FaceModuleLifecycle {
    if (!this.#fp) notConnected();
    return this.#fp;
  }

  /**
   * Pull the newest preview frame (Lane 1). Bypasses #track exactly like the lib
   * client bypasses its own op-lock, so the feed runs concurrently with an
   * in-flight capture. The check-and-increment below is SYNCHRONOUS (before any
   * await) so a read cannot slip past #closing after the teardown drain observed
   * zero in-flight reads. Returns a null frame (never throws) when closing/not open.
   */
  async readFrame(lastSeq?: bigint): Promise<FrameRead> {
    const base = {
      snapshot: this.#latestSnapshot?.snapshot ?? null,
      snapshotAgeMs: this.#latestSnapshot
        ? performance.now() - this.#latestSnapshot.monotonicAtWrite
        : null,
      captureId: this.#latestSnapshot?.captureId ?? this.#captureId,
      sessionGeneration: this.#sessionGeneration,
    };
    if (this.#closing || !this.#fp || !this.#fp.device.isOpen) {
      return { frame: null, ...base };
    }
    this.#framesInFlight++; // synchronous: paired with the #closing check above
    const p = this.#fp.device.getVideoFrame(lastSeq);
    this.#inFlightFrame = p;
    try {
      const frame = await p;
      // Recompute snapshot/age AFTER the await so the buffer is current.
      return {
        frame,
        snapshot: this.#latestSnapshot?.snapshot ?? null,
        snapshotAgeMs: this.#latestSnapshot
          ? performance.now() - this.#latestSnapshot.monotonicAtWrite
          : null,
        captureId: this.#latestSnapshot?.captureId ?? this.#captureId,
        sessionGeneration: this.#sessionGeneration,
      };
    } catch {
      return { frame: null, ...base };
    } finally {
      this.#framesInFlight--;
      if (this.#framesInFlight === 0) this.#inFlightFrame = null;
    }
  }

  /** Dispose any existing session, then create + connect a new one. */
  async connect(config: ResolvedConfig): Promise<DeviceInfo> {
    // Drain both lanes before acquiring the busy lock so a still-settling Lane-2
    // op can't turn a reconnect into a BusyError (mirrors disconnect()).
    await this.#quiesceFrameLane();
    await this.#quiesceOpLane();
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
      this.#sessionGeneration++;
      this.#closing = false; // a fresh session re-opens the frame lane
      this.#latestSnapshot = null;
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

  /** Close camera (if open) and dispose the lifecycle. Drains both lanes first
   *  so a still-settling capture never turns End-session into a BusyError. */
  async disconnect(): Promise<void> {
    await this.#quiesceFrameLane();
    await this.#quiesceOpLane();
    await this.#track(() => this.#teardown());
  }

  /**
   * Unguarded teardown used by shutdown — bypasses the busy lock so the process
   * can always release the device even mid-operation (Ctrl-C / SIGTERM).
   */
  async forceDispose(): Promise<void> {
    this.#closing = true; // stop new reads immediately; do NOT await the drain
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

  /**
   * Stop the frame lane before dispose: flip #closing (synchronously blocks new
   * reads via readFrame's gate), then await the single in-flight read, BOUNDED by
   * a timeout so a wedged device read can't wedge teardown. At most one read is in
   * flight (clients poll sequentially + the synchronous gate), so awaiting the
   * retained promise is sufficient.
   */
  async #quiesceFrameLane(): Promise<void> {
    this.#closing = true;
    const inflight = this.#inFlightFrame;
    if (!inflight) return;
    let tid: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<void>((r) => {
      tid = setTimeout(r, 500);
    });
    await Promise.race([inflight.catch(() => {}), timeout]);
    clearTimeout(tid);
  }

  /**
   * Wait for an in-flight Lane-2 op (capture/match) to settle before teardown,
   * so disconnect()/connect() don't reject with BusyError when a capture is still
   * draining server-side. Bounded so a wedged op can't wedge teardown.
   */
  async #quiesceOpLane(): Promise<void> {
    const inflight = this.#inFlightOp;
    if (!inflight) return;
    let tid: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<void>((r) => {
      tid = setTimeout(r, 2500);
    });
    await Promise.race([inflight.catch(() => {}), timeout]);
    clearTimeout(tid);
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
      this.#latestSnapshot = null;
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

  capture(params: CaptureParams, signal?: AbortSignal): Promise<CaptureResult> {
    return this.#track(() => {
      const captureId = ++this.#captureId;
      this.#latestSnapshot = null; // clear at op start: no prior-op snapshot lingers
      return this.#require().device.captureAndProcess(
        {
          minimalQuality: params.minimalQuality,
          maximalSpoofScore: params.maximalSpoofScore,
          timeoutMs: params.timeoutMs,
        },
        signal,
        (snap) => {
          this.#latestSnapshot = {
            snapshot: snap,
            captureId,
            monotonicAtWrite: performance.now(),
          };
        },
      );
    });
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
    signal?: AbortSignal,
  ): Promise<CaptureAndMatchResult> {
    return this.#track(async () => {
      const fp = this.#require();
      const reference = await fp.device.processImage(params.reference, {
        minimalQuality: params.capture.minimalQuality,
        maximalSpoofScore: params.capture.maximalSpoofScore,
      });
      const captureId = ++this.#captureId;
      this.#latestSnapshot = null;
      const live = await fp.device.captureAndProcess(
        {
          minimalQuality: params.capture.minimalQuality,
          maximalSpoofScore: params.capture.maximalSpoofScore,
          timeoutMs: params.capture.timeoutMs,
        },
        signal,
        (snap) => {
          this.#latestSnapshot = {
            snapshot: snap,
            captureId,
            monotonicAtWrite: performance.now(),
          };
        },
      );
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
