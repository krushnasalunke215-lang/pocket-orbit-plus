import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT } from './fs-walk';

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  overrides?: Record<string, string>;
}
interface LockPackage {
  version?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}
interface PackageLock {
  packages: Record<string, LockPackage>;
}

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as PackageJson;
const lock = JSON.parse(
  readFileSync(join(ROOT, 'package-lock.json'), 'utf8'),
) as PackageLock;

const EXACT = /^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/;
const PINNED_NAME = (name: string): boolean =>
  name.startsWith('@iwsdk/') ||
  name.startsWith('@iwer/') ||
  name === 'iwer' ||
  name === '@meta-quest/metavr';

/** Transitive IWSDK/IWER packages held to the installed version through overrides. */
const OVERRIDES: Record<string, string> = {
  '@iwsdk/xr-input': '1.1.0-rc.2',
  '@iwsdk/locomotor': '1.1.0-rc.2',
  '@iwsdk/scene-composition': '1.1.0-rc.2',
  iwer: '2.8.0',
  '@iwer/devui': '2.8.0',
};

const direct = (): [string, string][] =>
  [...Object.entries(pkg.dependencies ?? {}), ...Object.entries(pkg.devDependencies ?? {})].filter(
    ([name]) => PINNED_NAME(name),
  );

describe('IWSDK and IWER pins', () => {
  it('pins every direct @iwsdk/*, @iwer/*, iwer and @meta-quest/metavr exactly', () => {
    const pins = direct();
    expect(pins.length).toBeGreaterThanOrEqual(5);
    for (const [name, spec] of pins) expect(spec, name).toMatch(EXACT);
  });

  it('overrides the transitive IWSDK/IWER packages exactly', () => {
    for (const [name, version] of Object.entries(OVERRIDES)) {
      expect(pkg.overrides?.[name], name).toBe(version);
      expect(pkg.overrides?.[name], name).toMatch(EXACT);
    }
  });

  it('package-lock.json root lists the same specs as package.json', () => {
    const root = lock.packages[''];
    expect(root.dependencies).toEqual(pkg.dependencies);
    expect(root.devDependencies).toEqual(pkg.devDependencies);
  });

  it('the locked versions equal each pin', () => {
    const pins: [string, string][] = [...direct(), ...Object.entries(OVERRIDES)];
    for (const [name, version] of pins) {
      expect(lock.packages[`node_modules/${name}`]?.version, name).toBe(version);
    }
  });
});
