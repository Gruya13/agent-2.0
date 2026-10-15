/**
 * Coding tok: zahtev -> reprodukcija -> izmena -> testiranje -> nezavisan
 * pregled -> prihvaćena promena.
 *
 * Ciljni repozitorijum je pravi mali git repo u temp-u; adapteri su mock, pa je
 * tok deterministički. Mock programer ne ume da napiše popravku — izvršava
 * komandu iz okruženja, pa test može da simulira i uspeh i svaku vrstu
 * nedozvoljene izmene.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '../tools/orchestrator/lib/config.mjs';
import { exists } from '../tools/orchestrator/lib/fsx.mjs';
import { createStore } from '../tools/orchestrator/lib/store.mjs';
import { createCodingPipeline } from '../tools/orchestrator/lib/coding.mjs';
import { createPipeline } from '../tools/orchestrator/lib/pipeline.mjs';
import { gitExec, makeVault } from './helpers/vault.mjs';

const PARSE_SA_BUGOM = [
  'export function broj(tekst, podrazumevano = null) {',
  '  const n = Number(tekst);',
  '  return n || podrazumevano;',
  '}',
  '',
].join('\n');

const POSTOJECI_TEST = [
  "import test from 'node:test';",
  "import assert from 'node:assert/strict';",
  "import { broj } from '../src/parse.js';",
  '',
  "test('broj cita vrednost', () => { assert.equal(broj('5', null), 5); });",
  "test('broj vraca podrazumevano za neispravan ulaz', () => { assert.equal(broj('x', 7), 7); });",
  '',
].join('\n');

async function napraviCiljniRepo({ saBugom = true } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agent2-cilj-'));
  await fs.mkdir(path.join(root, 'src'), { recursive: true });
  await fs.mkdir(path.join(root, 'tests'), { recursive: true });
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({
    name: 'ciljni-fixture', private: true, type: 'module', scripts: { test: 'node --test tests/' },
  }, null, 2));
  await fs.writeFile(path.join(root, 'src', 'parse.js'), saBugom
    ? PARSE_SA_BUGOM
    : PARSE_SA_BUGOM.replace('return n || podrazumevano;', 'return Number.isNaN(n) ? podrazumevano : n;'));
  await fs.writeFile(path.join(root, 'tests', 'parse.test.js'), POSTOJECI_TEST);
  await gitExec(root, ['init', '-q', '-b', 'main']);
  await gitExec(root, ['-c', 'user.name=f', '-c', 'user.email=f@local', 'add', '-A']);
  await gitExec(root, ['-c', 'user.name=f', '-c', 'user.email=f@local', 'commit', '-q', '-m', 'pocetno stanje']);
  const base = (await gitExec(root, ['rev-parse', 'HEAD'])).stdout.trim();
  return { root, base };
}

async function skriptaProgramera(telo) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent2-fix-'));
  const put = path.join(dir, 'fix.mjs');
  await fs.writeFile(put, telo, 'utf8');
  return `node ${put}`;
}

const ISPRAVKA = [
  "import { readFileSync, writeFileSync } from 'node:fs';",
  "writeFileSync('src/parse.js', readFileSync('src/parse.js', 'utf8')",
  "  .replace('return n || podrazumevano;', 'return Number.isNaN(n) ? podrazumevano : n;'));",
  "writeFileSync('tests/parse.zero.test.js', [",
  "  \"import test from 'node:test';\",",
  "  \"import assert from 'node:assert/strict';\",",
  "  \"import { broj } from '../src/parse.js';\",",
  "  '',",
  "  \"test('nula se ne gubi', () => { assert.equal(broj('0', null), 0); });\",",
  "  '',",
  "].join('\\n'));",
].join('\n');

async function pripremi({ saBugom = true } = {}) {
  const vault = await makeVault();
  const config = await loadConfig(vault.root);
  const store = createStore(config);
  const coding = createCodingPipeline(config, { store });
  const cilj = await napraviCiljniRepo({ saBugom });
  // Kratka reprodukciona komanda: PADA dok je bug prisutan (nula se gubi).
  const reproSkript = "import('./src/parse.js').then((m) => { const v = m.broj('0', null); if (v !== 0) { console.error('BUG: 0 ->', v); process.exit(1); } })";
  const repro = `node -e ${JSON.stringify(reproSkript)}`;
  const zadatak = await coding.dodajCodeZadatak({
    title: 'Nula se gubi u broj()',
    requirement: 'Funkcija broj(tekst, podrazumevano) mora da vrati 0 kada je tekst "0".',
    target: cilj.root,
    base: cilj.base,
    scope: ['src/**', 'tests/**'],
    testCommand: 'npm test',
    reproCommand: repro,
  });
  return { vault, config, store, coding, cilj, zadatak };
}

test('code: ceo tok — reprodukcija, popravka, test, nezavisan pregled, prihvatanje', async () => {
  const { vault, store, coding, cilj, zadatak } = await pripremi();
  process.env.AGENT_2_0_MOCK_CODE_CMD = await skriptaProgramera(ISPRAVKA);
  try {
    const izrada = await coding.runCodeTask(zadatak.data.id);
    assert.equal(izrada.ok, true, JSON.stringify(izrada));
    let t = await store.get(zadatak.data.id);
    assert.equal(t.data.status, 'verified');
    assert.equal(t.data.code_evidence.reproduce.exitCode > 0, true, 'test mora pasti pre popravke');
    assert.equal(t.data.code_evidence.check.exitCode, 0, 'test mora proći posle popravke');
    assert.equal(t.data.code_evidence.baseline.exitCode > 0, true, 'regresioni test mora pasti na osnovi');

    const pregled = await coding.runCodeTask(zadatak.data.id);
    assert.equal(pregled.ok, true, JSON.stringify(pregled));
    t = await store.get(zadatak.data.id);
    assert.equal(t.data.status, 'verified');
    assert.ok(t.data.code_evidence.review.verdict === 'pass');
    // Reviewer-ov scenario je sačuvan uz evidenciju, ne samo opisan u nalazu.
    const scenario = path.join(vault.root, 'tasks', 'reviews', 'TASK-101-review', 'reviewer-control.js');
    assert.equal(await exists(scenario), true, 'scenario nezavisnog pregleda mora biti sačuvan');

    const prihvatanje = await coding.runCodeTask(zadatak.data.id);
    assert.equal(prihvatanje.ok, true, JSON.stringify(prihvatanje));
    t = await store.get(zadatak.data.id);
    assert.equal(t.data.status, 'consolidated');

    // Dokaz 6: promena je u ciljnom repou i možе se pregledati iz čistog checkout-a.
    const sadrzaj = (await gitExec(cilj.root, ['show', 'HEAD:src/parse.js'])).stdout;
    assert.match(sadrzaj, /Number\.isNaN/);
    const tagovi = (await gitExec(cilj.root, ['tag', '--list'])).stdout;
    assert.match(tagovi, /dokaz\/TASK-101-accept/);
    const merge = (await gitExec(cilj.root, ['log', '--oneline', '-1'])).stdout;
    assert.match(merge, /prihvacena popravka/);
    assert.deepEqual(t.data.artifacts.sort(), ['src/parse.js', 'tests/parse.zero.test.js']);
  } finally {
    delete process.env.AGENT_2_0_MOCK_CODE_CMD;
    await vault.cleanup();
  }
});

test('code: kontrolna petlja vodi zadatak kroz sva tri koraka do prihvatanja', async () => {
  const vault = await makeVault();
  const config = await loadConfig(vault.root);
  const store = createStore(config);
  const pipeline = createPipeline(config, { store });
  const coding = createCodingPipeline(config, { store });
  const cilj = await napraviCiljniRepo();
  const reproSkript = "import('./src/parse.js').then((m) => { const v = m.broj('0', null); if (v !== 0) process.exit(1); })";
  await coding.dodajCodeZadatak({
    title: 'Nula se gubi u broj()',
    requirement: 'Funkcija broj(tekst, podrazumevano) mora da vrati 0 kada je tekst "0".',
    target: cilj.root,
    base: cilj.base,
    scope: ['src/**', 'tests/**'],
    testCommand: 'npm test',
    reproCommand: `node -e ${JSON.stringify(reproSkript)}`,
  });
  process.env.AGENT_2_0_MOCK_CODE_CMD = await skriptaProgramera(ISPRAVKA);
  try {
    let status = '';
    for (let i = 0; i < 6; i += 1) {
      await pipeline.runOnce();
      status = (await store.get('TASK-101')).data.status;
      if (status === 'consolidated') break;
    }
    // Petlja mora sama da izvede izradu, pregled i prihvatanje.
    assert.equal(status, 'consolidated');
  } finally {
    delete process.env.AGENT_2_0_MOCK_CODE_CMD;
    await vault.cleanup();
  }
});

test('code: izmena van opsega sprečava prihvatanje', async () => {
  const { vault, store, coding, cilj, zadatak } = await pripremi();
  process.env.AGENT_2_0_MOCK_CODE_CMD = await skriptaProgramera([
    "import { writeFileSync } from 'node:fs';",
    "writeFileSync('README.md', 'van opsega\\n');",
  ].join('\n'));
  try {
    const rezultat = await coding.runCodeTask(zadatak.data.id);
    assert.equal(rezultat.ok, false);
    assert.match(String(rezultat.reason), /van dozvoljenog opsega/);
    const t = await store.get(zadatak.data.id);
    assert.equal(t.data.status, 'ready');
    assert.equal(t.data.code_evidence.implement.outside.includes('README.md'), true);
    // Ništa nije ušlo u ciljni repo.
    const log = (await gitExec(cilj.root, ['log', '--oneline'])).stdout;
    assert.doesNotMatch(log, /prihvacena popravka/);
    assert.doesNotMatch(log, /popravka/);
  } finally {
    delete process.env.AGENT_2_0_MOCK_CODE_CMD;
    await vault.cleanup();
  }
});

test('code: test koji ne prolazi posle popravke sprečava prihvatanje', async () => {
  const { vault, coding, cilj, zadatak } = await pripremi();
  // Doda regresioni test, ali NE popravi bug.
  process.env.AGENT_2_0_MOCK_CODE_CMD = await skriptaProgramera([
    "import { writeFileSync } from 'node:fs';",
    "writeFileSync('tests/parse.zero.test.js', [",
    "  \"import test from 'node:test';\",",
    "  \"import assert from 'node:assert/strict';\",",
    "  \"import { broj } from '../src/parse.js';\",",
    "  '',",
    "  \"test('nula se ne gubi', () => { assert.equal(broj('0', null), 0); });\",",
    "  '',",
    "].join('\\n'));",
  ].join('\n'));
  try {
    const rezultat = await coding.runCodeTask(zadatak.data.id);
    assert.equal(rezultat.ok, false);
    assert.match(String(rezultat.reason), /test ne prolazi posle popravke/);
    const log = (await gitExec(cilj.root, ['log', '--oneline'])).stdout;
    assert.doesNotMatch(log, /prihvacena popravka/);
  } finally {
    delete process.env.AGENT_2_0_MOCK_CODE_CMD;
    await vault.cleanup();
  }
});

test('code: zadatak bez reprodukcije (bug ne postoji) se odbija', async () => {
  const { vault, coding, zadatak } = await pripremi({ saBugom: false });
  process.env.AGENT_2_0_MOCK_CODE_CMD = await skriptaProgramera(ISPRAVKA);
  try {
    const rezultat = await coding.runCodeTask(zadatak.data.id);
    assert.equal(rezultat.ok, false);
    assert.match(String(rezultat.reason), /bug se ne reprodukuje/);
  } finally {
    delete process.env.AGENT_2_0_MOCK_CODE_CMD;
    await vault.cleanup();
  }
});
