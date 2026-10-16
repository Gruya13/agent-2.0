/**
 * Rebase na main kada izvedeni fajl (wiki/Index.md) menja i agent i kontrolni
 * sloj. Konflikt na izvedenim fajlovima resava se u korist main-a; konflikt na
 * sadrzaju ostaje odbijanje.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { loadConfig } from '../tools/orchestrator/lib/config.mjs';
import { createStore } from '../tools/orchestrator/lib/store.mjs';
import { createPipeline } from '../tools/orchestrator/lib/pipeline.mjs';
import { createWorktree, mergeIntoMain } from '../tools/orchestrator/lib/worktree.mjs';
import { gitExec, makeVault } from './helpers/vault.mjs';

const BRANCH = 'agent/consolidator/TASK-101';
const commit = (dir, ime) => gitExec(dir, ['-c', `user.name=${ime}`, '-c', `user.email=${ime}@local`, 'commit', '-qm', ime]);

test('RG1: konflikt samo na wiki/Index.md ne obara spajanje', async () => {
  const vault = await makeVault();
  const config = await loadConfig(vault.root);
  const store = createStore(config);
  const pipeline = createPipeline(config, { store });
  try {
    await pipeline.ingest({ source: 'raw/dokument.md', title: 'Proba' });
    const wt = await createWorktree(config, { id: 'TASK-101', role: 'consolidator', base: 'main' });
    await fs.mkdir(path.join(wt.path, 'wiki'), { recursive: true });
    await fs.writeFile(path.join(wt.path, 'wiki', 'Index.md'), '# Index iz grane', 'utf8');
    await fs.writeFile(path.join(wt.path, 'wiki', 'Proizvod.md'), '# Proizvod iz grane', 'utf8');
    await gitExec(wt.path, ['add', '-A']);
    await commit(wt.path, 'konsolidator');
    await pipeline.reflect(); // main istovremeno menja Index
    const r = await mergeIntoMain(config, {
      branch: BRANCH, message: 'agentctl: test merge',
      worktreeDir: wt.path, generatedPaths: ['wiki/Index.md'],
      zonePolicy: { production: ['wiki/Proizvod.md'] },
    });
    assert.equal(r.merged, true, JSON.stringify(r));
    const index = await fs.readFile(path.join(vault.root, 'wiki', 'Index.md'), 'utf8');
    assert.equal(index.includes('Index iz grane'), false, 'Index ne sme doci iz grane');
    assert.equal(await fs.access(path.join(vault.root, 'wiki', 'Proizvod.md')).then(() => true), true);
  } finally {
    await vault.cleanup();
  }
});

test('RG2: konflikt na sadrzaju (produkciona beleska) ostaje odbijanje', async () => {
  const vault = await makeVault();
  const config = await loadConfig(vault.root);
  const store = createStore(config);
  const pipeline = createPipeline(config, { store });
  try {
    await pipeline.ingest({ source: 'raw/dokument.md', title: 'Proba' });
    const wt = await createWorktree(config, { id: 'TASK-101', role: 'consolidator', base: 'main' });
    await fs.mkdir(path.join(wt.path, 'wiki'), { recursive: true });
    await fs.writeFile(path.join(wt.path, 'wiki', 'Proizvod.md'), '# Verzija grane', 'utf8');
    await gitExec(wt.path, ['add', '-A']);
    await commit(wt.path, 'grana');
    await fs.writeFile(path.join(vault.root, 'wiki', 'Proizvod.md'), '# Verzija main-a', 'utf8');
    await gitExec(vault.root, ['add', 'wiki/Proizvod.md']);
    await commit(vault.root, 'operator');
    const r = await mergeIntoMain(config, {
      branch: BRANCH, message: 'agentctl: test merge',
      worktreeDir: wt.path, generatedPaths: ['wiki/Index.md'],
      zonePolicy: { production: ['wiki/Proizvod.md'] },
    });
    assert.equal(r.merged, false, JSON.stringify(r));
    assert.equal(r.conflict, true, JSON.stringify(r));
    const sadrzaj = await fs.readFile(path.join(vault.root, 'wiki', 'Proizvod.md'), 'utf8');
    assert.equal(sadrzaj.includes('Verzija main-a'), true, 'main sadrzaj ostaje');
  } finally {
    await vault.cleanup();
  }
});
