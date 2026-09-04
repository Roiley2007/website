// Deterministic PRNG. The whole simulation depends on this being identical in
// Node and the browser, so the viewer can extrapolate ticks that exactly match
// what the scheduled runner will later commit.

export function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** RNG bound to state.rngState so every draw advances persisted state. */
export function rngFor(state) {
  return {
    next() {
      state.rngState = (state.rngState + 0x6d2b79f5) | 0;
      let t = Math.imul(state.rngState ^ (state.rngState >>> 15), 1 | state.rngState);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    range(lo, hi) { return lo + this.next() * (hi - lo); },
    int(lo, hi) { return Math.floor(this.range(lo, hi + 1)); },
    pick(arr) { return arr[Math.floor(this.next() * arr.length) % arr.length]; },
    chance(p) { return this.next() < p; },
  };
}
