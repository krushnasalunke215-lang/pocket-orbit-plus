import { BufferAttribute, IcosahedronGeometry, Vector3, type BufferGeometry } from '@iwsdk/core';
import { mulberry32 } from './cosmos/random.js';

/*
 * A lumpy icosphere baked once at module init (the board moon and the comet
 * nucleus): IcosahedronGeometry(1, detail) displaced along each direction
 * by seeded smooth lumps and a few round craters, rescaled into [lo, hi]
 * radii, with smooth normals (corners at the same point share one normal,
 * so the silhouette is irregular but the surface is not faceted). The
 * geometry uv stays the icosahedron's spherical mapping (atlas tiles).
 */

export function bakeLumpyGeometry(detail: number, seed: number, lo: number, hi: number, craters = 0): BufferGeometry {
  const geometry = new IcosahedronGeometry(1, detail);
  const random = mulberry32(seed);
  const lumps: number[] = [];
  for (let k = 0; k < 7; k++) {
    const z = random() * 2 - 1;
    const a = random() * Math.PI * 2;
    const s = Math.sqrt(1 - z * z);
    lumps.push(Math.cos(a) * s, Math.sin(a) * s, z, (random() - 0.45) * 0.8);
  }
  const pits: number[] = [];
  for (let k = 0; k < craters; k++) {
    const z = random() * 2 - 1;
    const a = random() * Math.PI * 2;
    const s = Math.sqrt(1 - z * z);
    pits.push(Math.cos(a) * s, Math.sin(a) * s, z, 0.12 + random() * 0.2);
  }
  const pos = geometry.getAttribute('position') as BufferAttribute;
  const radii = new Float32Array(pos.count);
  let min = Infinity;
  let max = -Infinity;
  const v = new Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).normalize();
    let r = 0;
    for (let k = 0; k < lumps.length; k += 4) {
      const d = lumps[k] * v.x + lumps[k + 1] * v.y + lumps[k + 2] * v.z;
      r += lumps[k + 3] * Math.max(0, d) ** 2;
    }
    for (let k = 0; k < pits.length; k += 4) {
      // A bowl with a raised rim: angular distance over the crater size.
      const ang = Math.acos(Math.min(1, pits[k] * v.x + pits[k + 1] * v.y + pits[k + 2] * v.z)) / pits[k + 3];
      if (ang < 1.4) r += ang < 1 ? -0.18 * (1 - ang * ang) : 0.08 * Math.sin(((ang - 1) / 0.4) * Math.PI);
    }
    radii[i] = r;
    min = Math.min(min, r);
    max = Math.max(max, r);
  }
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).normalize();
    v.multiplyScalar(lo + ((hi - lo) * (radii[i] - min)) / Math.max(1e-6, max - min));
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  const normals = new Float32Array(pos.count * 3);
  const sums = new Map<string, Vector3>();
  const key = (i: number) => `${pos.getX(i).toFixed(5)},${pos.getY(i).toFixed(5)},${pos.getZ(i).toFixed(5)}`;
  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  const n = new Vector3();
  for (let i = 0; i < pos.count; i += 3) {
    a.fromBufferAttribute(pos, i);
    b.fromBufferAttribute(pos, i + 1);
    c.fromBufferAttribute(pos, i + 2);
    n.subVectors(c, b).cross(a.sub(b));
    for (let j = 0; j < 3; j++) {
      const k = key(i + j);
      const sum = sums.get(k);
      if (sum) sum.add(n);
      else sums.set(k, n.clone());
    }
  }
  for (let i = 0; i < pos.count; i++) {
    const s = sums.get(key(i))!.normalize();
    normals.set([s.x, s.y, s.z], i * 3);
  }
  geometry.setAttribute('normal', new BufferAttribute(normals, 3));
  geometry.computeBoundingSphere();
  return geometry;
}
