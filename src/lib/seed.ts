import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from 'lz-string';
import { MIN_ROSTER, MAX_ROSTER, type Player } from '../state/store';
import { presetAvatar } from '../avatar/presets';

/**
 * Replay link encoding. We pack {seed, names} into the URL hash so anyone
 * who taps the link sees the same match deterministically.
 *
 * v2 format (compact, iMessage-safe):
 *   `v2:<seed>:<base64-lzcompressed names joined by \x1f>`
 * Avatars are reconstructed from presetAvatar(index) — full per-player
 * avatar fidelity is sacrificed for URL length so the link fits inside
 * iMessage's URL parsing limits (the old format was producing 600+ char
 * URLs that iMessage broke across multiple "words").
 *
 * v1 format (legacy, kept for backward compatibility): full
 * lz-compressed JSON {v:1, s, p:[{n, a}]}.
 */

interface V1Payload {
  v: 1;
  s: number;
  p: Array<{ n: string; a: unknown }>;
}

export function encodeReplay(roster: readonly Player[], seed: number): string {
  // v2: names joined by \x1f then lz-compressed. Seeds + length are URL-safe
  // ints so they stay outside the compression payload.
  const names = roster.map((p) => p.name).join('\x1f');
  const compressed = compressToEncodedURIComponent(names);
  return `v2.${(seed >>> 0).toString(36)}.${roster.length}.${compressed}`;
}

export function decodeReplay(encoded: string): { roster: Player[]; seed: number } | null {
  // v2 path
  if (encoded.startsWith('v2.')) {
    const parts = encoded.split('.');
    if (parts.length < 4) return null;
    const seed = parseInt(parts[1], 36);
    const n = parseInt(parts[2], 10);
    if (isNaN(seed) || isNaN(n)) return null;
    if (n < MIN_ROSTER || n > MAX_ROSTER) return null;
    const payload = parts.slice(3).join('.');
    const raw = decompressFromEncodedURIComponent(payload);
    if (!raw) return null;
    const names = raw.split('\x1f');
    if (names.length !== n) return null;
    const roster: Player[] = names.map((name, i) => ({
      id: i,
      name,
      avatar: presetAvatar(i),
    }));
    return { roster, seed: seed >>> 0 };
  }
  // v1 legacy fallback
  try {
    const json = decompressFromEncodedURIComponent(encoded);
    if (!json) return null;
    const data = JSON.parse(json) as V1Payload;
    if (data.v !== 1) return null;
    if (typeof data.s !== 'number') return null;
    if (!Array.isArray(data.p)) return null;
    if (data.p.length < MIN_ROSTER || data.p.length > MAX_ROSTER) return null;
    const roster: Player[] = data.p.map((entry, i) => {
      if (typeof entry.n !== 'string') throw new Error('bad payload');
      // v1 had avatars; if missing/garbled, fall back to preset.
      const av =
        entry.a && typeof entry.a === 'object'
          ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
            ((entry.a as any) as Player['avatar'])
          : presetAvatar(i);
      return { id: i, name: entry.n, avatar: av };
    });
    return { roster, seed: data.s >>> 0 };
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
