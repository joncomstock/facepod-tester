/** High-res still capture — pure status machine + gating. No React/DOM.
 *  The effectful object-URL / fetch lifecycle lives in useHighResStill.ts. */
import type { ImageDatatype } from "../api.ts";

export type HighResStatus = "idle" | "capturing" | "ready" | "no-image" | "error";

export interface HighResState {
  status: HighResStatus;
  /** Present only when status === "error". */
  message: string | null;
}

export const INITIAL_HIGH_RES: HighResState = { status: "idle", message: null };

export type HighResEvent =
  | { type: "start" }
  | { type: "ready" }
  | { type: "noFace" }
  | { type: "error"; message: string }
  | { type: "discard" };

export function nextHighResState(_prev: HighResState, event: HighResEvent): HighResState {
  switch (event.type) {
    case "start":
      return { status: "capturing", message: null };
    case "ready":
      return { status: "ready", message: null };
    case "noFace":
      return { status: "no-image", message: null };
    case "error":
      return { status: "error", message: event.message };
    case "discard":
      return { status: "idle", message: null };
  }
}

/** High-res capture is allowed only while the verify feed is genuinely live
 *  (camera open + watching) and no capture is already in flight. */
export function canCaptureHighRes(active: boolean, status: HighResStatus): boolean {
  return active && status !== "capturing";
}

/** Download filename for a captured still. PNG by default; jpg/jpeg → .jpg. */
export function highResFilename(id: string, encoding: ImageDatatype | undefined): string {
  const ext = encoding === "jpg" || encoding === "jpeg" ? "jpg" : "png";
  return `facepod-highres-${id}.${ext}`;
}
