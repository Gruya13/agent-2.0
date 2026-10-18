/**
 * Nagli prekid kontrolnog procesa (kill -9) i oporavak.
 *
 * W6 pokriva uredan povrat greške harnesa; ovi testovi pokrivaju stvarno ubijanje
 * procesa: (1) tokom izrade sa aktivnim zakupom, (2) posle prihvatanja coding
 * promene a pre wiki zapisa/evidencije.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { promises as fsp } from 'node:fs';
import { loadConfig, PACKAGE_ROOT } from '../tools/orchestrator/lib/config.mjs';
import { createStore } from '../tools/orchestrator/lib/store.mjs';
import { createCodingPipeline } from '../tools/orchestrator/lib/coding.mjs';
import { gitExec } from './helpers/vault.mjs';
import { ISPRAVKA, pripremiCoding, skriptaProgramera } from './helpers/coding-fixture.mjs';

const RUNNER = path.join(PACKAGE_ROOT, 'tests', 'helpers', 'code-runner.mjs');
const cekaj = (ms) => new Promise((r) => setTimeout(r, ms));

async function cekajFajl(put, timeoutMs = 15000) {
  const kraj = Date.now() + timeoutMs;
  while (Date.now() < kraj) {
    if (await fsp.access(put).then(() => true).catch(() => false)) return true;
    await cekaj(50);
  }
  return false;
}

function pokreni(vaultRoot, id, env) {
  // `detached` daje zasebnu procesnu grupu: SIGKILL na grupu ubija i `git` decu
  // (npr. `git commit` koji visi u pre-commit hook-u), inače dete ostane živo i
  // drži `.git/index.lock`, pa sledeći pokušaj pada — flaky CR2.
  const child = spawn(process.execPath, [RUNNER, vaultRoot, id], {
    cwd: PACKAGE_ROOT,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  let out = '';
  let err = '';
  child.stdout.on('data', (c) => { out += c.toString(); });
  child.stderr.on('data', (c) => { err += c.toString(); });
  return { child, ispis: () => out, greska: () => err };
}

test('CR1: kill tokom izrade — zakup istekne, zadatak nije zarobljen, nastavak prolazi', async () => {
  const { vault, config, store, coding, zadatak } = await pripremiCoding({ lease: { ttlMs: 1500, heartbeatMs: 500 } });
  // Zaseban proces čita konfiguraciju iz FAJLA — kratak TTL mora biti i tamo.
  await fs.mkdir(path.join(vault.root, 'tools', 'config'), { recursive: true });
  await fs.writeFile(
    path.join(vault.root, 'tools', 'config', 'agents.yml'),
    'lease:\n  ttlMs: 1500\n  heartbeatMs: 500\n',
    'utf8',
  );
  const marker = path.join(vault.root, '.runtime-kill-marker');
  // Spori "programer": markira da je zakup uzet i spava dok ga ne ubijemo.
  const spori = `bash -c "touch ${marker}; sleep 60"`;
  const p = pokreni(vault.root, zadatak.data.id, { AGENT_2_0_MOCK_CODE_CMD: spori });
  try {
    assert.equal(await cekajFajl(marker), true, 'mock programer nije stigao do markera');
    const uTok = await store.get(zadatak.data.id);
    assert.equal(uTok.data.status, 'in_progress');
    assert.ok(uTok.data.lease_expires_at, 'zakup mora biti zabeležen');
    const stariToken = uTok.data.lock_token;

    // Ubij CELU procesnu grupu (i `git` decu), ne samo node proces.
    try { process.kill(-p.child.pid, 'SIGKILL'); } catch { p.child.kill('SIGKILL'); }
    await new Promise((r) => p.child.on('close', r));

    // Zakup istekne po postojećim pravilima i novi proces ga vraća u opticaj.
    await cekaj(2000);
    const vraceni = await store.reclaimExpired();
    assert.ok(vraceni.some((x) => x.id === zadatak.data.id), 'istekao zakup mora biti opozvan');
    const posle = await store.get(zadatak.data.id);
    assert.equal(posle.data.status, 'ready');
    assert.equal(posle.data.lock_owner, null, 'nema trajno zarobljenog zadatka');

    // Stari token više ne vredi.
    await assert.rejects(
      () => store.renew(zadatak.data.id, 'agentctl', { token: stariToken }),
      /ne drži|istekao|NOT_OWNER|drugi proces/,
    );

    // Nastavak u novom procesu dovršava izradu.
    process.env.AGENT_2_0_MOCK_CODE_CMD = await skriptaProgramera(ISPRAVKA);
    const nastavak = await coding.runCodeTask(zadatak.data.id);
    assert.equal(nastavak.ok, true, JSON.stringify(nastavak));
    assert.equal((await store.get(zadatak.data.id)).data.status, 'verified');
  } finally {
    delete process.env.AGENT_2_0_MOCK_CODE_CMD;
    if (p.child.exitCode === null) {
      try { process.kill(-p.child.pid, 'SIGKILL'); } catch { p.child.kill('SIGKILL'); }
    }
    await vault.cleanup();
  }
});

test('CR2: kill posle prihvatanja a pre wiki zapisa — nastavak ne duplira merge', async () => {
  const { vault, config, store, coding, cilj, zadatak } = await pripremiCoding({ lease: { ttlMs: 1500, heartbeatMs: 500 } });
  await fs.mkdir(path.join(vault.root, 'tools', 'config'), { recursive: true });
  await fs.writeFile(
    path.join(vault.root, 'tools', 'config', 'agents.yml'),
    'lease:\n  ttlMs: 1500\n  heartbeatMs: 500\n',
    'utf8',
  );
  process.env.AGENT_2_0_MOCK_CODE_CMD = await skriptaProgramera(ISPRAVKA);
  try {
    await coding.runCodeTask(zadatak.data.id); // izrada
    await coding.runCodeTask(zadatak.data.id); // pregled

    // Uspori wiki zapis: pre-commit hook u KONTROLNOM repou spava.
    const hook = path.join(vault.root, '.git', 'hooks', 'pre-commit');
    await fs.mkdir(path.dirname(hook), { recursive: true });
    await fs.writeFile(hook, '#!/bin/sh\nsleep 30\n', 'utf8');
    await fs.chmod(hook, 0o755);

    const p = pokreni(vault.root, zadatak.data.id, { AGENT_2_0_MOCK_CODE_CMD: process.env.AGENT_2_0_MOCK_CODE_CMD });
    // Čekamo da merge u ciljnom repou postoji (prihvatanje je prošlo).
    const kraj = Date.now() + 20000;
    let spojeno = false;
    while (Date.now() < kraj && !spojeno) {
      const log = (await gitExec(cilj.root, ['log', '--oneline'])).stdout;
      spojeno = /prihvacena popravka/.test(log);
      if (!spojeno) await cekaj(100);
    }
    assert.equal(spojeno, true, 'merge u ciljnom repou nije nastao pre prekida');

    try { process.kill(-p.child.pid, 'SIGKILL'); } catch { p.child.kill('SIGKILL'); }
    await new Promise((r) => p.child.on('close', r));
    await fs.rm(hook, { force: true });
    // Zaostali `git` iz ubijene grupe ne sme da drži lock; ako ga ipak ima,
    // sačekaj kratko da nestane (ne uklanjaj lock ručno — to bi prikrilo uzrok).
    const lock = path.join(vault.root, '.git', 'index.lock');
    for (let i = 0; i < 40; i += 1) {
      if (!(await fs.access(lock).then(() => true).catch(() => false))) break;
      await cekaj(50);
    }

    // Mrtav proces drži zakup do isteka TTL-a; nov proces ga opoziva po pravilima.
    await cekaj(2000);
    await store.reclaimExpired();

    const posle = await store.get(zadatak.data.id);
    assert.ok(posle.data.code_evidence.accept?.merge, 'prihvaćena promena je zabeležena');
    assert.ok(!posle.data.code_evidence.memory_write, 'wiki zapis nije završen');
    assert.notEqual(posle.data.status, 'consolidated');

    // Nastavak: samo faza zapisa, bez novog merge-a.
    const nastavak = await coding.runCodeTask(zadatak.data.id);
    assert.equal(nastavak.ok, true, JSON.stringify(nastavak));
    assert.equal(nastavak.step, 'memory', 'nastavak izvršava samo zapis u memoriju');
    const krajnje = await store.get(zadatak.data.id);
    assert.equal(krajnje.data.status, 'consolidated');
    assert.equal(await fsp.access(path.join(vault.root, 'wiki', 'Izmene', 'TASK-101.md')).then(() => true), true);

    const log = (await gitExec(cilj.root, ['log', '--oneline'])).stdout;
    assert.equal((log.match(/prihvacena popravka/g) ?? []).length, 1, 'merge nije dupliran');

    // Evidencija mora biti potpuna: i prihvatanje i zapis (inače sledeći poziv
    // baca NOT_READY, a zapis je već obavljen).
    assert.ok(krajnje.data.code_evidence.memory_write, 'memory_write mora biti zabeležen');
    const posleZapisa = await coding.runCodeTask(zadatak.data.id);
    assert.equal(posleZapisa.step, 'done', 'završen zadatak se ne obrađuje ponovo');
  } finally {
    delete process.env.AGENT_2_0_MOCK_CODE_CMD;
    await vault.cleanup();
  }
});
test('CR3: merge u Gitu bez evidencije o prihvatanju — oporavak dopunjuje zapis', async () => {
  const { vault, coding, cilj, store, zadatak } = await pripremiCoding({ lease: { ttlMs: 60000, heartbeatMs: 5000 } });
  process.env.AGENT_2_0_MOCK_CODE_CMD = await skriptaProgramera(ISPRAVKA);
  try {
    await coding.runCodeTask(zadatak.data.id); // izrada
    await coding.runCodeTask(zadatak.data.id); // pregled
    const pre = await store.get(zadatak.data.id);
    const pregledan = pre.data.code_evidence.review.sha;

    // Simuliraj prekid IZMEDJU merge-a i upisa evidencije: merge je u Gitu,
    // a `accept` nije zabeležen.
    await gitExec(cilj.root, ['-c', 'user.name=agentctl', '-c', 'user.email=agentctl@local', 'merge', '--no-ff', '-m', `agentctl(${zadatak.data.id}): prihvacena popravka`, pregledan]);
    await store.setFields(zadatak.data.id, {
      code_evidence: { ...pre.data.code_evidence, accept: null },
    }, { actor: 'agentctl', note: 'fixture: prekid pre evidencije' });

    const r = await coding.runCodeTask(zadatak.data.id);
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.recovered, true, 'nastavak mora prepoznati merge iz Gita');
    const posle = await store.get(zadatak.data.id);
    assert.equal(posle.data.status, 'consolidated');
    assert.ok(posle.data.code_evidence.memory_write, 'zapis mora biti u evidenciji');
    assert.equal(posle.data.code_evidence.accept.recovered, true);
    const log = (await gitExec(cilj.root, ['log', '--oneline'])).stdout;
    assert.equal((log.match(/prihvacena popravka/g) ?? []).length, 1, 'merge nije dupliran');
    // Ponovni poziv ne radi ništa (nema NOT_READY).
    const opet = await coding.runCodeTask(zadatak.data.id);
    assert.equal(opet.step, 'done');
  } finally {
    delete process.env.AGENT_2_0_MOCK_CODE_CMD;
    await vault.cleanup();
  }
});
