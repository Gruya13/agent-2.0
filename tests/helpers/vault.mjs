/**
 * Pomoćnik za testove: napravi privremeni vault sa kompletnim alatom.
 *
 * Testovi nikad ne rade nad pravim repozitorijumom: svaki dobija svoj
 * `mkdtemp` koren, pa je paralelno izvršavanje bezbedno.
 */
import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { PACKAGE_ROOT } from '../../tools/orchestrator/lib/config.mjs';

const execFileAsync = promisify(execFile);

export async function gitExec(cwd, args) {
  const { stdout, stderr } = await execFileAsync('git', ['-C', cwd, ...args], { maxBuffer: 8 * 1024 * 1024 });
  return { stdout: stdout.trimEnd(), stderr: stderr.trimEnd() };
}

export const RAW_DOCUMENT = [
  'Asinhroni multi-agentski sistemi zamenjuju efemernu razmenu poruka trajnim zapisom.',
  'Crna tabla cuva stanje problema, hipoteze i parcijalne rezultate na jednom mestu.',
  'Izvori znanja su heterogeni agenti koji se aktiviraju kada prepoznaju relevantno stanje.',
  'Kontrolni mehanizam raspodeljuje resurse i verifikuje uslove prelaza izmedju faza.',
  'Git worktree izolacija garantuje da paralelni agenti ne mogu da pregaze tudji rad.',
  'Vremenski zakup sprecava trajno blokiranje resursa kada agent otkaze usred posla.',
  'Obsidian format dvostrukih zagrada gradi semanticki graf izmedju koncepata.',
].join(' ');

/** Napravi izolovan vault spreman za `agentctl`. */
export async function makeVault({ documents = { 'dokument.md': RAW_DOCUMENT }, initGit = true } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agent2-vault-'));

  await fs.cp(path.join(PACKAGE_ROOT, 'tools'), path.join(root, 'tools'), { recursive: true });
  await fs.cp(path.join(PACKAGE_ROOT, '.agents'), path.join(root, '.agents'), { recursive: true });
  await fs.copyFile(path.join(PACKAGE_ROOT, 'package.json'), path.join(root, 'package.json'));
  await fs.copyFile(path.join(PACKAGE_ROOT, '.gitignore'), path.join(root, '.gitignore'));
  // Fixture vault počinje bez manifesta izvora: on pripada konkretnom vault-u.
  await fs.rm(path.join(root, '.agents', 'raw-manifest.json'), { force: true });

  await fs.mkdir(path.join(root, 'raw'), { recursive: true });
  for (const dir of ['wiki/drafts', 'tasks/inbox', 'tasks/active', 'tasks/review', 'tasks/completed', 'tasks/reviews']) {
    await fs.mkdir(path.join(root, dir), { recursive: true });
  }
  for (const [name, content] of Object.entries(documents)) {
    await fs.writeFile(path.join(root, 'raw', name), content, 'utf8');
  }

  if (initGit) {
    await gitExec(root, ['init', '-q', '-b', 'main']);
    await gitExec(root, ['-c', 'user.name=fixture', '-c', 'user.email=fixture@local', 'add', '-A']);
    await gitExec(root, ['-c', 'user.name=fixture', '-c', 'user.email=fixture@local', 'commit', '-q', '-m', 'fixture: pocetno stanje']);
  }

  return {
    root,
    path: (...parts) => path.join(root, ...parts),
    async read(rel) {
      return fs.readFile(path.join(root, rel), 'utf8');
    },
    async write(rel, content) {
      const full = path.join(root, rel);
      await fs.mkdir(path.dirname(full), { recursive: true });
      await fs.writeFile(full, content, 'utf8');
    },
    async exists(rel) {
      try {
        await fs.access(path.join(root, rel));
        return true;
      } catch {
        return false;
      }
    },
    /** Ukloni privremeni vault; toleriše otvorene worktree-e. */
    async cleanup() {
      // Git ume da drži `.git/objects/pack` u trenutku brisanja; par pokušaja
      // sprečava da čišćenje obori test koji je inače prošao.
      await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    },
  };
}

/** Pokreni CLI ovog repozitorijuma nad datim vault-om. */
export async function runCli(vaultRoot, args, { env = {} } = {}) {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [
      path.join(PACKAGE_ROOT, 'tools', 'orchestrator', 'cli.mjs'),
      ...args, '--vault', vaultRoot,
    ], {
      cwd: PACKAGE_ROOT,
      env: { ...process.env, ...env },
      maxBuffer: 8 * 1024 * 1024,
    });
    return { code: 0, stdout, stderr };
  } catch (error) {
    return { code: error.code ?? 1, stdout: error.stdout ?? '', stderr: error.stderr ?? String(error.message) };
  }
}
