/**
 * 8-bit-style SFX synthesized at runtime via Web Audio. No asset downloads:
 * each sound is a tiny oscillator + noise + envelope routine. Easier to ship,
 * and the chiptune-ish timbre fits the visuals.
 *
 * The engine routes through a MediaStreamDestination so the canvas recorder
 * captures the audio sample-accurately in sync with the video.
 */

let ctx: AudioContext | null = null;
let masterGain: GainNode | null = null;
let muted = false;

export function getAudioContext(): AudioContext | null {
  if (!ctx) {
    try {
      ctx = new AudioContext();
      masterGain = ctx.createGain();
      masterGain.gain.value = 0.4;
      masterGain.connect(ctx.destination);
    } catch (e) {
      console.warn('AudioContext init failed', e);
      return null;
    }
  }
  return ctx;
}

/**
 * Per-recording audio capture handle. The destination node is created fresh
 * for each match so the audio track's internal timeline anchors to the same
 * moment the video track starts. A long-lived destination would cause
 * MediaRecorder to mux `mvhd.duration = AudioContext.currentTime +
 * recordingLength`, producing huge bogus durations (the 1800s bug).
 *
 * Caller MUST invoke `dispose()` after `recorder.stop()` completes so the
 * destination is disconnected from masterGain — but the AudioContext and
 * masterGain themselves stay alive across the session.
 */
export interface CaptureAudioHandle {
  tracks: MediaStreamTrack[];
  dispose(): void;
}

export function createCaptureAudio(): CaptureAudioHandle {
  const audio = getAudioContext();
  if (!audio || !masterGain) return { tracks: [], dispose: () => {} };
  const dest = audio.createMediaStreamDestination();
  masterGain.connect(dest);
  return {
    tracks: dest.stream.getAudioTracks(),
    dispose: () => {
      try {
        masterGain!.disconnect(dest);
      } catch {
        // Already disconnected — no-op.
      }
      for (const t of dest.stream.getAudioTracks()) t.stop();
    },
  };
}

export function setMuted(value: boolean): void {
  muted = value;
  if (masterGain) masterGain.gain.value = value ? 0 : 0.4;
}

export function isMuted(): boolean {
  return muted;
}

/** Resume the context after a user gesture (browsers gate autoplay). */
export async function resumeAudio(): Promise<void> {
  const audio = getAudioContext();
  if (audio && audio.state === 'suspended') {
    try {
      await audio.resume();
    } catch (e) {
      console.warn('audio resume failed', e);
    }
  }
}

interface ToneOpts {
  freq: number;
  type?: OscillatorType;
  durationSec: number;
  attack?: number;
  release?: number;
  gain?: number;
  freqEnd?: number;
}

function playTone(opts: ToneOpts): void {
  const audio = getAudioContext();
  if (!audio || !masterGain) return;
  const now = audio.currentTime;
  const osc = audio.createOscillator();
  const env = audio.createGain();
  osc.type = opts.type ?? 'square';
  osc.frequency.setValueAtTime(opts.freq, now);
  if (opts.freqEnd !== undefined) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, opts.freqEnd), now + opts.durationSec);
  }
  const peak = opts.gain ?? 0.3;
  const attack = opts.attack ?? 0.005;
  const release = opts.release ?? 0.05;
  env.gain.setValueAtTime(0, now);
  env.gain.linearRampToValueAtTime(peak, now + attack);
  env.gain.exponentialRampToValueAtTime(0.0001, now + opts.durationSec + release);
  osc.connect(env).connect(masterGain);
  osc.start(now);
  osc.stop(now + opts.durationSec + release + 0.01);
}

function playNoise(durationSec: number, gain = 0.4, filterFreq = 2000): void {
  const audio = getAudioContext();
  if (!audio || !masterGain) return;
  const now = audio.currentTime;
  const bufferSize = Math.max(1, Math.floor(audio.sampleRate * durationSec));
  const buffer = audio.createBuffer(1, bufferSize, audio.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
  const source = audio.createBufferSource();
  source.buffer = buffer;
  const filter = audio.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = filterFreq;
  const env = audio.createGain();
  env.gain.setValueAtTime(gain, now);
  env.gain.exponentialRampToValueAtTime(0.0001, now + durationSec);
  source.connect(filter).connect(env).connect(masterGain);
  source.start(now);
  source.stop(now + durationSec + 0.01);
}

export const SFX = {
  hit(): void {
    playNoise(0.08, 0.5, 1200);
    playTone({ freq: 220, type: 'square', durationSec: 0.06, freqEnd: 80, gain: 0.25 });
  },
  throw(): void {
    playTone({ freq: 800, type: 'sawtooth', durationSec: 0.25, freqEnd: 200, gain: 0.2 });
    playNoise(0.15, 0.3, 3000);
  },
  ropeBounce(): void {
    playTone({ freq: 140, type: 'triangle', durationSec: 0.15, freqEnd: 110, gain: 0.3 });
  },
  nearElimination(): void {
    playTone({ freq: 660, type: 'square', durationSec: 0.08, gain: 0.2 });
    setTimeout(() => playTone({ freq: 880, type: 'square', durationSec: 0.08, gain: 0.2 }), 80);
  },
  eliminated(): void {
    // Two-note descending stinger
    playTone({ freq: 440, type: 'square', durationSec: 0.18, gain: 0.32 });
    setTimeout(
      () => playTone({ freq: 330, type: 'square', durationSec: 0.28, gain: 0.32 }),
      170,
    );
    playNoise(0.3, 0.25, 800);
  },
  matchEnd(): void {
    // Victory fanfare: C-E-G arpeggio + sustained
    const notes = [523, 659, 784, 1046];
    notes.forEach((freq, i) => {
      setTimeout(
        () => playTone({ freq, type: 'square', durationSec: 0.18, gain: 0.3 }),
        i * 110,
      );
    });
    setTimeout(
      () => playTone({ freq: 1046, type: 'square', durationSec: 0.6, gain: 0.3 }),
      notes.length * 110,
    );
  },
};
