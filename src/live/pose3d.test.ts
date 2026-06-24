import { describe, expect, it } from "vitest";
import { estimatePose, estimatePose3D } from "./pose3d.ts";
import { poseFromLandmarks } from "./derived.ts";

type Vec3 = [number, number, number];
const FRAME = { w: 1000, h: 1000 };
const F = FRAME.w, CX = FRAME.w / 2, CY = FRAME.h / 2;

// Same canonical model the solver uses (camera-frame mm).
const MODEL: Record<string, Vec3> = {
  nose: [0, 0, 0],
  left_eye: [-170, -170, 135],
  right_eye: [170, -170, 135],
  mouth_left: [-150, 150, 125],
  mouth_right: [150, 150, 125],
};

const rad = (d: number) => (d * Math.PI) / 180;
function mul(A: number[][], B: number[][]) {
  const out = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      let s = 0;
      for (let k = 0; k < 3; k++) s += A[i][k] * B[k][j];
      out[i][j] = s;
    }
  }
  return out;
}

function rx(a: number) { const c = Math.cos(a), s = Math.sin(a); return [[1, 0, 0], [0, c, -s], [0, s, c]]; }
function ry(a: number) { const c = Math.cos(a), s = Math.sin(a); return [[c, 0, s], [0, 1, 0], [-s, 0, c]]; }
function rz(a: number) { const c = Math.cos(a), s = Math.sin(a); return [[c, -s, 0], [s, c, 0], [0, 0, 1]]; }

/** Build R = Rz(roll)·Ry(yaw)·Rx(pitch). yaw is given in the PUBLIC convention
 *  (+ = face toward image-right); the camera-frame matrix uses the opposite
 *  handedness, so we negate it here (mirrors SIGN.yaw in the solver). */
function rotation(roll: number, yaw: number, pitch: number) {
  return mul(mul(rz(rad(roll)), ry(rad(-yaw))), rx(rad(pitch)));
}

/** Project the model under (R, t) into landmarks the solver will consume. */
function project(R: number[][], tz: number) {
  const types = ["nose", "left_eye", "right_eye", "mouth_left", "mouth_right"];
  return types.map((t) => {
    const p = MODEL[t];
    const xc = R[0][0] * p[0] + R[0][1] * p[1] + R[0][2] * p[2];
    const yc = R[1][0] * p[0] + R[1][1] * p[1] + R[1][2] * p[2];
    const zc = R[2][0] * p[0] + R[2][1] * p[1] + R[2][2] * p[2] + tz;
    return { type: t, x: (F * xc) / zc + CX, y: (F * yc) / zc + CY };
  });
}

describe("pose3d (POSIT model fit)", () => {
  it("returns ~0° for a frontal, upright face", () => {
    const p = estimatePose3D(project(rotation(0, 0, 0), 800), FRAME)!;
    expect(p.roll!).toBeCloseTo(0, 0);
    expect(p.yaw!).toBeCloseTo(0, 0);
    expect(p.pitch!).toBeCloseTo(0, 0);
  });

  it("recovers known rotations from synthetic projections (within ~2°)", () => {
    for (const [roll, yaw, pitch] of [
      [8, 15, -10],
      [-12, -20, 7],
      [5, 25, 15],
    ]) {
      const p = estimatePose3D(project(rotation(roll, yaw, pitch), 800), FRAME)!;
      expect(p.roll!).toBeCloseTo(roll, 0);
      expect(p.yaw!).toBeCloseTo(yaw, 0);
      expect(p.pitch!).toBeCloseTo(pitch, 0);
    }
  });

  it("agrees in sign with the 2D heuristic on roll and yaw", () => {
    const lms = project(rotation(10, 18, 0), 800);
    const three = estimatePose3D(lms, FRAME)!;
    const two = poseFromLandmarks(lms)!;
    expect(Math.sign(three.roll!)).toBe(Math.sign(two.roll!));
    expect(Math.sign(three.yaw!)).toBe(Math.sign(two.yaw!));
  });

  it("falls back to the 2D method when 3D is not possible", () => {
    const eyesOnly = [
      { type: "left_eye", x: 40, y: 100 },
      { type: "right_eye", x: 60, y: 100 },
      { type: "nose", x: 50, y: 120 },
    ];
    expect(estimatePose3D(eyesOnly, FRAME)).toBeNull(); // no mouth → can't fit
    expect(estimatePose(eyesOnly, FRAME)!.method).toBe("2d");
    expect(estimatePose(project(rotation(0, 0, 0), 800), FRAME)!.method).toBe("3d");
    expect(estimatePose(eyesOnly, null)!.method).toBe("2d"); // no frame size
    expect(estimatePose(null, FRAME)).toBeNull();
  });
});
