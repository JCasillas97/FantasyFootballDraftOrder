import { describe, it, expect } from 'vitest';
import { compressToEncodedURIComponent } from 'lz-string';
import { encodeReplay, decodeReplay } from '../seed';
import type { Player } from '../../state/store';
import { DEFAULT_AVATARS } from '../../avatar/presets';
import type { Avatar } from '../../avatar/avatar';

/**
 * Replay link encoding must round-trip exactly — otherwise the "tap to watch
 * the same match" promise breaks. Also verifies decode rejects garbage
 * gracefully (return null) instead of crashing the app on a malformed URL.
 */

const sampleRoster: Player[] = DEFAULT_AVATARS.map((avatar, i) => ({
  id: i,
  name: `Player ${i + 1}`,
  avatar,
}));

// A roster whose avatars are deliberately *not* the presets, to prove v3 carries
// custom avatar fidelity through the link.
const customRoster: Player[] = Array.from({ length: 12 }, (_, i) => ({
  id: i,
  name: `Wrestler ${i + 1}`,
  avatar: {
    skinTone: (i + 2) % 7,
    hairStyle: (i + 5) % 8,
    hairColor: (i * 3 + 1) % 12,
    facialHair: (i + 1) % 5,
    headgear: (i + 4) % 5,
    gearColor: (i * 5 + 2) % 12,
    accessory: (i + 3) % 4,
    height: (i + 1) % 3,
    build: (i + 2) % 3,
  } satisfies Avatar,
}));

describe('replay encode/decode', () => {
  it('round-trips a roster + seed', () => {
    const seed = 1234567;
    const encoded = encodeReplay(sampleRoster, seed);
    const decoded = decodeReplay(encoded);
    expect(decoded).not.toBeNull();
    expect(decoded!.seed).toBe(seed);
    expect(decoded!.roster.length).toBe(12);
    for (let i = 0; i < 12; i++) {
      expect(decoded!.roster[i].name).toBe(sampleRoster[i].name);
      expect(decoded!.roster[i].avatar).toEqual(sampleRoster[i].avatar);
    }
  });

  it('round-trips custom avatars (not just presets)', () => {
    const encoded = encodeReplay(customRoster, 42);
    const decoded = decodeReplay(encoded);
    expect(decoded).not.toBeNull();
    for (let i = 0; i < 12; i++) {
      expect(decoded!.roster[i].name).toBe(customRoster[i].name);
      expect(decoded!.roster[i].avatar).toEqual(customRoster[i].avatar);
    }
  });

  it('handles unusual seed values (0, MAX_UINT32)', () => {
    for (const seed of [0, 1, 2 ** 32 - 1, 0xdeadbeef]) {
      const decoded = decodeReplay(encodeReplay(sampleRoster, seed));
      expect(decoded?.seed).toBe(seed >>> 0);
    }
  });

  it('returns null for garbage input', () => {
    expect(decodeReplay('not-real-lzstring')).toBeNull();
    expect(decodeReplay('')).toBeNull();
    // Valid lz-string but wrong shape:
    expect(decodeReplay('NoZQGgwgZgrgrCAA')).toBeNull();
  });

  it('still decodes legacy v2 links (names only, avatars from presets)', () => {
    // Hand-construct a v2 link the way the old encoder would have, then make
    // sure the decoder still accepts it so any links already shared keep
    // working.
    const names = sampleRoster.map((p) => p.name).join('\x1f');
    const v2 = `v2.${(42).toString(36)}.${sampleRoster.length}.${compressToEncodedURIComponent(names)}`;
    const decoded = decodeReplay(v2);
    expect(decoded).not.toBeNull();
    expect(decoded!.seed).toBe(42);
    expect(decoded!.roster[0].name).toBe('Player 1');
  });

  it('keeps encoded payload SHORT enough for iMessage URLs', () => {
    const encoded = encodeReplay(sampleRoster, 42);
    // v3 format: ~200 chars of names + 60 chars of avatar codes (~260 total).
    // iMessage was breaking links past ~400-500 chars; aim for <400 with margin.
    expect(encoded.length).toBeLessThan(400);
  });
});
