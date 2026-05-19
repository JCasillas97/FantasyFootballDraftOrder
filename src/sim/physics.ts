/**
 * The ring is an axis-aligned rectangle inside the canvas. Inner bounds are
 * where wrestlers can stand; the rope band runs along the perimeter. Going
 * "over the top rope" means crossing one of the rope edges while in the
 * beingEliminated state.
 *
 * Coordinates are canvas-pixel space (960 wide x 540 tall canvas).
 */
export interface Ring {
  readonly cx: number;
  readonly cy: number;
  readonly halfW: number;
  readonly halfH: number;
}

export const RING: Ring = {
  cx: 480,
  cy: 290,
  halfW: 280,
  halfH: 160,
};

export const ROPE_BAND = 18;

export function ringLeft(r: Ring = RING): number {
  return r.cx - r.halfW;
}
export function ringRight(r: Ring = RING): number {
  return r.cx + r.halfW;
}
export function ringTop(r: Ring = RING): number {
  return r.cy - r.halfH;
}
export function ringBottom(r: Ring = RING): number {
  return r.cy + r.halfH;
}

/** Squared distance — for cheap proximity checks. */
export function distSq(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

/** Clamp a point to remain inside the ring (allowing it to touch the rope). */
export function clampToRing(x: number, y: number, r: Ring = RING): { x: number; y: number } {
  return {
    x: Math.max(ringLeft(r), Math.min(ringRight(r), x)),
    y: Math.max(ringTop(r), Math.min(ringBottom(r), y)),
  };
}

/** Direction vector from (x,y) toward the nearest rope edge, normalized. */
export function toNearestRope(
  x: number,
  y: number,
  r: Ring = RING,
): { dx: number; dy: number } {
  const distLeft = x - ringLeft(r);
  const distRight = ringRight(r) - x;
  const distTop = y - ringTop(r);
  const distBottom = ringBottom(r) - y;
  const min = Math.min(distLeft, distRight, distTop, distBottom);
  if (min === distLeft) return { dx: -1, dy: 0 };
  if (min === distRight) return { dx: 1, dy: 0 };
  if (min === distTop) return { dx: 0, dy: -1 };
  return { dx: 0, dy: 1 };
}

/** True if the point is within ROPE_BAND of any rope edge. */
export function isNearRope(x: number, y: number, r: Ring = RING): boolean {
  return (
    x - ringLeft(r) < ROPE_BAND ||
    ringRight(r) - x < ROPE_BAND ||
    y - ringTop(r) < ROPE_BAND ||
    ringBottom(r) - y < ROPE_BAND
  );
}
