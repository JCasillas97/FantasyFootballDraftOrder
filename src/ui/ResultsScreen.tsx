import { useAppStore } from '../state/store';
import { PLAYER_COLORS } from '../render/renderer';

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
      <button onClick={reset}>Run Another Rumble</button>
    </div>
  );
}
