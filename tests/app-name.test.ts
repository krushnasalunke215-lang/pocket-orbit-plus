import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { APP_NAME } from '../src/config';
import { ROOT, walkFiles } from './fs-walk';

const BINARY = /\.(png|jpe?g|gif|webp|ico|glb|ktx2|mp3|ogg|wav|wasm|bin)$/i;

describe('single-name rule', () => {
  it('APP_NAME is non-empty', () => {
    expect(APP_NAME.trim().length).toBeGreaterThan(0);
  });

  it('APP_NAME appears only in src/config.ts', () => {
    const files = [
      ...walkFiles(join(ROOT, 'src')),
      ...walkFiles(join(ROOT, 'public')),
      join(ROOT, 'index.html'),
    ].filter((f) => !BINARY.test(f));
    const offenders = files
      .map((f) => relative(ROOT, f).replaceAll('\\', '/'))
      .filter((rel) => rel !== 'src/config.ts')
      .filter((rel) => readFileSync(join(ROOT, rel), 'utf8').includes(APP_NAME));
    expect(offenders).toEqual([]);
  });
});
