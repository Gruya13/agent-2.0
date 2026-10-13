/**
 * Tanak, deterministički omotač oko `git`. Identitet se zadaje po pozivu kroz
 * `-c user.name=...`, tako da svaki commit nosi ime agenta koji ga je napravio —
 * Git dnevnik je time revizorski trag bez ikakve posebne infrastrukture.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export class GitError extends Error {
  constructor(message, result = {}) {
    super(message);
    this.name = 'GitError';
    this.code = 'GIT_ERROR';
    Object.assign(this, result);
  }
}

export function identityFor(actor) {
  const name = String(actor || 'agentctl').replace(/\s+/g, '-');
  return ['-c', `user.name=${name}`, '-c', `user.email=${name}@agent-2.0.local`];
}

export async function git(cwd, args, { actor = null, allowFailure = false, env = {}, maxBuffer = 8 * 1024 * 1024 } = {}) {
  const prefixed = actor ? [...identityFor(actor), ...args] : args;
  try {
    const { stdout, stderr } = await execFileAsync('git', ['-C', cwd, ...prefixed], {
      maxBuffer,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', ...env },
    });
    return { code: 0, stdout: stdout.trimEnd(), stderr: stderr.trimEnd() };
  } catch (error) {
    const result = {
      code: error.code ?? 1,
      stdout: String(error.stdout ?? '').trimEnd(),
      stderr: String(error.stderr ?? error.message).trimEnd(),
    };
    if (allowFailure) return result;
    throw new GitError(`git ${args.join(' ')} nije uspeo: ${result.stderr.split('\n')[0] || 'nepoznata greška'}`, result);
  }
}

export async function isGitRepo(dir) {
  try {
    const { stdout } = await git(dir, ['rev-parse', '--is-inside-work-tree']);
    return stdout === 'true';
  } catch {
    return false;
  }
}

export async function currentBranch(dir) {
  const { stdout } = await git(dir, ['rev-parse', '--abbrev-ref', 'HEAD']);
  return stdout;
}

export async function hasCommits(dir) {
  const result = await git(dir, ['rev-parse', '--verify', 'HEAD'], { allowFailure: true });
  return result.code === 0;
}

export async function statusPorcelain(dir) {
  const { stdout } = await git(dir, ['status', '--porcelain']);
  return stdout ? stdout.split('\n').filter(Boolean) : [];
}

/** Komituj sve izmene; `committed: false` kada nema šta da se komituje. */
export async function commitAll(dir, message, { actor = 'agentctl' } = {}) {
  const before = await statusPorcelain(dir);
  if (!before.length) return { committed: false, sha: null, files: [] };
  await git(dir, ['add', '-A'], { actor });
  const commit = await git(dir, ['commit', '-m', message], { actor, allowFailure: true });
  if (commit.code !== 0) {
    if (/nothing to commit|no changes added/i.test(`${commit.stdout}\n${commit.stderr}`)) {
      return { committed: false, sha: null, files: before };
    }
    throw new GitError(`git commit nije uspeo: ${commit.stderr || commit.stdout}`, commit);
  }
  const { stdout } = await git(dir, ['rev-parse', 'HEAD']);
  return { committed: true, sha: stdout, files: before };
}

/**
 * Komituj SAMO navedene putanje. Kontrolni sloj sme da komituje svoje
 * knjigovodstvo (`tasks/`, `wiki/`, manifest), ali ne i tuđe izmene u radnom
 * stablu — `git add -A` bez pathspec-a bi pojeo sve što se nađe.
 */
export async function commitPaths(dir, paths, message, { actor = 'agentctl' } = {}) {
  if (!paths.length) return { committed: false, sha: null, files: [] };
  await git(dir, ['add', '-A', '--', ...paths], { actor });
  const staged = await git(dir, ['diff', '--cached', '--name-only', '--', ...paths], { allowFailure: true });
  const files = staged.stdout ? staged.stdout.split('\n').filter(Boolean) : [];
  if (!files.length) return { committed: false, sha: null, files: [] };
  const commit = await git(dir, ['commit', '-m', message, '--', ...paths], { actor, allowFailure: true });
  if (commit.code !== 0) {
    if (/nothing to commit|no changes added/i.test(`${commit.stdout}\n${commit.stderr}`)) {
      return { committed: false, sha: null, files };
    }
    throw new GitError(`git commit nije uspeo: ${commit.stderr || commit.stdout}`, commit);
  }
  const { stdout } = await git(dir, ['rev-parse', 'HEAD']);
  return { committed: true, sha: stdout, files };
}

export async function headSha(dir, ref = 'HEAD') {
  const { stdout } = await git(dir, ['rev-parse', ref]);
  return stdout;
}

export async function log(dir, { limit = 20, format = '%h %an %s' } = {}) {
  const { stdout } = await git(dir, ['log', `--max-count=${limit}`, `--format=${format}`], { allowFailure: true });
  return stdout ? stdout.split('\n') : [];
}

export async function diffNameStatus(dir, ref, paths = []) {
  const { stdout } = await git(dir, ['diff', '--name-status', ref, '--', ...paths], { allowFailure: true });
  return stdout ? stdout.split('\n').filter(Boolean) : [];
}

export async function changedFilesInHead(dir) {
  const { stdout } = await git(dir, ['show', '--name-only', '--format=', 'HEAD'], { allowFailure: true });
  return stdout ? stdout.split('\n').filter(Boolean) : [];
}

export async function branchExists(dir, branch) {
  const result = await git(dir, ['rev-parse', '--verify', `refs/heads/${branch}`], { allowFailure: true });
  return result.code === 0;
}
