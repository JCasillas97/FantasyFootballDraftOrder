import { createRng, type Rng } from './rng';
import {
  buildSchedule,
  createSchedulerState,
  currentVictim,
  currentTarget,
  advanceSchedule,
  winnerOf,
  type SchedulerState,
} from './scheduler';
import { type Wrestler, makeWrestler, isActive } from './wrestler';
import { nearestOther, pickWanderPoint, startingPositions } from './ai';
import { distSq, clampToRing, toNearestRope } from './physics';
import { type GameEvent } from './events';

export const TICK_HZ = 60;
export const TICK_DT = 1 / TICK_HZ;
const STRIKE_RADIUS_SQ = 28 * 28; // close enough to land a punch
const ELIMINATION_TOSS_DURATION = 1.0;
const WANDER_SPEED = 45;
const ENGAGE_SPEED = 70;
const VICTIM_PUSH_SPEED = 110;
const ELIM_VELOCITY = 260;
const ATTACK_DURATION = 0.32;
const ATTACK_HIT_FRAME = 0.15;
const RECOVER_DURATION = 0.22;
const STUN_DURATION = 0.35;
const HIT_IMPULSE = 90;
/** Per-tick probability that a wandering wrestler picks a new opponent. */
const ENGAGE_PROB = 0.012;

export interface MatchState {
  t: number;
  rng: Rng;
  scheduler: SchedulerState;
  wrestlers: Wrestler[];
  finished: boolean;
  /** Indices in elimination order; filled in as the match progresses. */
  eliminationLog: number[];
  /** Events emitted since the last drainEvents() call. */
  pendingEvents: GameEvent[];
}

export interface MatchConfig {
  seed: number;
  rosterSize: number;
}

export function createMatch({ seed, rosterSize }: MatchConfig): MatchState {
  const rng = createRng(seed);
  const schedule = buildSchedule(rosterSize, rng);
  const scheduler = createSchedulerState(schedule);
  const positions = startingPositions(rosterSize);
  const wrestlers = positions.map(({ x, y, facing }, i) => makeWrestler(i, x, y, facing));
  // Seed initial wander targets so the first tick has somewhere to go.
  for (const w of wrestlers) {
    const target = pickWanderPoint(rng);
    w.wanderX = target.x;
    w.wanderY = target.y;
  }
  return {
    t: 0,
    rng,
    scheduler,
    wrestlers,
    finished: false,
    eliminationLog: [],
    pendingEvents: [{ type: 'matchStart', seed }],
  };
}

/**
 * Advance the sim by one fixed-timestep tick. Order of operations matters
 * for determinism — same seed must always produce the same trajectory.
 */
export function tick(s: MatchState): void {
  if (s.finished) return;
  s.t += TICK_DT;

  const victim = currentVictim(s.scheduler);
  const target = currentTarget(s.scheduler);

  // Per-wrestler behavior. We process in id order so determinism is preserved.
  for (const w of s.wrestlers) {
    if (!isActive(w)) continue;

    switch (w.state) {
      case 'wandering':
        wanderStep(w, s, victim, target);
        break;
      case 'engaging':
        engageStep(w, s);
        break;
      case 'beingEliminated':
        eliminateStep(w, s);
        break;
      case 'attacking':
        attackStep(w, s);
        break;
      case 'stunned':
        stunStep(w);
        break;
      case 'recovering':
        recoverStep(w);
        break;
      case 'nearRope':
        // Not entered in current sim; collapse to wandering.
        w.state = 'wandering';
        break;
      case 'eliminated':
        break;
    }
  }

  // Forced elimination trigger: if the scheduler's elimination target has
  // arrived and the victim isn't already being tossed, force the sequence.
  if (victim !== null && target !== null && s.t >= target) {
    const v = s.wrestlers[victim];
    if (isActive(v) && v.state !== 'beingEliminated') {
      forceElimination(s, v);
    }
  }

  // Soft separation: push wrestlers apart so they don't all stack on one pixel.
  separate(s.wrestlers);

  // Integrate position from velocity for any state that uses velocity.
  for (const w of s.wrestlers) {
    if (w.state === 'eliminated') continue;
    w.x += w.vx * TICK_DT;
    w.y += w.vy * TICK_DT;
    if (w.state !== 'beingEliminated') {
      const clamped = clampToRing(w.x, w.y);
      w.x = clamped.x;
      w.y = clamped.y;
    }
  }

  // Check for match end (only winner remains).
  if (!s.finished) {
    const active = s.wrestlers.filter(isActive);
    if (active.length <= 1) {
      const winner = winnerOf(s.scheduler.schedule);
      s.finished = true;
      s.pendingEvents.push({
        type: 'matchEnd',
        winner,
        eliminationOrder: s.scheduler.schedule.eliminationOrder.slice(),
      });
    }
  }
}

function wanderStep(w: Wrestler, s: MatchState, victim: number | null, target: number | null): void {
  // Arrived at wander point? Pick a new one.
  if (distSq(w.x, w.y, w.wanderX, w.wanderY) < 15 * 15) {
    const p = pickWanderPoint(s.rng);
    w.wanderX = p.x;
    w.wanderY = p.y;
  }

  // If this wrestler IS the current victim and the elimination window is
  // approaching, steer toward the nearest rope. The eliminator role is
  // cosmetic: whichever wrestler happens to be near at toss time.
  let steerX = w.wanderX;
  let steerY = w.wanderY;
  let speed = WANDER_SPEED;
  const isVictim = victim !== null && victim === w.id;
  const tilElim = target !== null ? target - s.t : Infinity;
  if (isVictim && tilElim < 5) {
    const dir = toNearestRope(w.x, w.y);
    steerX = w.x + dir.dx * 200;
    steerY = w.y + dir.dy * 200;
    speed = VICTIM_PUSH_SPEED;
  }

  // Non-victims gravitate toward the current victim near the toss window so
  // they're nearby when the elimination triggers (this is what makes the
  // eliminator role land on a believable nearby wrestler, not someone across
  // the ring). This nudge does NOT change WHO is eliminated.
  if (!isVictim && victim !== null && tilElim < 4) {
    const v = s.wrestlers[victim];
    if (isActive(v) && distSq(w.x, w.y, v.x, v.y) < 220 * 220) {
      w.state = 'engaging';
      w.targetId = victim;
      return;
    }
  }

  // Background combat: every so often a wandering wrestler picks a fight
  // with a nearby active opponent. Keeps the ring active even when no
  // elimination is imminent.
  if (s.rng.next() < ENGAGE_PROB) {
    const opponent = nearestOther(w, s.wrestlers);
    if (opponent && distSq(w.x, w.y, opponent.x, opponent.y) < 180 * 180) {
      w.state = 'engaging';
      w.targetId = opponent.id;
      return;
    }
  }

  steerToward(w, steerX, steerY, speed);
}

function engageStep(w: Wrestler, s: MatchState): void {
  if (w.targetId === null) {
    w.state = 'wandering';
    return;
  }
  const t = s.wrestlers[w.targetId];
  if (!isActive(t) || t.state === 'beingEliminated' || t.state === 'eliminated') {
    w.state = 'wandering';
    w.targetId = null;
    return;
  }
  const d2 = distSq(w.x, w.y, t.x, t.y);
  w.facing = t.x < w.x ? -1 : 1;
  if (d2 < STRIKE_RADIUS_SQ) {
    // In strike range — wind up an attack.
    w.state = 'attacking';
    w.stateTimer = ATTACK_DURATION;
    w.animPhase = 0;
    w.vx = 0;
    w.vy = 0;
    return;
  }
  steerToward(w, t.x, t.y, ENGAGE_SPEED);
}

function attackStep(w: Wrestler, s: MatchState): void {
  const wasAbove = w.stateTimer;
  w.stateTimer -= TICK_DT;
  w.animPhase = 1 - w.stateTimer / ATTACK_DURATION;
  // Hit frame: fires once when timer crosses the hit threshold.
  const hitThreshold = ATTACK_DURATION - ATTACK_HIT_FRAME;
  if (wasAbove > hitThreshold && w.stateTimer <= hitThreshold) {
    const t = w.targetId !== null ? s.wrestlers[w.targetId] : null;
    if (t && isActive(t) && t.state !== 'beingEliminated') {
      // Apply impulse to victim (push them away from attacker).
      const dx = t.x - w.x;
      const dy = t.y - w.y;
      const len = Math.hypot(dx, dy) || 1;
      t.vx = (dx / len) * HIT_IMPULSE;
      t.vy = (dy / len) * HIT_IMPULSE;
      t.state = 'stunned';
      t.stateTimer = STUN_DURATION;
      s.pendingEvents.push({ type: 'hit', attacker: w.id, victim: t.id, move: 'punch' });
    }
  }
  if (w.stateTimer <= 0) {
    w.state = 'recovering';
    w.stateTimer = RECOVER_DURATION;
  }
}

function stunStep(w: Wrestler): void {
  w.stateTimer -= TICK_DT;
  // Drift with residual velocity, no AI input. Damping handled by integration.
  w.vx *= 0.94;
  w.vy *= 0.94;
  if (w.stateTimer <= 0) {
    w.state = 'wandering';
  }
}

function recoverStep(w: Wrestler): void {
  w.stateTimer -= TICK_DT;
  w.vx *= 0.85;
  w.vy *= 0.85;
  if (w.stateTimer <= 0) {
    w.state = 'wandering';
    w.targetId = null;
  }
}

function steerToward(w: Wrestler, tx: number, ty: number, speed: number): void {
  const dx = tx - w.x;
  const dy = ty - w.y;
  const len = Math.hypot(dx, dy);
  if (len < 0.001) {
    w.vx = 0;
    w.vy = 0;
    return;
  }
  w.vx = (dx / len) * speed;
  w.vy = (dy / len) * speed;
  w.facing = dx < 0 ? -1 : 1;
}

function forceElimination(s: MatchState, v: Wrestler): void {
  // Identity of the eliminator is cosmetic — pick the nearest active
  // wrestler. If none is near, eliminator is null (rare; first-tick fallback).
  const eliminator = nearestOther(v, s.wrestlers);
  const dir = toNearestRope(v.x, v.y);
  v.state = 'beingEliminated';
  v.stateTimer = ELIMINATION_TOSS_DURATION;
  v.animPhase = 0;
  v.vx = dir.dx * ELIM_VELOCITY;
  v.vy = dir.dy * ELIM_VELOCITY - 60; // slight upward arc
  s.pendingEvents.push({
    type: 'throw',
    attacker: eliminator?.id ?? v.id,
    victim: v.id,
  });
}

function eliminateStep(w: Wrestler, s: MatchState): void {
  w.stateTimer -= TICK_DT;
  w.animPhase = 1 - w.stateTimer / ELIMINATION_TOSS_DURATION;
  // Gravity / drag while tossed.
  w.vy += 180 * TICK_DT;
  if (w.stateTimer <= 0) {
    // Commit elimination.
    const eliminator = nearestOther(w, s.wrestlers);
    const finishingPosition = 12 - s.eliminationLog.length; // first elim = pick 12
    s.eliminationLog.push(w.id);
    advanceSchedule(s.scheduler);
    w.state = 'eliminated';
    w.vx = 0;
    w.vy = 0;
    s.pendingEvents.push({
      type: 'eliminated',
      wrestler: w.id,
      eliminator: eliminator?.id ?? null,
      finishingPosition,
    });
  }
}

function separate(wrestlers: Wrestler[]): void {
  const r = 16;
  const r2 = r * r * 4; // 2r squared
  for (let i = 0; i < wrestlers.length; i++) {
    const a = wrestlers[i];
    if (!isActive(a) || a.state === 'beingEliminated') continue;
    for (let j = i + 1; j < wrestlers.length; j++) {
      const b = wrestlers[j];
      if (!isActive(b) || b.state === 'beingEliminated') continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < r2 && d2 > 0.0001) {
        const d = Math.sqrt(d2);
        const push = ((2 * r - d) / d) * 0.5;
        a.x -= dx * push;
        a.y -= dy * push;
        b.x += dx * push;
        b.y += dy * push;
      }
    }
  }
}

/** Drain accumulated events so subscribers can process them. */
export function drainEvents(s: MatchState): GameEvent[] {
  const out = s.pendingEvents;
  s.pendingEvents = [];
  return out;
}

/**
 * Run the sim headlessly until completion. Used by uniformity tests and by
 * the (optional) "fast-forward to result" debug path.
 */
export function runToCompletion(seed: number, rosterSize: number = 12): MatchState {
  const s = createMatch({ seed, rosterSize });
  const maxTicks = TICK_HZ * 60 * 10; // 10-minute safety bound
  for (let i = 0; i < maxTicks && !s.finished; i++) {
    tick(s);
  }
  return s;
}

