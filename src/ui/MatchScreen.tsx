import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../state/store';
import { createMatch, tick, drainEvents, TICK_DT, type MatchState } from '../sim/tickLoop';
import { freshSeed } from '../sim/rng';
import { CANVAS_W, CANVAS_H, drawFrame, type SpriteSheets } from '../render/renderer';
import { composeAvatarSheet } from '../avatar/compose';
import { startRecording, isRecorderSupported, type RecorderHandle } from '../capture/recorder';
import { CommentaryStream } from '../sim/commentary';
import { CommentaryLog } from './CommentaryLog';
import { SFX, getCaptureAudioTracks, resumeAudio, setMuted, isMuted } from '../audio/engine';

export function MatchScreen() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const roster = useAppStore((s) => s.roster);
  const setResult = useAppStore((s) => s.setResult);
  const setScreen = useAppStore((s) => s.setScreen);
  const [recordingActive, setRecordingActive] = useState(false);
  const [lines, setLines] = useState<readonly string[]>([]);
  const [muted, setMutedLocal] = useState(isMuted());

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    void resumeAudio();

    const seed = freshSeed();
    const state: MatchState = createMatch({ seed, rosterSize: roster.length });
    const commentary = new CommentaryStream(seed);

    const sheets: SpriteSheets = new Map();
    for (const player of roster) {
      sheets.set(player.id, composeAvatarSheet(player.avatar));
    }

    drawFrame(ctx, state, roster, sheets);

    // Start the recorder *after* audio tracks are available so they get baked
    // into the MP4. If audio init fails (no user gesture yet) we still record
    // video-only — better than nothing.
    let recorder: RecorderHandle | null = null;
    if (isRecorderSupported()) {
      const audioTracks = getCaptureAudioTracks();
      recorder = startRecording(canvas, {
        fps: 60,
        videoBitsPerSecond: 1_200_000,
        audioTracks,
      });
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
        commentary: commentary.all.slice(),
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
        commentary.ingest(ev, roster);
        switch (ev.type) {
          case 'hit':
            SFX.hit();
            break;
          case 'throw':
            SFX.throw();
            break;
          case 'nearRope':
            SFX.nearElimination();
            break;
          case 'eliminated':
            SFX.eliminated();
            break;
          case 'matchEnd':
            SFX.matchEnd();
            break;
        }
      }
      if (events.length > 0) setLines(commentary.all.slice());

      drawFrame(ctx, state, roster, sheets);

      if (state.finished) {
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

  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    setMutedLocal(next);
  };

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
      <div
        style={{
          display: 'flex',
          gap: 8,
          alignItems: 'center',
          justifyContent: 'space-between',
          marginTop: 8,
        }}
      >
        <p style={{ color: 'var(--text-dim)', fontSize: 12, margin: 0 }}>
          Keep this tab visible — background tabs throttle frame capture.
        </p>
        <button onClick={toggleMute} style={{ fontSize: 11 }}>
          {muted ? 'Unmute' : 'Mute'}
        </button>
      </div>
      <div style={{ marginTop: 8 }}>
        <CommentaryLog lines={lines} />
      </div>
    </div>
  );
}
