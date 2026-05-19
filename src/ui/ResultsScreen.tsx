import { useAppStore } from '../state/store';
import { PLAYER_COLORS } from '../render/renderer';
import { downloadBlob } from '../capture/recorder';

export function ResultsScreen() {
  const result = useAppStore((s) => s.result);
  const reset = useAppStore((s) => s.reset);

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

  const videoSizeKb = result.recording
    ? Math.round((result.recording.blob.size / 1024) * 10) / 10
    : 0;

  // eliminationOrder[0] = first eliminated = pick #12.
  // eliminationOrder[N-1] = last standing = pick #1.
  // Reverse so the draft board reads from pick #1 down.
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
          const color = PLAYER_COLORS[row.wrestlerId % PLAYER_COLORS.length];
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
              <span
                style={{
                  width: 20,
                  height: 20,
                  background: color,
                  border: '2px solid var(--border)',
                  display: 'inline-block',
                }}
              />
              <span style={{ flex: 1 }}>{player?.name ?? `Player ${row.wrestlerId + 1}`}</span>
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
              ⚠ WebM file — won't preview inline in iMessage. For inline iPhone playback, run
              the match in Chrome 126+ or Safari 17+.
            </div>
          )}
        </div>
      )}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        {result.recording && (
          <button onClick={downloadVideo}>
            Download {result.recording.isMp4 ? 'MP4' : 'WebM'}
          </button>
        )}
        <button onClick={reset}>Run Another Rumble</button>
      </div>
    </div>
  );
}
