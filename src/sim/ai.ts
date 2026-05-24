import { type Rng } from './rng';
import { type Wrestler, isActive } from './wrestler';
import { distSq, ringLeft, ringRight, ringTop, ringBottom, RING } from './physics';

/**
 * Picks a new wander destination inside the ring, biased toward the ring
 * center to discourage wrestlers from camping the ropes (which would visually
 * leak the scheduler's victim selection).
 *
 * Determinism note: this consumes RNG, so the same seed always produces the
 * same wander pattern.
 */
export function pickWanderPoint(rng: Rng): { x: number; y: number } {
  // Triangular distribution biased toward center: average of two uniforms.
  const u1 = rng.next();
  const u2 = rng.next();
  const fx = (u1 + u2) / 2;
  const v1 = rng.next();
  const v2 = rng.next();
  const fy = (v1 + v2) / 2;
  const margin = 30;
  const x = ringLeft() + margin + fx * (ringRight() - ringLeft() - 2 * margin);
  const y = ringTop() + margin + fy * (ringBottom() - ringTop() - 2 * margin);
  return { x, y };
}

/**
 * Nearest active wrestler to `w` (excluding itself), or null if alone.
 * Used both for picking an engagement target and for identifying the
 * eliminator when the scheduler triggers a forced elimination.
 */
export function nearestOther(w: Wrestler, all: readonly Wrestler[]): Wrestler | null {
  let best: Wrestler | null = null;
  let bestD = Infinity;
  for (const other of all) {
    // Wrestlers who aren't actually in the ring yet shouldn't be picked.
    if (other.state === 'offstage' || other.state === 'entering') continue;
    if (other.id === w.id || !isActive(other)) continue;
    const d = distSq(w.x, w.y, other.x, other.y);
    if (d < bestD) {
      bestD = d;
      best = other;
    }
  }
  return best;
}

/** Starting positions: 12 wrestlers evenly spaced around the ring center. */
export function startingPositions(n: number): Array<{ x: number; y: number; facing: -1 | 1 }> {
  const out: Array<{ x: number; y: number; facing: -1 | 1 }> = [];
  const radiusX = RING.halfW * 0.6;
  const radiusY = RING.halfH * 0.55;
  for (let i = 0; i < n; i++) {
    const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
    const x = RING.cx + Math.cos(angle) * radiusX;
    const y = RING.cy + Math.sin(angle) * radiusY;
    out.push({ x, y, facing: Math.cos(angle) >= 0 ? -1 : 1 });
  }
  return out;
}
