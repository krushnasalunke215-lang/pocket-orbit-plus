import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT, walkFiles } from './fs-walk';

/*
 * src/sim and src/game must stay pure: no Three.js, IWSDK or DOM, and no
 * ambient clocks or randomness, because determinism (path hashes, the solver,
 * a future seeded Daily Comet) depends on it. A seeded RNG module added later
 * belongs in an explicit allowlist here, not in a looser pattern.
 */
const FORBIDDEN: RegExp[] = [
  /from ['"]three/,
  /from ['"]@iwsdk/,
  /\bimport\s*\(\s*['"`](three|@iwsdk)/,
  /\bwindow\./,
  /\bdocument\./,
  /\bnavigator\b/,
  /\bperformance\./,
  /\brequestAnimationFrame\b/,
  /\bsetTimeout\b/,
  /\bsetInterval\b/,
  /\bDate\.now\b/,
  /\bnew Date\b/,
  /\bMath\.random\b/,
];

describe('pure layers (src/sim, src/game)', () => {
  it('import nothing from three, @iwsdk or the DOM and use no clocks or randomness', () => {
    const files = [
      ...walkFiles(join(ROOT, 'src', 'sim')),
      ...walkFiles(join(ROOT, 'src', 'game')),
    ].filter((f) => f.endsWith('.ts'));
    expect(files.length).toBeGreaterThan(10);
    const violations: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      for (const re of FORBIDDEN) {
        if (re.test(text)) {
          violations.push(`${relative(ROOT, file).replaceAll('\\', '/')}: ${re}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('catches the forbidden forms', () => {
    const samples = [
      "import { Vector3 } from 'three';",
      "const { World } = await import('@iwsdk/core');",
      'const m = await import("three");',
      'window.__game = api;',
      'document.body',
      'navigator.xr',
      'const t = performance.now();',
      'requestAnimationFrame(loop);',
      'setTimeout(fn, 0);',
      'setInterval(fn, 10);',
      'const now = Date.now();',
      'const d = new Date();',
      'const r = Math.random();',
    ];
    for (const sample of samples) {
      expect(FORBIDDEN.some((re) => re.test(sample)), sample).toBe(true);
    }
    expect(FORBIDDEN.some((re) => re.test("import { simulate } from './simulate.js';"))).toBe(false);
  });
});
