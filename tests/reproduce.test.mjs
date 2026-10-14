import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { makeVault, gitExec } from './helpers/vault.mjs';
import { isReproductionScript, runReproductionScripts } from '../tools/orchestrator/lib/reproduce.mjs';
import { headSha } from '../tools/orchestrator/lib/git.mjs';

async function pripremi() {
  const vault = await makeVault();
  const skripte = path.join(vault.root, '.probne-skripte');
  await fs.mkdir(skripte, { recursive: true });
  const revision = await headSha(vault.root);
  return { vault, skripte, revision };
}

test('isReproductionScript prepoznaje samo NALAZ-*.sh|py', () => {
  assert.equal(isReproductionScript('tasks/challenges/TASK-1/NALAZ-1.sh'), true);
  assert.equal(isReproductionScript('tasks/challenges/TASK-1/NALAZ-12.py'), true);
  assert.equal(isReproductionScript('tasks/challenges/TASK-1/izvestaj.md'), false);
  assert.equal(isReproductionScript('tasks/challenges/TASK-1/drugo.sh'), false);
});

test('reprodukcija: skript koji obara tvrdnju se broji, onaj koji ne uspe ne blokira', async () => {
  const { vault, skripte, revision } = await pripremi();
  await fs.writeFile(path.join(skripte, 'NALAZ-1.sh'), '#!/usr/bin/env bash\necho "OBORENO: proba"\nexit 0\n');
  await fs.writeFile(path.join(skripte, 'NALAZ-2.sh'), '#!/usr/bin/env bash\necho "nije oboreno"\nexit 1\n');

  const rezultati = await runReproductionScripts({
    repoRoot: vault.root, revision, worktreeDir: skripte,
    scripts: ['NALAZ-1.sh', 'NALAZ-2.sh'], timeoutMs: 30_000,
  });
  assert.equal(rezultati.length, 2);
  const oboren = rezultati.find((r) => r.script === 'NALAZ-1.sh');
  const lazni = rezultati.find((r) => r.script === 'NALAZ-2.sh');
  assert.equal(oboren.reproduced, true, 'izlazni kod 0 znači da je tvrdnja oborena');
  assert.match(oboren.output, /OBORENO/);
  assert.equal(lazni.reproduced, false, 'skript koji nije oborio tvrdnju je lažni nalaz');
  assert.equal(lazni.exitCode, 1);
  await vault.cleanup();
});

test('reprodukcija: skript radi u SVEŽEM klonu zamrznute revizije, ne u glavnom stablu', async () => {
  const { vault, skripte, revision } = await pripremi();
  // Skript dokazuje gde je pokrenut i na kojoj je reviziji.
  await fs.writeFile(path.join(skripte, 'NALAZ-1.sh'), [
    '#!/usr/bin/env bash',
    'set -e',
    'test -f tools/orchestrator/cli.mjs || exit 1',
    `test "$(git rev-parse HEAD)" = "${revision}" || exit 1`,
    'echo "OBORENO: pokrenut u svežem klonu"',
    'exit 0',
    '',
  ].join('\n'));
  // Prljavo glavno stablo ne sme da utiče na klon.
  await vault.write('PRLJAVO.txt', 'ne komituje se');

  const [rezultat] = await runReproductionScripts({
    repoRoot: vault.root, revision, worktreeDir: skripte, scripts: ['NALAZ-1.sh'], timeoutMs: 30_000,
  });
  assert.equal(rezultat.reproduced, true, rezultat.output);
  assert.equal(await vault.exists('.probne-skripte/NALAZ-1.sh'), true, 'original nije diran');
  await vault.cleanup();
});

test('reprodukcija: skript koji se zamrzne se prekida i ne blokira', async () => {
  const { vault, skripte, revision } = await pripremi();
  await fs.writeFile(path.join(skripte, 'NALAZ-1.sh'), '#!/usr/bin/env bash\nsleep 30\n');
  const started = Date.now();
  const [rezultat] = await runReproductionScripts({
    repoRoot: vault.root, revision, worktreeDir: skripte, scripts: ['NALAZ-1.sh'], timeoutMs: 500,
  });
  assert.equal(rezultat.reproduced, false);
  assert.equal(rezultat.timedOut, true);
  assert.ok(Date.now() - started < 20_000, 'prekid mora da bude brz');
  await vault.cleanup();
});

test('reprodukcija: poštuje maksimalan broj skripti', async () => {
  const { vault, skripte, revision } = await pripremi();
  for (const n of [1, 2, 3, 4]) await fs.writeFile(path.join(skripte, `NALAZ-${n}.sh`), '#!/usr/bin/env bash\nexit 0\n');
  const rezultati = await runReproductionScripts({
    repoRoot: vault.root, revision, worktreeDir: skripte,
    scripts: ['NALAZ-1.sh', 'NALAZ-2.sh', 'NALAZ-3.sh', 'NALAZ-4.sh'], max: 2, timeoutMs: 30_000,
  });
  assert.equal(rezultati.length, 2);
  await vault.cleanup();
});

test('reprodukcija: pukao sandbox nije „lažni nalaz" nego neizvršena provera', async () => {
  const { vault, skripte, revision } = await pripremi();
  await fs.writeFile(path.join(skripte, 'NALAZ-1.sh'), '#!/usr/bin/env bash\necho "OBORENO: proba"\nexit 0\n');

  // Kontrola: sa ispravnim sandboxom isti skript je izvršen i nalaz je priznat.
  const [kontrola] = await runReproductionScripts({
    repoRoot: vault.root, revision, worktreeDir: skripte, scripts: ['NALAZ-1.sh'], timeoutMs: 30_000,
  });
  assert.equal(kontrola.executed, true, 'ispravan sandbox mora da izvrši skript');

  // Kontrolisana greška okruženja: bwrap se prekida pre nego što pokrene skript
  // (isti tekst koji je istorijski prijavljen na a0dc5c8).
  const bin = path.join(vault.root, '.probni-bin');
  await fs.mkdir(bin, { recursive: true });
  const lazniBwrap = path.join(bin, 'bwrap');
  await fs.writeFile(lazniBwrap, '#!/usr/bin/env bash\necho "bwrap: loopback: Failed to create NETLINK_ROUTE socket: Operation not permitted" >&2\nexit 1\n');
  await fs.chmod(lazniBwrap, 0o755);

  const stariPath = process.env.PATH;
  process.env.PATH = `${bin}:${stariPath}`;
  try {
    const [rezultat] = await runReproductionScripts({
      repoRoot: vault.root, revision, worktreeDir: skripte, scripts: ['NALAZ-1.sh'], timeoutMs: 30_000,
    });
    assert.equal(rezultat.reproduced, false);
    assert.equal(rezultat.executed, false, 'sandbox koji nije pokrenuo skript je neizvršena provera, ne lažni nalaz');
    assert.match(rezultat.output, /NETLINK_ROUTE/);
  } finally {
    process.env.PATH = stariPath;
    await vault.cleanup();
  }
});

test('reprodukcija: skript koji sam ispiše „bwrap:" je izvršen, ne neizvršen', async () => {
  const { vault, skripte, revision } = await pripremi();
  // Kontraprimer iz nezavisne verifikacije (T4): tekst izlaza ne sme da
  // odlučuje o tome da li je provera izvršena.
  await fs.writeFile(path.join(skripte, 'NALAZ-1.sh'), '#!/usr/bin/env bash\necho "bwrap: poruka samog skripta" >&2\nexit 1\n');
  const [rezultat] = await runReproductionScripts({
    repoRoot: vault.root, revision, worktreeDir: skripte, scripts: ['NALAZ-1.sh'], timeoutMs: 30_000,
  });
  assert.equal(rezultat.executed, true, 'skript se stvarno izvršio, pa nije neizvršena provera');
  assert.equal(rezultat.reproduced, false, 'skript koji nije oborio tvrdnju je lažni nalaz');
  await vault.cleanup();
});

test('reprodukcija: skript koji se ne učitava (sintaksna greška) je neizvršena provera', async () => {
  const { vault, skripte, revision } = await pripremi();
  // Kontraprimer iz nezavisne verifikacije: interpreter startuje, ali telo
  // provere nikad ne dobija kontrolu — to ne sme da se broji kao lažni nalaz.
  await fs.writeFile(path.join(skripte, 'NALAZ-1.py'), 'if True print("NIKAD")\n');
  const [rezultat] = await runReproductionScripts({
    repoRoot: vault.root, revision, worktreeDir: skripte, scripts: ['NALAZ-1.py'], timeoutMs: 30_000,
  });
  assert.equal(rezultat.executed, false, 'skript se nije učitao, pa provera nije izvršena');
  assert.equal(rezultat.reproduced, false);
  await vault.cleanup();
});

test('reprodukcija: skript koji izađe preko os._exit je i dalje izvršen', async () => {
  const { vault, skripte, revision } = await pripremi();
  // Kontraprimer iz nezavisne verifikacije: izlazak bez pražnjenja bafera ne
  // sme da obriše dokaz da je provera pokrenuta.
  await fs.writeFile(path.join(skripte, 'NALAZ-1.py'), 'import os\nos.write(2, b"TELO_IZVRSENO\\n")\nos._exit(1)\n');
  const [rezultat] = await runReproductionScripts({
    repoRoot: vault.root, revision, worktreeDir: skripte, scripts: ['NALAZ-1.py'], timeoutMs: 30_000,
  });
  assert.equal(rezultat.executed, true, 'telo skripta se izvršilo pre izlaska');
  assert.equal(rezultat.reproduced, false);
  await vault.cleanup();
});

test('reprodukcija: skript koji koristi __file__ radi isto kao pri direktnom pokretanju', async () => {
  const { vault, skripte, revision } = await pripremi();
  // Kontraprimer iz treće nezavisne verifikacije: pokretač ne sme da menja
  // uslove izvršavanja skripta (__file__, __name__, sys.argv).
  await fs.writeFile(path.join(skripte, 'NALAZ-1.py'), [
    'from pathlib import Path',
    'assert __name__ == "__main__", __name__',
    'if Path(__file__).is_file():',
    '    print("OBORENO: provera izvrsena")',
    '',
  ].join('\n'));
  const [rezultat] = await runReproductionScripts({
    repoRoot: vault.root, revision, worktreeDir: skripte, scripts: ['NALAZ-1.py'], timeoutMs: 30_000,
  });
  assert.equal(rezultat.reproduced, true, rezultat.output);
  assert.equal(rezultat.executed, true);
  await vault.cleanup();
});

