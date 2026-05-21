import type { GameEvent } from './events';
import type { AttackMove } from './wrestler';
import { displayName, type Player } from '../state/store';

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

const SPOTLIGHT_CLIMB_LINES = [
  '{a} is going UP TOP!',
  'Wait — {a} is climbing the turnbuckle!',
  "{a}'s heading to the top rope! THE CROWD IS ON THEIR FEET!",
];
const SPOTLIGHT_LEAP_LINES = [
  'OH MY GOD, {a} IS FLYING!',
  '{a} LEAPS OFF THE TOP!',
  "{a} TAKES TO THE SKY!",
];
const SPOTLIGHT_IMPACT_LINES = [
  'DEVASTATING! {a} CRUSHES {v} FROM THE TOP ROPE!',
  '{a} BURIES {v} INTO THE MAT!',
  'THE WHOLE RING SHAKES! {a} just folded {v} in half!',
  'GOOD GOD! {v} is OUT COLD after that splash from {a}!',
];

// Move-specific hit flavor. Only a fraction of hits log a line (most stay
// silent) so the log doesn't become a wall of text in a 45-second match.
const HIT_LINES: Record<AttackMove, string[]> = {
  punch: [
    '{a} CRACKS {v} in the jaw!',
    '{a} fires off a stiff jab on {v}.',
    '{a} buries a fist into {v}.',
  ],
  kick: [
    '{a} boots {v} square in the chest!',
    '{a} lands a roundhouse on {v}!',
    '{a} drives a knee into {v}.',
  ],
  tackle: [
    '{a} SPEARS {v}!',
    '{a} levels {v} with a flying tackle!',
    '{a} runs through {v} like a freight train.',
  ],
  clothesline: [
    '{a} nearly takes {v}’s head off with a clothesline!',
    '{a} catches {v} with a brutal clothesline!',
  ],
  grapple: ['{a} locks up with {v}.', '{a} muscles {v} into a hold.'],
  irishWhip: [
    '{a} sends {v} flying into the ropes!',
    '{a} whips {v} across the ring!',
  ],
  topRope: [
    '{a} flies off the top rope and CRUSHES {v}!',
    'TOP ROPE! {a} comes down on {v}!',
    '{a} hits a high-flying splash on {v}!',
  ],
  splash: [
    '{a} crashes onto {v} with a splash!',
    '{a} drops the bomb on {v}!',
  ],
};

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
      case 'hit': {
        // Only ~25% of hits make the log, so it doesn't fill up too fast.
        if (this.nextRoll() < 0.25) {
          const lines = HIT_LINES[ev.move] ?? HIT_LINES.punch;
          this.push(
            this.pick(lines).replace('{a}', nameOf(ev.attacker)).replace('{v}', nameOf(ev.victim)),
          );
        }
        break;
      }
      case 'throw': {
        this.push(
          this.pick(TOSS_LINES).replace('{a}', nameOf(ev.attacker)).replace('{v}', nameOf(ev.victim)),
        );
        break;
      }
      case 'nearRope': {
        this.push(this.pick(NEAR_ROPE_LINES).replace('{v}', nameOf(ev.wrestler)));
        break;
      }
      case 'eliminated': {
        const v = nameOf(ev.wrestler);
        if (ev.eliminator === null || ev.eliminator === ev.wrestler) {
          this.push(this.pick(SOLO_ELIM_LINES).replace('{v}', v));
        }
        this.push(
          this.pick(ELIM_LINES).replace('{v}', v).replace('{p}', String(ev.finishingPosition)),
        );
        break;
      }
      case 'spotlight': {
        const a = nameOf(ev.actor);
        const v = nameOf(ev.target);
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
