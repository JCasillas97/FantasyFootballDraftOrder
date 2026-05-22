import { displayName, type Player } from '../state/store';
import { AvatarPreview } from './AvatarEditor';

export interface DraftPick {
  pickNumber: number;
  wrestlerId: number | null;
}

interface Props {
  roster: readonly Player[];
  picks: readonly DraftPick[];
}

/**
 * Horizontal grid below the canvas that fills in 12 → 1 as eliminations land.
 * Slot #12 fills first (first wrestler out); slot #1 fills last (the winner)
 * and gets the gold highlight.
 */
export function DraftPickPanel({ roster, picks }: Props) {
  return (
    <div
      style={{
        background: 'var(--bg-panel)',
        border: '2px solid var(--border)',
        padding: 10,
      }}
    >
      <div
        style={{
          fontSize: 11,
          color: 'var(--accent)',
          fontWeight: 'bold',
          letterSpacing: 1,
          marginBottom: 6,
        }}
      >
        DRAFT ORDER
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
          gap: 4,
        }}
      >
        {picks.map((pick) => {
          const player = pick.wrestlerId !== null ? roster[pick.wrestlerId] : null;
          const isWinner = pick.pickNumber === 1;
          return (
            <div
              key={pick.pickNumber}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '3px 5px',
                background: player
                  ? isWinner
                    ? 'rgba(255, 204, 0, 0.18)'
                    : 'var(--bg-elevated)'
                  : 'transparent',
                border: isWinner && player ? '1px solid var(--accent)' : '1px solid var(--border)',
                fontSize: 11,
                opacity: player ? 1 : 0.5,
                minHeight: 32,
              }}
            >
              <span
                style={{
                  minWidth: 22,
                  textAlign: 'right',
                  color: isWinner && player ? 'var(--accent)' : 'var(--text-dim)',
                  fontWeight: 'bold',
                }}
              >
                #{pick.pickNumber}
              </span>
              {player ? (
                <>
                  <AvatarPreview avatar={player.avatar} scale={1} />
                  <span
                    style={{
                      flex: 1,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {displayName(player, pick.wrestlerId!)}
                  </span>
                </>
              ) : (
                <span style={{ color: 'var(--text-dim)' }}>—</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
