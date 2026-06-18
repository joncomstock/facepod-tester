/** Pure device-raster → percentage mapping. The feed renders in a box whose
 *  aspect ratio equals the frame's (9:16), so a coordinate maps to a simple
 *  percentage of the natural pixel dimension — no letterbox/crop offsets. */
export interface PctBox { leftPct: number; topPct: number; widthPct: number; heightPct: number }
export interface PctPoint { leftPct: number; topPct: number }

export function mapBox(
  box: { x: number; y: number; width: number; height: number },
  naturalW: number,
  naturalH: number,
): PctBox {
  return {
    leftPct: (box.x / naturalW) * 100,
    topPct: (box.y / naturalH) * 100,
    widthPct: (box.width / naturalW) * 100,
    heightPct: (box.height / naturalH) * 100,
  };
}

export function mapPoint(
  p: { x: number; y: number },
  naturalW: number,
  naturalH: number,
): PctPoint {
  return { leftPct: (p.x / naturalW) * 100, topPct: (p.y / naturalH) * 100 };
}
