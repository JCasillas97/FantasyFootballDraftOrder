import { MIN_ROSTER, MAX_ROSTER, type Player } from '../state/store';
import type { Avatar } from '../avatar/avatar';

/**
 * Roster persistence. localStorage by default; export/import JSON for moving
 * a league's avatars between devices (the user's desktop vs another
 * commissioner's).
 *
 * Format is versioned so future field additions don't silently corrupt old
 * saves. v1 = the format below.
 */

const KEY_PREFIX = 'rumble-draft-roster:';
const INDEX_KEY = 'rumble-draft-roster-index';

export interface SavedRoster {
  version: 1;
  name: string;
  savedAt: number;
  players: Array<{ name: string; avatar: Avatar }>;
}

export function listSavedRosters(): string[] {
  try {
    const raw = localStorage.getItem(INDEX_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

export function saveRoster(name: string, players: Player[]): void {
  const saved: SavedRoster = {
    version: 1,
    name,
    savedAt: Date.now(),
    players: players.map((p) => ({ name: p.name, avatar: p.avatar })),
  };
  localStorage.setItem(KEY_PREFIX + name, JSON.stringify(saved));
  const index = listSavedRosters();
  if (!index.includes(name)) {
    localStorage.setItem(INDEX_KEY, JSON.stringify([...index, name]));
  }
}

export function loadRoster(name: string): SavedRoster | null {
  const raw = localStorage.getItem(KEY_PREFIX + name);
  if (!raw) return null;
  try {
    const data = JSON.parse(raw) as SavedRoster;
    if (data.version !== 1) return null;
    return data;
  } catch {
    return null;
  }
}

export function deleteRoster(name: string): void {
  localStorage.removeItem(KEY_PREFIX + name);
  const index = listSavedRosters().filter((n) => n !== name);
  localStorage.setItem(INDEX_KEY, JSON.stringify(index));
}

export function rosterToPlayers(saved: SavedRoster): Player[] {
  return saved.players.map((p, i) => ({ id: i, name: p.name, avatar: p.avatar }));
}

export function exportRosterJson(name: string, players: Player[]): string {
  const saved: SavedRoster = {
    version: 1,
    name,
    savedAt: Date.now(),
    players: players.map((p) => ({ name: p.name, avatar: p.avatar })),
  };
  return JSON.stringify(saved, null, 2);
}

export function importRosterJson(json: string): SavedRoster | null {
  try {
    const data = JSON.parse(json) as SavedRoster;
    if (data.version !== 1) return null;
    if (!Array.isArray(data.players)) return null;
    if (data.players.length < MIN_ROSTER || data.players.length > MAX_ROSTER) return null;
    // Light shape validation.
    for (const p of data.players) {
      if (typeof p.name !== 'string') return null;
      if (typeof p.avatar !== 'object' || p.avatar === null) return null;
    }
    return data;
  } catch {
    return null;
  }
}
