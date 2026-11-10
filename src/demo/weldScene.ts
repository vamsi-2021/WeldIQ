/**
 * Tiny 3D model of a T-joint fillet weld plus a perspective projector, used to
 * draw the demo "camera" view and demo thumbnails with react-native-svg.
 * Units are metres, +Y up (same convention as ARKit).
 */
export type Vec3 = [number, number, number];

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const norm = (a: Vec3): Vec3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

export const WELD_TARGET: Vec3 = [0, 0.02, 0];

interface Box {
  min: Vec3;
  max: Vec3;
  color: [number, number, number];
}

const BOXES: Box[] = [
  // Base plate and upright plate of a T-joint.
  { min: [-0.15, -0.012, -0.1], max: [0.15, 0, 0.1], color: [128, 136, 146] },
  { min: [-0.15, 0, -0.006], max: [0.15, 0.12, 0.006], color: [140, 148, 158] },
];

/** Fillet weld beads along both sides of the joint. */
const BEADS: { y: number; z: number }[] = [
  { y: 0.006, z: 0.012 },
  { y: 0.006, z: -0.012 },
];
const BEAD_RADIUS = 0.0075;
const BEAD_SEGMENTS = 18;

const LIGHT = norm([0.4, 1, 0.35]);

export interface Shape {
  kind: 'poly' | 'bead' | 'ripple';
  points: string;
  depth: number;
  fill?: string;
  stroke?: string;
  width?: number;
}

export interface Projection {
  shapes: Shape[];
  grid: string[];
  targetRing: string | null;
}

/** Camera position for an orbit around the weld. */
export function orbitCamera(azimuthDeg: number, elevationDeg: number, distance = 0.42): Vec3 {
  const az = (azimuthDeg * Math.PI) / 180;
  const el = (elevationDeg * Math.PI) / 180;
  return [
    WELD_TARGET[0] + distance * Math.cos(el) * Math.sin(az),
    WELD_TARGET[1] + distance * Math.sin(el),
    WELD_TARGET[2] + distance * Math.cos(el) * Math.cos(az),
  ];
}

/** Projects the weld scene for a camera at `eye` looking at the weld. */
export function projectScene(
  eye: Vec3,
  width: number,
  height: number,
  opts: { look?: Vec3; showTarget?: boolean } = {},
): Projection {
  const look = opts.look ?? WELD_TARGET;
  const f = norm(sub(look, eye));
  const r = norm(cross(f, [0, 1, 0]));
  const u = cross(r, f);
  const focal = Math.min(width, height) * 1.25;

  const toCam = (p: Vec3) => {
    const d = sub(p, eye);
    return [dot(d, r), dot(d, u), dot(d, f)] as Vec3;
  };
  const toScreen = (c: Vec3) => [width / 2 + (focal * c[0]) / c[2], height / 2 - (focal * c[1]) / c[2]];
  const visible = (c: Vec3) => c[2] > 0.02;

  const shapes: Shape[] = [];

  for (const box of BOXES) {
    const { min, max } = box;
    const faces: { n: Vec3; pts: Vec3[] }[] = [
      { n: [0, 1, 0], pts: [[min[0], max[1], min[2]], [max[0], max[1], min[2]], [max[0], max[1], max[2]], [min[0], max[1], max[2]]] },
      { n: [0, -1, 0], pts: [[min[0], min[1], min[2]], [min[0], min[1], max[2]], [max[0], min[1], max[2]], [max[0], min[1], min[2]]] },
      { n: [0, 0, 1], pts: [[min[0], min[1], max[2]], [min[0], max[1], max[2]], [max[0], max[1], max[2]], [max[0], min[1], max[2]]] },
      { n: [0, 0, -1], pts: [[min[0], min[1], min[2]], [max[0], min[1], min[2]], [max[0], max[1], min[2]], [min[0], max[1], min[2]]] },
      { n: [1, 0, 0], pts: [[max[0], min[1], min[2]], [max[0], min[1], max[2]], [max[0], max[1], max[2]], [max[0], max[1], min[2]]] },
      { n: [-1, 0, 0], pts: [[min[0], min[1], min[2]], [min[0], max[1], min[2]], [min[0], max[1], max[2]], [min[0], min[1], max[2]]] },
    ];
    for (const face of faces) {
      const center = face.pts.reduce((a, p) => [a[0] + p[0] / 4, a[1] + p[1] / 4, a[2] + p[2] / 4] as Vec3, [0, 0, 0] as Vec3);
      if (dot(face.n, sub(eye, center)) <= 0) {
        continue; // back face
      }
      const cam = face.pts.map(toCam);
      if (!cam.every(visible)) {
        continue;
      }
      const shade = 0.35 + 0.65 * Math.max(0, dot(face.n, LIGHT));
      const [cr, cg, cb] = box.color.map(c => Math.round(c * shade));
      shapes.push({
        kind: 'poly',
        points: cam.map(c => toScreen(c).join(',')).join(' '),
        depth: cam.reduce((a, c) => a + c[2], 0) / 4,
        fill: `rgb(${cr},${cg},${cb})`,
        stroke: 'rgba(0,0,0,0.25)',
      });
    }
  }

  // Weld beads as thick polylines split into depth-sorted segments, with ripples.
  for (const bead of BEADS) {
    for (let i = 0; i < BEAD_SEGMENTS; i++) {
      const x0 = -0.15 + (0.3 * i) / BEAD_SEGMENTS;
      const x1 = -0.15 + (0.3 * (i + 1)) / BEAD_SEGMENTS;
      const a = toCam([x0, bead.y, bead.z]);
      const b = toCam([x1, bead.y, bead.z]);
      if (!visible(a) || !visible(b)) {
        continue;
      }
      const depth = (a[2] + b[2]) / 2;
      // Bead sits in the corner; hide it when the upright plate is between it and the camera.
      if (Math.sign(eye[2]) !== Math.sign(bead.z) && Math.abs(eye[2]) > 0.006 && eye[1] < 0.12) {
        continue;
      }
      const widthPx = (Math.min(width, height) * 1.25 * BEAD_RADIUS * 2) / depth;
      const sa = toScreen(a);
      const sb = toScreen(b);
      shapes.push({
        kind: 'bead',
        points: `${sa.join(',')} ${sb.join(',')}`,
        depth: depth - 0.004,
        stroke: '#8a6f55',
        width: widthPx,
      });
      const mid = toScreen(toCam([(x0 + x1) / 2, bead.y + BEAD_RADIUS * 0.35, bead.z]));
      shapes.push({
        kind: 'ripple',
        points: `${mid[0]},${mid[1]}`,
        depth: depth - 0.005,
        fill: 'rgba(255,214,170,0.55)',
        width: widthPx * 0.28,
      });
    }
  }

  shapes.sort((a, b) => b.depth - a.depth);

  // Workbench grid for parallax.
  const grid: string[] = [];
  const y = -0.012;
  for (let k = -6; k <= 6; k++) {
    const g = k * 0.1;
    for (const [p, q] of [
      [[g, y, -0.6], [g, y, 0.6]],
      [[-0.6, y, g], [0.6, y, g]],
    ] as [Vec3, Vec3][]) {
      // Clip each line to the part in front of the camera.
      const pts: string[] = [];
      for (let s = 0; s <= 12; s++) {
        const t = s / 12;
        const c = toCam([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t]);
        if (visible(c)) {
          pts.push(toScreen(c).join(','));
        }
      }
      if (pts.length > 1) {
        grid.push(pts.join(' '));
      }
    }
  }

  let targetRing: string | null = null;
  if (opts.showTarget) {
    const pts: string[] = [];
    for (let i = 0; i <= 32; i++) {
      const a = (i / 32) * Math.PI * 2;
      const c = toCam([WELD_TARGET[0] + 0.04 * Math.cos(a), WELD_TARGET[1], WELD_TARGET[2] + 0.04 * Math.sin(a)]);
      if (!visible(c)) {
        return { shapes, grid, targetRing: null };
      }
      pts.push(toScreen(c).join(','));
    }
    targetRing = pts.join(' ');
  }

  return { shapes, grid, targetRing };
}
