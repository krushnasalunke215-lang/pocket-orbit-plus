// Dev tool, run once by hand (never by the build): downloads the Solar System
// Scope 2k textures (CC BY 4.0, https://www.solarsystemscope.com/textures/)
// into .agents/scratch/textures-src/ and re-encodes them with sharp into
// public/vendor/textures/ (see CREDITS.md there). Prints every output file's
// size and the total, which must stay under about 6 MB.
// Usage: node scripts/vendor-textures.mjs [--force] (re-download)
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(root, '.agents', 'scratch', 'textures-src');
const OUT = path.join(root, 'public', 'vendor', 'textures');
const BASE = 'https://www.solarsystemscope.com/textures/download/';
const force = process.argv.includes('--force');

const FILES = [
  '2k_stars_milky_way.jpg',
  '2k_saturn.jpg',
  '2k_saturn_ring_alpha.png',
  '2k_earth_daymap.jpg',
  '2k_uranus.jpg',
  '2k_moon.jpg',
  '2k_mercury.jpg',
  '2k_jupiter.jpg',
  '2k_neptune.jpg',
  '2k_mars.jpg',
];

/** Atlas tiles, 2 columns x 4 rows, row-major from the top (null = the ice tile). */
const ATLAS = [
  '2k_earth_daymap.jpg',
  '2k_uranus.jpg',
  '2k_moon.jpg',
  '2k_mercury.jpg',
  '2k_jupiter.jpg',
  '2k_neptune.jpg',
  '2k_mars.jpg',
  null,
];

const WEBP = { quality: 80, effort: 6 };

async function download(name) {
  const file = path.join(SRC, name);
  if (existsSync(file) && !force) return file;
  const res = await fetch(BASE + name);
  const type = res.headers.get('content-type') ?? '';
  if (!res.ok || !type.startsWith('image/')) throw new Error(`${name}: HTTP ${res.status} ${type}`);
  writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  console.log(`downloaded ${name} (${statSync(file).size} bytes)`);
  return file;
}

const src = (name) => path.join(SRC, name);

/** The moon tile desaturated, lifted and tinted pale blue (comet nucleus, icy moons). */
async function iceTile(w, h) {
  const { data } = await sharp(src('2k_moon.jpg')).resize(w, h, { fit: 'fill' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const out = Buffer.alloc(w * h * 3);
  const tint = [0.8, 0.89, 1.0];
  for (let i = 0; i < w * h; i++) {
    const l = (0.2126 * data[i * 3] + 0.7152 * data[i * 3 + 1] + 0.0722 * data[i * 3 + 2]) / 255;
    const v = 0.42 + 0.58 * l;
    for (let c = 0; c < 3; c++) out[i * 3 + c] = Math.round(Math.min(1, v * tint[c]) * 255);
  }
  return sharp(out, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer();
}

async function atlas(size, file) {
  const tw = size / 2;
  const th = size / 4;
  const tiles = await Promise.all(
    ATLAS.map(async (name, i) => ({
      input: name ? await sharp(src(name)).resize(tw, th, { fit: 'fill' }).removeAlpha().png().toBuffer() : await iceTile(tw, th),
      left: (i % 2) * tw,
      top: Math.floor(i / 2) * th,
    })),
  );
  await sharp({ create: { width: size, height: size, channels: 3, background: '#000000' } })
    .composite(tiles)
    .webp(WEBP)
    .toFile(path.join(OUT, file));
}

async function equirect(name, w, h, file, options = WEBP) {
  await sharp(src(name)).resize(w, h, { fit: 'fill' }).removeAlpha().webp(options).toFile(path.join(OUT, file));
}

/** The star panorama keeps its faint point stars only at a higher quality (still small). */
const SKY_WEBP = { quality: 92, effort: 6 };

mkdirSync(SRC, { recursive: true });
mkdirSync(OUT, { recursive: true });
for (const name of FILES) await download(name);

await equirect('2k_stars_milky_way.jpg', 2048, 1024, 'milky-way-2k.webp', SKY_WEBP);
await equirect('2k_stars_milky_way.jpg', 1024, 512, 'milky-way-1k.webp', SKY_WEBP);
await equirect('2k_saturn.jpg', 2048, 1024, 'saturn-2k.webp');
await equirect('2k_saturn.jpg', 1024, 512, 'saturn-1k.webp');
await sharp(src('2k_saturn_ring_alpha.png'))
  .ensureAlpha()
  .resize(1024, 64, { fit: 'fill' })
  .webp({ ...WEBP, alphaQuality: 90 })
  .toFile(path.join(OUT, 'saturn-ring.webp'));
await atlas(2048, 'planets-2k.webp');
await atlas(1024, 'planets-1k.webp');

let total = 0;
for (const file of ['milky-way-2k.webp', 'milky-way-1k.webp', 'saturn-2k.webp', 'saturn-1k.webp', 'saturn-ring.webp', 'planets-2k.webp', 'planets-1k.webp']) {
  const { size } = statSync(path.join(OUT, file));
  const meta = await sharp(path.join(OUT, file)).metadata();
  total += size;
  console.log(`${file.padEnd(20)} ${String(meta.width).padStart(4)}x${String(meta.height).padEnd(4)} ${size} bytes`);
}
console.log(`total ${total} bytes (${(total / 1048576).toFixed(2)} MB)`);
if (total > 6 * 1048576) {
  console.error('total over 6 MB');
  process.exit(1);
}
