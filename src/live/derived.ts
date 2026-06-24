/** DERIVED-only hints (NOT HID-measured). Brightness = mean Rec.601 luma off the
 *  rendered frame; distance = bbox-area fraction proxy. Both must be labeled. */
export function meanLuminance(rgba: Uint8ClampedArray): number {
  let sum = 0, n = 0;
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    sum += (0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2]) / 255;
    n++;
  }
  return n === 0 ? 0 : sum / n;
}

export function distanceHint(
  box: { x: number; y: number; width: number; height: number } | null,
  frameArea: number,
): "near" | "ok" | "far" | null {
  if (!box || frameArea <= 0) return null;
  const frac = (box.width * box.height) / frameArea;
  if (frac < 0.05) return "far";
  if (frac > 0.35) return "near";
  return "ok";
}

/** Head pose estimated from the 5 face landmarks — DERIVED, not HID-measured.
 *  The device emits no pose angles; only corrective bits (positioningFeedback).
 *  Roll is exact (the eye-line tilt). Yaw/pitch are 2D proxies (no depth), so
 *  they indicate direction/relative magnitude, not calibrated degrees. Signs:
 *  roll + = subject's head tilted so the image-right eye sits lower; yaw + =
 *  nose right of the eye-midpoint; pitch + = nose below the eye/mouth midline. */
export interface Pose {
  roll: number | null;
  yaw: number | null;
  pitch: number | null;
}

export function poseFromLandmarks(
  landmarks: { type?: string; x: number; y: number }[] | null | undefined,
): Pose | null {
  if (!landmarks || landmarks.length === 0) return null;
  const at = (t: string) => landmarks.find((l) => l.type === t) ?? null;
  const le = at("left_eye"), re = at("right_eye"), nose = at("nose");
  const ml = at("mouth_left"), mr = at("mouth_right");
  if (!le || !re) return null; // both eyes are the minimum needed for any estimate

  const deg = (r: number) => (r * 180) / Math.PI;
  // Order eyes by image-x so roll is sign-stable regardless of left/right labeling.
  const [e1, e2] = le.x <= re.x ? [le, re] : [re, le];
  const dx = e2.x - e1.x, dy = e2.y - e1.y;
  const interocular = Math.hypot(dx, dy) || 1;
  const eyeMidX = (le.x + re.x) / 2, eyeMidY = (le.y + re.y) / 2;

  const roll = deg(Math.atan2(dy, dx));
  const yaw = nose ? deg(Math.atan2(nose.x - eyeMidX, interocular)) : null;
  let pitch: number | null = null;
  if (nose && ml && mr) {
    const mouthMidY = (ml.y + mr.y) / 2;
    const span = mouthMidY - eyeMidY || 1; // eye-line → mouth-line vertical extent
    pitch = deg(Math.atan2(nose.y - (eyeMidY + span / 2), span));
  }
  return { roll, yaw, pitch };
}
