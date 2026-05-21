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
import { type Wrestler, type AttackMove, makeWrestler, isActive } from './wrestler';
import { nearestOther, pickWanderPoint, startingPositions } from './ai';
import { distSq, clampToRing, toNearestRope } from './physics';
import { type GameEvent } from './events';

export const TICK_HZ = 60;
export const TICK_DT = 1 / TICK_HZ;
const STRIKE_RADIUS_SQ = 32 * 32; // close enough to land a hit
const ELIMINATION_TOSS_DURATION = 1.0;
const WANDER_SPEED = 50;
const ENGAGE_SPEED = 85;
const ELIM_VELOCITY = 280;
const RECOVER_DURATION = 0.18;
const STUN_DURATION = 0.30;
/** Per-tick probability a wandering wrestler picks a fight with a nearby opponent. */
const ENGAGE_PROB = 0.06;

interface MoveDef {
  duration: number;
  hitFrame: number; // time-into-attack the hit lands
  impulse: number; // knockback magnitude applied to victim on hit
  chargeSpeed: number; // 0 = stand still, >0 = attacker lunges forward during wind-up
}

/**
 * Move catalog. Eliminations and regular combat draw from different pools so
 * eliminations *feel* like a finishing move, not a stiff jab.
 */
const MOVE_DEFS: Record<AttackMove, MoveDef> = {
  punch: { duration: 0.26, hitFrame: 0.14, impulse: 80, chargeSpeed: 0 },
  kick: { duration: 0.52, hitFrame: 0.30, impulse: 130, chargeSpeed: 0 },
  tackle: { duration: 0.58, hitFrame: 0.36, impulse: 170, chargeSpeed: 130 },
  clothesline: { duration: 0.44, hitFrame: 0.26, impulse: 200, chargeSpeed: 90 },
  grapple: { duration: 0.30, hitFrame: 0.18, impulse: 60, chargeSpeed: 0 },
  irishWhip: { duration: 0.34, hitFrame: 0.20, impulse: 220, chargeSpeed: 0 },
  topRope: { duration: 0.85, hitFrame: 0.65, impulse: 280, chargeSpeed: 80 },
  splash: { duration: 0.75, hitFrame: 0.55, impulse: 260, chargeSpeed: 70 },
};

// Punches drop a bit (3 → 2) and the showier moves are weighted up so each
// match reliably shows kicks, tackles, and at least one top-rope dive.
const REGULAR_MOVES: readonly AttackMove[] = [
  'punch',
  'punch',
  'kick',
  'kick',
  'tackle',
  'tackle',
  'clothesline',
  'splash',
];
const FINISHER_MOVES: readonly AttackMove[] = [
  'topRope',
  'splash',
  'clothesline',
  'irishWhip',
];

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

  // Forced elimination trigger: when the scheduler's timestamp arrives,
  // pick a nearby attacker and have them perform a finisher whose hit
  // frame launches the scripted victim out of the ring.
  if (victim !== null && target !== null && s.t >= target) {
    const v = s.wrestlers[victim];
    if (
      isActive(v) &&
      v.state !== 'beingEliminated' &&
      !isFinisherInProgress(s, victim)
    ) {
      triggerFinisher(s, v);
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

function wanderStep(w: Wrestler, s: MatchState, _victim: number | null, _target: number | null): void {
  if (distSq(w.x, w.y, w.wanderX, w.wanderY) < 15 * 15) {
    const p = pickWanderPoint(s.rng);
    w.wanderX = p.x;
    w.wanderY = p.y;
  }

  // Pure independent brawling. Every wrestler picks fights with whoever
  // happens to be nearby — no global "victim" attractor — so the doomed
  // wrestler isn't telegraphed by everyone walking toward them.
  if (s.rng.next() < ENGAGE_PROB) {
    const opponent = nearestOther(w, s.wrestlers);
    if (opponent && distSq(w.x, w.y, opponent.x, opponent.y) < 180 * 180) {
      w.state = 'engaging';
      w.targetId = opponent.id;
      return;
    }
  }

  steerToward(w, w.wanderX, w.wanderY, WANDER_SPEED);
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
    // In strike range — pick a regular move and wind up.
    startAttack(w, s, REGULAR_MOVES[s.rng.nextInt(REGULAR_MOVES.length)], false);
    return;
  }
  steerToward(w, t.x, t.y, ENGAGE_SPEED);
}

function startAttack(w: Wrestler, _s: MatchState, move: AttackMove, isFinisher: boolean): void {
  const def = MOVE_DEFS[move];
  w.state = 'attacking';
  w.attackMove = move;
  w.isFinisher = isFinisher;
  w.stateTimer = def.duration;
  w.animPhase = 0;
  // Charge moves keep some forward velocity; standing moves freeze.
  if (def.chargeSpeed === 0) {
    w.vx = 0;
    w.vy = 0;
  }
}

function attackStep(w: Wrestler, s: MatchState): void {
  const move = w.attackMove ?? 'punch';
  const def = MOVE_DEFS[move];
  const wasAbove = w.stateTimer;
  w.stateTimer -= TICK_DT;
  w.animPhase = 1 - w.stateTimer / def.duration;

  // Charge moves keep the attacker moving toward the target during wind-up.
  if (def.chargeSpeed > 0 && w.targetId !== null) {
    const t = s.wrestlers[w.targetId];
    if (t && isActive(t)) {
      const dx = t.x - w.x;
      const dy = t.y - w.y;
      const len = Math.hypot(dx, dy) || 1;
      w.vx = (dx / len) * def.chargeSpeed;
      w.vy = (dy / len) * def.chargeSpeed;
      w.facing = dx < 0 ? -1 : 1;
    }
  }

  // Hit frame: fires once when timer crosses the threshold.
  const hitThreshold = def.duration - def.hitFrame;
  if (wasAbove > hitThreshold && w.stateTimer <= hitThreshold) {
    const t = w.targetId !== null ? s.wrestlers[w.targetId] : null;
    if (t && isActive(t) && t.state !== 'beingEliminated') {
      const dx = t.x - w.x;
      const dy = t.y - w.y;
      const len = Math.hypot(dx, dy) || 1;
      if (w.isFinisher) {
        // Launch direction: blend attacker→victim direction with nearest-rope
        // bias and a small random angular jitter. The result is a varied,
        // believable angle — straight axes only happen by coincidence.
        const rope = toNearestRope(t.x, t.y);
        const awayLen = Math.hypot(dx, dy) || 1;
        const awayDx = dx / awayLen;
        const awayDy = dy / awayLen;
        let lx = awayDx * 0.7 + rope.dx * 0.6;
        let ly = awayDy * 0.7 + rope.dy * 0.6;
        // ±20° random rotation for extra variety.
        const jitter = (s.rng.next() - 0.5) * (Math.PI / 4.5);
        const cos = Math.cos(jitter);
        const sin = Math.sin(jitter);
        const rotX = lx * cos - ly * sin;
        const rotY = lx * sin + ly * cos;
        const lLen = Math.hypot(rotX, rotY) || 1;
        t.vx = (rotX / lLen) * ELIM_VELOCITY;
        t.vy = (rotY / lLen) * ELIM_VELOCITY - 90; // upward arc on top of the launch
        t.state = 'beingEliminated';
        t.stateTimer = ELIMINATION_TOSS_DURATION;
        t.animPhase = 0;
        s.pendingEvents.push({ type: 'throw', attacker: w.id, victim: t.id });
      } else {
        t.vx = (dx / len) * def.impulse;
        t.vy = (dy / len) * def.impulse;
        t.state = 'stunned';
        t.stateTimer = STUN_DURATION;
        s.pendingEvents.push({ type: 'hit', attacker: w.id, victim: t.id, move });
      }
    }
  }
  if (w.stateTimer <= 0) {
    w.state = 'recovering';
    w.stateTimer = RECOVER_DURATION;
    w.attackMove = null;
    w.isFinisher = false;
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

function triggerFinisher(s: MatchState, v: Wrestler): void {
  // Identity of the eliminator is cosmetic — prefer the nearest active
  // wrestler who is *available* to start a finisher (not currently mid-
  // animation). Fall back to nearest-active. Last resort: direct toss.
  const eliminator = pickEliminator(s, v);
  if (!eliminator) {
    // Nobody nearby — just launch the victim at a varied angle. Rare.
    const rope = toNearestRope(v.x, v.y);
    const jitter = (s.rng.next() - 0.5) * (Math.PI / 3);
    const cos = Math.cos(jitter);
    const sin = Math.sin(jitter);
    const lx = rope.dx * cos - rope.dy * sin;
    const ly = rope.dx * sin + rope.dy * cos;
    v.state = 'beingEliminated';
    v.stateTimer = ELIMINATION_TOSS_DURATION;
    v.animPhase = 0;
    v.vx = lx * ELIM_VELOCITY;
    v.vy = ly * ELIM_VELOCITY - 80;
    s.pendingEvents.push({ type: 'throw', attacker: v.id, victim: v.id });
    return;
  }
  eliminator.targetId = v.id;
  // Pick a flashy finisher. If the victim is already very close to a rope,
  // bias toward clothesline/irishWhip (horizontal); otherwise top-rope.
  const move = FINISHER_MOVES[s.rng.nextInt(FINISHER_MOVES.length)];
  startAttack(eliminator, s, move, true);
}

function isFinisherInProgress(s: MatchState, victimId: number): boolean {
  for (const w of s.wrestlers) {
    if (w.state === 'attacking' && w.isFinisher && w.targetId === victimId) return true;
  }
  return false;
}

function pickEliminator(s: MatchState, victim: Wrestler): Wrestler | null {
  let best: Wrestler | null = null;
  let bestD = Infinity;
  for (const other of s.wrestlers) {
    if (other.id === victim.id || !isActive(other)) continue;
    if (other.state === 'beingEliminated') continue;
    const d = distSq(other.x, other.y, victim.x, victim.y);
    // Prefer wrestlers who can immediately start a move.
    const ready = other.state === 'wandering' || other.state === 'engaging';
    const score = ready ? d : d + 50_000;
    if (score < bestD) {
      bestD = score;
      best = other;
    }
  }
  return best;
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

