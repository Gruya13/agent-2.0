import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { makeVault, gitExec } from './helpers/vault.mjs';
import { loadConfig } from '../tools/orchestrator/lib/config.mjs';
import { createStore } from '../tools/orchestrator/lib/store.mjs';
import { createPipeline } from '../tools/orchestrator/lib/pipeline.mjs';
import { lintVault } from '../tools/orchestrator/lib/lint.mjs';
import { listWorktrees } from '../tools/orchestrator/lib/worktree.mjs';
import { log as gitLog } from '../tools/orchestrator/lib/git.mjs';
import { listNotes } from '../tools/orchestrator/lib/vault.mjs';
import { readJsonl, sha256 } from '../tools/orchestrator/lib/fsx.mjs';

async function setup(options = {}) {
  const vault = await makeVault();
  const config = await loadConfig(vault.root);
  const store = createStore(config);
  const pipeline = createPipeline(config, { store, ...options });
  return { vault, config, store, pipeline };
}

test('E2E: izvor -> nacrt -> verifikacija -> konsolidacija u main', async () => {
  const { vault, config, store, pipeline } = await setup();
  const rawBefore = sha256(await vault.read('raw/dokument.md'));

  // Faza 1 — unos.
  const ingested = await pipeline.ingest({
    source: 'raw/dokument.md',
    title: 'Crna tabla i izolacija rada',
    request: 'Izvuci kljucne koncepte u enciklopedijsku belesku.',
    tags: ['arhitektura'],
  });
  assert.equal(ingested.data.id, 'TASK-101');
  assert.equal(ingested.data.status, 'ready');
  assert.equal(ingested.phase, 'inbox');
  assert.equal(ingested.data.source, 'raw/dokument.md');
  // Izvor mora biti komitovan: bez toga ga sveže radno stablo ne vidi, a
  // verifikator prijavljuje `raw.deleted` (nalaz N1 iz prave verifikacije).
  const tracked = await gitExec(vault.root, ['ls-tree', '-r', '--name-only', 'HEAD', '--', 'raw']);
  assert.ok(tracked.stdout.split('\n').includes('raw/dokument.md'), 'izvor nije u Gitu posle ingest-a');

  // Faza 2 — istraživanje u izolaciji: main NE sme da vidi nacrt.
  const research = await pipeline.runResearch('TASK-101');
  assert.equal(research.ok, true);
  assert.equal(research.artifacts.length, 1);
  assert.match(research.artifacts[0], /^wiki\/drafts\/.+\.md$/);
  assert.equal(await vault.exists(research.artifacts[0]), false, 'nacrt ne ulazi u main pre verifikacije');
  let task = await store.get('TASK-101');
  assert.equal(task.data.status, 'review');
  assert.equal(task.data.lock_owner, null, 'zakup se oslobađa posle faze');
  assert.equal(task.phase, 'review');

  // Faza 3 — verifikacija od strane drugog harnesa, nad granom istraživača.
  const verify = await pipeline.runVerify('TASK-101');
  assert.equal(verify.ok, true);
  assert.equal(verify.verdict, 'pass');
  task = await store.get('TASK-101');
  assert.equal(task.data.status, 'verified');
  assert.equal(task.data.verification.verdict, 'pass');
  assert.equal(await vault.exists('tasks/reviews/TASK-101.md'), false, 'revizija je i dalje samo na grani');

  // Faza 4 — konsolidacija: produkciona beleška ulazi u main kroz merge.
  const consolidate = await pipeline.runConsolidate('TASK-101');
  assert.equal(consolidate.ok, true, consolidate.reason);
  task = await store.get('TASK-101');
  assert.equal(task.data.status, 'consolidated');
  assert.equal(task.phase, 'completed');
  assert.equal(await vault.exists('tasks/completed/TASK-101.md'), true);
  assert.deepEqual(task.data.artifacts, ['wiki/Crna_tabla_i_izolacija_rada.md'], 'artefakti pokazuju na produkciju, ne na obrisani nacrt');

  const production = (await listNotes(vault.root, ['wiki'])).filter((n) => !n.includes('/drafts/') && n !== 'wiki/Index.md');
  assert.equal(production.length, 1);
  const noteText = await vault.read(production[0]);
  assert.match(noteText, /status: consolidated/);
  assert.match(noteText, /authors:/);
  assert.match(noteText, /- consolidator/);

  // Nacrt je premešten, ne kopiran.
  assert.equal(await vault.exists(research.artifacts[0]), false);
  assert.deepEqual(await listNotes(vault.root, ['wiki/drafts']), []);

  // Faza 5 — refleksija: indeks i manifest.
  const reflect = await pipeline.reflect();
  assert.equal(reflect.ok, true);
  const index = await vault.read('wiki/Index.md');
  assert.match(index, /## Beleške \(1\)/);
  assert.match(index, /\[\[Crna_tabla_i_izolacija_rada\]\]/);

  // Invarijante: raw nepromenjen, repozitorijum čist za knjigovodstvo, lint čist.
  assert.equal(sha256(await vault.read('raw/dokument.md')), rawBefore, 'raw/ je nepromenljiv');
  const lint = await lintVault(config);
  assert.equal(lint.errors.length, 0, lint.errors.map((e) => `${e.code} ${e.target}`).join('; '));

  // Revizorski trag: svaki doprinos nosi ime svog agenta.
  const history = await gitLog(config.root, { limit: 30, format: '%an|%s' });
  const authors = new Set(history.map((l) => l.split('|')[0]));
  for (const expected of ['researcher', 'verifier', 'consolidator', 'agentctl']) {
    assert.ok(authors.has(expected), `git istorija mora da sadrži autora "${expected}" (${[...authors].join(',')})`);
  }
  assert.ok(history.some((l) => l.includes('researcher(TASK-101)')));

  // Radna stabla i grane su počišćeni.
  const worktrees = await listWorktrees(config);
  assert.equal(worktrees.length, 1);
  const { stdout: branches } = await gitExec(config.root, ['branch', '--list', 'agent/*']);
  assert.equal(branches.trim(), '');

  // Dnevnik događaja sadrži sve faze.
  const events = await readJsonl(config.paths.events);
  for (const kind of ['task.ingested', 'phase.start', 'phase.done', 'task.write']) {
    assert.ok(events.some((e) => e.kind === kind), `nema događaja "${kind}"`);
  }
  assert.ok(events.some((e) => e.kind === 'phase.done' && e.phase === 'research'));
  assert.ok(events.some((e) => e.kind === 'phase.done' && e.phase === 'consolidate'));
  await vault.cleanup();
});

test('E2E: kontrolna petlja run() dovršava zadatak bez ručnih koraka', async () => {
  const { vault, pipeline, store, config } = await setup();
  await pipeline.ingest({ source: 'raw/dokument.md', title: 'Automatski tok' });
  const rounds = await pipeline.run({ rounds: 6 });
  const task = await store.get('TASK-101');
  assert.equal(task.data.status, 'consolidated');
  assert.ok(rounds.length >= 3);
  assert.ok(rounds.some((r) => r.actions.some((a) => a.phase === 'verify' && a.ok)));
  assert.equal((await lintVault(config)).errors.length, 0);
  await vault.cleanup();
});

test('E2E: odbijen nacrt se vraća istraživaču, pa na kraju blokira zadatak', async () => {
  const { vault, config, store, pipeline } = await setup({ maxRevisions: 1 });
  await pipeline.ingest({ source: 'raw/dokument.md', title: 'Odbijen nacrt' });
  process.env.AGENT_2_0_MOCK_VERDICT = 'fail';
  try {
    await pipeline.runResearch('TASK-101');
    const verify = await pipeline.runVerify('TASK-101');
    assert.equal(verify.ok, false);
    assert.equal(verify.verdict, 'fail');
    let task = await store.get('TASK-101');
    assert.equal(task.data.status, 'ready', 'odbijen nacrt se vraća u opticaj');
    assert.notEqual(task.data.status, 'consolidated');

    await pipeline.runResearch('TASK-101');
    const second = await pipeline.runVerify('TASK-101');
    assert.equal(second.ok, false);
    assert.equal(second.blocked, true);
    task = await store.get('TASK-101');
    assert.equal(task.data.status, 'blocked');
    assert.match(task.data.blocked_reason, /odbijen \d+ puta/i);
    // Zadržan zadatak i dalje mora da poštuje šemu i fazu.
    assert.equal((await lintVault(config)).errors.length, 0);
  } finally {
    delete process.env.AGENT_2_0_MOCK_VERDICT;
    await vault.cleanup();
  }
});

test('E2E: konsolidator sa izlaznim kodom 0 ali bez beleške ne ulazi u main', async () => {
  const { vault, config, store, pipeline } = await setup();
  await pipeline.ingest({ source: 'raw/dokument.md', title: 'Prazna konsolidacija' });
  await pipeline.runResearch('TASK-101');
  await pipeline.runVerify('TASK-101');
  assert.equal((await store.get('TASK-101')).data.status, 'verified');

  process.env.AGENT_2_0_MOCK_NOOP = '1';
  try {
    const result = await pipeline.runConsolidate('TASK-101');
    assert.equal(result.ok, false);
    assert.match(result.reason, /produkcione beleške/);
    const task = await store.get('TASK-101');
    assert.equal(task.data.status, 'review', 'zadatak se vraća u review, ne u produkcionu granu');
    assert.equal((await lintVault(config)).errors.length, 0);
    // main nije dobio ni jednu produkcionu belešku
    assert.deepEqual((await listNotes(vault.root, ['wiki'])).filter((n) => n !== 'wiki/Index.md'), []);
    assert.match(task.body, /Konsolidacija bez artefakta/);
  } finally {
    delete process.env.AGENT_2_0_MOCK_NOOP;
    await vault.cleanup();
  }
});

test('E2E: run() sam troši dozvoljene pokušaje i blokira zadatak posle njih', async () => {
  const { vault, store, pipeline } = await setup({ maxRevisions: 1 });
  await pipeline.ingest({ source: 'raw/dokument.md', title: 'Uporno odbijana beleška' });
  process.env.AGENT_2_0_MOCK_VERDICT = 'fail';
  try {
    // Bez ovoga bi petlja stala posle prvog `fail` i retry se nikad ne bi desio.
    const rounds = await pipeline.run({ rounds: 6 });
    const task = await store.get('TASK-101');
    assert.equal(task.data.status, 'blocked', `očekivan blocked, dobijeno ${task.data.status}`);
    assert.ok(rounds.length >= 3, `petlja mora da nastavi posle odbijenog nacrta (krugova: ${rounds.length})`);
    const phases = rounds.flatMap((r) => r.actions).map((a) => a.phase);
    assert.ok(phases.filter((p) => p === 'research').length >= 2, 'istraživač mora dobiti drugi pokušaj');
    assert.ok(phases.filter((p) => p === 'verify').length >= 2, 'verifikator mora ponovo suditi');
  } finally {
    delete process.env.AGENT_2_0_MOCK_VERDICT;
    await vault.cleanup();
  }
});

test('E2E: istekao zakup se oporavlja i radno stablo se uklanja', async () => {
  const vault = await makeVault();
  const config = await loadConfig(vault.root);
  let current = new Date('2025-01-01T00:00:00.000Z');
  const store = createStore(config, { clock: () => current });
  const pipeline = createPipeline(config, { store });
  await pipeline.ingest({ source: 'raw/dokument.md', title: 'Zaglavljen posao' });

  await store.claim('TASK-101', 'researcher', { ttlMs: 60_000 });
  assert.equal((await store.get('TASK-101')).data.status, 'in_progress');

  // Agent "puca": zakup ističe bez predaje posla.
  current = new Date('2025-01-02T00:00:00.000Z');
  const result = await pipeline.runOnce({ only: 'research' });
  assert.ok(result.actions.some((a) => a.phase === 'reclaim' && a.task === 'TASK-101'));
  const task = await store.get('TASK-101');
  assert.ok(['ready', 'in_progress', 'review'].includes(task.data.status), task.data.status);
  const events = await readJsonl(config.paths.events);
  assert.ok(events.some((e) => e.kind === 'lease.reclaimed'));
  await vault.cleanup();
});

test('E2E: zadatak sa nezadovoljenom zavisnošću ostaje predložen', async () => {
  const { vault, store, pipeline } = await setup();
  await vault.write('raw/drugi.md', 'Drugi izvor.');
  await gitExec(vault.root, ['-c', 'user.name=f', '-c', 'user.email=f@local', 'add', '-A']);
  await gitExec(vault.root, ['-c', 'user.name=f', '-c', 'user.email=f@local', 'commit', '-q', '-m', 'drugi izvor']);

  const first = await pipeline.ingest({ source: 'raw/dokument.md', title: 'Prvi' });
  await pipeline.run({ rounds: 6 });
  assert.equal((await store.get(first.data.id)).data.status, 'consolidated');

  const second = await pipeline.ingest({ source: 'raw/drugi.md', title: 'Drugi', dependsOn: ['TASK-999'] });
  assert.equal(second.data.status, 'proposed', 'nezadovoljena zavisnost ne pušta zadatak u rad');

  const third = await pipeline.ingest({ source: 'raw/drugi.md', title: 'Treci', dependsOn: ['TASK-101'] });
  assert.equal(third.data.status, 'ready', 'zadovoljena zavisnost pušta zadatak u rad');
  await vault.cleanup();
});

test('E2E: parallelna dva zadatka se spajaju sekvencijalno bez konflikta', async () => {
  const { vault, config, store, pipeline } = await setup();
  await vault.write('raw/drugi.md', 'Drugi izvor o kontrolnom mehanizmu.');
  await gitExec(vault.root, ['-c', 'user.name=f', '-c', 'user.email=f@local', 'add', '-A']);
  await gitExec(vault.root, ['-c', 'user.name=f', '-c', 'user.email=f@local', 'commit', '-q', '-m', 'drugi']);

  await pipeline.ingest({ source: 'raw/dokument.md', title: 'Prva beleska' });
  await pipeline.ingest({ source: 'raw/drugi.md', title: 'Druga beleska' });
  const rounds = await pipeline.run({ rounds: 12 });

  for (const id of ['TASK-101', 'TASK-102']) {
    assert.equal((await store.get(id)).data.status, 'consolidated', `${id} nije konsolidovan`);
  }
  const notes = (await listNotes(vault.root, ['wiki'])).filter((n) => n !== 'wiki/Index.md');
  assert.equal(notes.length, 2);
  assert.equal((await lintVault(config)).errors.length, 0);
  assert.ok(rounds.length >= 4);
  await vault.cleanup();
});

test('E2E: ingest odbija izvor van raw/ i nepostojeći izvor', async () => {
  const { vault, pipeline } = await setup();
  await assert.rejects(() => pipeline.ingest({ source: 'wiki/Index.md', title: 'X' }), /mora biti u raw/);
  await assert.rejects(() => pipeline.ingest({ source: 'raw/nema.md', title: 'X' }), /ne postoji/);
  await vault.cleanup();
});

test('E2E: lint prijavljuje prekršaj ugovora posle ručne intervencije', async () => {
  const { vault, config, pipeline } = await setup();
  await pipeline.ingest({ source: 'raw/dokument.md', title: 'Beleska' });
  await pipeline.run({ rounds: 6 });
  assert.equal((await lintVault(config)).errors.length, 0);

  // Ručno izmeni izvor -> ugovor je prekršen i to mora biti vidljivo.
  await vault.write('raw/dokument.md', 'izmijenjen izvor');
  const lint = await lintVault(config);
  assert.ok(lint.errors.some((e) => e.code === 'raw.modified'));
  await vault.cleanup();
});
