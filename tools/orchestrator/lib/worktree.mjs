/**
 * Fizička izolacija rada: svaki agent dobija sopstveno `git worktree` i granu.
 * Deljena je samo baza objekata u `.git`, pa izmene jednog agenta ne mogu da
 * pokvare radni direktorijum drugog.
 */
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { branchExists, commitAll, commitPaths, currentBranch, git, hasCommits, headSha, statusPorcelain } from './git.mjs';
import { exists } from './fsx.mjs';

export const MAIN_BRANCH = 'main';

/**
 * Putanja je po (zadatak, uloga): verifikator mora da vidi nacrt istraživača,
 * ali ne sme da deli isti direktorijum sa njim — dva worktree-a ne mogu da
 * zauzimaju istu putanju.
 */
export function worktreePath(config, id, role = null) {
  return path.join(config.paths.worktrees, role ? `${id}-${role}` : id);
}

/** Sva radna stabla dodeljena jednom zadatku (bilo kojoj ulozi). */
export async function worktreesForTask(config, id) {
  const prefix = `${id}-`;
  const all = await listWorktrees(config);
  return all.filter((entry) => {
    const name = path.basename(entry.path);
    return name === id || name.startsWith(prefix);
  });
}

export function branchName(config, role, id) {
  return `${config.worktree.branchPrefix}/${role}/${id}`;
}

export async function listWorktrees(config) {
  const { stdout } = await git(config.root, ['worktree', 'list', '--porcelain']);
  const entries = [];
  let current = null;
  for (const line of stdout.split('\n')) {
    if (!line.trim()) {
      if (current) entries.push(current);
      current = null;
      continue;
    }
    const index = line.indexOf(' ');
    const key = index === -1 ? line : line.slice(0, index);
    const value = index === -1 ? '' : line.slice(index + 1);
    if (key === 'worktree') {
      if (current) entries.push(current);
      current = { path: value };
      continue;
    }
    if (!current) continue;
    if (key === 'HEAD') current.head = value;
    else if (key === 'branch') current.branch = value.replace('refs/heads/', '');
    else if (key === 'detached') current.detached = true;
    else if (key === 'bare') current.bare = true;
  }
  if (current) entries.push(current);
  return entries;
}

/**
 * Osiguraj da glavna grana postoji (svež `git init` nema ni jedan commit).
 * Bez ovoga `git worktree add` nema od čega da se odvoji.
 */
export async function ensureMainBranch(config) {
  if (await hasCommits(config.root)) {
    const branch = await currentBranch(config.root);
    return { branch, created: false };
  }
  await git(config.root, ['checkout', '-B', MAIN_BRANCH], { actor: 'agentctl' });
  await git(config.root, ['commit', '--allow-empty', '-m', 'agentctl: inicijalizacija crne table'], { actor: 'agentctl' });
  return { branch: MAIN_BRANCH, created: true };
}

/**
 * Napravi (ili ponovo otvori) izolovano radno stablo za zadatak i ulogu.
 * Ponovni poziv je idempotentan: postojeće stablo sa odgovarajućom granom se
 * vraća bez novog `git worktree add`.
 */
export async function createWorktree(config, { id, role, base = MAIN_BRANCH } = {}) {
  const dir = worktreePath(config, id, role);
  const branch = branchName(config, role, id);
  const worktrees = await listWorktrees(config);
  const existing = worktrees.find((w) => path.resolve(w.path) === path.resolve(dir));
  if (existing) {
    const branchRef = (existing.branch ?? '').replace('refs/heads/', '');
    if (branchRef && branchRef !== branch) {
      throw new Error(`radno stablo ${dir} postoji na grani "${branchRef}", očekivana je "${branch}"`);
    }
    return { path: dir, branch: branchRef || branch, reused: true };
  }

  await fs.mkdir(config.paths.worktrees, { recursive: true });
  const attachExisting = await branchExists(config.root, branch);
  const args = attachExisting
    ? ['worktree', 'add', dir, branch]
    : ['worktree', 'add', '-b', branch, dir, base];
  await git(config.root, args, { actor: 'agentctl' });
  return { path: dir, branch, reused: false };
}

/** Ukloni radno stablo. Grana ostaje — nju briše `deleteBranch` posle merge-a. */
export async function removeWorktree(config, id, { role = null, force = true } = {}) {
  const dir = worktreePath(config, id, role);
  if (!(await exists(dir))) return { removed: false, reason: 'ne postoji' };
  const args = ['worktree', 'remove', ...(force ? ['--force'] : []), dir];
  const result = await git(config.root, args, { actor: 'agentctl', allowFailure: true });
  if (result.code !== 0) {
    await fs.rm(dir, { recursive: true, force: true });
    await git(config.root, ['worktree', 'prune'], { actor: 'agentctl', allowFailure: true });
    return { removed: true, forced: true, note: result.stderr.split('\n')[0] };
  }
  return { removed: true };
}

/** Ukloni sva radna stabla jednog zadatka (sve uloge) i očisti registar. */
export async function removeWorktreesForTask(config, id) {
  const entries = await worktreesForTask(config, id);
  const removed = [];
  for (const entry of entries) {
    const result = await git(config.root, ['worktree', 'remove', '--force', entry.path], { actor: 'agentctl', allowFailure: true });
    if (result.code !== 0) await fs.rm(entry.path, { recursive: true, force: true });
    removed.push(entry.path);
  }
  await git(config.root, ['worktree', 'prune'], { actor: 'agentctl', allowFailure: true });
  return removed;
}

export async function deleteBranch(config, branch) {
  const result = await git(config.root, ['branch', '-D', branch], { actor: 'agentctl', allowFailure: true });
  return { deleted: result.code === 0, stderr: result.stderr };
}

/** Komituj rad u izolovanom stablu pod imenom agenta koji je radio. */
export async function commitWorktree(config, id, message, { actor, role = null } = {}) {
  const dir = worktreePath(config, id, role);
  if (!(await exists(dir))) return { committed: false, sha: null, files: [], reason: 'radno stablo ne postoji' };
  return commitAll(dir, message, { actor: actor ?? 'agent' });
}

/**
 * Sekvencijalni merge u `main`. Uvek se izvodi iz glavnog radnog stabla, nikad
 * iz agentskog, i nikad sa prljavim stanjem — kontrolni sloj prvo komituje svoje
 * knjigovodstvo.
 */
export async function mergeIntoMain(config, { branch, message, actor = 'agentctl' } = {}) {
  const worktrees = await listWorktrees(config);
  const primary = worktrees.find((w) => path.resolve(w.path) === path.resolve(config.root));
  const current = await currentBranch(config.root);
  if (current !== MAIN_BRANCH) {
    return { merged: false, reason: `glavno radno stablo je na grani "${current}", ne "${MAIN_BRANCH}"` };
  }
  if (!primary) {
    return { merged: false, reason: 'glavni repozitorijum nije registrovan kao radno stablo' };
  }

  const dirty = await statusPorcelain(config.root);
  if (dirty.length) {
    // Knjigovodstvo crne table se komituje pre merge-a; ostale izmene se ne diraju.
    await commitPaths(config.root, ['tasks', 'wiki', '.agents/raw-manifest.json'], `agentctl: knjigovodstvo pre merge-a ${branch}`, { actor: 'agentctl' });
    const stillDirty = await statusPorcelain(config.root);
    if (stillDirty.length) {
      const changed = await branchChangedPaths(config, branch);
      const overlap = stillDirty
        .map((line) => line.slice(3).trim())
        .filter((file) => changed.includes(file));
      if (overlap.length) {
        return { merged: false, reason: `radno stablo je prljavo u fajlovima koje grana menja: ${overlap.join(', ')}` };
      }
    }
  }

  const result = await git(config.root, ['merge', '--no-ff', '--no-edit', '-m', message, branch], {
    actor,
    allowFailure: true,
  });
  if (result.code === 0) {
    const sha = await headSha(config.root);
    return { merged: true, sha, branch, output: result.stdout };
  }

  const conflicted = (await git(config.root, ['diff', '--name-only', '--diff-filter=U'], { allowFailure: true })).stdout
    .split('\n').filter(Boolean);
  await git(config.root, ['merge', '--abort'], { actor: 'agentctl', allowFailure: true });
  return {
    merged: false,
    conflict: true,
    branch,
    files: conflicted,
    reason: conflicted.length
      ? `tekstualni konflikt u: ${conflicted.join(', ')}`
      : result.stderr.split('\n')[0] || 'merge nije uspeo',
  };
}

/**
 * Poslednja linija odbrane: i pored zakupa, proveri da su izmene na grani
 * zaista iz agentske zone pre nego što uđu u `main`.
 */
export async function branchChangedPaths(config, branch, base = MAIN_BRANCH) {
  const { stdout } = await git(config.root, ['diff', '--name-only', `${base}...${branch}`], { allowFailure: true });
  return stdout ? stdout.split('\n').filter(Boolean) : [];
}

/**
 * Izvedeni artefakti (npr. `wiki/Index.md`) se ne merge-uju kao sadržaj: svaka
 * grana ih menja na svoj način, pa bi svaki paralelni rad pravio tekstualni
 * konflikt. Zato se pre merge-a u radnom stablu poravnaju sa `main`, a
 * kontrolni sloj ih posle merge-a regeneriše iz stanja vault-a.
 */
export async function alignGeneratedPaths(config, worktreeDir, paths, { base = MAIN_BRANCH, actor = 'agentctl' } = {}) {
  if (!paths.length) return { aligned: [] };
  const before = await git(worktreeDir, ['diff', '--name-only', base, '--', ...paths], { allowFailure: true });
  if (!before.stdout) return { aligned: [] };
  await git(worktreeDir, ['checkout', base, '--', ...paths], { actor, allowFailure: true });
  const commit = await commitPaths(worktreeDir, paths, `agentctl: izvedeni artefakti poravnati sa ${base} pre merge-a`, { actor });
  return { aligned: before.stdout.split('\n').filter(Boolean), commit };
}

export async function pruneWorktrees(config) {
  await git(config.root, ['worktree', 'prune'], { actor: 'agentctl', allowFailure: true });
}
