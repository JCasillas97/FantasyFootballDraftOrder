/**
 * Canvas → MP4 (or WebM) capture via the native MediaRecorder API.
 *
 * iMessage on iOS plays H.264 MP4 inline. WebM is downloaded as a generic
 * attachment, breaking the "tap and watch" UX. So we feature-detect MP4
 * support and prefer it. Chrome 126+ and Safari 17+ produce MP4 directly;
 * Firefox falls back to WebM, which the UI flags so the user knows.
 */
export interface RecorderHandle {
  stop(): Promise<RecordingResult>;
  cancel(): void;
}

export interface RecordingResult {
  blob: Blob;
  mimeType: string;
  /** True if the result is iMessage-inline-playable (MP4/H.264). */
  isMp4: boolean;
  duration: number; // seconds (best-effort from recorder)
}

const MP4_MIME_CANDIDATES = [
  'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
  'video/mp4;codecs=avc1.42E01E',
  'video/mp4;codecs=h264',
  'video/mp4',
];

const WEBM_MIME_CANDIDATES = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
];

export function pickBestMimeType(): { mime: string; isMp4: boolean } | null {
  if (typeof MediaRecorder === 'undefined') return null;
  for (const m of MP4_MIME_CANDIDATES) {
    if (MediaRecorder.isTypeSupported(m)) return { mime: m, isMp4: true };
  }
  for (const m of WEBM_MIME_CANDIDATES) {
    if (MediaRecorder.isTypeSupported(m)) return { mime: m, isMp4: false };
  }
  return null;
}

export interface StartOptions {
  fps?: number;
  videoBitsPerSecond?: number;
  /** Audio stream to mix in (from AudioContext.createMediaStreamDestination()). */
  audioTracks?: MediaStreamTrack[];
}

export function startRecording(
  canvas: HTMLCanvasElement,
  opts: StartOptions = {},
): RecorderHandle | null {
  const pick = pickBestMimeType();
  if (!pick) return null;

  const videoBitsPerSecond = opts.videoBitsPerSecond ?? 1_200_000;
  // Capture at the canvas's natural update rate rather than forcing a target
  // FPS. Some setups (high refresh displays, throttled tabs) caused timing
  // mismatches when a fixed 60fps was requested — the encoded video played
  // back faster than realtime. Passing no rate lets the browser sync output
  // frames to actual canvas updates.
  const stream = (canvas as HTMLCanvasElement & {
    captureStream(fps?: number): MediaStream;
  }).captureStream();
  for (const track of opts.audioTracks ?? []) {
    stream.addTrack(track);
  }

  let recorder: MediaRecorder;
  try {
    recorder = new MediaRecorder(stream, {
      mimeType: pick.mime,
      videoBitsPerSecond,
    });
  } catch (e) {
    console.error('MediaRecorder construction failed', e);
    return null;
  }

  const chunks: BlobPart[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };

  const startedAt = performance.now();
  recorder.start(1000); // 1s chunks so memory doesn't balloon

  let stopped = false;

  const stop = (): Promise<RecordingResult> =>
    new Promise((resolve, reject) => {
      if (stopped) return reject(new Error('recorder already stopped'));
      stopped = true;
      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: pick.mime.split(';')[0] });
        const duration = (performance.now() - startedAt) / 1000;
        for (const track of stream.getTracks()) track.stop();
        resolve({ blob, mimeType: pick.mime, isMp4: pick.isMp4, duration });
      };
      recorder.onerror = (e) => reject(e);
      if (recorder.state !== 'inactive') recorder.stop();
      else resolve({ blob: new Blob(chunks), mimeType: pick.mime, isMp4: pick.isMp4, duration: 0 });
    });

  const cancel = () => {
    stopped = true;
    if (recorder.state !== 'inactive') recorder.stop();
    for (const track of stream.getTracks()) track.stop();
  };

  return { stop, cancel };
}

export function isRecorderSupported(): boolean {
  return pickBestMimeType() !== null;
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Defer revoke so the browser has time to start the download.
  setTimeout(() => URL.revokeObjectURL(url), 5_000);
}
