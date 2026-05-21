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
 * Sidebar that fills in 12 → 1 as eliminations land. Slot #12 is the first
 * wrestler out; slot #1 is the winner (filled on matchEnd).
 */
export function DraftPickPanel({ roster, picks }: Props) {
  return (
    <div
      style={{
        background: 'var(--bg-panel)',
        border: '2px solid var(--border)',
        padding: 8,
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        minWidth: 180,
      }}
    >
      <div
        style={{
          fontSize: 11,
          color: 'var(--accent)',
          fontWeight: 'bold',
          letterSpacing: 1,
          textAlign: 'center',
          marginBottom: 4,
        }}
      >
        DRAFT ORDER
      </div>
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
              padding: '2px 4px',
              background: player
                ? isWinner
                  ? 'rgba(255, 204, 0, 0.18)'
                  : 'var(--bg-elevated)'
                : 'transparent',
              border: isWinner && player ? '1px solid var(--accent)' : '1px solid transparent',
              fontSize: 11,
              opacity: player ? 1 : 0.5,
            }}
          >
            <span
              style={{
                width: 22,
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
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
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
  );
}
