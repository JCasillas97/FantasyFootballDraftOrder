import { useState, useRef } from 'react';
import { useAppStore, MIN_ROSTER, MAX_ROSTER, type Player } from '../state/store';
import { AvatarEditor, AvatarPreview } from './AvatarEditor';
import {
  saveRoster,
  loadRoster,
  listSavedRosters,
  deleteRoster,
  rosterToPlayers,
  exportRosterJson,
  importRosterJson,
} from '../lib/storage';

export function SetupScreen() {
  const roster = useAppStore((s) => s.roster);
  const setRoster = useAppStore((s) => s.setRoster);
  const setRosterSize = useAppStore((s) => s.setRosterSize);
  const setScreen = useAppStore((s) => s.setScreen);

  const [selectedId, setSelectedId] = useState<number>(0);
  const [savedNames, setSavedNames] = useState<string[]>(() => listSavedRosters());
  const [saveName, setSaveName] = useState('');
  const [statusMsg, setStatusMsg] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const selected = roster.find((p) => p.id === selectedId) ?? roster[0];

  const updatePlayer = (id: number, patch: Partial<Player>) => {
    setRoster(roster.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  };

  const allNamed = roster.every((p) => p.name.trim().length > 0);

  const handleSave = () => {
    const name = saveName.trim();
    if (!name) {
      setStatusMsg('Enter a roster name first.');
      return;
    }
    saveRoster(name, roster);
    setSavedNames(listSavedRosters());
    setStatusMsg(`Saved roster "${name}".`);
  };

  const handleLoad = (name: string) => {
    const saved = loadRoster(name);
    if (!saved) {
      setStatusMsg(`Could not load "${name}".`);
      return;
    }
    setRoster(rosterToPlayers(saved));
    setSelectedId(0);
    setSaveName(name);
    setStatusMsg(`Loaded "${name}".`);
  };

  const handleDelete = (name: string) => {
    deleteRoster(name);
    setSavedNames(listSavedRosters());
    if (saveName === name) setSaveName('');
    setStatusMsg(`Deleted "${name}".`);
  };

  const handleExport = () => {
    const name = saveName.trim() || 'roster';
    const json = exportRosterJson(name, roster);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${name}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };

  const handleImport = async (file: File) => {
    const text = await file.text();
    const saved = importRosterJson(text);
    if (!saved) {
      setStatusMsg('Invalid roster JSON.');
      return;
    }
    setRoster(rosterToPlayers(saved));
    setSelectedId(0);
    setSaveName(saved.name);
    setStatusMsg(`Imported "${saved.name}".`);
  };

  const handleResize = (delta: number) => {
    const next = roster.length + delta;
    setRosterSize(next);
    if (selectedId >= next) setSelectedId(Math.max(0, next - 1));
  };

  return (
    <div style={{ width: '100%', maxWidth: 980 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          marginBottom: 16,
          flexWrap: 'wrap',
        }}
      >
        <span style={{ color: 'var(--text-dim)' }}>League size:</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button
            onClick={() => handleResize(-1)}
            disabled={roster.length <= MIN_ROSTER}
            style={{ padding: '4px 12px' }}
          >
            −
          </button>
          <span
            style={{
              minWidth: 56,
              textAlign: 'center',
              background: 'var(--bg-panel)',
              border: '2px solid var(--border)',
              padding: '6px 12px',
              fontWeight: 'bold',
              color: 'var(--accent)',
            }}
          >
            {roster.length} teams
          </span>
          <button
            onClick={() => handleResize(1)}
            disabled={roster.length >= MAX_ROSTER}
            style={{ padding: '4px 12px' }}
          >
            +
          </button>
        </div>
        <span style={{ color: 'var(--text-dim)', fontSize: 11 }}>
          {MIN_ROSTER}–{MAX_ROSTER} allowed
        </span>
      </div>
      <p style={{ color: 'var(--text-dim)', marginTop: 0 }}>
        Enter {roster.length} names and customize each wrestler. Click a row to edit.
      </p>

      <div className="setup-grid">
        {/* Roster list */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
            maxHeight: 540,
            overflowY: 'auto',
          }}
        >
          {roster.map((p, i) => {
            const isSelected = p.id === selectedId;
            return (
              <div
                key={p.id}
                onClick={() => setSelectedId(p.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: 6,
                  background: isSelected ? 'var(--bg-elevated)' : 'var(--bg-panel)',
                  border: isSelected ? '2px solid var(--accent)' : '2px solid var(--border)',
                  cursor: 'pointer',
                }}
              >
                <span style={{ width: 20, textAlign: 'right', color: 'var(--text-dim)' }}>
                  {i + 1}
                </span>
                <AvatarPreview avatar={p.avatar} scale={1} />
                <input
                  type="text"
                  value={p.name}
                  maxLength={16}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => updatePlayer(p.id, { name: e.target.value })}
                  style={{ flex: 1, fontSize: 12, padding: '4px 6px' }}
                />
              </div>
            );
          })}
        </div>

        {/* Editor panel */}
        <div>
          <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 8 }}>
            Editing: <span style={{ color: 'var(--text)' }}>{selected.name}</span>
          </div>
          <AvatarEditor
            avatar={selected.avatar}
            onChange={(avatar) => updatePlayer(selected.id, { avatar })}
          />
        </div>
      </div>

      {/* Roster management */}
      <div
        style={{
          background: 'var(--bg-panel)',
          border: '2px solid var(--border)',
          padding: 12,
          marginBottom: 16,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}
      >
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            type="text"
            placeholder="Roster name"
            value={saveName}
            onChange={(e) => setSaveName(e.target.value)}
            style={{ width: 200, fontSize: 12 }}
          />
          <button onClick={handleSave} style={{ fontSize: 11 }}>
            Save Roster
          </button>
          <button onClick={handleExport} style={{ fontSize: 11 }}>
            Export JSON
          </button>
          <button onClick={() => fileRef.current?.click()} style={{ fontSize: 11 }}>
            Import JSON
          </button>
          <input
            type="file"
            ref={fileRef}
            accept="application/json"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleImport(f);
              e.target.value = '';
            }}
          />
        </div>
        {savedNames.length > 0 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>Saved:</span>
            {savedNames.map((n) => (
              <span
                key={n}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border)',
                  padding: '2px 6px',
                  fontSize: 11,
                }}
              >
                <button
                  onClick={() => handleLoad(n)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--text)',
                    padding: '0 4px',
                    fontSize: 11,
                  }}
                >
                  {n}
                </button>
                <button
                  onClick={() => handleDelete(n)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--accent-hot)',
                    padding: '0 4px',
                    fontSize: 11,
                  }}
                  title="Delete"
                >
                  ✕
                </button>
              </span>
            ))}
          </div>
        )}
        {statusMsg && <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>{statusMsg}</div>}
      </div>

      <button disabled={!allNamed} onClick={() => setScreen('match')}>
        Start Rumble
      </button>
    </div>
  );
}
