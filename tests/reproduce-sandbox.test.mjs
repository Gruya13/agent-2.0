import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { makeVault } from './helpers/vault.mjs';
import { headSha } from '../tools/orchestrator/lib/git.mjs';
import { runReproductionScripts } from '../tools/orchestrator/lib/reproduce.mjs';
import { SANDBOX_IMAGE, dockerSandboxDostupan } from '../tools/orchestrator/lib/sandbox.mjs';

async function pripremi() {
  const vault = await makeVault();
  const skripte = path.join(vault.root, '.probne-skripte');
  await fs.mkdir(skripte, { recursive: true });
  const revision = await headSha(vault.root);
  return { vault, skripte, revision };
}

test('reprodukcija: docker sandbox izvršava skript sa read-only rootfs i bez mreže', async (t) => {
  if (!(await dockerSandboxDostupan())) {
    t.skip(`docker ili slika ${SANDBOX_IMAGE} nije dostupna`);
    return;
  }
  const { vault, skripte, revision } = await pripremi();
  await fs.writeFile(path.join(skripte, 'NALAZ-1.sh'), [
    '#!/usr/bin/env bash',
    'set -e',
    '# Skript vidi samo svež klon revizije u /work.',
    'test -f tools/orchestrator/cli.mjs || exit 9',
    'test -w /work || exit 10',
    '# Host home i tajne nisu vidljivi.',
    'test ! -d /home/gru/.dsh || exit 11',
    'test ! -d "$HOME/.dsh" || exit 12',
    '# Nema mrežnog interfejsa osim loopback-a.',
    'test ! -d /sys/class/net/eth0 || exit 13',
    '# Rootfs je read-only: upis van /work i /tmp mora da padne.',
    'touch /etc/agent2-proba 2>/dev/null && exit 14',
    'echo "OBORENO: docker sandbox radi"',
    'exit 0',
    '',
  ].join('\n'));

  let rezultati;
  try {
    rezultati = await runReproductionScripts({
      repoRoot: vault.root, revision, worktreeDir: skripte,
      scripts: ['NALAZ-1.sh'], timeoutMs: 120_000, sandbox: 'docker',
    });
  } finally {
    await vault.cleanup();
  }
  const [r] = rezultati;
  assert.equal(r.executed, true, JSON.stringify(r));
  assert.equal(r.reproduced, true, r.output);
});
