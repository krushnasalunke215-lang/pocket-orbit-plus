import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT, walkFiles } from './fs-walk';

const FORBIDDEN: RegExp[] = [
  /from ['"]three/,
  /from ['"]@iwsdk/,
  /\bwindow\./,
  /\bdocument\./,
];

describe('pure layers (src/sim, src/game)', () => {
  it('import nothing from three, @iwsdk or the DOM', () => {
    const files = [
      ...walkFiles(join(ROOT, 'src', 'sim')),
      ...walkFiles(join(ROOT, 'src', 'game')),
    ].filter((f) => f.endsWith('.ts'));
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
});
