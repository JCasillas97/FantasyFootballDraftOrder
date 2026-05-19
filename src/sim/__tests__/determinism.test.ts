import { describe, it, expect } from 'vitest';
import { runToCompletion, createMatch, tick, drainEvents } from '../tickLoop';

/**
 * Determinism: same seed must always produce the same match. This unlocks
 * the replay-link feature and lets the user re-record a failed video
 * capture without getting a different match.
 */

describe('match determinism', () => {
  it('same seed produces identical elimination order', () => {
    for (const seed of [1, 42, 9999, 2 ** 31 - 1, 0]) {
      const a = runToCompletion(seed);
      const b = runToCompletion(seed);
      expect(a.scheduler.schedule.eliminationOrder).toEqual(
        b.scheduler.schedule.eliminationOrder,
      );
      expect(a.eliminationLog).toEqual(b.eliminationLog);
    }
  });

  it('same seed produces identical wrestler trajectories', () => {
    const seed = 123456;
    const a = runToCompletion(seed);
    const b = runToCompletion(seed);
    for (let i = 0; i < a.wrestlers.length; i++) {
      expect(a.wrestlers[i].x).toBeCloseTo(b.wrestlers[i].x, 6);
      expect(a.wrestlers[i].y).toBeCloseTo(b.wrestlers[i].y, 6);
    }
  });

  it('same seed produces identical event count', () => {
    const seed = 555;
    const collectEvents = () => {
      const s = createMatch({ seed, rosterSize: 12 });
      const events = [];
      let safety = 0;
      while (!s.finished && safety++ < 60 * 60 * 10) {
        tick(s);
        events.push(...drainEvents(s));
      }
      return events;
    };
    const a = collectEvents();
    const b = collectEvents();
    expect(a.length).toBe(b.length);
    for (let i = 0; i < a.length; i++) {
      expect(a[i]).toEqual(b[i]);
    }
  });

  it('different seeds produce different elimination orders (with high probability)', () => {
    const a = runToCompletion(1);
    const b = runToCompletion(2);
    expect(a.scheduler.schedule.eliminationOrder).not.toEqual(
      b.scheduler.schedule.eliminationOrder,
    );
  });
});
