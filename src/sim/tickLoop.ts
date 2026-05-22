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
import {
  distSq,
  clampToRing,
  clampToCanvas,
  toNearestRope,
  ringLeft,
  ringRight,
  ringTop,
  ringBottom,
  PLAYABLE_INSET,
} from './physics';
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
  topRope: { duration: 1.05, hitFrame: 0.75, impulse: 280, chargeSpeed: 110 },
  splash: { duration: 0.95, hitFrame: 0.7, impulse: 260, chargeSpeed: 100 },
};

// Tackle dropped from the regular pool entirely — its forward charge was
// making the action feel hectic. It stays available as a finisher move.
// Splash kept at 2/10 so the in-match top-rope dive still shows up.
const REGULAR_MOVES: readonly AttackMove[] = [
  'punch',
  'punch',
  'punch',
  'punch',
  'kick',
  'kick',
  'kick',
  'clothesline',
  'splash',
  'splash',
];

/** Moves that lay the victim flat instead of a quick stun. */
const BIG_HITS: ReadonlySet<AttackMove> = new Set(['tackle', 'splash', 'topRope', 'clothesline']);
const DOWNED_DURATION = 1.4;
const SPOTLIGHT_DOWNED_DURATION = 3.0;

/**
 * The Spotlight is a guaranteed mid-match showstopper. Time pauses, every
 * other wrestler stops moving, one wrestler walks to the nearest turnbuckle,
 * climbs up, hangs there, leaps across the ring, and crashes onto a
 * pre-chosen victim. Sequence stages drive both physics and commentary.
 */
type SpotlightStage =
  | 'pending'
  | 'walk'
  | 'climb'
  | 'hang'
  | 'leap'
  | 'impact'
  | 'launch'
  | 'done';
interface SpotlightState {
  /** Which scheduled elimination this spotlight replaces. */
  targetElimIdx: number;
  /** Picked at match start; the wrestler performing the dive. */
  actor: number;
  /** Set to currentVictim when the spotlight actually begins. */
  target: number;
  stage: SpotlightStage;
  stageTimer: number;
  cornerX: number;
  cornerY: number;
  leapStartX: number;
  leapStartY: number;
}
const SPOTLIGHT_WALK_MAX = 2.0;
const SPOTLIGHT_CLIMB_DURATION = 0.7;
const SPOTLIGHT_HANG_DURATION = 0.9;
const SPOTLIGHT_LEAP_DURATION = 1.0;
const SPOTLIGHT_RECOVER_DURATION = 1.6;
const SPOTLIGHT_IMPACT_PAUSE = 0.7;
const SPOTLIGHT_LAUNCH_DURATION = 1.4;
const SPOTLIGHT_CLIMB_HEIGHT = 56;
const SPOTLIGHT_WALK_SPEED = 110;
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
  /** Mid-match showstopper sequence (null = none planned). */
  spotlight: SpotlightState | null;
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
    spotlight: planSpotlight(schedule.eliminationOrder, rng),
  };
}

/**
 * Pick spotlight participants deterministically. The spotlight *replaces* a
 * specific scheduled elimination (the midpoint one), so its target is always
 * whoever is currentVictim at the moment it fires — guaranteed to match the
 * scheduler. The actor is pre-picked from wrestlers who survive past that
 * point (so they're always alive at spotlight time).
 */
function planSpotlight(
  eliminationOrder: readonly number[],
  rng: Rng,
): SpotlightState | null {
  if (eliminationOrder.length < 4) return null;
  const targetElimIdx = Math.floor(eliminationOrder.length / 2);
  if (targetElimIdx >= eliminationOrder.length - 1) return null;
  // Actor: any wrestler eliminated LATER (or the winner).
  const actorPool = eliminationOrder.slice(targetElimIdx + 1);
  if (actorPool.length === 0) return null;
  const actor = actorPool[rng.nextInt(actorPool.length)];
  return {
    targetElimIdx,
    actor,
    target: -1,
    stage: 'pending',
    stageTimer: 0,
    cornerX: 0,
    cornerY: 0,
    leapStartX: 0,
    leapStartY: 0,
  };
}

/**
 * Advance the sim by one fixed-timestep tick. Order of operations matters
 * for determinism — same seed must always produce the same trajectory.
 */
export function tick(s: MatchState): void {
  if (s.finished) return;
  // Spotlight handling: if an active sequence is in progress, time is paused
  // and the choreography drives the actor/target. Other wrestlers stand still.
  if (s.spotlight && s.spotlight.stage !== 'pending' && s.spotlight.stage !== 'done') {
    spotlightTick(s);
    return;
  }

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
      // If this scheduled elimination is the spotlight slot, run the showpiece
      // sequence instead of the regular finisher. The spotlight ends with the
      // same elimination commit, so the schedule progresses normally.
      if (
        s.spotlight &&
        s.spotlight.stage === 'pending' &&
        s.scheduler.nextIndex === s.spotlight.targetElimIdx
      ) {
        s.spotlight.target = victim;
        beginSpotlight(s);
        return;
      }
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
    if (w.state === 'beingEliminated') {
      // Keep launched wrestlers on-canvas so the faded body stays visible.
      // They can leave the ring (cross the ropes) but not leave the screen.
      const clamp = clampToCanvas(w.x, w.y);
      if (w.x !== clamp.x) w.vx = 0;
      if (w.y !== clamp.y) w.vy = 0;
      w.x = clamp.x;
      w.y = clamp.y;
    } else {
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
        if (BIG_HITS.has(move)) {
          // Lay them out on the mat. They'll get back up after DOWNED_DURATION.
          t.stateTimer = DOWNED_DURATION;
          t.downed = true;
        } else {
          t.stateTimer = STUN_DURATION;
          t.downed = false;
        }
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
  if (w.downed) {
    // Laid flat — stop sliding so they don't drift across the ring.
    w.vx *= 0.7;
    w.vy *= 0.7;
  } else {
    w.vx *= 0.94;
    w.vy *= 0.94;
  }
  if (w.stateTimer <= 0) {
    w.state = 'wandering';
    w.downed = false;
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
    const finishingPosition = s.wrestlers.length - s.eliminationLog.length;
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

// ---------------- Spotlight choreography ----------------

function beginSpotlight(s: MatchState): void {
  const sp = s.spotlight!;
  const actor = s.wrestlers[sp.actor];
  // Pick the nearest turnbuckle (interior corner).
  const corners: Array<{ x: number; y: number }> = [
    { x: ringLeft() + PLAYABLE_INSET, y: ringTop() + PLAYABLE_INSET },
    { x: ringRight() - PLAYABLE_INSET, y: ringTop() + PLAYABLE_INSET },
    { x: ringLeft() + PLAYABLE_INSET, y: ringBottom() - PLAYABLE_INSET },
    { x: ringRight() - PLAYABLE_INSET, y: ringBottom() - PLAYABLE_INSET },
  ];
  let best = corners[0];
  let bestD = Infinity;
  for (const c of corners) {
    const d = distSq(actor.x, actor.y, c.x, c.y);
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  sp.cornerX = best.x;
  sp.cornerY = best.y;
  sp.stage = 'walk';
  sp.stageTimer = SPOTLIGHT_WALK_MAX;

  // Reset everyone else's velocity and clear any timed combat states so the
  // ring is visually still while the spotlight runs.
  for (const w of s.wrestlers) {
    if (w.id === sp.actor || w.id === sp.target) continue;
    if (!isActive(w)) continue;
    if (w.state === 'beingEliminated') continue;
    w.vx = 0;
    w.vy = 0;
    w.state = 'wandering';
    w.targetId = null;
    w.attackMove = null;
    w.isFinisher = false;
    w.downed = false;
    w.stateTimer = 0;
  }
  // Target also stands still and faces the actor.
  const target = s.wrestlers[sp.target];
  target.state = 'wandering';
  target.vx = 0;
  target.vy = 0;
  target.facing = actor.x > target.x ? 1 : -1;
  // Actor starts walking toward the corner.
  actor.state = 'wandering';
  actor.targetId = null;
  actor.attackMove = null;
}

function spotlightTick(s: MatchState): void {
  const sp = s.spotlight!;
  const actor = s.wrestlers[sp.actor];
  const target = s.wrestlers[sp.target];
  sp.stageTimer -= TICK_DT;

  switch (sp.stage) {
    case 'walk': {
      const dx = sp.cornerX - actor.x;
      const dy = sp.cornerY - actor.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 6 || sp.stageTimer <= 0) {
        actor.x = sp.cornerX;
        actor.y = sp.cornerY;
        actor.vx = 0;
        actor.vy = 0;
        sp.stage = 'climb';
        sp.stageTimer = SPOTLIGHT_CLIMB_DURATION;
        s.pendingEvents.push({ type: 'spotlight', stage: 'climb', actor: sp.actor, target: sp.target });
      } else {
        actor.vx = (dx / dist) * SPOTLIGHT_WALK_SPEED;
        actor.vy = (dy / dist) * SPOTLIGHT_WALK_SPEED;
        actor.x += actor.vx * TICK_DT;
        actor.y += actor.vy * TICK_DT;
        actor.facing = dx < 0 ? -1 : 1;
      }
      break;
    }
    case 'climb': {
      const p = 1 - Math.max(0, sp.stageTimer / SPOTLIGHT_CLIMB_DURATION);
      actor.renderYOffset = SPOTLIGHT_CLIMB_HEIGHT * p;
      // Face the target while climbing.
      actor.facing = target.x < actor.x ? -1 : 1;
      if (sp.stageTimer <= 0) {
        actor.renderYOffset = SPOTLIGHT_CLIMB_HEIGHT;
        sp.stage = 'hang';
        sp.stageTimer = SPOTLIGHT_HANG_DURATION;
      }
      break;
    }
    case 'hang': {
      actor.renderYOffset = SPOTLIGHT_CLIMB_HEIGHT;
      if (sp.stageTimer <= 0) {
        sp.leapStartX = actor.x;
        sp.leapStartY = actor.y;
        sp.stage = 'leap';
        sp.stageTimer = SPOTLIGHT_LEAP_DURATION;
        // Actor now flies — show top-rope attack pose.
        actor.state = 'attacking';
        actor.attackMove = 'topRope';
        actor.isFinisher = false;
        actor.animPhase = 0;
        s.pendingEvents.push({ type: 'spotlight', stage: 'leap', actor: sp.actor, target: sp.target });
      }
      break;
    }
    case 'leap': {
      const phase = 1 - Math.max(0, sp.stageTimer / SPOTLIGHT_LEAP_DURATION);
      actor.animPhase = phase;
      // Interpolate horizontal toward target.
      actor.x = sp.leapStartX + (target.x - sp.leapStartX) * phase;
      actor.y = sp.leapStartY + (target.y - sp.leapStartY) * phase;
      // Render Y offset: start high (on turnbuckle), arc up briefly, then
      // come crashing down to 0 at impact.
      const arc = Math.sin(phase * Math.PI) * 40;
      actor.renderYOffset = SPOTLIGHT_CLIMB_HEIGHT * (1 - phase) + arc;
      actor.facing = target.x < sp.leapStartX ? -1 : 1;
      if (sp.stageTimer <= 0) {
        // IMPACT: actor lands on the victim. Victim laid flat momentarily so
        // the audience sees the splash registered before the launch.
        actor.x = target.x;
        actor.y = target.y;
        actor.renderYOffset = 0;
        actor.state = 'recovering';
        actor.stateTimer = SPOTLIGHT_RECOVER_DURATION;
        actor.attackMove = null;
        actor.animPhase = 0;
        target.state = 'stunned';
        target.downed = true;
        target.stateTimer = SPOTLIGHT_DOWNED_DURATION;
        target.vx = 0;
        target.vy = 0;
        s.pendingEvents.push({ type: 'spotlight', stage: 'impact', actor: sp.actor, target: sp.target });
        s.pendingEvents.push({ type: 'hit', attacker: sp.actor, victim: sp.target, move: 'topRope' });
        sp.stage = 'impact';
        sp.stageTimer = SPOTLIGHT_IMPACT_PAUSE;
      }
      break;
    }
    case 'impact': {
      // Hold the "victim laid out next to the attacker" pose briefly, then
      // launch the victim out of the ring as the elimination.
      if (sp.stageTimer <= 0) {
        const rope = toNearestRope(target.x, target.y);
        const jitter = (s.rng.next() - 0.5) * (Math.PI / 4);
        const cos = Math.cos(jitter);
        const sin = Math.sin(jitter);
        const lx = rope.dx * cos - rope.dy * sin;
        const ly = rope.dx * sin + rope.dy * cos;
        target.state = 'beingEliminated';
        target.stateTimer = ELIMINATION_TOSS_DURATION;
        target.animPhase = 0;
        target.downed = false;
        target.vx = lx * ELIM_VELOCITY;
        target.vy = ly * ELIM_VELOCITY - 100;
        s.pendingEvents.push({ type: 'throw', attacker: sp.actor, victim: sp.target });
        sp.stage = 'launch';
        sp.stageTimer = SPOTLIGHT_LAUNCH_DURATION;
      }
      break;
    }
    case 'launch': {
      // Drive the target's elimination toss while sim time is still paused
      // so the launch is visible during the spotlight (not after).
      if (target.state === 'beingEliminated') {
        eliminateStep(target, s);
        target.x += target.vx * TICK_DT;
        target.y += target.vy * TICK_DT;
        const clamp = clampToCanvas(target.x, target.y);
        if (target.x !== clamp.x) target.vx = 0;
        if (target.y !== clamp.y) target.vy = 0;
        target.x = clamp.x;
        target.y = clamp.y;
      }
      if (sp.stageTimer <= 0 || target.state === 'eliminated') {
        sp.stage = 'done';
      }
      break;
    }
    default:
      break;
  }
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

