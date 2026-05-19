import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from 'lz-string';
import type { Player } from '../state/store';
import type { Avatar } from '../avatar/avatar';

/**
 * Replay link encoding. We pack {roster, seed} into the URL hash so anyone
 * who taps the link sees the same match deterministically. lz-string handles
 * URI-safe compression — typical 12-player roster + seed lands around
 * 350-600 chars, well inside iMessage's URL length limits.
 *
 * Format: `#replay=<encoded>`
 *
 * Field order in the payload is fixed; bumping `v` lets us migrate the
 * schema later without breaking old links.
 */

interface ReplayPayload {
  v: 1;
  s: number;
  p: Array<{ n: string; a: Avatar }>;
}

export function encodeReplay(roster: readonly Player[], seed: number): string {
  const payload: ReplayPayload = {
    v: 1,
    s: seed >>> 0,
    p: roster.map((p) => ({ n: p.name, a: p.avatar })),
  };
  return compressToEncodedURIComponent(JSON.stringify(payload));
}

export function decodeReplay(encoded: string): { roster: Player[]; seed: number } | null {
  try {
    const json = decompressFromEncodedURIComponent(encoded);
    if (!json) return null;
    const data = JSON.parse(json) as ReplayPayload;
    if (data.v !== 1) return null;
    if (typeof data.s !== 'number') return null;
    if (!Array.isArray(data.p) || data.p.length !== 12) return null;
    const roster: Player[] = data.p.map((entry, i) => {
      if (typeof entry.n !== 'string' || typeof entry.a !== 'object') {
        throw new Error('bad payload');
      }
      return { id: i, name: entry.n, avatar: entry.a };
    });
    return { roster, seed: data.s };
  } catch {
    return null;
  }
}

/** Parse the current URL hash for a replay payload. */
export function readReplayFromUrl(): { roster: Player[]; seed: number } | null {
  if (typeof window === 'undefined') return null;
  const hash = window.location.hash;
  if (!hash.startsWith('#replay=')) return null;
  return decodeReplay(hash.slice('#replay='.length));
}

/** Build a full URL with the replay hash. */
export function buildReplayUrl(roster: readonly Player[], seed: number): string {
  const encoded = encodeReplay(roster, seed);
  const base = window.location.origin + window.location.pathname;
  return `${base}#replay=${encoded}`;
}
