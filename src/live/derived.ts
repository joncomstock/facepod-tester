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
