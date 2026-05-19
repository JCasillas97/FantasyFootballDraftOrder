import { useAppStore } from '../state/store';

export function SetupScreen() {
  const roster = useAppStore((s) => s.roster);
  const setRoster = useAppStore((s) => s.setRoster);
  const setScreen = useAppStore((s) => s.setScreen);

  const updateName = (id: number, name: string) => {
    setRoster(roster.map((p) => (p.id === id ? { ...p, name } : p)));
  };

  const allNamed = roster.every((p) => p.name.trim().length > 0);

  return (
    <div style={{ width: '100%', maxWidth: 720 }}>
      <p style={{ color: 'var(--text-dim)', marginTop: 0 }}>
        Enter 12 player names. The rumble decides your draft order.
      </p>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(2, 1fr)',
          gap: '8px 16px',
          marginBottom: 24,
        }}
      >
        {roster.map((p, i) => (
          <label
            key={p.id}
            style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-dim)' }}
          >
            <span style={{ width: 24, textAlign: 'right' }}>{i + 1}.</span>
            <input
              type="text"
              value={p.name}
              maxLength={16}
              onChange={(e) => updateName(p.id, e.target.value)}
              style={{ flex: 1 }}
            />
          </label>
        ))}
      </div>
      <button disabled={!allNamed} onClick={() => setScreen('match')}>
        Start Rumble
      </button>
    </div>
  );
}
