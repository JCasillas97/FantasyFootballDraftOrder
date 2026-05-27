import type { GameEvent } from './events';
import { displayName, type Player } from '../state/store';

/**
 * Templated play-by-play. The match engine emits semantic events; this turns
 * them into varied human-readable lines. Commentary is intentionally sparse —
 * only eliminations, the showpiece moments (top-rope splash, table-break),
 * the surprise entrance, and the matchEnd announcement. hit / throw /
 * nearRope events are silent so the log stays readable.
 */

const ELIM_LINES = [
  '{v} hits the floor — pick #{p}.',
  '{v} is eliminated. Slotting in at pick #{p}.',
  '{v} crashes out. That locks pick #{p}.',
  'And {v} is done. Pick #{p} is theirs.',
];

const WINNER_LINES = [
  '{w} stands tall! Pick #1 is locked in.',
  "It's all over — {w} wins the rumble and the top pick!",
  '{w} is the LAST ONE STANDING. Number one overall.',
];

const SURPRISE_ENTRY_LINES = [
  "WAIT! That music — IT'S {a}! THE CROWD HAS LOST IT!",
  "HERE COMES {a}! THIS CHANGES EVERYTHING!",
  "OH MY GOD — {a} IS THE SURPRISE ENTRANT!",
  "{a} IS WALKING DOWN THE RAMP! THE LATE ENTRY IS HERE!",
];

const SPOTLIGHT_CLIMB_LINES = [
  '{a} is going UP TOP!',
  'Wait — {a} is climbing the turnbuckle!',
  "{a}'s heading to the top rope! THE CROWD IS ON THEIR FEET!",
  "{a} just hauled {v} out of the ring — table spot incoming?!",
];
const SPOTLIGHT_LEAP_LINES = [
  'OH MY GOD, {a} IS FLYING!',
  '{a} LEAPS OFF THE TOP!',
  "{a} TAKES TO THE SKY!",
  "{a} is dragging {v} toward the announce table!",
];
const SPOTLIGHT_IMPACT_LINES = [
  'DEVASTATING! {a} CRUSHES {v} FROM THE TOP ROPE!',
  '{a} BURIES {v} INTO THE MAT!',
  'THE WHOLE RING SHAKES! {a} just folded {v} in half!',
  'GOOD GOD! {v} is OUT COLD after that splash from {a}!',
  'TABLE BROKEN IN HALF! {v} is DONE thanks to {a}!',
  'SPLINTERS EVERYWHERE! {a} just put {v} THROUGH the table!',
];

export class CommentaryStream {
  private lines: string[] = [];
  private rngState: number;

  constructor(seed: number) {
    this.rngState = seed >>> 0;
  }

  /** Drainable accumulated lines, newest last. */
  get all(): readonly string[] {
    return this.lines;
  }

  ingest(ev: GameEvent, roster: readonly Player[]): void {
    const nameOf = (i: number) => (roster[i] ? displayName(roster[i]) : `Player ${i + 1}`);
    switch (ev.type) {
      // hit / throw / nearRope intentionally silent — too noisy. Commentary
      // only fires on eliminations, the major showpiece events, and matchEnd.
      case 'eliminated': {
        const v = nameOf(ev.wrestler);
        this.push(
          this.pick(ELIM_LINES).replace('{v}', v).replace('{p}', String(ev.finishingPosition)),
        );
        break;
      }
      case 'spotlight': {
        const a = nameOf(ev.actor);
        const v = nameOf(ev.target);
        // actor === target means the surprise-entry signal (one wrestler,
        // catwalk walk). Only the 'climb' stage fires a line so we get one
        // entrance announcement, not three.
        if (ev.actor === ev.target) {
          if (ev.stage === 'climb') {
            this.push(this.pick(SURPRISE_ENTRY_LINES).replace('{a}', a));
          }
          break;
        }
        let lines: readonly string[];
        if (ev.stage === 'climb') lines = SPOTLIGHT_CLIMB_LINES;
        else if (ev.stage === 'leap') lines = SPOTLIGHT_LEAP_LINES;
        else lines = SPOTLIGHT_IMPACT_LINES;
        this.push(this.pick(lines).replace('{a}', a).replace('{v}', v));
        break;
      }
      case 'matchEnd': {
        this.push(this.pick(WINNER_LINES).replace('{w}', nameOf(ev.winner)));
        break;
      }
      default:
        break;
    }
  }

  private push(line: string): void {
    this.lines.push(line);
  }

  private pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.nextRoll() * arr.length)];
  }

  /** Mulberry32 step (inlined; we don't import sim rng to avoid coupling). */
  private nextRoll(): number {
    this.rngState = (this.rngState + 0x6d2b79f5) >>> 0;
    let t = this.rngState;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
}
