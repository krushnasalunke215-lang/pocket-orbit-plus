/**
 * Level authoring helper: prints the best robust solutions of a level.
 *
 *   npm run solve -- <levelId> [step]
 *
 * Exits 1 when the level is unknown or has no robust solution.
 */
import { getLevel } from '../src/sim/levels/index.js';
import { startPlacements } from '../src/sim/level.js';
import { solveLevel, solvesWithZeroMoves } from '../src/sim/solver.js';
import { vec2Distance } from '../src/sim/vec.js';

const [levelId, stepArg] = process.argv.slice(2);
const level = levelId ? getLevel(levelId) : undefined;
if (!level) {
  console.error(`Usage: npm run solve -- <levelId> [step]  (unknown level: ${levelId ?? 'none'})`);
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
console.log(
  JSON.stringify(
    {
      level: level.id,
      step,
      runtimeMs,
      zeroMovesSolves: solvesWithZeroMoves(level),
      robustSolutions: solutions.length,
      top: solutions.slice(0, 5).map((s) => ({
        placements: s.placements,
        neighborScore: s.neighborScore,
        moved: Object.fromEntries(
          Object.keys(s.placements).map((id) => [id, round3(vec2Distance(s.placements[id], start[id]))]),
        ),
        outcome: s.result.outcome,
        time: round3(s.result.time),
        pathHash: s.result.pathHash,
        flybys: s.result.flybys.map((f) => `${f.bodyId}@${round3(f.time)}s d=${round3(f.closestDistance)}`),
      })),
    },
    null,
    2,
  ),
);
process.exit(solutions.length > 0 ? 0 : 1);
