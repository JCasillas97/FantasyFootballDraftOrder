/**
 * Wrestler state + state machine. For Phase 1 the visual behavior is simple
 * (wander, engage, get tossed). The full attack/stun/recover sub-states are
 * filled in during Phase 3 when sprite animations need timing hooks.
 *
 * The hard invariant: state transitions never *decide* an elimination. The
 * scheduler picks the victim ahead of time; the state machine only performs
 * the elimination when the scheduler points at this wrestler.
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
  };
}

export function isActive(w: Wrestler): boolean {
  return w.state !== 'eliminated';
}
