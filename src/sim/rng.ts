/**
 * Mulberry32: a small, fast, seedable PRNG with good statistical quality for
 * sims that don't need cryptographic randomness. The sim subtree uses this
 * instead of Math.random so that a given seed always reproduces the same match.
 */
export interface Rng {
  /** Next float in [0, 1). */
  next(): number;
  /** Next integer in [0, n) where n > 0. */
  nextInt(n: number): number;
  /** Float in [min, max). */
  nextRange(min: number, max: number): number;
}

export function createRng(seed: number): Rng {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    nextInt: (n) => Math.floor(next() * n),
    nextRange: (min, max) => min + next() * (max - min),
  };
}

/** Fisher-Yates shuffle. Returns a new array; does not mutate input. */
export function shuffle<T>(array: readonly T[], rng: Rng): T[] {
  const out = array.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = rng.nextInt(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Crypto-grade 32-bit seed for fresh matches. */
export function freshSeed(): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0];
}
