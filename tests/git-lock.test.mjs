/**
 * Zaostali `.git/index.lock`: uklanja se SAMO dokazano star lock, nikad lock
 * živog git procesa (dokazani kontraprimer: spor git add sa clean filterom).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { commitPaths } from '../tools/orchestrator/lib/git.mjs';
import { makeVault } from './helpers/vault.mjs';

test('GL1: commitPaths ne briše lock mlađi od 60 s (može biti živ proces)', async () => {
  const vault = await makeVault();
  try {
    await vault.write('wiki/Proba.md', '# x\n');
    const lock = path.join(vault.root, '.git', 'index.lock');
    await fs.writeFile(lock, '', 'utf8');
    await assert.rejects(() => commitPaths(vault.root, ['wiki/Proba.md'], 'proba'), /index\.lock|nije uspeo/i);
    assert.equal(await fs.access(lock).then(() => true).catch(() => false), true, 'živ lock mora ostati');
  } finally {
    await vault.cleanup();
  }
});

test('GL2: commitPaths uklanja dokazano zaostao lock i nastavlja', async () => {
  const vault = await makeVault();
  try {
    await vault.write('wiki/Proba.md', '# x\n');
    const lock = path.join(vault.root, '.git', 'index.lock');
    await fs.writeFile(lock, '', 'utf8');
    const staro = new Date(Date.now() - 120_000);
    await fs.utimes(lock, staro, staro);
    const r = await commitPaths(vault.root, ['wiki/Proba.md'], 'proba');
    assert.equal(r.committed, true);
    assert.equal(r.lockCleared, true, 'zaostali lock mora biti zabeležen kao uklonjen');
    assert.equal(await fs.access(lock).then(() => true).catch(() => false), false);
  } finally {
    await vault.cleanup();
  }
});
