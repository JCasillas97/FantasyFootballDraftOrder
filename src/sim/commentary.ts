import type { GameEvent } from './events';
import type { Player } from '../state/store';

/**
 * Templated play-by-play. The match engine emits semantic events; this turns
 * them into varied human-readable lines. Multiple variants per event type so
 * the log doesn't read like the same sentence repeated.
 */

const TOSS_LINES = [
  '{a} hurls {v} over the top rope!',
  '{a} sends {v} flying out of the ring!',
  '{v} takes a clothesline from hell, courtesy of {a}!',
  "{a} dumps {v} like yesterday's trash!",
  '{v} is OUT. {a} did the honors.',
  'GOODBYE, {v}! Tossed by {a}!',
];

const ELIM_LINES = [
  '{v} hits the floor — pick #{p}.',
  '{v} is eliminated. Slotting in at pick #{p}.',
  '{v} crashes out. That locks pick #{p}.',
  'And {v} is done. Pick #{p} is theirs.',
];

const SOLO_ELIM_LINES = [
  '{v} eliminates themselves somehow?!',
  'No eliminator credited — {v} just went over.',
  '{v} took the dive without help.',
];

const NEAR_ROPE_LINES = [
  '{v} is dangling on the apron!',
  '{v} hangs on by their fingertips!',
  '{v} is in serious trouble at the rope!',
];

const WINNER_LINES = [
  '{w} stands tall! Pick #1 is locked in.',
  "It's all over — {w} wins the rumble and the top pick!",
  '{w} is the LAST ONE STANDING. Number one overall.',
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
    switch (ev.type) {
      case 'throw': {
        const a = roster[ev.attacker]?.name ?? `P${ev.attacker}`;
        const v = roster[ev.victim]?.name ?? `P${ev.victim}`;
        this.push(this.pick(TOSS_LINES).replace('{a}', a).replace('{v}', v));
        break;
      }
      case 'nearRope': {
        const v = roster[ev.wrestler]?.name ?? `P${ev.wrestler}`;
        this.push(this.pick(NEAR_ROPE_LINES).replace('{v}', v));
        break;
      }
      case 'eliminated': {
        const v = roster[ev.wrestler]?.name ?? `P${ev.wrestler}`;
        if (ev.eliminator === null || ev.eliminator === ev.wrestler) {
          this.push(this.pick(SOLO_ELIM_LINES).replace('{v}', v));
        }
        this.push(
          this.pick(ELIM_LINES)
            .replace('{v}', v)
            .replace('{p}', String(ev.finishingPosition)),
        );
        break;
      }
      case 'matchEnd': {
        const w = roster[ev.winner]?.name ?? `P${ev.winner}`;
        this.push(this.pick(WINNER_LINES).replace('{w}', w));
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
    // Mulberry32 step (inlined; we don't import the sim rng to avoid coupling).
    this.rngState = (this.rngState + 0x6d2b79f5) >>> 0;
    let t = this.rngState;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    const u = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    return arr[Math.floor(u * arr.length)];
  }
}
