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

interface AppState {
  screen: Screen;
  roster: Player[];
  result: MatchResult | null;
  setScreen: (screen: Screen) => void;
  setRoster: (roster: Player[]) => void;
  setResult: (result: MatchResult) => void;
  reset: () => void;
}

const defaultRoster = (): Player[] =>
  Array.from({ length: 12 }, (_, i) => ({
    id: i,
    name: `Player ${i + 1}`,
    avatar: presetAvatar(i),
  }));

export const useAppStore = create<AppState>((set) => ({
  screen: 'setup',
  roster: defaultRoster(),
  result: null,
  setScreen: (screen) => set({ screen }),
  setRoster: (roster) => set({ roster }),
  setResult: (result) => set({ result }),
  reset: () => set({ screen: 'setup', result: null }),
}));
