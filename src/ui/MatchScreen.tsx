import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../state/store';
import { createMatch, tick, drainEvents, TICK_DT, type MatchState } from '../sim/tickLoop';
import { freshSeed } from '../sim/rng';
import { CANVAS_W, CANVAS_H, drawFrame, type SpriteSheets } from '../render/renderer';
import { composeAvatarSheet } from '../avatar/compose';
import { startRecording, isRecorderSupported, type RecorderHandle } from '../capture/recorder';
import { CommentaryStream } from '../sim/commentary';
import { CommentaryLog } from './CommentaryLog';
import { DraftPickPanel, type DraftPick } from './DraftPickPanel';
import { SFX, getCaptureAudioTracks, resumeAudio, setMuted, isMuted } from '../audio/engine';

export function MatchScreen() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const roster = useAppStore((s) => s.roster);
  const leagueName = useAppStore((s) => s.leagueName);
  const replaySeed = useAppStore((s) => s.replaySeed);
  const setResult = useAppStore((s) => s.setResult);
  const setScreen = useAppStore((s) => s.setScreen);
  const setReplaySeed = useAppStore((s) => s.setReplaySeed);
  const [lines, setLines] = useState<readonly string[]>([]);
  const initialPicks = () =>
    Array.from({ length: roster.length }, (_, i) => ({
      pickNumber: roster.length - i,
      wrestlerId: null as number | null,
    }));
  const [picks, setPicks] = useState<readonly DraftPick[]>(initialPicks);
  // Mirror of picks so the RAF loop can read the latest value without
  // re-binding the closure on each React render.
  const picksRef = useRef<readonly DraftPick[]>(picks);
  const [muted, setMutedLocal] = useState(isMuted());

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    void resumeAudio();

    const seed = replaySeed ?? freshSeed();
    // Consume the replay seed so navigating back to setup and rerunning gives
    // a fresh match instead of replaying the same one.
    if (replaySeed !== null) setReplaySeed(null);
    const state: MatchState = createMatch({ seed, rosterSize: roster.length });
    const commentary = new CommentaryStream(seed);

    const sheets: SpriteSheets = new Map();
    for (const player of roster) {
      sheets.set(player.id, composeAvatarSheet(player.avatar));
    }

    let resultsShownAt = 0;
    const RESULTS_HOLD_MS = 7000;
    drawFrame(ctx, state, roster, sheets, { leagueName, picks: picksRef.current });

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
    }

    let raf = 0;
    let accumulator = 0;
    let lastWall = performance.now();
    let stopped = false;
    // Crowd energy decays toward 0; spikes on big events (eliminations,
    // spotlight impact, table-break slam). Pure render-only — doesn't touch
    // sim determinism.
    let crowdEnergy = 0.15; // baseline "interested" level

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
      const pickUpdates: Array<{ pickNumber: number; wrestlerId: number }> = [];
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
            pickUpdates.push({ pickNumber: ev.finishingPosition, wrestlerId: ev.wrestler });
            crowdEnergy = Math.max(crowdEnergy, 0.85);
            break;
          case 'matchEnd':
            SFX.matchEnd();
            pickUpdates.push({ pickNumber: 1, wrestlerId: ev.winner });
            crowdEnergy = 1.2;
            break;
          case 'spotlight':
            if (ev.stage === 'climb') crowdEnergy = Math.max(crowdEnergy, 0.55);
            else if (ev.stage === 'leap') crowdEnergy = Math.max(crowdEnergy, 0.85);
            else if (ev.stage === 'impact') crowdEnergy = 1.3; // eruption!
            break;
        }
      }
      if (events.length > 0) setLines(commentary.all.slice());
      if (pickUpdates.length > 0) {
        const next = picksRef.current.map((p) => {
          const upd = pickUpdates.find((u) => u.pickNumber === p.pickNumber);
          return upd ? { ...p, wrestlerId: upd.wrestlerId } : p;
        });
        picksRef.current = next;
        setPicks(next);
      }

      // Crowd energy decays each frame back toward baseline.
      const decay = Math.min(1, delta * 0.4);
      crowdEnergy = crowdEnergy * (1 - decay) + 0.15 * decay;

      // Hold the end-of-match results overlay on the canvas for several
      // seconds so it bakes into the recorded video before we finalize.
      const showResults = state.finished;
      if (showResults && resultsShownAt === 0) resultsShownAt = now;
      drawFrame(ctx, state, roster, sheets, {
        leagueName,
        picks: picksRef.current,
        resultsOverlay: showResults,
        crowdEnergy,
        tableBroken: state.tableBreak?.broken ?? false,
      });

      if (showResults && now - resultsShownAt >= RESULTS_HOLD_MS) {
        stopped = true;
        finalize();
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
    // We intentionally only run this once per mount; eslint can't infer that.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    setMutedLocal(next);
  };

  return (
    <div style={{ width: '100%', maxWidth: 1200 }}>
      <div className="match-grid">
        <div style={{ position: 'relative' }}>
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
        <CommentaryLog lines={lines} />
      </div>
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
      <div style={{ marginTop: 12 }}>
        <DraftPickPanel roster={roster} picks={picks} />
      </div>
    </div>
  );
}
