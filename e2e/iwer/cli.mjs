// Drives the IWSDK CLI without a shell: PowerShell 5.1 mangles the embedded
// quotes of --input-json, so JSON is built with JSON.stringify straight into
// the argument array.
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const cliBin = path.join(root, 'node_modules', '@iwsdk', 'cli', 'bin', 'iwsdk.js');

/**
 * Runs `iwsdk <...args>` and returns the parsed JSON envelope ({ ok, data, ... }).
 * `input` becomes --input-json. Throws on a non-JSON reply unless json is false;
 * a non-zero exit with a JSON envelope is returned (ok false) for the caller to judge.
 */
export function run(args, { input, json = true, timeoutMs = 120_000 } = {}) {
  const argv = [cliBin, ...args];
  if (input !== undefined) argv.push('--input-json', JSON.stringify(input));
  let stdout;
  try {
    stdout = execFileSync(process.execPath, argv, {
      cwd: root,
      encoding: 'utf8',
      timeout: timeoutMs,
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    // Failed commands print their JSON envelope on stderr.
    stdout = String(error.stdout ?? '').trim() || String(error.stderr ?? '').trim();
    if (!json || !stdout.startsWith('{')) {
      throw new Error(`iwsdk ${args.join(' ')} failed: ${String(stdout || error.message).slice(0, 2000)}`);
    }
  }
  if (!json) return stdout;
  try {
    return JSON.parse(stdout);
  } catch {
    throw new Error(`iwsdk ${args.join(' ')} did not return JSON: ${stdout.slice(0, 2000)}`);
  }
}

/** Like run(), but throws unless the envelope says ok. Returns envelope.data. */
export function call(args, options) {
  const envelope = run(args, options);
  if (!envelope.ok) {
    throw new Error(`iwsdk ${args.join(' ')} -> ${JSON.stringify(envelope.error ?? envelope).slice(0, 2000)}`);
  }
  return envelope.data;
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
