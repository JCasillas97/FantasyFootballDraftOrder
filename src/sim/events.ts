import type { AttackMove } from './wrestler';

/**
 * Engine event types. The match engine emits these as the sim runs; UI,
 * commentary, audio, and effects all subscribe to the same stream. Keeping
 * events as discriminated unions lets each subscriber pattern-match cleanly.
 */
export type GameEvent =
  | { type: 'matchStart'; seed: number }
  | { type: 'hit'; attacker: number; victim: number; move: AttackMove }
  | { type: 'throw'; attacker: number; victim: number }
  | { type: 'nearRope'; wrestler: number }
  | { type: 'eliminated'; wrestler: number; eliminator: number | null; finishingPosition: number }
  | { type: 'spotlight'; stage: 'climb' | 'leap' | 'impact'; actor: number; target: number }
  | { type: 'matchEnd'; winner: number; eliminationOrder: number[] };
