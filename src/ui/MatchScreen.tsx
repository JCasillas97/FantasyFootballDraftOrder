import { useEffect, useRef } from 'react';
import { useAppStore } from '../state/store';
import { createMatch, tick, drainEvents, TICK_DT, type MatchState } from '../sim/tickLoop';
import { freshSeed } from '../sim/rng';
import { CANVAS_W, CANVAS_H, PLAYER_COLORS, drawFrame } from '../render/renderer';

export function MatchScreen() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const roster = useAppStore((s) => s.roster);
  const setResult = useAppStore((s) => s.setResult);
  const setScreen = useAppStore((s) => s.setScreen);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const seed = freshSeed();
    const state: MatchState = createMatch({ seed, rosterSize: roster.length });
    const commentary: string[] = [];

    let raf = 0;
    let accumulator = 0;
    let lastWall = performance.now();
    let stopped = false;

    const loop = (now: number) => {
      if (stopped) return;
      const delta = Math.min(0.25, (now - lastWall) / 1000); // cap big tab-switch jumps
      lastWall = now;
      accumulator += delta;

      while (accumulator >= TICK_DT) {
        tick(state);
        accumulator -= TICK_DT;
      }

      const events = drainEvents(state);
      for (const ev of events) {
        if (ev.type === 'eliminated') {
          const name = roster[ev.wrestler]?.name ?? `P${ev.wrestler}`;
          commentary.push(`#${ev.finishingPosition}: ${name} ELIMINATED`);
        }
      }

      drawFrame(ctx, state, roster, PLAYER_COLORS);

      if (state.finished) {
        // Build the result: scheduler's eliminationOrder = elims in order.
        // Pick #12 = first eliminated, pick #1 = winner.
        setResult({
          seed,
          roster: roster.slice(),
          eliminationOrder: state.scheduler.schedule.eliminationOrder.slice(),
          commentary,
        });
        // Brief pause on the final frame before flipping to results.
        setTimeout(() => setScreen('results'), 1500);
        return;
      }

      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
    };
  }, [roster, setResult, setScreen]);

  return (
    <div style={{ width: '100%', maxWidth: 980 }}>
      <canvas
        ref={canvasRef}
        width={CANVAS_W}
        height={CANVAS_H}
        style={{
          width: '100%',
          maxWidth: CANVAS_W,
          imageRendering: 'pixelated',
          border: '2px solid var(--border)',
          display: 'block',
        }}
      />
    </div>
  );
}
