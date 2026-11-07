/**
 * Level authoring helper: prints the best robust solutions of a level.
 *
 *   npm run solve -- <levelId> [step] [--melody]
 *
 * --melody groups the robust solutions by the order their bodies ring
 * (rungSequence) and prints the best placement per sequence.
 *
 * Exits 1 when the level is unknown or has no robust solution.
 */
import { rungSequence } from '../src/game/song.js';
import { getLevel } from '../src/sim/levels/index.js';
import { startPlacements } from '../src/sim/level.js';
import { simulate } from '../src/sim/simulate.js';
import { solveLevel, solvesWithZeroMoves, type Solution } from '../src/sim/solver.js';
import { vec2Distance } from '../src/sim/vec.js';

const args = process.argv.slice(2);
const melodyMode = args.includes('--melody');
const [levelId, stepArg] = args.filter((a) => a !== '--melody');
const level = levelId ? getLevel(levelId) : undefined;
if (!level) {
  console.error(`Usage: npm run solve -- <levelId> [step] [--melody]  (unknown level: ${levelId ?? 'none'})`);
  process.exit(1);
}
const step = stepArg === undefined ? 0.1 : Number(stepArg);
if (!(step > 0)) {
  console.error(`Invalid step: ${stepArg}`);
  process.exit(1);
}

const start = startPlacements(level);
const t0 = performance.now();
const solutions = solveLevel(level, { step });
const runtimeMs = Math.round(performance.now() - t0);

const round3 = (n: number) => Math.round(n * 1000) / 1000;
const describe = (s: Solution) => ({
  placements: s.placements,
  neighborScore: s.neighborScore,
  moved: Object.fromEntries(
    Object.keys(s.placements).map((id) => [id, round3(vec2Distance(s.placements[id], start[id]))]),
  ),
  outcome: s.result.outcome,
  time: round3(s.result.time),
  pathHash: s.result.pathHash,
  flybys: s.result.flybys.map((f) => `${f.bodyId}@${round3(f.time)}s d=${round3(f.closestDistance)}`),
});

const report: Record<string, unknown> = {
  level: level.id,
  step,
  runtimeMs,
  zeroMovesSolves: solvesWithZeroMoves(level),
  robustSolutions: solutions.length,
};
if (melodyMode) {
  // Solutions arrive sorted best first, so the first one per sequence is its best.
  const groups = new Map<string, { count: number; best: Solution }>();
  for (const s of solutions) {
    const key = rungSequence(level, s.result.flybys).join(' ');
    const group = groups.get(key);
    if (group) group.count++;
    else groups.set(key, { count: 1, best: s });
  }
  report.storedSequence = rungSequence(level, simulate(level, level.solution).flybys);
  report.melody = level.melody ?? null;
  report.sequences = [...groups.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .map(([sequence, { count, best }]) => ({
      sequence: sequence ? sequence.split(' ') : [],
      count,
      best: describe(best),
    }));
} else {
  report.top = solutions.slice(0, 5).map(describe);
}
console.log(JSON.stringify(report, null, 2));
process.exit(solutions.length > 0 ? 0 : 1);
