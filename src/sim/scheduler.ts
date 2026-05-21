import { type Rng, shuffle } from './rng';

/**
 * The scheduler is the source of truth for who gets eliminated in what order.
 * At match start, it uniformly shuffles [0..N-1] to produce the "fate vector".
 * The tick loop reads the current victim from here and nudges AI weights to
 * steer that wrestler toward the ropes. Eliminations themselves are committed
 * back into the scheduler so it can advance.
 *
 * Invariant: no live game logic ever reads RNG to *choose* who is eliminated.
 * Only the shuffle below does. This is what gives us provable 1/12 uniformity.
 */
export interface Schedule {
  /** roster indices in order of elimination; [0] = first out (pick #12), last = winner (pick #1). */
  readonly eliminationOrder: readonly number[];
  /** target timestamps (seconds) for the 11 eliminations. Length = N-1. */
  readonly targets: readonly number[];
  /** total target match duration in seconds (last elim happens just before this). */
  readonly duration: number;
}

export interface SchedulerState {
  readonly schedule: Schedule;
  /** Index into eliminationOrder of the next wrestler to be eliminated. */
  nextIndex: number;
}

export function buildSchedule(rosterSize: number, rng: Rng): Schedule {
  const indices = Array.from({ length: rosterSize }, (_, i) => i);
  const eliminationOrder = shuffle(indices, rng);

  // Scale duration with roster size so each wrestler gets roughly the same
  // screen time regardless of league size. 12 wrestlers → ~150-210s (the
  // original target). 6 → ~75-105s. 20 → ~250-350s.
  const secondsPerWrestler = 12.5 + rng.next() * 5;
  const duration = rosterSize * secondsPerWrestler;
  const targets = pacingCurve(rosterSize - 1, duration);

  return { eliminationOrder, targets, duration };
}

/**
 * Distributes N-1 elimination timestamps across [0, duration] with a
 * front-loaded mid-match flurry, slowdown through the late game, and a
 * dramatic gap before the final 1v1.
 *
 * For 12 wrestlers (11 eliminations) the curve produces roughly:
 *   first elim ~5% in, eliminations 2-7 packed in 10-50%, 8-10 in 55-80%,
 *   final elimination at ~95% of duration.
 */
function pacingCurve(numEliminations: number, duration: number): number[] {
  const n = numEliminations;
  const targets: number[] = [];
  for (let i = 0; i < n; i++) {
    const p = (i + 1) / (n + 1); // i+1 / N, evenly spaced in [0, 1]
    // Ease-out then long tail: pulls early eliminations toward the front,
    // and stretches the final couple toward the end.
    const eased = easeForRumblePacing(p);
    targets.push(eased * duration);
  }
  return targets;
}

function easeForRumblePacing(p: number): number {
  // Composite curve:
  // - middle of match (p ~ 0.3-0.7): squashed denser
  // - last elimination (p near 1.0): pushed toward 0.95+
  // - first elimination (p near 0): mildly delayed (no instant first-elim)
  if (p < 0.5) {
    // ease-out-quad: faster eliminations early/mid
    return 0.05 + 0.45 * (1 - (1 - p * 2) ** 2);
  }
  // tail: slower, ends near 0.95
  const q = (p - 0.5) * 2; // [0, 1]
  return 0.5 + 0.45 * q ** 1.5;
}

export function createSchedulerState(schedule: Schedule): SchedulerState {
  return { schedule, nextIndex: 0 };
}

/** Wrestler index scheduled to go out next, or null if the match is over. */
export function currentVictim(s: SchedulerState): number | null {
  if (s.nextIndex >= s.schedule.eliminationOrder.length - 1) return null;
  return s.schedule.eliminationOrder[s.nextIndex];
}

/** Target timestamp (sec) for the next scheduled elimination. */
export function currentTarget(s: SchedulerState): number | null {
  if (s.nextIndex >= s.schedule.targets.length) return null;
  return s.schedule.targets[s.nextIndex];
}

/** Called when an elimination is committed. Advances to the next victim. */
export function advanceSchedule(s: SchedulerState): void {
  s.nextIndex++;
}

/** Winner index (the final entry in eliminationOrder). */
export function winnerOf(schedule: Schedule): number {
  return schedule.eliminationOrder[schedule.eliminationOrder.length - 1];
}
