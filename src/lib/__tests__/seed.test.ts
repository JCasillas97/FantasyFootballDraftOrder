import { describe, it, expect } from 'vitest';
import { encodeReplay, decodeReplay } from '../seed';
import type { Player } from '../../state/store';
import { DEFAULT_AVATARS } from '../../avatar/presets';

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
      // v2 format trades full avatar fidelity for URL length — avatars are
      // reconstructed from presetAvatar(index), which matches the default
      // avatars used in this test fixture (DEFAULT_AVATARS).
      expect(decoded!.roster[i].avatar).toEqual(sampleRoster[i].avatar);
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

  it('keeps encoded payload SHORT enough for iMessage URLs', () => {
    const encoded = encodeReplay(sampleRoster, 42);
    // v2 format: names-only payload, ~200 chars for a 12-player roster.
    // iMessage was breaking links past ~400-500 chars; aim for <300.
    expect(encoded.length).toBeLessThan(300);
  });
});
