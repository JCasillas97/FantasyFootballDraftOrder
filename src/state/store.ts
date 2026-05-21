import { create } from 'zustand';
import type { Avatar } from '../avatar/avatar';
import { presetAvatar } from '../avatar/presets';

export type Screen = 'setup' | 'match' | 'results';

export interface Player {
  id: number;
  name: string;
  avatar: Avatar;
}

export interface RecordingInfo {
  blob: Blob;
  mimeType: string;
  isMp4: boolean;
}

export interface MatchResult {
  seed: number;
  roster: Player[];
  /** Indices into roster, in order of elimination (index 0 = first eliminated = draft pick 12). */
  eliminationOrder: number[];
  /** Optional play-by-play log built during the match. */
  commentary: string[];
  recording: RecordingInfo | null;
}

export const MIN_ROSTER = 4;
export const MAX_ROSTER = 20;
export const DEFAULT_ROSTER_SIZE = 12;

interface AppState {
  screen: Screen;
  roster: Player[];
  result: MatchResult | null;
  /** When set, MatchScreen replays this exact seed instead of generating a fresh one. */
  replaySeed: number | null;
  setScreen: (screen: Screen) => void;
  setRoster: (roster: Player[]) => void;
  setRosterSize: (size: number) => void;
  setResult: (result: MatchResult) => void;
  setReplaySeed: (seed: number | null) => void;
  reset: () => void;
}

const defaultRoster = (size: number = DEFAULT_ROSTER_SIZE): Player[] =>
  Array.from({ length: size }, (_, i) => ({
    id: i,
    name: '',
    avatar: presetAvatar(i),
  }));

/** Resolves the on-screen / shareable name. Empty names fall back to "Player N". */
export function displayName(player: Player, index?: number): string {
  const trimmed = player.name.trim();
  if (trimmed) return trimmed;
  return `Player ${(index ?? player.id) + 1}`;
}

export const useAppStore = create<AppState>((set, get) => ({
  screen: 'setup',
  roster: defaultRoster(),
  result: null,
  replaySeed: null,
  setScreen: (screen) => set({ screen }),
  setRoster: (roster) => set({ roster }),
  setRosterSize: (size) => {
    const clamped = Math.max(MIN_ROSTER, Math.min(MAX_ROSTER, Math.floor(size)));
    const current = get().roster;
    if (clamped === current.length) return;
    if (clamped < current.length) {
      // Shrinking: keep the first N players, drop the rest.
      set({ roster: current.slice(0, clamped) });
    } else {
      // Growing: append fresh players with preset avatars at the new indices.
      const extra: Player[] = [];
      for (let i = current.length; i < clamped; i++) {
        extra.push({ id: i, name: '', avatar: presetAvatar(i) });
      }
      set({ roster: [...current, ...extra] });
    }
  },
  setResult: (result) => set({ result }),
  setReplaySeed: (seed) => set({ replaySeed: seed }),
  reset: () => {
    if (typeof window !== 'undefined' && window.location.hash) {
      // Drop any replay payload from the URL so future fresh matches don't
      // re-trigger replay mode on refresh.
      history.replaceState(null, '', window.location.pathname + window.location.search);
    }
    set({ screen: 'setup', result: null, replaySeed: null });
  },
}));
