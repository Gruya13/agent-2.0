/**
 * Doslednost produkcione putanje kroz faze: extract -> research -> verify ->
 * challenge -> consolidate. Kapija dozvoljava samo putanju izvedenu iz
 * deklarisanog artefakta zadatka, a prompt konsolidatoru je navodi tačno.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { loadConfig } from '../tools/orchestrator/lib/config.mjs';
import { createStore } from '../tools/orchestrator/lib/store.mjs';
import { createPipeline } from '../tools/orchestrator/lib/pipeline.mjs';
import { gitExec, makeVault } from './helpers/vault.mjs';

async function pripremi({ title = 'Moj naslov' } = {}) {
  const vault = await makeVault();
  const config = await loadConfig(vault.root);
  const store = createStore(config);
  const pipeline = createPipeline(config, { store });
  await pipeline.ingest({ source: 'raw/dokument.md', title });
  return { vault, config, store, pipeline };
}

test('CP1: dozvoljena produkciona putanja izvodi se iz NACRTA, ne iz izvora', async () => {
  const { vault, store, pipeline } = await pripremi({ title: 'Moj naslov' });
  try {
    await pipeline.runResearch('TASK-101');
    const t = await store.get('TASK-101');
    const nacrt = (t.data.artifacts ?? []).find((rel) => rel.startsWith('wiki/drafts/'));
    assert.ok(nacrt, 'istraživanje mora dati nacrt');
    assert.deepEqual(pipeline.productionPathsFor(t), [`wiki/${path.basename(nacrt)}`]);
    // Ime izvora (raw/dokument.md) NIJE dozvoljena produkciona meta.
    assert.equal(pipeline.productionPathsFor(t).includes('wiki/dokument.md'), false);
  } finally {
    await vault.cleanup();
  }
});

test('CP2: konsolidator koji upiše drugu produkcionu putanju je odbijen', async () => {
  const { vault, store, pipeline } = await pripremi({ title: 'Moj naslov' });
  process.env.AGENT_2_0_MOCK_CONSOLIDATE_PATH = 'wiki/pogresna-meta.md';
  try {
    await pipeline.runResearch('TASK-101');
    await pipeline.runVerify('TASK-101');
    await pipeline.runChallenge('TASK-101');
    const r = await pipeline.runConsolidate('TASK-101');
    assert.equal(r.ok, false, JSON.stringify(r));
    assert.match(String(r.reason), /zone|dozvol/);

    const uMainu = (await gitExec(vault.root, ['ls-tree', '-r', '--name-only', 'HEAD'])).stdout;
    assert.doesNotMatch(uMainu, /pogresna-meta/, 'pogrešna meta ne sme u main');
    const t = await store.get('TASK-101');
    assert.notEqual(t.data.status, 'consolidated');
  } finally {
    delete process.env.AGENT_2_0_MOCK_CONSOLIDATE_PATH;
    await vault.cleanup();
  }
});

test('CP3: lanac dozvoljene putanje prolazi do objave deklarisane beleške', async () => {
  const { vault, store, pipeline } = await pripremi({ title: 'Moj naslov' });
  try {
    await pipeline.runResearch('TASK-101');
    const t0 = await store.get('TASK-101');
    const ocekivano = pipeline.productionPathsFor(t0)[0];
    await pipeline.runVerify('TASK-101');
    await pipeline.runChallenge('TASK-101');
    const r = await pipeline.runConsolidate('TASK-101');
    assert.equal(r.ok, true, JSON.stringify(r));
    const t = await store.get('TASK-101');
    assert.equal(t.data.status, 'consolidated');
    assert.deepEqual(t.data.artifacts, [ocekivano], 'artefakti pokazuju na tačno deklarisanu putanju');
  } finally {
    await vault.cleanup();
  }
});
