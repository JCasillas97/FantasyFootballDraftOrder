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
  clampToFloor,
  toNearestRope,
  ringLeft,
  ringRight,
  ringTop,
  ringBottom,
  PLAYABLE_INSET,
  SPOT_TABLE_X,
  SPOT_TABLE_Y,
  CANVAS_BOUND_W,
  RING,
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
  // Tackle is rare; on hit the attacker mounts and pounds the target.
  tackle: { duration: 0.58, hitFrame: 0.40, impulse: 60, chargeSpeed: 150 },
  // Clothesline is a multi-phase rope-bounce. attackStep overrides motion
  // based on animPhase: run to rope, bounce, return, strike.
  clothesline: { duration: 0.95, hitFrame: 0.78, impulse: 220, chargeSpeed: 0 },
  grapple: { duration: 0.30, hitFrame: 0.18, impulse: 60, chargeSpeed: 0 },
  irishWhip: { duration: 0.34, hitFrame: 0.20, impulse: 220, chargeSpeed: 0 },
  topRope: { duration: 1.05, hitFrame: 0.75, impulse: 280, chargeSpeed: 110 },
  splash: { duration: 0.95, hitFrame: 0.7, impulse: 260, chargeSpeed: 100 },
};

// Combat is striking-heavy. Clothesline dropped to 1/26 (~1/4 of the
// previous rate) because the rope-bounce spot was running too often and
// looked jittery on the canvas. Tackle and splash remain rare.
const REGULAR_MOVES: readonly AttackMove[] = [
  'punch',
  'punch',
  'punch',
  'punch',
  'punch',
  'punch',
  'punch',
  'punch',
  'punch',
  'kick',
  'kick',
  'kick',
  'kick',
  'kick',
  'kick',
  'kick',
  'kick',
  'kick',
  'kick',
  'kick',
  'kick',
  'kick',
  'clothesline',
  'tackle',
  'splash',
  'splash',
];
const MOUNT_DURATION = 1.6;
const MOUNT_PUNCH_INTERVAL = 0.32;

const INTRO_DURATION = 3.4;
/** Surprise wrestler enters when this many wrestlers are still in the ring. */
const SURPRISE_TRIGGER_IN_RING = 2;
const SURPRISE_CATWALK_DURATION = 6.0;
interface SurpriseState {
  wrestlerId: number;
  triggered: boolean;
  /** 'pending' = waiting offstage. 'walking' = on the catwalk. 'arrived' = entered ring. */
  stage: 'pending' | 'walking' | 'arrived';
  stageTimer: number;
  startX: number;
  startY: number;
  ringEntryX: number;
  ringEntryY: number;
}

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
const SPOTLIGHT_WALK_MAX = 2.6;
const SPOTLIGHT_CLIMB_DURATION = 1.1;
const SPOTLIGHT_HANG_DURATION = 1.6;
const SPOTLIGHT_LEAP_DURATION = 1.3;
const SPOTLIGHT_RECOVER_DURATION = 1.9;
const SPOTLIGHT_IMPACT_PAUSE = 1.0;
const SPOTLIGHT_LAUNCH_DURATION = 1.0;

/**
 * Table-break spot — second guaranteed showpiece per match. Actor grabs the
 * target inside the ring, drags them to the spot table outside the ropes,
 * lifts them up, slams them through the table, and the target is eliminated
 * lying on the broken halves. Same trigger pattern as the spotlight: this
 * sequence REPLACES one scheduled elimination.
 */
type TableBreakStage =
  | 'pending'
  | 'approach'
  | 'knockout'
  | 'drag'
  | 'lift'
  | 'slam'
  | 'rest'
  | 'walkToCenter'
  | 'celebrate'
  | 'done';
interface TableBreakState {
  /** Which scheduled elimination this spot replaces. */
  targetElimIdx: number;
  actor: number;
  target: number;
  stage: TableBreakStage;
  stageTimer: number;
  /** True once the slam connects (renderer shows broken table from here). */
  broken: boolean;
  dragStartX: number;
  dragStartY: number;
}
const TABLEBREAK_APPROACH_MAX = 1.6;
const TABLEBREAK_KNOCKOUT_DURATION = 1.4;
const TABLEBREAK_DRAG_DURATION = 1.4;
const TABLEBREAK_LIFT_DURATION = 0.8;
const TABLEBREAK_SLAM_DURATION = 0.45;
const TABLEBREAK_REST_DURATION = 1.4;
const TABLEBREAK_WALK_DURATION = 1.6;
const TABLEBREAK_CELEBRATE_DURATION = 4.0;
const TABLEBREAK_LIFT_HEIGHT = 32;
const TABLEBREAK_DRAG_SPEED = 80;
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
  /** Earlier showstopper: table-break elimination (null = none planned). */
  tableBreak: TableBreakState | null;
  /** Pre-match intro hold ("ARE YOU READY TO RUMBLE!!!"). */
  intro: { stage: 'pending' | 'shouting' | 'done'; stageTimer: number };
  /** Surprise late entrant — comes out on the catwalk mid-match. */
  surprise: SurpriseState | null;
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
  for (const w of wrestlers) {
    const target = pickWanderPoint(rng);
    w.wanderX = target.x;
    w.wanderY = target.y;
  }
  // Pick the surprise late entrant deterministically — must be the LAST
  // wrestler eliminated (the winner) so they're guaranteed alive when they
  // walk out on the catwalk. They start offscreen at the catwalk's far end.
  let surprise: SurpriseState | null = null;
  // Need enough wrestlers and enough match duration to fit a surprise
  // entrance before the table-break finale fires. Below 6 teams the action
  // wraps too fast to make a real entrance.
  if (rosterSize >= 6) {
    const surpriseId = schedule.eliminationOrder[schedule.eliminationOrder.length - 1];
    const w = wrestlers[surpriseId];
    // Park them off-canvas to the right and mark inactive until trigger.
    w.x = -200;
    w.y = -200;
    w.state = 'offstage';
    surprise = {
      wrestlerId: surpriseId,
      triggered: false,
      stage: 'pending',
      stageTimer: 0,
      // Top of the red carpet, directly under the TitanTron — feet at
      // y=120 puts the head at y=56 (just below the TitanTron's bottom
      // edge), so the wrestler is fully visible the moment they appear.
      // Catwalk's wider carpet is centered around x=66 ((rampLeft 8 +
      // rampRight 124) / 2).
      startX: 66,
      startY: 120,
      ringEntryX: ringLeft() + PLAYABLE_INSET + 40,
      ringEntryY: ringTop() + PLAYABLE_INSET + 20,
    };
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
    tableBreak: planTableBreak(schedule.eliminationOrder, rng),
    intro: { stage: 'pending', stageTimer: INTRO_DURATION },
    surprise,
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
  if (eliminationOrder.length < 6) return null;
  const targetElimIdx = Math.floor(eliminationOrder.length / 2);
  // Must leave room for the table-break finale (at N-2) — skip if collision.
  if (targetElimIdx >= eliminationOrder.length - 2) return null;
  // Actor must NOT be the very next scheduled victim (would get eliminated
  // immediately after the splash). Also must NOT be the winner — the winner
  // IS the surprise late entrant and is OFFSTAGE on the catwalk until the
  // final two; making them the spotlight actor mid-match teleports them
  // into the ring, which was the source of the "wrestler appears at the
  // corner of the ring mid-match" glitch.
  const minActorIdx = Math.min(targetElimIdx + 2, eliminationOrder.length - 1);
  const maxActorIdx = eliminationOrder.length - 1; // exclusive — skips the winner
  const actorPool = eliminationOrder.slice(minActorIdx, maxActorIdx);
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
 * Plan the table-break event. It's the FINAL elimination — the winner
 * eliminates the runner-up by slamming them through the announcer table,
 * then celebrates. targetElimIdx = N-2 (second-to-last in eliminationOrder,
 * which determines pick #2). Actor = eliminationOrder[N-1] (the winner).
 */
function planTableBreak(
  eliminationOrder: readonly number[],
  _rng: Rng,
): TableBreakState | null {
  if (eliminationOrder.length < 4) return null; // need at least 4 for a meaningful runner-up
  const targetElimIdx = eliminationOrder.length - 2;
  const actor = eliminationOrder[eliminationOrder.length - 1];
  if (actor === undefined) return null;
  return {
    targetElimIdx,
    actor,
    target: -1,
    stage: 'pending',
    stageTimer: 0,
    broken: false,
    dragStartX: 0,
    dragStartY: 0,
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
  // Pre-match intro hold: just keep sim time at 0 while the "ARE YOU READY
  // TO RUMBLE" screen plays. Drains a wall-clock timer; doesn't advance s.t.
  if (s.intro.stage === 'pending') {
    s.intro.stage = 'shouting';
  }
  if (s.intro.stage === 'shouting') {
    s.intro.stageTimer -= TICK_DT;
    if (s.intro.stageTimer <= 0) s.intro.stage = 'done';
    return;
  }

  // Surprise late entrant choreography: walks out on the catwalk and into
  // the ring. Other wrestlers continue brawling normally (no pause).
  // Trigger when only 2 in-ring wrestlers remain (excluding the surprise
  // wrestler who's still offstage). Late-match entrance for max drama.
  if (s.surprise && !s.surprise.triggered) {
    const sw = s.wrestlers[s.surprise.wrestlerId];
    // Defensive: only run the catwalk entrance if the surprise wrestler is
    // ACTUALLY still offstage. If something else pulled them into the ring
    // (shouldn't happen now that spotlight excludes the winner, but just
    // in case), skip the entrance so we don't teleport them around.
    if (sw.state === 'offstage') {
      let inRingCount = 0;
      for (const w of s.wrestlers) {
        if (w.state === 'eliminated') continue;
        if (w.state === 'offstage' || w.state === 'entering') continue;
        inRingCount++;
      }
      if (inRingCount <= SURPRISE_TRIGGER_IN_RING) {
        s.surprise.triggered = true;
        s.surprise.stage = 'walking';
        s.surprise.stageTimer = SURPRISE_CATWALK_DURATION;
        sw.x = s.surprise.startX;
        sw.y = s.surprise.startY;
        sw.state = 'entering';
        sw.vx = 0;
        sw.vy = 0;
        s.pendingEvents.push({
          type: 'spotlight',
          stage: 'climb',
          actor: s.surprise.wrestlerId,
          target: s.surprise.wrestlerId,
        });
      }
    } else {
      // Wrestler isn't offstage anymore — mark surprise as done so the
      // trigger doesn't keep firing each tick.
      s.surprise.triggered = true;
      s.surprise.stage = 'arrived';
    }
  }
  if (s.surprise && s.surprise.stage === 'walking') {
    s.surprise.stageTimer -= TICK_DT;
    const p = 1 - Math.max(0, s.surprise.stageTimer / SURPRISE_CATWALK_DURATION);
    const w = s.wrestlers[s.surprise.wrestlerId];
    w.x = s.surprise.startX + (s.surprise.ringEntryX - s.surprise.startX) * p;
    w.y = s.surprise.startY + (s.surprise.ringEntryY - s.surprise.startY) * p;
    w.facing = 1;
    if (s.surprise.stageTimer <= 0) {
      s.surprise.stage = 'arrived';
      w.state = 'wandering';
      w.x = s.surprise.ringEntryX;
      w.y = s.surprise.ringEntryY;
      const wp = pickWanderPoint(s.rng);
      w.wanderX = wp.x;
      w.wanderY = wp.y;
    }
  }

  if (s.spotlight && s.spotlight.stage !== 'pending' && s.spotlight.stage !== 'done') {
    spotlightTick(s);
    return;
  }
  if (s.tableBreak && s.tableBreak.stage !== 'pending' && s.tableBreak.stage !== 'done') {
    tableBreakTick(s);
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
      case 'celebrating':
      case 'offstage':
      case 'entering':
        // Driven by external sequences (table-break, surprise entrance).
        break;
      case 'mounting':
        mountStep(w, s);
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
      // Two showpiece slots replace the regular finisher: the table-break
      // (earlier) and the spotlight (midpoint). Both end with the same
      // elimination commit so the schedule progresses normally.
      if (
        s.tableBreak &&
        s.tableBreak.stage === 'pending' &&
        s.scheduler.nextIndex === s.tableBreak.targetElimIdx
      ) {
        // If the actor (the winner) is still mid-catwalk-walk, wait one
        // tick. Otherwise the choreography would teleport them.
        const tbActor = s.wrestlers[s.tableBreak.actor];
        if (tbActor.state === 'entering' || tbActor.state === 'offstage') {
          // skip — try again next tick
        } else {
          s.tableBreak.target = victim;
          beginTableBreak(s);
          return;
        }
      }
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
    // Surprise wrestler on the catwalk is OUTSIDE the ring's playable
    // area — their position is managed by surpriseTick directly. The
    // ring clamp would yank them into the ring corner.
    if (w.state === 'offstage' || w.state === 'entering') continue;
    w.x += w.vx * TICK_DT;
    w.y += w.vy * TICK_DT;
    if (w.state === 'beingEliminated') {
      // Land in the floor band between ring and crowd — never in the seats.
      // The launched velocity carries them past the ropes; the barricade
      // distance away from the ring is the hard stop.
      const clamp = clampToFloor(w.x, w.y);
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

  // Clothesline: run to nearest rope, bounce, charge back at the target.
  if (move === 'clothesline' && w.targetId !== null) {
    const t = s.wrestlers[w.targetId];
    if (t && isActive(t)) {
      if (w.animPhase < 0.4) {
        // Phase 1: run AWAY from target toward nearest rope behind us.
        const awayX = w.x - t.x;
        const awayY = w.y - t.y;
        const awayLen = Math.hypot(awayX, awayY) || 1;
        w.vx = (awayX / awayLen) * 220;
        w.vy = (awayY / awayLen) * 220;
        w.facing = awayX < 0 ? -1 : 1;
      } else if (w.animPhase < 0.5) {
        // Phase 2: bounce off the rope — brief halt before reversing.
        w.vx *= 0.2;
        w.vy *= 0.2;
        w.facing = t.x < w.x ? -1 : 1;
      } else {
        // Phase 3: charge BACK toward target at high speed for the strike.
        const dx = t.x - w.x;
        const dy = t.y - w.y;
        const len = Math.hypot(dx, dy) || 1;
        w.vx = (dx / len) * 240;
        w.vy = (dy / len) * 240;
        w.facing = dx < 0 ? -1 : 1;
      }
    }
  } else if (def.chargeSpeed > 0 && w.targetId !== null) {
    // Standard charge moves (tackle, splash, topRope) move straight toward target.
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
        if (move === 'tackle') {
          // Takedown: target downed for the whole mount + a beat, attacker
          // is going to mount and pound them.
          t.state = 'stunned';
          t.downed = true;
          t.stateTimer = MOUNT_DURATION + 0.6;
          t.vx = 0;
          t.vy = 0;
          s.pendingEvents.push({ type: 'hit', attacker: w.id, victim: t.id, move });
          // Override the normal attacking → recovering transition: the
          // attacker mounts next.
          w.state = 'mounting';
          w.stateTimer = MOUNT_DURATION;
          w.animPhase = 0;
          // Reuse downed flag on attacker as a punch-timer; cleared on exit.
          w.attackMove = null;
          return;
        }
        if (move === 'clothesline') {
          // Clothesline rope-bounce always knocks the target flat.
          t.state = 'stunned';
          t.downed = true;
          t.stateTimer = DOWNED_DURATION;
        } else if (BIG_HITS.has(move)) {
          // Lay them out on the mat. They'll get back up after DOWNED_DURATION.
          t.state = 'stunned';
          t.stateTimer = DOWNED_DURATION;
          t.downed = true;
        } else {
          t.state = 'stunned';
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

/**
 * Post-tackle ground-and-pound. Attacker is mounted on top of the downed
 * target, throws repeated punches. Each punch interval emits a hit event so
 * the SFX/crowd-energy systems can react. After MOUNT_DURATION the attacker
 * exits to recovering.
 */
function mountStep(w: Wrestler, s: MatchState): void {
  w.stateTimer -= TICK_DT;
  if (w.targetId === null) {
    w.state = 'wandering';
    return;
  }
  const t = s.wrestlers[w.targetId];
  if (!t || !isActive(t)) {
    w.state = 'wandering';
    return;
  }
  // Sit on top of the target. Slight offset so the attacker isn't perfectly
  // overlapping (renderer can still show both sprites distinctly).
  w.x = t.x;
  w.y = t.y - 4;
  w.vx = 0;
  w.vy = 0;
  w.facing = 1;
  // Per-punch animation cycle. Each MOUNT_PUNCH_INTERVAL seconds, the
  // animPhase wraps 0 → 1 and fires a hit event at the apex.
  w.mountPunchPhase += TICK_DT / MOUNT_PUNCH_INTERVAL;
  if (w.mountPunchPhase >= 1) {
    w.mountPunchPhase -= 1;
    // Punch lands.
    s.pendingEvents.push({ type: 'hit', attacker: w.id, victim: t.id, move: 'punch' });
    t.stateTimer = Math.max(t.stateTimer, MOUNT_PUNCH_INTERVAL * 1.5);
  }
  w.animPhase = w.mountPunchPhase;
  if (w.stateTimer <= 0) {
    w.state = 'recovering';
    w.stateTimer = RECOVER_DURATION;
    w.mountPunchPhase = 0;
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
    // Skip offstage / entering — they're on the catwalk, not the mat.
    if (a.state === 'offstage' || a.state === 'entering') continue;
    for (let j = i + 1; j < wrestlers.length; j++) {
      const b = wrestlers[j];
      if (!isActive(b) || b.state === 'beingEliminated') continue;
      if (b.state === 'offstage' || b.state === 'entering') continue;
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
    // CRITICAL: don't touch wrestlers who are offstage or mid-catwalk-walk.
    // Resetting them to 'wandering' was leaving the surprise wrestler stuck
    // at (-200, -200) invisible for the rest of the match — and breaking
    // the catwalk trigger (which checks for 'offstage').
    if (w.state === 'offstage' || w.state === 'entering') continue;
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
        // IMPACT: actor lands next to (not on top of) the victim so the
        // audience clearly sees the body that's getting eliminated.
        const stepDir = target.x < CANVAS_BOUND_W / 2 ? 1 : -1;
        actor.x = target.x + stepDir * 18;
        actor.y = target.y - 2;
        actor.facing = -stepDir as -1 | 1;
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
      // commit the elimination in place — the body stays on the mat where
      // they got slammed, no flying through the air.
      if (sp.stageTimer <= 0) {
        const eliminator = nearestOther(target, s.wrestlers);
        const finishingPosition = s.wrestlers.length - s.eliminationLog.length;
        s.eliminationLog.push(target.id);
        advanceSchedule(s.scheduler);
        target.state = 'eliminated';
        target.downed = false;
        target.vx = 0;
        target.vy = 0;
        s.pendingEvents.push({
          type: 'eliminated',
          wrestler: target.id,
          eliminator: eliminator?.id ?? sp.actor,
          finishingPosition,
        });
        sp.stage = 'launch';
        sp.stageTimer = SPOTLIGHT_LAUNCH_DURATION;
      }
      break;
    }
    case 'launch': {
      // "Rest" stage — body lies dead on the mat at the slam position while
      // the actor finishes recovering. Just runs out the clock.
      if (sp.stageTimer <= 0) {
        sp.stage = 'done';
      }
      break;
    }
    default:
      break;
  }
}

// ---------------- Table-break choreography ----------------

function beginTableBreak(s: MatchState): void {
  const tb = s.tableBreak!;
  const actor = s.wrestlers[tb.actor];
  const target = s.wrestlers[tb.target];
  tb.stage = 'approach';
  tb.stageTimer = TABLEBREAK_APPROACH_MAX;

  // Freeze every non-participant so the spot reads as a moment.
  for (const w of s.wrestlers) {
    if (w.id === tb.actor || w.id === tb.target) continue;
    if (!isActive(w)) continue;
    if (w.state === 'beingEliminated') continue;
    // Don't reset offstage / entering wrestlers — same bug as beginSpotlight.
    if (w.state === 'offstage' || w.state === 'entering') continue;
    w.vx = 0;
    w.vy = 0;
    w.state = 'wandering';
    w.targetId = null;
    w.attackMove = null;
    w.isFinisher = false;
    w.downed = false;
    w.stateTimer = 0;
  }
  target.state = 'wandering';
  target.vx = 0;
  target.vy = 0;
  target.targetId = null;
  actor.state = 'wandering';
  actor.targetId = null;
  actor.attackMove = null;
  s.pendingEvents.push({
    type: 'spotlight',
    stage: 'climb',
    actor: tb.actor,
    target: tb.target,
  });
}

function tableBreakTick(s: MatchState): void {
  const tb = s.tableBreak!;
  const actor = s.wrestlers[tb.actor];
  const target = s.wrestlers[tb.target];
  tb.stageTimer -= TICK_DT;

  switch (tb.stage) {
    case 'approach': {
      // Actor walks to the target, then they pair up.
      const dx = target.x - actor.x;
      const dy = target.y - actor.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 24 || tb.stageTimer <= 0) {
        // Knock the victim DOWN flat first — they stay on the mat for a
        // beat so the audience clearly sees the KO before any carry/lift.
        target.state = 'stunned';
        target.downed = true;
        target.stateTimer = 20; // held until the slam commits
        target.vx = 0;
        target.vy = 0;
        actor.facing = dx < 0 ? -1 : 1;
        s.pendingEvents.push({
          type: 'hit',
          attacker: tb.actor,
          victim: tb.target,
          move: 'punch',
        });
        s.pendingEvents.push({
          type: 'spotlight',
          stage: 'leap',
          actor: tb.actor,
          target: tb.target,
        });
        tb.stage = 'knockout';
        tb.stageTimer = TABLEBREAK_KNOCKOUT_DURATION;
        tb.dragStartX = (actor.x + target.x) / 2;
        tb.dragStartY = (actor.y + target.y) / 2;
      } else {
        actor.vx = (dx / dist) * TABLEBREAK_DRAG_SPEED;
        actor.vy = (dy / dist) * TABLEBREAK_DRAG_SPEED;
        actor.x += actor.vx * TICK_DT;
        actor.y += actor.vy * TICK_DT;
        actor.facing = dx < 0 ? -1 : 1;
      }
      break;
    }
    case 'knockout': {
      // Hold the target visibly flat on the mat. Actor stands over them
      // (no movement). The audience registers the KO before the carry.
      // Drift damping in case target had any residual velocity.
      target.vx = 0;
      target.vy = 0;
      actor.vx = 0;
      actor.vy = 0;
      if (tb.stageTimer <= 0) {
        tb.stage = 'drag';
        tb.stageTimer = TABLEBREAK_DRAG_DURATION;
      }
      break;
    }
    case 'drag': {
      // Slide them together to the LAUNCH spot — south side of the ring,
      // still inside the ropes. Actor will throw the target from here and
      // stay planted.
      const launchX = RING.cx;
      const launchY = RING.cy + RING.halfH - PLAYABLE_INSET - 6;
      const p = 1 - Math.max(0, tb.stageTimer / TABLEBREAK_DRAG_DURATION);
      const ax = tb.dragStartX + (launchX - tb.dragStartX) * p;
      const ay = tb.dragStartY + (launchY - tb.dragStartY) * p;
      target.x = ax;
      target.y = ay;
      actor.x = ax - 4;
      actor.y = ay - 2;
      actor.facing = 1;
      if (tb.stageTimer <= 0) {
        target.x = launchX;
        target.y = launchY;
        actor.x = launchX - 4;
        actor.y = launchY - 2;
        tb.stage = 'lift';
        tb.stageTimer = TABLEBREAK_LIFT_DURATION;
      }
      break;
    }
    case 'lift': {
      // Actor lifts the target overhead — both still inside the ring.
      const p = 1 - Math.max(0, tb.stageTimer / TABLEBREAK_LIFT_DURATION);
      target.renderYOffset = TABLEBREAK_LIFT_HEIGHT * p;
      if (tb.stageTimer <= 0) {
        // Snapshot launch position; the slam stage flies the target out.
        tb.dragStartX = target.x;
        tb.dragStartY = target.y;
        tb.stage = 'slam';
        tb.stageTimer = TABLEBREAK_SLAM_DURATION;
      }
      break;
    }
    case 'slam': {
      // Target flies in an arc OVER the south rope and lands on the
      // announce table. Actor stays inside the ring.
      const p = 1 - Math.max(0, tb.stageTimer / TABLEBREAK_SLAM_DURATION);
      target.x = tb.dragStartX + (SPOT_TABLE_X - tb.dragStartX) * p;
      target.y = tb.dragStartY + (SPOT_TABLE_Y - tb.dragStartY) * p;
      const arc = Math.sin(p * Math.PI) * 28;
      target.renderYOffset = TABLEBREAK_LIFT_HEIGHT * (1 - p) + arc;
      if (tb.stageTimer <= 0) {
        target.renderYOffset = 0;
        target.x = SPOT_TABLE_X;
        target.y = SPOT_TABLE_Y + 8;
        tb.broken = true;
        // Commit elimination in place — body stays on the broken table.
        const finishingPosition = s.wrestlers.length - s.eliminationLog.length;
        s.eliminationLog.push(target.id);
        advanceSchedule(s.scheduler);
        target.state = 'eliminated';
        target.downed = false;
        target.vx = 0;
        target.vy = 0;
        s.pendingEvents.push({
          type: 'eliminated',
          wrestler: target.id,
          eliminator: tb.actor,
          finishingPosition,
        });
        s.pendingEvents.push({
          type: 'spotlight',
          stage: 'impact',
          actor: tb.actor,
          target: tb.target,
        });
        s.pendingEvents.push({
          type: 'hit',
          attacker: tb.actor,
          victim: tb.target,
          move: 'topRope',
        });
        tb.stage = 'rest';
        tb.stageTimer = TABLEBREAK_REST_DURATION;
      }
      break;
    }
    case 'rest': {
      // Body lies on the wreckage; actor catches their breath, then heads
      // back into the ring to celebrate.
      if (tb.stageTimer <= 0) {
        tb.stage = 'walkToCenter';
        tb.stageTimer = TABLEBREAK_WALK_DURATION;
      }
      break;
    }
    case 'walkToCenter': {
      // Actor (the winner) walks from the south-ropes launch spot to the
      // center of the ring for the victory pose. Stays inside the ring.
      const p = 1 - Math.max(0, tb.stageTimer / TABLEBREAK_WALK_DURATION);
      const startX = RING.cx - 4;
      const startY = RING.cy + RING.halfH - PLAYABLE_INSET - 6;
      actor.x = startX + (RING.cx - startX) * p;
      actor.y = startY + (RING.cy - startY) * p;
      actor.facing = RING.cx < actor.x ? -1 : 1;
      if (tb.stageTimer <= 0) {
        actor.x = RING.cx;
        actor.y = RING.cy;
        actor.state = 'celebrating';
        actor.stateTimer = TABLEBREAK_CELEBRATE_DURATION;
        tb.stage = 'celebrate';
        tb.stageTimer = TABLEBREAK_CELEBRATE_DURATION;
      }
      break;
    }
    case 'celebrate': {
      // Winner stands in the center with arms raised. Crowd erupts.
      actor.x = RING.cx;
      actor.y = RING.cy;
      actor.state = 'celebrating';
      actor.stateTimer = tb.stageTimer;
      if (tb.stageTimer <= 0) tb.stage = 'done';
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

