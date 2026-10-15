/**
 * Integritet wiki memorije: nijedna kontrolna operacija ne sme da komituje tuđi
 * rad. Ovi testovi su prvo PADALI (potvrda nalaza), a posle ispravke su
 * regresioni dokaz.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../tools/orchestrator/lib/config.mjs';
import { createStore } from '../tools/orchestrator/lib/store.mjs';
import { createPipeline } from '../tools/orchestrator/lib/pipeline.mjs';
import { gitExec, makeVault } from './helpers/vault.mjs';
import { ISPRAVKA, pripremiCoding, skriptaProgramera } from './helpers/coding-fixture.mjs';

const TUDJA = 'wiki/Tudja-beleska.md';
const TUDJA_SADRZAJ = [
  '---', 'title: Tuđa beleška', 'created: 2026-10-01T00:00:00.000Z',
  'updated: 2026-10-01T00:00:00.000Z', 'authors: [operator]', 'status: draft',
  'tags: [tudje]', '---', '', '# Tuđa beleška', '', 'Sadržaj koji kontrolni sloj ne sme sam da komituje.', '',
].join('\n');

async function imaNekomitovan(vault) {
  const status = await gitExec(vault.root, ['status', '--porcelain']);
  return status.stdout.includes(TUDJA);
}

test('W1: coding zapis u wiki ne povlači tuđu belešku u komit', async () => {
  const { vault, coding, zadatak } = await pripremiCoding();
  process.env.AGENT_2_0_MOCK_CODE_CMD = await skriptaProgramera(ISPRAVKA);
  try {
    // Tuđi rad ostavljen u kontrolnom vault-u.
    await vault.write(TUDJA, TUDJA_SADRZAJ);

    for (let i = 0; i < 3; i += 1) {
      const r = await coding.runCodeTask(zadatak.data.id);
      assert.equal(r.ok, true, JSON.stringify(r));
    }
    const fajlovi = (await gitExec(vault.root, ['show', '--name-only', '--pretty=format:', 'HEAD']))
      .stdout.split('\n').filter(Boolean);
    assert.equal(fajlovi.includes(TUDJA), false, 'tuđa beleška ne sme ući u komit');
    assert.equal(await imaNekomitovan(vault), true, 'tuđi rad mora ostati sačuvan i nekomitovan');
    // Zapis o izmeni JE komitovan.
    const log = (await gitExec(vault.root, ['log', '--oneline', '-3'])).stdout;
    assert.match(log, /zapis o izmeni TASK-101/);
  } finally {
    delete process.env.AGENT_2_0_MOCK_CODE_CMD;
    await vault.cleanup();
  }
});

test('W2: knjigovodstvo dokumentnog toka ne povlači tuđu belešku', async () => {
  const vault = await makeVault();
  const config = await loadConfig(vault.root);
  const store = createStore(config);
  const pipeline = createPipeline(config, { store });
  try {
    await pipeline.ingest({ source: 'raw/dokument.md', title: 'Doc' });
    await vault.write(TUDJA, TUDJA_SADRZAJ);

    await pipeline.runResearch('TASK-101');
    await pipeline.runVerify('TASK-101');
    assert.equal((await pipeline.runChallenge('TASK-101')).ok, true);
    const konsolidacija = await pipeline.runConsolidate('TASK-101');
    assert.equal(konsolidacija.ok, true, JSON.stringify(konsolidacija));

    const svi = (await gitExec(vault.root, ['log', '--name-only', '--pretty=format:%h', '--all'])).stdout;
    assert.doesNotMatch(svi, /Tudja-beleska/, 'tuđa beleška ne sme biti komitovana nijednom fazom');
    assert.equal(await imaNekomitovan(vault), true, 'tuđi rad ostaje nekomitovan');
  } finally {
    await vault.cleanup();
  }
});

test('W3: reflect/index ne povlači tuđu belešku', async () => {
  const vault = await makeVault();
  const config = await loadConfig(vault.root);
  const store = createStore(config);
  const pipeline = createPipeline(config, { store });
  try {
    await vault.write(TUDJA, TUDJA_SADRZAJ);
    const reflect = await pipeline.reflect();
    assert.ok(reflect.notes >= 1);

    const svi = (await gitExec(vault.root, ['log', '--name-only', '--pretty=format:%h'])).stdout;
    assert.doesNotMatch(svi, /Tudja-beleska/, 'index/reflect ne sme da komituje tuđu belešku');
    assert.equal(await imaNekomitovan(vault), true, 'tuđi rad ostaje nekomitovan');
  } finally {
    await vault.cleanup();
  }
});
