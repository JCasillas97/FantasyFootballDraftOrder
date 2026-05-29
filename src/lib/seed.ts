import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from 'lz-string';
import { MIN_ROSTER, MAX_ROSTER, type Player } from '../state/store';
import { presetAvatar } from '../avatar/presets';
import type { Avatar } from '../avatar/avatar';

/**
 * Replay link encoding. We pack {seed, names, avatars} into the URL hash so
 * anyone who taps the link sees the same match deterministically with the
 * exact roster the host configured.
 *
 * v3 format (current): `v3.<seed>.<n>.<names>.<avatars>` where
 *   - seed is base36
 *   - names is lz-compressed names joined by \x1f
 *   - avatars is a flat string of `n` zero-padded 5-char base36 codes, one
 *     per player. Each code packs the 9 avatar fields via mixed-radix.
 *   For a 12-player roster the URL lands around 260 chars — short enough that
 *   iMessage stops breaking the link across "words".
 *
 * v2 format (legacy): `v2.<seed>.<n>.<names>` — avatars were reconstructed
 *   from presetAvatar(index). Decode still works for any v2 links in the
 *   wild but new shares always use v3.
 *
 * v1 format (legacy): full lz-compressed JSON {v:1, s, p:[{n, a}]}.
 */

// Mixed-radix sizes for each avatar field. Order matters — encode + decode
// must agree. Product = 7*8*12*5*5*12*4*3*3 = 3,628,800 (< 36^5 = 60,466,176)
// so each avatar fits in exactly 5 base36 chars.
const AVATAR_FIELDS: ReadonlyArray<readonly [keyof Avatar, number]> = [
  ['skinTone', 7],
  ['hairStyle', 8],
  ['hairColor', 12],
  ['facialHair', 5],
  ['headgear', 5],
  ['gearColor', 12],
  ['accessory', 4],
  ['height', 3],
  ['build', 3],
];
const AVATAR_CHARS = 5;

function clampField(v: number, size: number): number {
  if (!Number.isFinite(v)) return 0;
  const n = Math.floor(v);
  if (n < 0) return 0;
  if (n >= size) return size - 1;
  return n;
}

function encodeAvatar(a: Avatar): string {
  let n = 0;
  let mult = 1;
  for (const [field, size] of AVATAR_FIELDS) {
    n += clampField(a[field], size) * mult;
    mult *= size;
  }
  return n.toString(36).padStart(AVATAR_CHARS, '0');
}

function decodeAvatar(code: string, fallbackIndex: number): Avatar {
  let n = parseInt(code, 36);
  if (!Number.isFinite(n) || n < 0) return presetAvatar(fallbackIndex);
  const result = {} as Avatar;
  for (const [field, size] of AVATAR_FIELDS) {
    (result[field] as number) = n % size;
    n = Math.floor(n / size);
  }
  return result;
}

interface V1Payload {
  v: 1;
  s: number;
  p: Array<{ n: string; a: unknown }>;
}

export function encodeReplay(roster: readonly Player[], seed: number): string {
  const names = roster.map((p) => p.name).join('\x1f');
  const compressed = compressToEncodedURIComponent(names);
  const avatars = roster.map((p) => encodeAvatar(p.avatar)).join('');
  return `v3.${(seed >>> 0).toString(36)}.${roster.length}.${compressed}.${avatars}`;
}

export function decodeReplay(encoded: string): { roster: Player[]; seed: number } | null {
  // v3 path
  if (encoded.startsWith('v3.')) {
    const parts = encoded.split('.');
    // 5 segments: tag, seed, count, names, avatars. names is lz-compressed
    // and the encoder is URL-safe so it won't contain '.'.
    if (parts.length !== 5) return null;
    const seed = parseInt(parts[1], 36);
    const n = parseInt(parts[2], 10);
    if (isNaN(seed) || isNaN(n)) return null;
    if (n < MIN_ROSTER || n > MAX_ROSTER) return null;
    const raw = decompressFromEncodedURIComponent(parts[3]);
    if (!raw) return null;
    const names = raw.split('\x1f');
    if (names.length !== n) return null;
    const avatarBlob = parts[4];
    if (avatarBlob.length !== n * AVATAR_CHARS) return null;
    const roster: Player[] = names.map((name, i) => ({
      id: i,
      name,
      avatar: decodeAvatar(avatarBlob.slice(i * AVATAR_CHARS, (i + 1) * AVATAR_CHARS), i),
    }));
    return { roster, seed: seed >>> 0 };
  }
  // v2 legacy: names only, avatars from preset
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
