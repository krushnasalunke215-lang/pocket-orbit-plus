/** Small deterministic PRNG (mulberry32), so the cosmos is the same every run. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A uniformly random unit direction from `random`, written into `out`. */
export function randomDirection(random: () => number, out: number[]): number[] {
  const z = random() * 2 - 1;
  const a = random() * Math.PI * 2;
  const r = Math.sqrt(1 - z * z);
  out[0] = Math.cos(a) * r;
  out[1] = z;
  out[2] = Math.sin(a) * r;
  return out;
}
