#!/usr/bin/env node
/**
 * demo.mjs — end-to-end demonstracija petofaznog toka.
 *
 * Podrazumevano radi u privremenom vault-u (ništa se ne menja u repozitorijumu):
 *
 *   node scripts/demo.mjs             # privremeni vault, deterministički mock harnesi
 *   node scripts/demo.mjs --in-place  # demo nad ovim repozitorijumom
 *   node scripts/demo.mjs --real      # pravi harnesi (agy/dsh/codex), troši kvotu
 *
 * Svrha: pokazati da izolacija (worktree), zakup (lease), automat stanja,
 * verifikacija od strane drugog harnesa i sekvencijalni merge zaista rade —
 * a ne samo da su opisani.
 */
import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { PACKAGE_ROOT, loadConfig } from '../tools/orchestrator/lib/config.mjs';
import { createStore } from '../tools/orchestrator/lib/store.mjs';
import { createPipeline } from '../tools/orchestrator/lib/pipeline.mjs';
import { lintVault } from '../tools/orchestrator/lib/lint.mjs';
import { listWorktrees } from '../tools/orchestrator/lib/worktree.mjs';
import { git } from '../tools/orchestrator/lib/git.mjs';
import { readJsonl } from '../tools/orchestrator/lib/fsx.mjs';

const args = new Set(process.argv.slice(2));
const IN_PLACE = args.has('--in-place');
const REAL = args.has('--real');

const execFileAsync = promisify(execFile);
const gitRun = (cwd, args) => execFileAsync('git', ['-C', cwd, ...args], { maxBuffer: 8 * 1024 * 1024 });

const IZVOR = [
  'Arhitektura crne table razdvaja domensko znanje od kontrolnog toka.',
  'Izvori znanja su heterogeni agenti koji se aktiviraju kada prepoznaju relevantno stanje na tabli.',
  'Kontrolni mehanizam raspodeljuje resurse, resava konflikte nadmetanja i verifikuje uslove prelaza.',
  'Git worktree izolacija garantuje da paralelni agenti ne mogu da pregaze tudji rad ni da pokvare radni direktorijum.',
  'Vremenski zakup sprecava trajno blokiranje resursa kada agent otkaze usred posla.',
  'Obsidian format dvostrukih zagrada gradi semanticki graf znanja izmedju koncepata.',
  'Indeks je izveden artefakt: kontrolni sloj ga regenerise iz stanja vault-a posle svakog spajanja.',
].join(' ');

const korak = (n, naslov) => console.log(`\n\x1b[1m${n}. ${naslov}\x1b[0m`);
const detalj = (text) => console.log(`   ${text}`);

async function pripremiVault() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agent2-demo-'));
  await fs.cp(path.join(PACKAGE_ROOT, 'tools'), path.join(root, 'tools'), { recursive: true });
  await fs.cp(path.join(PACKAGE_ROOT, '.agents'), path.join(root, '.agents'), { recursive: true });
  await fs.copyFile(path.join(PACKAGE_ROOT, 'package.json'), path.join(root, 'package.json'));
  await fs.copyFile(path.join(PACKAGE_ROOT, '.gitignore'), path.join(root, '.gitignore'));
  await fs.rm(path.join(root, '.agents', 'raw-manifest.json'), { force: true });
  for (const dir of ['raw', 'wiki/drafts', 'tasks/inbox', 'tasks/active', 'tasks/review', 'tasks/completed', 'tasks/reviews']) {
    await fs.mkdir(path.join(root, dir), { recursive: true });
  }
  await fs.writeFile(path.join(root, 'raw', 'dokument.md'), `${IZVOR}\n`, 'utf8');

  // Svađi vault mora biti Git repozitorijum: izolacija rada se oslanja na worktree.
  const identitet = ['-c', 'user.name=demo', '-c', 'user.email=demo@local'];
  await gitRun(root, ['init', '-q', '-b', 'main']);
  await gitRun(root, [...identitet, 'add', '-A']);
  await gitRun(root, [...identitet, 'commit', '-q', '-m', 'demo: početno stanje']);
  return root;
}

async function main() {
  let root = PACKAGE_ROOT;
  let privremen = false;
  if (!IN_PLACE) {
    root = await pripremiVault();
    privremen = true;
  }

  if (REAL) console.log('Pažnja: --real koristi prave harnese (agy, dsh, codex) i troši kvotu.');

  const config = await loadConfig(root);
  if (REAL) {
    for (const role of ['researcher', 'verifier', 'consolidator']) config.agents[role].adapter = 'harness';
  }
  const store = createStore(config);
  const pipeline = createPipeline(config, { store, logger: () => {} });

  console.log(`\x1b[1mAgent 2.0 — demonstracija\x1b[0m`);
  detalj(`vault: ${root}`);
  detalj(`adapteri: ${Object.entries(config.agents).map(([r, a]) => `${r}=${a.adapter === 'mock' ? 'mock' : a.harness}`).join(', ')}`);

  korak(1, 'Ingest — izvor ulazi u raw/, zadatak u tasks/inbox/');
  const task = await pipeline.ingest({
    source: 'raw/dokument.md',
    title: 'Crna tabla i izolacija rada',
    request: 'Izvuci ključne koncepte u enciklopedijsku belešku.',
    tags: ['arhitektura', 'agenti'],
  });
  detalj(`zadatak ${task.data.id}, status=${task.data.status}, faza=${task.phase}`);
  detalj(`dnevnik događaja: ${(await readJsonl(config.paths.events)).length} zapisa`);

  korak(2, 'Research — izolovano radno stablo, nacrt u wiki/drafts/');
  const research = await pipeline.runResearch(task.data.id);
  detalj(`worktree: ${path.relative(root, path.join(config.paths.worktrees, `${task.data.id}-researcher`))}, grana agent/researcher/${task.data.id}`);
  detalj(`nacrt: ${research.artifacts.join(', ')}`);
  detalj(`u main-u nacrt ${(await fs.access(path.join(root, research.artifacts[0])).then(() => 'POSTOJI (greška!)', () => 'ne postoji (ispravno)'))}`);

  korak(3, 'Verify — drugi harnes, sopstveno radno stablo nad granom istraživača');
  const verify = await pipeline.runVerify(task.data.id);
  detalj(`verdikt: ${verify.verdict}`);
  detalj(`revizorski trag: tasks/reviews/${task.data.id}.md`);

  korak(4, 'Consolidate — produkcija u wiki/, rebase na main, merge --no-ff');
  const consolidate = await pipeline.runConsolidate(task.data.id);
  detalj(`merge: ${consolidate.merge ? consolidate.merge.slice(0, 8) : '(nije prošao)'}`);

  korak(5, 'Reflect — izvedeni indeks i manifest izvora');
  const reflect = await pipeline.reflect();
  detalj(`belešaka u indeksu: ${reflect.notes}`);

  console.log('\n\x1b[1mStanje posle toka\x1b[0m');
  const finalTask = await store.get(task.data.id);
  detalj(`zadatak: status=${finalTask.data.status}, faza=${finalTask.phase}, artefakti=${finalTask.data.artifacts.join(', ')}`);
  const notes = (await fs.readdir(path.join(root, 'wiki'))).filter((f) => f.endsWith('.md'));
  detalj(`wiki/: ${notes.join(', ')}`);
  detalj(`tasks/completed/: ${(await fs.readdir(path.join(root, 'tasks', 'completed'))).join(', ') || '(prazno)'}`);
  detalj(`radna stabla: ${(await listWorktrees(config)).length - 1} zadatkom dodeljenih (očekivano 0)`);
  const lint = await lintVault(config);
  detalj(`lint: ${lint.errors.length} grešaka, ${lint.warnings.length} upozorenja`);
  const events = await readJsonl(config.paths.events);
  detalj(`događaji: ${events.length} (vrste: ${[...new Set(events.map((e) => e.kind))].sort().join(', ')})`);

  console.log('\n\x1b[1mGit revizorski trag (autor | poruka)\x1b[0m');
  const history = await git(root, ['log', '--graph', '--format=%an | %s', '--max-count=12']);
  console.log(history.stdout.split('\n').map((l) => `   ${l}`).join('\n'));

  console.log('\n\x1b[1mwiki/Index.md (izveden)\x1b[0m');
  const index = await fs.readFile(path.join(root, 'wiki', 'Index.md'), 'utf8');
  console.log(index.split('\n').slice(0, 16).map((l) => `   ${l}`).join('\n'));

  if (privremen) {
    await fs.rm(root, { recursive: true, force: true });
    console.log('\nPrivremeni vault je obrisan.');
  }
  console.log('\n\x1b[1mDemo završen.\x1b[0m Ceo test set: node --test tests/');
}

main().catch((error) => {
  console.error(`demo: ${error.message}`);
  if (process.env.DEBUG) console.error(error.stack);
  process.exitCode = 1;
});
