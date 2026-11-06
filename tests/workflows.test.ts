import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { ROOT } from './fs-walk';

interface Step {
  id?: string;
  uses?: string;
  run?: string;
  with?: Record<string, unknown>;
}
interface Job {
  needs?: string | string[];
  permissions?: Record<string, string>;
  steps: Step[];
}
interface Workflow {
  permissions?: Record<string, string>;
  jobs: Record<string, Job>;
}

const load = (name: string): Workflow =>
  parse(readFileSync(join(ROOT, '.github', 'workflows', name), 'utf8')) as Workflow;

describe('ci.yml', () => {
  it('runs install, typecheck, test, build in order', () => {
    const ci = load('ci.yml');
    const runs = Object.values(ci.jobs)
      .flatMap((job) => job.steps)
      .map((s) => s.run)
      .filter((r): r is string => typeof r === 'string');
    const expected = ['npm ci', 'npm run typecheck', 'npm test', 'npm run build'];
    const indexes = expected.map((cmd) => runs.indexOf(cmd));
    expect(indexes.every((i) => i >= 0)).toBe(true);
    expect([...indexes].sort((a, b) => a - b)).toEqual(indexes);
  });

  it('only reads the repository', () => {
    const ci = load('ci.yml');
    expect(ci.permissions).toEqual({ contents: 'read' });
    for (const job of Object.values(ci.jobs)) expect(job.permissions).toBeUndefined();
  });
});

describe('pages.yml', () => {
  const pages = load('pages.yml');

  it('grants Pages and OIDC write only to the deploy job', () => {
    expect(pages.permissions).toEqual({ contents: 'read' });
    expect(pages.jobs.build.permissions).toBeUndefined();
    expect(pages.jobs.deploy.permissions).toEqual({ pages: 'write', 'id-token': 'write' });
    // The deploy job runs no project code: only actions, no `run` steps.
    expect(pages.jobs.deploy.steps.every((s) => s.uses && !s.run)).toBe(true);
  });

  it('builds with the repo name as the base path', () => {
    const runs = pages.jobs.build.steps.map((s) => s.run ?? '');
    expect(
      runs.some((r) => r.includes('--base=/${{ github.event.repository.name }}/')),
    ).toBe(true);
  });

  it('uploads dist as the Pages artifact', () => {
    const upload = pages.jobs.build.steps.find(
      (s) => s.uses === 'actions/upload-pages-artifact@v4',
    );
    expect(upload?.with?.path).toBe('dist');
  });

  it('deploys after build with deploy-pages', () => {
    const deploy = pages.jobs.deploy;
    const needs = Array.isArray(deploy.needs) ? deploy.needs : [deploy.needs];
    expect(needs).toContain('build');
    const step = deploy.steps.find((s) => s.id === 'deployment');
    expect(step?.uses).toBe('actions/deploy-pages@v4');
  });
});
