/**
 * Wrestler state + state machine. The hard invariant: state transitions never
 * *decide* an elimination. The scheduler picks the victim ahead of time; the
 * state machine only performs the elimination when the scheduler points at
 * this wrestler. Combat varieties below are purely cosmetic.
 */
export type WrestlerState =
  | 'wandering'
  | 'engaging'
  | 'attacking'
  | 'stunned'
  | 'recovering'
  | 'nearRope'
  | 'beingEliminated'
  | 'eliminated';

export type AttackMove =
  | 'punch'
  | 'kick'
  | 'tackle'
  | 'clothesline'
  | 'topRope'
  | 'splash'
  | 'grapple'
  | 'irishWhip';

export interface Wrestler {
  /** Index into the roster — stable for the whole match. */
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  facing: -1 | 1;
  state: WrestlerState;
  /** Seconds remaining in the current state (for timed states). */
  stateTimer: number;
  /** Id of the wrestler this one is currently focused on, or null. */
  targetId: number | null;
  /** Wander goal point (x, y) — only used in wandering state. */
  wanderX: number;
  wanderY: number;
  /** Render hint: how far through an animation/toss the wrestler is, 0..1. */
  animPhase: number;
  /** Move being performed in the current `attacking` state. */
  attackMove: AttackMove | null;
  /** True when this attack is the scripted elimination finisher. */
  isFinisher: boolean;
  /** True when the wrestler is laid out on the mat (extended stun). */
  downed: boolean;
  /** Vertical render offset (climb height etc). Not part of physics. */
  renderYOffset: number;
}

export function makeWrestler(id: number, x: number, y: number, facing: -1 | 1): Wrestler {
  return {
    id,
    x,
    y,
    vx: 0,
    vy: 0,
    facing,
    state: 'wandering',
    stateTimer: 0,
    targetId: null,
    wanderX: x,
    wanderY: y,
    animPhase: 0,
    attackMove: null,
    isFinisher: false,
    downed: false,
    renderYOffset: 0,
  };
}

export function isActive(w: Wrestler): boolean {
  return w.state !== 'eliminated';
}
