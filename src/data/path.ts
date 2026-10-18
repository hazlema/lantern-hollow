export interface P2 { x: number; z: number }

/** Chaikin corner-cutting so zombies round corners instead of snapping 90°. */
export function smooth(points: P2[], iterations = 3): P2[] {
  let pts = points;
  for (let it = 0; it < iterations; it++) {
    const out: P2[] = [pts[0]];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      out.push({ x: a.x * 0.75 + b.x * 0.25, z: a.z * 0.75 + b.z * 0.25 });
      out.push({ x: a.x * 0.25 + b.x * 0.75, z: a.z * 0.25 + b.z * 0.75 });
    }
    out.push(pts[pts.length - 1]);
    pts = out;
  }
  return pts;
}

/** Arc-length parameterised polyline: sample position/direction by distance travelled. */
export class Path {
  readonly points: P2[];
  readonly cum: number[];
  readonly length: number;

  constructor(points: P2[]) {
    this.points = points;
    this.cum = [0];
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i];
      this.cum.push(this.cum[i - 1] + Math.hypot(b.x - a.x, b.z - a.z));
    }
    this.length = this.cum[this.cum.length - 1];
  }

  private segment(d: number): number {
    // binary search for the segment containing distance d
    let lo = 0, hi = this.cum.length - 1;
    while (lo < hi - 1) {
      const mid = (lo + hi) >> 1;
      if (this.cum[mid] <= d) lo = mid; else hi = mid;
    }
    return lo;
  }

  /** Writes position, unit direction and left-normal at distance d into `out`. */
  sample(d: number, out: { x: number; z: number; dx: number; dz: number }): void {
    const dd = Math.max(0, Math.min(this.length, d));
    const i = this.segment(dd);
    const a = this.points[i], b = this.points[Math.min(i + 1, this.points.length - 1)];
    const segLen = this.cum[i + 1] - this.cum[i] || 1;
    const t = (dd - this.cum[i]) / segLen;
    out.x = a.x + (b.x - a.x) * t;
    out.z = a.z + (b.z - a.z) * t;
    out.dx = (b.x - a.x) / segLen;
    out.dz = (b.z - a.z) / segLen;
  }
}
