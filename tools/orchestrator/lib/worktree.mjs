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
export async function mergeIntoMain(config, { branch, message, actor = 'agentctl', worktreeDir = null, generatedPaths = [] } = {}) {
  const worktrees = await listWorktrees(config);
  const primary = worktrees.find((w) => path.resolve(w.path) === path.resolve(config.root));
  const current = await currentBranch(config.root);
  if (current !== MAIN_BRANCH) {
    return { merged: false, reason: `glavno radno stablo je na grani "${current}", ne "${MAIN_BRANCH}"` };
  }
  if (!primary) {
    return { merged: false, reason: 'glavni repozitorijum nije registrovan kao radno stablo' };
  }

  // 0. Grana sme da menja SAMO zone znanja. Bez ove kapije bi agent koji piše
  //    fajl-sistemom (mimo MCP-a) mogao da ubaci `raw/`, `tools/` ili `.agents/`
  //    u `main` — dokazano reprodukcionim skriptom u protnoj rundi.
  const dozvoljeneZone = ['wiki/', 'tasks/reviews/', 'tasks/audits/', 'tasks/challenges/'];
  const izmene = await branchChangedPaths(config, branch);
  const vanZone = izmene.filter((f) => !dozvoljeneZone.some((z) => f.startsWith(z)));
  if (vanZone.length) {
    return {
      merged: false,
      outOfZone: vanZone,
      reason: `grana menja zone van dozvole: ${vanZone.join(', ')}`,
    };
  }

  // 1. Knjigovodstvo crne table u main mora biti komitovano pre spajanja.
  const dirty = await statusPorcelain(config.root);
  if (dirty.length) {
    await commitPaths(config.root, ['tasks', 'wiki', '.agents/raw-manifest.json', 'raw'], `agentctl: knjigovodstvo pre merge-a ${branch}`, { actor: 'agentctl' });
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

  // 2. Grana se poravnava sa aktuelnim main-om (bez ovoga nosi zastarelo stanje
  //    crne table i Git odbija merge).
  if (worktreeDir) {
    // Izvedeni artefakti se neutrališu PRE rebase-a (inace rebase pukne na
    // konfliktu tipa add/add), pa tek onda ide rebase na aktuelni main.
    if (generatedPaths.length) await alignGeneratedPaths(config, worktreeDir, generatedPaths);
    const rebase = await rebaseBranchOntoMain(config, { branch, worktreeDir });
    if (!rebase.rebased) {
      return { merged: false, conflict: Boolean(rebase.conflict), branch, files: rebase.files ?? [], reason: rebase.reason };
    }
  }

  // 3. Eksplicitan merge commit: konsolidacija mora biti vidljiva u istoriji.
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
    conflict: conflicted.length > 0,
    branch,
    files: conflicted,
    reason: conflicted.length
      ? `tekstualni konflikt u: ${conflicted.join(', ')}`
      : result.stderr.split('\n').filter(Boolean).slice(0, 3).join(' ') || 'merge nije uspeo',
    detail: result.stderr,
  };
}

/**
 * Poslednja linija odbrane: i pored zakupa, proveri da su izmene na grani
 * zaista iz agentske zone pre nego što uđu u `main`.
 */
/**
 * Fajlovi koje je agent izmenio u svom radnom stablu, prema bazi grane.
 *
 * Obuhvata TRI izvora, jer svaki sam za sebe nešto propušta:
 *   - `git diff base` — izmene praćenih fajlova,
 *   - `git status --porcelain` — NEpraćene (novi izveštaj, novi fajl),
 *   - `git diff base HEAD` — slučaj kada je agent sam komitovao svoj rad.
 * Koristi se pre commit-a, npr. da se proveri da revizija nije izašla iz opsega.
 */
export async function changedFilesInWorktree(worktreeDir, base = MAIN_BRANCH) {
  const skup = new Set();
  const dodaj = (text) => {
    for (const line of String(text ?? '').split('\n')) {
      if (!line.trim()) continue;
      let rel = line.slice(3).trim();
      if (rel.includes(' -> ')) rel = rel.split(' -> ').pop();
      skup.add(rel.replace(/^"|"$/g, ''));
    }
  };

  const radni = await git(worktreeDir, ['diff', '--name-only', '--no-renames', base], { allowFailure: true });
  for (const rel of radni.stdout ? radni.stdout.split('\n') : []) if (rel) skup.add(rel);

  // `-uall`: bez toga git sažima nepraćene direktorijume ("tasks/audits/"), pa se
  // fajl unutra ne vidi i opseg se ne može proveriti po putanji.
  const status = await git(worktreeDir, ['status', '--porcelain', '--no-renames', '--untracked-files=all'], { allowFailure: true });
  dodaj(status.stdout);

  const komitovano = await git(worktreeDir, ['diff', '--name-only', '--no-renames', base, 'HEAD'], { allowFailure: true });
  for (const rel of komitovano.stdout ? komitovano.stdout.split('\n') : []) if (rel) skup.add(rel);

  return [...skup].sort();
}

/**
 * Sve putanje koje grana menja, uključujući OBE strane rename-a.
 *
 * `--no-renames` je obavezan: bez njega `git diff --name-only` za `git mv
 * tools/x wiki/x` prijavi samo odredište, pa kapija zona ne vidi da je izvor
 * iz zabranjene zone obrisan. Dokazano reprodukcionim skriptom red-teama.
 */
export async function branchChangedPaths(config, branch, base = MAIN_BRANCH) {
  const { stdout } = await git(config.root, ['diff', '--name-only', '--no-renames', `${base}...${branch}`], { allowFailure: true });
  return stdout ? stdout.split('\n').filter(Boolean) : [];
}

/**
 * Rebase agentske grane na `main` pre spajanja.
 *
 * Bez ovoga grana nosi i zastarelo stanje crne table (`tasks/`), jer je
 * nastala u trenutku kada je zadatak bio u drugoj fazi. Pri merge-u bi Git
 * pokušao da vrati stari raspored zadataka i oborio merge ("local changes
 * would be overwritten"). Rebase zadržava autorstvo komita, a kontrolnom sloju
 * daje aktuelno stanje kao osnovu.
 */
export async function rebaseBranchOntoMain(config, { branch, worktreeDir, base = MAIN_BRANCH } = {}) {
  if (!worktreeDir || !(await exists(worktreeDir))) {
    return { rebased: false, reason: `radno stablo za granu ${branch} ne postoji` };
  }
  const dirty = await statusPorcelain(worktreeDir);
  if (dirty.length) {
    return { rebased: false, reason: `radno stablo grane ${branch} je prljavo: ${dirty.slice(0, 3).join(', ')}` };
  }
  const result = await git(worktreeDir, ['rebase', base], { actor: 'agentctl', allowFailure: true });
  if (result.code === 0) return { rebased: true, branch };

  const conflicted = (await git(worktreeDir, ['diff', '--name-only', '--diff-filter=U'], { allowFailure: true })).stdout
    .split('\n').filter(Boolean);
  await git(worktreeDir, ['rebase', '--abort'], { actor: 'agentctl', allowFailure: true });
  return {
    rebased: false,
    conflict: true,
    files: conflicted,
    reason: `rebase na ${base} nije prošao${conflicted.length ? `: ${conflicted.join(', ')}` : ''}`,
  };
}

/**
 * Izvedeni artefakti (npr. `wiki/Index.md`) se ne merge-uju kao sadržaj: svaka
 * grana ih menja na svoj način, pa svaki paralelni rad pravi konflikt — ili,
 * još gore, konflikt tipa "dodato na obe strane" kada `main` već ima generisan
 * indeks, a grana ga tek dodaje.
 *
 * Zato se u radnom stablu pre rebase-a svedu na tačno ono što `main` ima:
 * preuzmu se ako postoje, a uklone ako ih `main` nema. Kontrolni sloj ih posle
 * merge-a regeneriše iz stanja vault-a (faza 5).
 */
export async function alignGeneratedPaths(config, worktreeDir, paths, { base = MAIN_BRANCH, actor = 'agentctl' } = {}) {
  if (!paths.length || !(await exists(worktreeDir))) return { aligned: [] };
  const changed = (await git(worktreeDir, ['diff', '--name-only', '--no-renames', base, '--', ...paths], { allowFailure: true })).stdout
    .split('\n').filter(Boolean);
  if (!changed.length) return { aligned: [] };

  for (const rel of paths) {
    const inBase = await git(config.root, ['cat-file', '-e', `${base}:${rel}`], { allowFailure: true });
    if (inBase.code === 0) {
      await git(worktreeDir, ['checkout', base, '--', rel], { actor, allowFailure: true });
    } else {
      // `main` ga nema: grana ga ne sme doneti kroz merge.
      await git(worktreeDir, ['rm', '-f', '--ignore-unmatch', '--', rel], { actor, allowFailure: true });
      await fs.rm(path.join(worktreeDir, rel), { force: true });
    }
  }
  const commit = await commitPaths(worktreeDir, paths, `agentctl: izvedeni artefakti poravnati sa ${base}`, { actor });
  return { aligned: changed, commit };
}

export async function pruneWorktrees(config) {
  await git(config.root, ['worktree', 'prune'], { actor: 'agentctl', allowFailure: true });
}
