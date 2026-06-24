/** 3D head-pose estimation from the 5 device landmarks — DERIVED, not HID-measured.
 *
 * A Perspective-n-Point solve (POSIT, DeMenthon & Davis 1995 — the classic
 * iterative "solvePnP" for non-coplanar points) fits a canonical 3D face model to
 * the 2D landmarks, then the recovered rotation is decomposed into roll/yaw/pitch.
 *
 * No camera calibration is available from the device, so the intrinsics are
 * ESTIMATED: focal ≈ frame width, principal point ≈ frame centre. Pose orientation
 * is fairly tolerant of focal error; the angles are best read as a strong estimate,
 * not calibrated truth. Falls back to the 2D heuristic (poseFromLandmarks) when
 * there aren't 5 landmarks, the frame size is unknown, or the solve degenerates.
 *
 * Conventions (camera frame: +x right, +y down, +z away from camera):
 *   roll  + → head tilted so the image-right eye sits lower (matches the 2D method)
 *   yaw   + → face turned toward image-right
 *   pitch + → chin down / looking down
 */
import { poseFromLandmarks, type Pose } from "./derived.ts";

export type { Pose };

type LM = { type?: string; x: number; y: number };
type Vec3 = [number, number, number];

/** Canonical 3D face model in camera-frame mm (nose tip = origin; eyes above,
 *  recessed; mouth below). Relative proportions only — absolute scale cancels. */
const MODEL: Record<string, Vec3> = {
  nose: [0, 0, 0],
  left_eye: [-170, -170, 135], // image-left eye → -x
  right_eye: [170, -170, 135],
  mouth_left: [-150, 150, 125],
  mouth_right: [150, 150, 125],
};

/** Sign normalisation so the reported axes read intuitively (see header). yaw is
 *  negated: in this camera-frame model Ry(+) turns the nose toward image-LEFT, but
 *  we report +yaw = face toward image-right to match the 2D heuristic (no sign jump
 *  on fallback). Verified against the 2D method in pose3d.test.ts. */
const SIGN = { roll: 1, yaw: -1, pitch: 1 };

const deg = (r: number) => (r * 180) / Math.PI;
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];

/** Inverse of a 3×3 matrix (row-major); null when singular. */
function inv3(m: number[][]): number[][] | null {
  const [a, b, c] = m[0], [d, e, f] = m[1], [g, h, i] = m[2];
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-12) return null;
  const id = 1 / det;
  return [
    [A * id, (c * h - b * i) * id, (b * f - c * e) * id],
    [B * id, (a * i - c * g) * id, (c * d - a * f) * id],
    [C * id, (b * g - a * h) * id, (a * e - b * d) * id],
  ];
}

/** Resolve the 5 model↔image correspondences, ordering eye/mouth pairs by image-x
 *  so the solve is invariant to the device's left/right landmark labelling. */
function correspondences(landmarks: LM[]): { obj: Vec3[]; img: [number, number][] } | null {
  const byType = (t: string) => landmarks.find((l) => l.type === t) ?? null;
  const nose = byType("nose");
  const eyes = [byType("left_eye"), byType("right_eye")].filter(Boolean) as LM[];
  const mouth = [byType("mouth_left"), byType("mouth_right")].filter(Boolean) as LM[];
  if (!nose || eyes.length !== 2 || mouth.length !== 2) return null;
  const [eL, eR] = eyes[0].x <= eyes[1].x ? [eyes[0], eyes[1]] : [eyes[1], eyes[0]];
  const [mL, mR] = mouth[0].x <= mouth[1].x ? [mouth[0], mouth[1]] : [mouth[1], mouth[0]];
  return {
    obj: [MODEL.nose, MODEL.left_eye, MODEL.right_eye, MODEL.mouth_left, MODEL.mouth_right],
    img: [[nose.x, nose.y], [eL.x, eL.y], [eR.x, eR.y], [mL.x, mL.y], [mR.x, mR.y]],
  };
}

/** POSIT: recover the object→camera rotation (rows = camera axes). Reference point
 *  is obj[0]; image points are taken relative to the principal point. */
function posit(obj: Vec3[], img: [number, number][], f: number, cx: number, cy: number): number[][] | null {
  const n = obj.length;
  const ref = obj[0];
  const mv: Vec3[] = obj.map((p) => [p[0] - ref[0], p[1] - ref[1], p[2] - ref[2]]);

  // B = pinv(A) = inv(Aᵀ A) Aᵀ, where A's rows are the model vectors (n×3).
  const ata = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      let s = 0;
      for (let k = 0; k < n; k++) s += mv[k][r] * mv[k][c];
      ata[r][c] = s;
    }
  }
  const inv = inv3(ata);
  if (!inv) return null;
  const B: number[][] = [[], [], []]; // 3×n
  for (let r = 0; r < 3; r++) {
    for (let k = 0; k < n; k++) {
      B[r][k] = inv[r][0] * mv[k][0] + inv[r][1] * mv[k][1] + inv[r][2] * mv[k][2];
    }
  }

  const u = img.map(([ix]) => ix - cx), v = img.map(([, iy]) => iy - cy);
  const u0 = u[0], v0 = v[0];
  let eps = new Array(n).fill(0);
  let iHat: Vec3 = [1, 0, 0], jHat: Vec3 = [0, 1, 0], kHat: Vec3 = [0, 0, 1];

  for (let iter = 0; iter < 30; iter++) {
    const xx = u.map((ui, i) => ui * (1 + eps[i]) - u0);
    const yy = v.map((vi, i) => vi * (1 + eps[i]) - v0);
    const I: Vec3 = [0, 0, 0], J: Vec3 = [0, 0, 0];
    for (let r = 0; r < 3; r++) {
      for (let k = 0; k < n; k++) { I[r] += B[r][k] * xx[k]; J[r] += B[r][k] * yy[k]; }
    }
    const s1 = norm(I), s2 = norm(J);
    if (s1 < 1e-9 || s2 < 1e-9) return null;
    iHat = scale(I, 1 / s1);
    kHat = cross(iHat, scale(J, 1 / s2));
    const kn = norm(kHat);
    if (kn < 1e-9) return null;
    kHat = scale(kHat, 1 / kn);
    jHat = cross(kHat, iHat); // re-orthonormalise
    const s = (s1 + s2) / 2;
    const z0 = f / s;
    if (!isFinite(z0) || z0 <= 0) return null;
    const next = mv.map((m) => dot(m, kHat) / z0);
    const delta = Math.max(...next.map((e, i) => Math.abs(e - eps[i])));
    eps = next;
    if (delta < 1e-4) break;
  }
  return [iHat, jHat, kHat]; // rows = R (object→camera)
}

/** Decompose R (object→camera, R = Rz(roll)·Ry(yaw)·Rx(pitch)) into Tait–Bryan angles. */
function eulerFrom(R: number[][]): Pose {
  const sy = Math.hypot(R[2][1], R[2][2]);
  let pitch: number, yaw: number, roll: number;
  if (sy > 1e-6) {
    pitch = Math.atan2(R[2][1], R[2][2]);
    yaw = Math.atan2(-R[2][0], sy);
    roll = Math.atan2(R[1][0], R[0][0]);
  } else { // gimbal lock
    pitch = Math.atan2(-R[1][2], R[1][1]);
    yaw = Math.atan2(-R[2][0], sy);
    roll = 0;
  }
  return {
    roll: SIGN.roll * deg(roll),
    yaw: SIGN.yaw * deg(yaw),
    pitch: SIGN.pitch * deg(pitch),
  };
}

/** 3D-model pose fit. Returns null on insufficient/degenerate input (caller falls back). */
export function estimatePose3D(
  landmarks: LM[] | null | undefined,
  frame: { w: number; h: number } | null,
): Pose | null {
  if (!landmarks || !frame || frame.w <= 0 || frame.h <= 0) return null;
  const corr = correspondences(landmarks);
  if (!corr) return null;
  const R = posit(corr.obj, corr.img, frame.w, frame.w / 2, frame.h / 2);
  if (!R) return null;
  const p = eulerFrom(R);
  if ([p.roll, p.yaw, p.pitch].some((a) => a == null || !isFinite(a))) return null;
  return p;
}

export interface PoseEstimate extends Pose {
  /** "3d" = POSIT model fit; "2d" = landmark-geometry fallback. */
  method: "3d" | "2d";
}

/** Best available pose: prefer the 3D model fit, fall back to the 2D heuristic. */
export function estimatePose(
  landmarks: LM[] | null | undefined,
  frame: { w: number; h: number } | null,
): PoseEstimate | null {
  const three = estimatePose3D(landmarks, frame);
  if (three) return { ...three, method: "3d" };
  const two = poseFromLandmarks(landmarks);
  return two ? { ...two, method: "2d" } : null;
}
