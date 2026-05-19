import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../state/store';
import { createMatch, tick, drainEvents, TICK_DT, type MatchState } from '../sim/tickLoop';
import { freshSeed } from '../sim/rng';
import { CANVAS_W, CANVAS_H, drawFrame, type SpriteSheets } from '../render/renderer';
import { composeAvatarSheet } from '../avatar/compose';
import { startRecording, isRecorderSupported, type RecorderHandle } from '../capture/recorder';

export function MatchScreen() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const roster = useAppStore((s) => s.roster);
  const setResult = useAppStore((s) => s.setResult);
  const setScreen = useAppStore((s) => s.setScreen);
  const [recordingActive, setRecordingActive] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const seed = freshSeed();
    const state: MatchState = createMatch({ seed, rosterSize: roster.length });
    const commentary: string[] = [];

    // Bake one sprite sheet per player. Done once here, not per frame.
    const sheets: SpriteSheets = new Map();
    for (const player of roster) {
      sheets.set(player.id, composeAvatarSheet(player.avatar));
    }

    // Draw the first frame immediately so captureStream has content to record.
    drawFrame(ctx, state, roster, sheets);

    let recorder: RecorderHandle | null = null;
    if (isRecorderSupported()) {
      recorder = startRecording(canvas, { fps: 60, videoBitsPerSecond: 1_200_000 });
      if (recorder) setRecordingActive(true);
    }

    let raf = 0;
    let accumulator = 0;
    let lastWall = performance.now();
    let stopped = false;

    const finalize = async () => {
      let recording = null;
      if (recorder) {
        try {
          const result = await recorder.stop();
          recording = {
            blob: result.blob,
            mimeType: result.mimeType,
            isMp4: result.isMp4,
          };
        } catch (e) {
          console.error('recorder stop failed', e);
        }
      }
      setResult({
        seed,
        roster: roster.slice(),
        eliminationOrder: state.scheduler.schedule.eliminationOrder.slice(),
        commentary,
        recording,
      });
      setScreen('results');
    };

    const loop = (now: number) => {
      if (stopped) return;
      const delta = Math.min(0.25, (now - lastWall) / 1000);
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

      drawFrame(ctx, state, roster, sheets);

      if (state.finished) {
        // Hold the final frame for ~1.5s so the recording catches the result.
        setTimeout(() => {
          stopped = true;
          finalize();
        }, 1500);
        return;
      }

      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      if (recorder) recorder.cancel();
    };
  }, [roster, setResult, setScreen]);

  return (
    <div style={{ width: '100%', maxWidth: 980, position: 'relative' }}>
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
      {recordingActive && (
        <div
          style={{
            position: 'absolute',
            top: 12,
            right: 12,
            background: 'rgba(0,0,0,0.6)',
            border: '1px solid var(--accent-hot)',
            padding: '4px 8px',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 12,
            color: 'var(--accent-hot)',
            fontWeight: 'bold',
            letterSpacing: 1,
          }}
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: 'var(--accent-hot)',
              animation: 'pulse 1s infinite',
            }}
          />
          REC
        </div>
      )}
      <p style={{ color: 'var(--text-dim)', fontSize: 12, marginTop: 8 }}>
        Keep this tab visible while the match plays — background tabs throttle frame capture.
      </p>
    </div>
  );
}
