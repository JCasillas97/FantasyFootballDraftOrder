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
/**
 * Inset from the ring edge that wrestler centers must stay inside. Without
 * this they cluster on the rope band itself, which looks like they're
 * standing on top of the ropes. The elimination sequence (state =
 * 'beingEliminated') bypasses the clamp so launched wrestlers do cross
 * outside.
 */
export const PLAYABLE_INSET = ROPE_BAND + 8;

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

/** Clamp a point to the playable area inside the ropes. */
export function clampToRing(x: number, y: number, r: Ring = RING): { x: number; y: number } {
  return {
    x: Math.max(ringLeft(r) + PLAYABLE_INSET, Math.min(ringRight(r) - PLAYABLE_INSET, x)),
    y: Math.max(ringTop(r) + PLAYABLE_INSET, Math.min(ringBottom(r) - PLAYABLE_INSET, y)),
  };
}

/**
 * Width of the concrete floor band between the ring and the crowd. Launched
 * wrestlers land somewhere in this band — they can leave the ring but not
 * end up in the seating. Renderer reads the same constant for crowd layout.
 */
export const FLOOR_BAND = 60;

/**
 * The "spot table" position — the announcer's table at the bottom of the
 * screen. The table-break spot drags the victim here and slams them through
 * the commentators' desk. Same coordinates used by the renderer.
 */
export const SPOT_TABLE_X = RING.cx;
export const SPOT_TABLE_Y = RING.cy + RING.halfH + 24;

/**
 * Clamp to the visible canvas (with sprite-size margin) so that wrestlers
 * launched out of the ring stay on-screen as "dead bodies". The sprite is
 * 48x64 on the canvas; the margins below keep the head/feet visible.
 */
export const CANVAS_BOUND_W = 960;
export const CANVAS_BOUND_H = 540;
export function clampToCanvas(x: number, y: number): { x: number; y: number } {
  const marginX = 24;
  const marginTop = 60;
  const marginBottom = 12;
  return {
    x: Math.max(marginX, Math.min(CANVAS_BOUND_W - marginX, x)),
    y: Math.max(marginTop, Math.min(CANVAS_BOUND_H - marginBottom, y)),
  };
}

/**
 * Clamp to the floor band — the concrete strip between the ropes and the
 * barricades. Eliminated bodies land here, not in the crowd. Wrestlers may
 * cross the ropes outward (the elimination toss does this) but they hit the
 * barricade at FLOOR_BAND distance and stop.
 */
export function clampToFloor(x: number, y: number, r: Ring = RING): { x: number; y: number } {
  return {
    x: Math.max(ringLeft(r) - FLOOR_BAND + 6, Math.min(ringRight(r) + FLOOR_BAND - 6, x)),
    y: Math.max(ringTop(r) - FLOOR_BAND + 6, Math.min(ringBottom(r) + FLOOR_BAND - 6, y)),
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
