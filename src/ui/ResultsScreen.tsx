import { useState } from 'react';
import { useAppStore, displayName } from '../state/store';
import { downloadBlob } from '../capture/recorder';
import { AvatarPreview } from './AvatarEditor';
import { renderResultsPng, copyBlobToClipboard } from '../lib/png';
import { buildReplayUrl } from '../lib/seed';

export function ResultsScreen() {
  const result = useAppStore((s) => s.result);
  const reset = useAppStore((s) => s.reset);
  const [status, setStatus] = useState('');

  if (!result) {
    return (
      <div>
        <p style={{ color: 'var(--text-dim)' }}>No result yet.</p>
        <button onClick={reset}>Back to Setup</button>
      </div>
    );
  }

  const downloadVideo = () => {
    if (!result.recording) return;
    const ext = result.recording.isMp4 ? 'mp4' : 'webm';
    downloadBlob(result.recording.blob, `draft-rumble-${result.seed}.${ext}`);
  };

  const exportPng = async () => {
    const blob = await renderResultsPng(result);
    if (!blob) {
      setStatus('PNG export failed.');
      return;
    }
    downloadBlob(blob, `draft-rumble-${result.seed}.png`);
    setStatus('PNG downloaded.');
  };

  const copyPng = async () => {
    const blob = await renderResultsPng(result);
    if (!blob) {
      setStatus('PNG generation failed.');
      return;
    }
    const ok = await copyBlobToClipboard(blob);
    setStatus(ok ? 'Image copied to clipboard.' : 'Clipboard not available; PNG downloaded instead.');
    if (!ok) downloadBlob(blob, `draft-rumble-${result.seed}.png`);
  };

  const copyReplayLink = async () => {
    const url = buildReplayUrl(result.roster, result.seed);
    try {
      await navigator.clipboard.writeText(url);
      setStatus('Replay link copied to clipboard.');
    } catch {
      setStatus(`Link: ${url}`);
    }
  };

  const videoSizeKb = result.recording
    ? Math.round((result.recording.blob.size / 1024) * 10) / 10
    : 0;

  // eliminationOrder[0] = first eliminated = pick #12.
  // eliminationOrder[N-1] = last standing = pick #1.
  const board = result.eliminationOrder
    .map((wrestlerId, eliminationIndex) => ({
      wrestlerId,
      pickNumber: result.roster.length - eliminationIndex,
    }))
    .sort((a, b) => a.pickNumber - b.pickNumber);

  return (
    <div style={{ width: '100%', maxWidth: 640 }}>
      <h2 style={{ margin: '0 0 16px', letterSpacing: 2, color: 'var(--accent)' }}>Draft Order</h2>
      <p style={{ color: 'var(--text-dim)', marginTop: 0 }}>
        Seed: <span style={{ color: 'var(--text)' }}>{result.seed}</span>
      </p>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
          padding: 12,
          background: 'var(--bg-panel)',
          border: '2px solid var(--border)',
          marginBottom: 24,
        }}
      >
        {board.map((row) => {
          const player = result.roster[row.wrestlerId];
          const isWinner = row.pickNumber === 1;
          return (
            <div
              key={row.wrestlerId}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '6px 8px',
                background: isWinner ? 'rgba(255, 204, 0, 0.1)' : 'transparent',
                border: isWinner ? '1px solid var(--accent)' : '1px solid transparent',
              }}
            >
              <span
                style={{
                  width: 40,
                  textAlign: 'right',
                  color: isWinner ? 'var(--accent)' : 'var(--text-dim)',
                  fontWeight: 'bold',
                }}
              >
                #{row.pickNumber}
              </span>
              <AvatarPreview avatar={player.avatar} />
              <span style={{ flex: 1 }}>{displayName(player, row.wrestlerId)}</span>
            </div>
          );
        })}
      </div>
      {result.recording && (
        <div style={{ marginBottom: 16, color: 'var(--text-dim)', fontSize: 12 }}>
          <div style={{ marginBottom: 8 }}>
            Recording: <span style={{ color: 'var(--text)' }}>{result.recording.mimeType}</span>{' '}
            ({videoSizeKb < 1024 ? `${videoSizeKb} KB` : `${(videoSizeKb / 1024).toFixed(1)} MB`})
          </div>
          {!result.recording.isMp4 && (
            <div style={{ color: 'var(--accent-hot)', marginBottom: 8 }}>
              Note: WebM file — won't preview inline in iMessage. For inline iPhone playback,
              run the match in Chrome 126+ or Safari 17+.
            </div>
          )}
        </div>
      )}
      <div
        style={{
          marginBottom: 16,
          padding: 10,
          background: 'var(--bg-panel)',
          border: '1px solid var(--border)',
          fontSize: 11,
          color: 'var(--text-dim)',
          lineHeight: 1.5,
        }}
      >
        <div style={{ color: 'var(--accent)', marginBottom: 4, fontWeight: 'bold' }}>
          If the MP4 looks broken (frozen / wrong duration):
        </div>
        <div>
          • <span style={{ color: 'var(--text)' }}>Use the replay link</span> — your league taps it,
          watches the same match in their browser. Deterministic from the seed.
        </div>
        <div>
          • <span style={{ color: 'var(--text)' }}>Screen-record the match</span> — macOS QuickTime
          (Cmd+Shift+5) or Windows Game Bar (Win+G) captures the browser tab. Bulletproof.
        </div>
        <div>
          • <span style={{ color: 'var(--text)' }}>Download PNG</span> — static results board with
          everyone's pick, plays inline in iMessage as a picture.
        </div>
      </div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        {result.recording && (
          <button onClick={downloadVideo}>
            Download {result.recording.isMp4 ? 'MP4' : 'WebM'}
          </button>
        )}
        <button onClick={exportPng}>Download PNG</button>
        <button onClick={copyPng}>Copy PNG</button>
        <button onClick={copyReplayLink}>Copy Replay Link</button>
        <button onClick={reset}>Run Another Rumble</button>
      </div>
      {status && (
        <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 8, wordBreak: 'break-all' }}>
          {status}
        </div>
      )}
    </div>
  );
}
