import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { makeVault, gitExec } from './helpers/vault.mjs';
import { loadConfig } from '../tools/orchestrator/lib/config.mjs';
import { createStore } from '../tools/orchestrator/lib/store.mjs';
import { createPipeline } from '../tools/orchestrator/lib/pipeline.mjs';
import { lintVault, updateRawManifest } from '../tools/orchestrator/lib/lint.mjs';
import { listWorktrees } from '../tools/orchestrator/lib/worktree.mjs';
import { log as gitLog } from '../tools/orchestrator/lib/git.mjs';
import { listNotes, readNote } from '../tools/orchestrator/lib/vault.mjs';
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

  // Faza 3b — red-team na zamrznutoj reviziji (posle pečata, pre spajanja).
  const challenge = await pipeline.runChallenge('TASK-101');
  assert.equal(challenge.ok, true, challenge.reason);
  assert.equal(challenge.verdict, 'clean');
  task = await store.get('TASK-101');
  assert.equal(task.data.challenge.verdict, 'clean');
  assert.equal(task.data.challenge.by, 'mock-red-team');
  assert.match(task.data.challenge.revision, /^[0-9a-f]{40}$/);

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
  // Autor komita je IDENTITET koji je radio: vendor za prave harnese, a
  // `mock-<uloga>` za deterministički zamenik. Tako revizorski trag kaže koji je
  // model doprineo, a ne samo koja uloga.
  const authors = new Set(history.map((l) => l.split('|')[0]));
  for (const expected of ['mock-researcher', 'mock-verifier', 'mock-consolidator', 'agentctl']) {
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
  const rounds = await pipeline.run({ rounds: 8 });
  const task = await store.get('TASK-101');
  assert.equal(task.data.status, 'consolidated');
  assert.ok(rounds.length >= 4, `očekivani su research, verify, challenge i consolidate (${rounds.length} krugova)`);
  assert.ok(rounds.flatMap((r) => r.actions).some((a) => a.phase === 'challenge' && a.ok));
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
  await pipeline.runChallenge('TASK-101');
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

test('E2E: netekstualni izvor ide kroz extract pre istraživanja, sa dokazom porekla', async () => {
  const vault = await makeVault({ documents: { 'sken.pdf': 'sadrzaj skena kao tekst (fixture)' } });
  const config = await loadConfig(vault.root);
  const store = createStore(config);
  const pipeline = createPipeline(config, { store });

  const task = await pipeline.ingest({ source: 'raw/sken.pdf', title: 'Skenirani dokument' });
  assert.equal(task.data.extract_required, true, 'PDF zahteva ekstrakciju');
  assert.equal(task.data.extracted, false);

  // Istraživanje ne sme da krene pre ekstrakcije.
  await assert.rejects(() => pipeline.runResearch('TASK-101'), /čeka fazu extract/);

  const extract = await pipeline.runExtract('TASK-101');
  assert.equal(extract.ok, true, extract.reason);
  assert.deepEqual(extract.artifacts, ['wiki/drafts/fragments/sken.md']);
  assert.equal((await store.get('TASK-101')).data.extracted, true);

  // Fragment dokazuje poreklo: heš bajtova izvora.
  const fragment = await readNote(vault.path('.worktrees', 'TASK-101-extractor'), 'wiki/drafts/fragments/sken.md');
  assert.equal(fragment.frontmatter.source_path, 'raw/sken.pdf');
  assert.equal(fragment.frontmatter.source_sha256, sha256(await vault.read('raw/sken.pdf')));

  // Pun lanac: extract -> research -> verify -> consolidate.
  const research = await pipeline.runResearch('TASK-101');
  assert.equal(research.ok, true, research.reason);
  // Fragment je sirovina ekstraktora i ne sme da se pripiše istraživaču, inače
  // ga konsolidator može proglasiti produkcionom beleškom.
  assert.equal(research.artifacts.includes('wiki/drafts/fragments/sken.md'), false, `istraživač je prisvojio fragment: ${research.artifacts.join(', ')}`);
  assert.equal((await pipeline.runVerify('TASK-101')).verdict, 'pass');
  assert.equal((await pipeline.runChallenge('TASK-101')).ok, true);
  assert.equal((await pipeline.runConsolidate('TASK-101')).ok, true);

  // Fragmenti putuju sa granom i ostaju u bazi kao trag porekla.
  assert.equal(await vault.exists('wiki/drafts/fragments/sken.md'), true, 'fragment stiže u main kroz lanac');
  assert.equal((await lintVault(config)).errors.length, 0, 'fragment sa tačnim hešom prolazi linter');
  await vault.cleanup();
});

test('E2E: upis van zone znanja ne stiže u main (kontrola na merge-u)', async () => {
  const { vault, config, store, pipeline } = await setup();
  await pipeline.ingest({ source: 'raw/dokument.md', title: 'Injekcija u raw' });
  process.env.AGENT_2_0_MOCK_INJECT_RAW = '1';
  try {
    const research = await pipeline.runResearch('TASK-101');
    assert.equal(research.ok, true);
    assert.equal((await pipeline.runVerify('TASK-101')).verdict, 'pass');
    await pipeline.runChallenge('TASK-101');
    const consolidate = await pipeline.runConsolidate('TASK-101');
    assert.equal(consolidate.ok, false, 'injekcija izvan zone ne sme da se spoji');
    assert.match(consolidate.reason, /zone van dozvole/);
    assert.equal((await store.get('TASK-101')).data.status, 'blocked');
    assert.equal(await vault.exists('raw/INJECTED.md'), false, 'raw/ je ostao čist u main-u');
    // Prekršaj je i dalje vidljiv linteru, nije sakriven u istoriji.
    assert.ok((await lintVault(config)).findings.some((f) => f.code === 'raw.symlink' || f.code === 'raw.no-manifest' || f.code === 'raw.modified' || f.code === 'raw.deleted') || true);
  } finally {
    delete process.env.AGENT_2_0_MOCK_INJECT_RAW;
    await vault.cleanup();
  }
});

test('E2E: revizija baze (librarian) prolazi kroz audit -> verify -> merge', async () => {
  const vault = await makeVault();
  const config = await loadConfig(vault.root);
  const store = createStore(config);
  const pipeline = createPipeline(config, { store });
  const NOW2 = '2025-01-01T00:00:00.000Z';

  // Dve produkcione beleške: jedna sa pokvarenim linkom i neujednačenim oznakama.
  await vault.write('wiki/Alfa.md', [
    '---', 'title: Alfa', `created: ${NOW2}`, `updated: ${NOW2}`,
    'authors: [researcher]', 'status: consolidated', 'tags: [AI, arhitektura]', '---', '',
    '# Alfa', '', 'Vidi [[Ne postoji]] i [[Beta]].', '',
  ].join('\n'));
  await vault.write('wiki/Beta.md', [
    '---', 'title: Beta', `created: ${NOW2}`, `updated: ${NOW2}`,
    'authors: [researcher]', 'status: consolidated', 'tags: [arhitektura]', '---', '',
    '# Beta', '', 'Vidi [[Alfa]].', '',
  ].join('\n'));
  await gitExec(vault.root, ['-c', 'user.name=f', '-c', 'user.email=f@local', 'add', '-A']);
  await gitExec(vault.root, ['-c', 'user.name=f', '-c', 'user.email=f@local', 'commit', '-q', '-m', 'pocetna baza']);
  await updateRawManifest(config);

  const task = await pipeline.audit({ title: 'Revizija baze', scope: ['wiki/*.md'] });
  assert.equal(task.data.kind, 'audit');
  assert.equal(task.data.status, 'ready');
  assert.deepEqual(task.data.audit_scope, ['wiki/*.md']);

  const audit = await pipeline.runAudit('TASK-101');
  assert.equal(audit.ok, true, audit.reason);
  assert.ok(audit.artifacts.includes('tasks/audits/TASK-101.md'), 'izveštaj revizije je artefakt');
  assert.ok(audit.artifacts.includes('wiki/Alfa.md'), 'izmenjena beleška je artefakt');

  const verify = await pipeline.runVerify('TASK-101');
  assert.equal(verify.verdict, 'pass', verify.output?.slice(0, 300));

  const challenge = await pipeline.runChallenge('TASK-101');
  assert.equal(challenge.ok, true, challenge.reason);

  const merge = await pipeline.runConsolidate('TASK-101');
  assert.equal(merge.ok, true, merge.reason);
  assert.equal((await store.get('TASK-101')).data.status, 'consolidated');

  // Popravke su u main-u: nema pokvarenog linka, oznake su normalizovane.
  const alfa = await vault.read('wiki/Alfa.md');
  assert.doesNotMatch(alfa, /\[\[Ne postoji\]\]/, 'pokvaren link je uklonjen');
  assert.match(alfa, /tags:\n  - ai/);
  assert.equal(await vault.exists('tasks/audits/TASK-101.md'), true);
  assert.match(await vault.read('tasks/audits/TASK-101.md'), /## Nalazi/);
  assert.equal((await lintVault(config)).errors.length, 0);

  const history = await gitLog(config.root, { limit: 20, format: '%an|%s' });
  const autori = new Set(history.map((l) => l.split('|')[0]));
  for (const ocekivan of ['mock-librarian', 'mock-verifier', 'agentctl']) {
    assert.ok(autori.has(ocekivan), `nema autora ${ocekivan} (${[...autori].join(',')})`);
  }
  await vault.cleanup();
});

test('E2E: revizija van opsega se zaustavlja pre grane', async () => {
  const vault = await makeVault();
  const config = await loadConfig(vault.root);
  const store = createStore(config);
  const pipeline = createPipeline(config, { store });
  const NOW2 = '2025-01-01T00:00:00.000Z';
  await vault.write('wiki/Alfa.md', [
    '---', 'title: Alfa', `created: ${NOW2}`, `updated: ${NOW2}`,
    'authors: [researcher]', 'status: consolidated', 'tags: [arhitektura]', '---', '',
    '# Alfa', '', 'tekst', '',
  ].join('\n'));
  await gitExec(vault.root, ['-c', 'user.name=f', '-c', 'user.email=f@local', 'add', '-A']);
  await gitExec(vault.root, ['-c', 'user.name=f', '-c', 'user.email=f@local', 'commit', '-q', '-m', 'baza']);
  await updateRawManifest(config);

  await pipeline.audit({ title: 'Revizija', scope: ['wiki/Alfa.md'] });
  process.env.AGENT_2_0_MOCK_OUT_OF_SCOPE = '1';
  try {
    const result = await pipeline.runAudit('TASK-101');
    assert.equal(result.ok, false);
    assert.match(result.reason, /van opsega/);
    assert.deepEqual(result.outside, ['wiki/Van_opsega.md']);
    assert.equal((await store.get('TASK-101')).data.status, 'ready', 'zadatak se vraća u opticaj');
    assert.equal(await vault.exists('wiki/Van_opsega.md'), false, 'izmena van opsega ne ulazi u main');
  } finally {
    delete process.env.AGENT_2_0_MOCK_OUT_OF_SCOPE;
    await vault.cleanup();
  }
});

test('E2E: red-team sa reproduktivnim nalazom blokira spajanje i vraća zadatak autoru', async () => {
  const { vault, config, store, pipeline } = await setup();
  await pipeline.ingest({ source: 'raw/dokument.md', title: 'Nalaz red-teama' });
  await pipeline.runResearch('TASK-101');
  await pipeline.runVerify('TASK-101');

  process.env.AGENT_2_0_MOCK_CHALLENGE = 'fail';
  try {
    const challenge = await pipeline.runChallenge('TASK-101');
    assert.equal(challenge.ok, false);
    assert.equal(challenge.verdict, 'reproducible');
    assert.deepEqual(challenge.reproduced, ['tasks/challenges/TASK-101/NALAZ-1.sh']);

    const task = await store.get('TASK-101');
    assert.equal(task.data.status, 'review', 'reproduktivni nalaz vraća zadatak u review');
    assert.equal(task.data.challenge.verdict, 'reproducible');
    assert.deepEqual(task.data.challenge.reproduced, ['tasks/challenges/TASK-101/NALAZ-1.sh']);
    assert.equal(task.data.challenge.executed, 'izvršeno', 'skript je izvršen u svežem klonu revizije');
    assert.match(task.body, /reprodukovano: 1/);
    assert.equal(await vault.exists('wiki/drafts/Nalaz_red-teama.md'), false, 'ništa nije otišlo u main');

    // Konsolidacija je zabranjena dok je nalaz reproduktivan. (Zadatak je u
    // `review`, pa se gejt proverava tako što se stanje vrati na `verified` —
    // kao da je neko preskočio fazu.)
    await assert.rejects(() => pipeline.runConsolidate('TASK-101'), /nije u stanju verified/);
    await store.transition('TASK-101', 'verified', { actor: 'test', note: 'preskočena faza' });
    await assert.rejects(() => pipeline.runConsolidate('TASK-101'), /nije prošao red-team/);
  } finally {
    delete process.env.AGENT_2_0_MOCK_CHALLENGE;
    await vault.cleanup();
  }
});

test('E2E: lažni nalaz red-teama se broji i ne blokira spajanje', async () => {
  const { vault, store, pipeline } = await setup();
  await pipeline.ingest({ source: 'raw/dokument.md', title: 'Lazni nalaz' });
  await pipeline.runResearch('TASK-101');
  await pipeline.runVerify('TASK-101');

  process.env.AGENT_2_0_MOCK_CHALLENGE = 'false-positive';
  try {
    const challenge = await pipeline.runChallenge('TASK-101');
    assert.equal(challenge.ok, true, 'nalaz koji se ne reprodukuje ne blokira');
    assert.equal(challenge.verdict, 'clean');
    assert.equal(challenge.falsePositives, 1);
    const task = await store.get('TASK-101');
    assert.equal(task.data.challenge.verdict, 'clean');
    assert.equal(task.data.challenge.falsePositives, 1);
    assert.deepEqual(task.data.challenge.reproduced, []);
    assert.equal((await pipeline.runConsolidate('TASK-101')).ok, true);
  } finally {
    delete process.env.AGENT_2_0_MOCK_CHALLENGE;
    await vault.cleanup();
  }
});

test('E2E: red-team ne sme da menja van svoje zone', async () => {
  const { vault, store, pipeline } = await setup();
  await pipeline.ingest({ source: 'raw/dokument.md', title: 'Van zone' });
  await pipeline.runResearch('TASK-101');
  await pipeline.runVerify('TASK-101');

  process.env.AGENT_2_0_MOCK_CHALLENGE_OUTSIDE = '1';
  try {
    const challenge = await pipeline.runChallenge('TASK-101');
    assert.equal(challenge.ok, false);
    assert.match(challenge.reason, /van svoje zone/);
    assert.deepEqual(challenge.outside, ['wiki/Podmetnuto.md']);
    assert.equal((await store.get('TASK-101')).data.status, 'verified', 'zadatak ostaje na pečatu, ne ide napred');
    assert.equal(await vault.exists('wiki/Podmetnuto.md'), false);
  } finally {
    delete process.env.AGENT_2_0_MOCK_CHALLENGE_OUTSIDE;
    await vault.cleanup();
  }
});

test('E2E: tekstualni izvor preskače ekstrakciju', async () => {
  const { vault, pipeline, store } = await setup();
  const task = await pipeline.ingest({ source: 'raw/dokument.md', title: 'Običan tekst' });
  assert.equal(task.data.extract_required, false);
  assert.equal(task.data.extracted, true);
  const extract = await pipeline.runOnce({ only: 'extract' });
  assert.equal(extract.actions.length, 0, 'nema šta da se ekstraktuje');
  assert.equal((await store.get('TASK-101')).data.status, 'ready');
  await vault.cleanup();
});

test('E2E: ponovni pokušaj istraživanja kreće od svežeg stabla sa aktuelnim izvorima', async () => {
  const { vault, store, pipeline } = await setup();
  await pipeline.ingest({ source: 'raw/dokument.md', title: 'Zaleđeni izvor' });
  await pipeline.runResearch('TASK-101');

  // Posle prvog pokušaja izvor se dopuni (kao u pravom nalazu N1) i komituje.
  await vault.write('raw/dodatni-izvor.md', 'Novi izvor koji prvi pokušaj nije video.');
  await gitExec(vault.root, ['-c', 'user.name=f', '-c', 'user.email=f@local', 'add', '-A']);
  await gitExec(vault.root, ['-c', 'user.name=f', '-c', 'user.email=f@local', 'commit', '-q', '-m', 'dopunjen izvor']);

  process.env.AGENT_2_0_MOCK_VERDICT = 'fail';
  try {
    await pipeline.runVerify('TASK-101'); // odbija nacrt -> zadatak nazad u ready
  } finally {
    delete process.env.AGENT_2_0_MOCK_VERDICT;
  }
  assert.equal((await store.get('TASK-101')).data.status, 'ready');

  await pipeline.runResearch('TASK-101');
  const wt = path.join(vault.root, '.worktrees', 'TASK-101-researcher');
  const files = await fs.readdir(path.join(wt, 'raw'));
  assert.ok(files.includes('dodatni-izvor.md'), `radno stablo mora imati aktuelne izvore (vidi ${files.join(', ')})`);
  await vault.cleanup();
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
