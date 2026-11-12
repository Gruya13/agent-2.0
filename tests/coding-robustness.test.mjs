/**
 * Kontrolne provere coding toka (nalazi iz nezavisnog pregleda koda).
 *
 * Svaki test prvo treba da PADNE na kodu bez ispravke — to je dokaz propusta —
 * a posle ispravke postaje regresioni dokaz.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gitExec } from './helpers/vault.mjs';
import { ISPRAVKA, pripremiCoding, skriptaProgramera } from './helpers/coding-fixture.mjs';

test('R1: pregled bez izričitog pass ne sme dovesti do prihvatanja', async () => {
  const { vault, store, coding, zadatak } = await pripremiCoding();
  process.env.AGENT_2_0_MOCK_CODE_CMD = await skriptaProgramera(ISPRAVKA);
  try {
    const izrada = await coding.runCodeTask(zadatak.data.id);
    assert.equal(izrada.ok, true, JSON.stringify(izrada));

    process.env.AGENT_2_0_MOCK_REVIEW_NO_VERDICT = '1';
    const pregled = await coding.runCodeTask(zadatak.data.id);
    assert.equal(pregled.ok, false, 'pregled bez verdikta mora biti odbijen');

    const prihvatanje = await coding.runCodeTask(zadatak.data.id);
    assert.equal(prihvatanje.ok, false, 'bez važećeg pass-a prihvatanje nije dozvoljeno');
    assert.notEqual((await store.get(zadatak.data.id)).data.status, 'consolidated');
  } finally {
    delete process.env.AGENT_2_0_MOCK_REVIEW_NO_VERDICT;
    delete process.env.AGENT_2_0_MOCK_CODE_CMD;
    await vault.cleanup();
  }
});

test('R2: zakup se obnavlja tokom dugog coding poziva', async () => {
  const { vault, store, coding, zadatak } = await pripremiCoding({ lease: { ttlMs: 400, heartbeatMs: 150 } });
  const sporo = await skriptaProgramera(
    "await new Promise((r) => setTimeout(r, 1200));\n" + ISPRAVKA,
  );
  process.env.AGENT_2_0_MOCK_CODE_CMD = sporo;
  try {
    const tok = coding.runCodeTask(zadatak.data.id);
    await new Promise((r) => setTimeout(r, 800));
    const uTokу = await store.get(zadatak.data.id);
    assert.ok(
      Date.parse(uTokу.data.lease_expires_at) > Date.now(),
      `zakup je istekao tokom rada (expires=${uTokу.data.lease_expires_at})`,
    );
    const rezultat = await tok;
    assert.equal(rezultat.ok, true, JSON.stringify(rezultat));
    assert.equal((await store.get(zadatak.data.id)).data.status, 'verified');
  } finally {
    delete process.env.AGENT_2_0_MOCK_CODE_CMD;
    await vault.cleanup();
  }
});

test('R3: stari pass ne odobrava granu koja je posle pregleda promenjena', async () => {
  const { vault, store, coding, cilj, zadatak } = await pripremiCoding();
  process.env.AGENT_2_0_MOCK_CODE_CMD = await skriptaProgramera(ISPRAVKA);
  try {
    await coding.runCodeTask(zadatak.data.id);
    await coding.runCodeTask(zadatak.data.id);
    const poslePregleda = await store.get(zadatak.data.id);
    assert.ok(poslePregleda.data.code_evidence.review, 'pregled mora biti završen');

    // Neovlašćena izmena kandidatske grane POSLE pregleda.
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent2-posle-'));
    await fs.rm(dir, { recursive: true, force: true });
    await gitExec(cilj.root, ['worktree', 'add', '--quiet', dir, 'agent/code/TASK-101']);
    await fs.writeFile(path.join(dir, 'src', 'podmetnuto.js'), '// van pregleda\n');
    await gitExec(dir, ['-c', 'user.name=x', '-c', 'user.email=x@local', 'add', '-A']);
    await gitExec(dir, ['-c', 'user.name=x', '-c', 'user.email=x@local', 'commit', '-q', '-m', 'posle pregleda']);
    await gitExec(cilj.root, ['worktree', 'remove', '--force', dir]);

    const prihvatanje = await coding.runCodeTask(zadatak.data.id);
    assert.equal(prihvatanje.ok, false, 'izmena posle pregleda ne sme biti prihvaćena');
    assert.notEqual((await store.get(zadatak.data.id)).data.status, 'consolidated');
  } finally {
    delete process.env.AGENT_2_0_MOCK_CODE_CMD;
    await vault.cleanup();
  }
});
test('R4: nezavisan pregled traži različit vendor od autora popravke', async () => {
  const { vault, config, store, coding, zadatak } = await pripremiCoding();
  process.env.AGENT_2_0_MOCK_CODE_CMD = await skriptaProgramera(ISPRAVKA);
  try {
    await coding.runCodeTask(zadatak.data.id);
    config.agents.reviewer = { adapter: 'harness', harness: 'mock-programer' };
    const pregled = await coding.runCodeTask(zadatak.data.id);
    assert.equal(pregled.ok, false, 'isti vendor ne sme da važi kao nezavisan pregled');
    assert.match(String(pregled.reason), /isti vendor/);
    assert.equal((await store.get(zadatak.data.id)).data.code_evidence.review, undefined);
  } finally {
    delete process.env.AGENT_2_0_MOCK_CODE_CMD;
    await vault.cleanup();
  }
});

test('R5: postojeći test se ne sme menjati', async () => {
  const { vault, coding, zadatak } = await pripremiCoding();
  process.env.AGENT_2_0_MOCK_CODE_CMD = await skriptaProgramera([
    "import { readFileSync, writeFileSync } from 'node:fs';",
    "writeFileSync('src/parse.js', readFileSync('src/parse.js', 'utf8')",
    "  .replace('return n || podrazumevano;', 'return Number.isNaN(n) ? podrazumevano : n;'));",
    "writeFileSync('tests/parse.test.js', '// oslabljen test\\n');",
  ].join('\n'));
  try {
    const rezultat = await coding.runCodeTask(zadatak.data.id);
    assert.equal(rezultat.ok, false);
    assert.match(String(rezultat.reason), /postojeći testovi su menjani/);
  } finally {
    delete process.env.AGENT_2_0_MOCK_CODE_CMD;
    await vault.cleanup();
  }
});

test('R6: preskočen regresioni test nije dokaz', async () => {
  const { vault, coding, zadatak } = await pripremiCoding();
  process.env.AGENT_2_0_MOCK_CODE_CMD = await skriptaProgramera([
    "import { readFileSync, writeFileSync } from 'node:fs';",
    "writeFileSync('src/parse.js', readFileSync('src/parse.js', 'utf8')",
    "  .replace('return n || podrazumevano;', 'return Number.isNaN(n) ? podrazumevano : n;'));",
    "writeFileSync('tests/parse.zero.test.js', \"import test from 'node:test';\\ntest.skip('nula', () => {});\\n\");",
  ].join('\n'));
  try {
    const rezultat = await coding.runCodeTask(zadatak.data.id);
    assert.equal(rezultat.ok, false);
    assert.match(String(rezultat.reason), /preskakanje/);
  } finally {
    delete process.env.AGENT_2_0_MOCK_CODE_CMD;
    await vault.cleanup();
  }
});

test('R7: simbolički link na kontrolni repo se odbija', async () => {
  const { vault, coding } = await pripremiCoding();
  try {
    const link = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'agent2-link-')), 'repo');
    await fs.symlink(vault.root, link, 'dir');
    await assert.rejects(
      () => coding.dodajCodeZadatak({
        title: 'Preko linka',
        requirement: 'Ovaj zadatak ne sme da prođe jer link vodi u kontrolni repozitorijum.',
        target: link, base: 'HEAD', scope: ['src/**'], testCommand: 'npm test',
      }),
      /kontrolni repo/,
    );
  } finally {
    await vault.cleanup();
  }
});

test('R8: postojeći MEMORY.md ciljnog projekta se ne prepisuje', async () => {
  const projekatski = '# Projektna memorija\n\nOvo je fajl ciljnog projekta i ne sme se dirati.\n';
  const { vault, coding, cilj, zadatak } = await pripremiCoding({ extra: { 'MEMORY.md': projekatski } });
  process.env.AGENT_2_0_MOCK_CODE_CMD = await skriptaProgramera(ISPRAVKA);
  try {
    for (let i = 0; i < 3; i += 1) {
      const r = await coding.runCodeTask(zadatak.data.id);
      assert.equal(r.ok, true, JSON.stringify(r));
    }
    const posle = (await gitExec(cilj.root, ['show', 'HEAD:MEMORY.md'])).stdout + '\n';
    assert.equal(posle, projekatski, 'projektni MEMORY.md mora ostati nepromenjen');
  } finally {
    delete process.env.AGENT_2_0_MOCK_CODE_CMD;
    await vault.cleanup();
  }
});

test('R9: neuspeh upisa dokaznog taga ne prihvata promenu', async () => {
  const { vault, coding, cilj, zadatak } = await pripremiCoding();
  process.env.AGENT_2_0_MOCK_CODE_CMD = await skriptaProgramera(ISPRAVKA);
  try {
    await coding.runCodeTask(zadatak.data.id);
    await coding.runCodeTask(zadatak.data.id);
    const pre = (await gitExec(cilj.root, ['rev-parse', 'HEAD'])).stdout.trim();
    const refDir = path.join(cilj.root, '.git', 'refs', 'tags', 'dokaz');
    await fs.mkdir(refDir, { recursive: true });
    await fs.writeFile(path.join(refDir, 'TASK-101-accept.lock'), '', 'utf8');

    const prihvatanje = await coding.runCodeTask(zadatak.data.id);
    assert.equal(prihvatanje.ok, false, 'bez sačuvanog dokaza nema prihvatanja');
    assert.match(String(prihvatanje.reason), /dokazni tag/);
    const posle = (await gitExec(cilj.root, ['rev-parse', 'HEAD'])).stdout.trim();
    assert.equal(posle, pre, 'glavna grana se ne sme promeniti ako dokaz nije sačuvan');
  } finally {
    delete process.env.AGENT_2_0_MOCK_CODE_CMD;
    await vault.cleanup();
  }
});

test('R10: klasifikacija pada na osnovi razlikuje tvrdnju od greške', async () => {
  const { vault, coding } = await pripremiCoding();
  try {
    assert.equal(coding.klasifikujPad({ stdout: 'AssertionError [ERR_ASSERTION]', stderr: '' }), 'assertion');
    assert.equal(coding.klasifikujPad({ stdout: '', stderr: 'SyntaxError: Unexpected token' }), 'error');
    assert.equal(coding.klasifikujPad({ stdout: '', stderr: '', timedOut: true }), 'timeout');
  } finally {
    await vault.cleanup();
  }
});
test('R11: TypeError na osnovi nije dokaz buga', async () => {
  const { vault, coding } = await pripremiCoding();
  try {
    assert.equal(coding.klasifikujPad({ stdout: '✖ test', stderr: 'TypeError: x is not a function' }), 'error');
    assert.equal(coding.klasifikujPad({ stdout: '✖ test\nAssertionError [ERR_ASSERTION]', stderr: '' }), 'assertion');
    // Node 26: greška učitavanja test fajla daje samo 'test failed' — to je
    // greška izvršavanja, ne tvrdnja o ponašanju (moraju ostati razlikovani).
    assert.equal(coding.klasifikujPad({ stdout: "✖ test\n  'test failed'", stderr: '' }), 'error');
    // Assertion sa ERR_ASSERTION ostaje assertion i kada se pojavi 'test failed'.
    assert.equal(
      coding.klasifikujPad({ stdout: "✖ test\nERR_ASSERTION\n  'test failed'", stderr: '' }),
      'assertion',
    );
    assert.equal(coding.klasifikujPad({ stdout: '', stderr: 'ERR_MODULE_NOT_FOUND' }), 'error');
    // Nenulti izlaz bez ikakvog signala nije dokaz buga.
    assert.equal(coding.klasifikujPad({ stdout: '', stderr: '', exitCode: 1 }), 'unknown');
  } finally {
    await vault.cleanup();
  }
});

test('R12: test["skip"] notacija se odbija kao preskakanje', async () => {
  const { vault, coding, zadatak } = await pripremiCoding();
  process.env.AGENT_2_0_MOCK_CODE_CMD = await skriptaProgramera([
    "import { readFileSync, writeFileSync } from 'node:fs';",
    "writeFileSync('src/parse.js', readFileSync('src/parse.js', 'utf8')",
    "  .replace('return n || podrazumevano;', 'return Number.isNaN(n) ? podrazumevano : n;'));",
    "writeFileSync('tests/parse.zero.test.js', \"import test from 'node:test';\\ntest['skip']('nula', () => {});\\n\");",
  ].join('\n'));
  try {
    const rezultat = await coding.runCodeTask(zadatak.data.id);
    assert.equal(rezultat.ok, false);
    assert.match(String(rezultat.reason), /preskakanje/);
  } finally {
    delete process.env.AGENT_2_0_MOCK_CODE_CMD;
    await vault.cleanup();
  }
});

test('R13: izmena grane tokom integracione provere ne ulazi u main', async () => {
  const { vault, store, coding, cilj, zadatak } = await pripremiCoding();
  process.env.AGENT_2_0_MOCK_CODE_CMD = await skriptaProgramera(ISPRAVKA);
  try {
    await coding.runCodeTask(zadatak.data.id);
    await coding.runCodeTask(zadatak.data.id);

    // U toku prihvatanja (integraciona provera) neko doda commit na granu.
    const tok = coding.runCodeTask(zadatak.data.id);
    await new Promise((r) => setTimeout(r, 120));
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent2-race-'));
    await fs.rm(dir, { recursive: true, force: true });
    await gitExec(cilj.root, ['worktree', 'add', '--quiet', dir, 'agent/code/TASK-101']);
    await fs.writeFile(path.join(dir, 'src', 'nepregledano.js'), '// posle pregleda\n');
    await gitExec(dir, ['-c', 'user.name=x', '-c', 'user.email=x@local', 'add', '-A']);
    await gitExec(dir, ['-c', 'user.name=x', '-c', 'user.email=x@local', 'commit', '-q', '-m', 'nepregledano']);
    await gitExec(cilj.root, ['worktree', 'remove', '--force', dir]);

    const rezultat = await tok;
    const uMainu = (await gitExec(cilj.root, ['ls-tree', '-r', '--name-only', 'main'])).stdout;
    if (rezultat.ok) {
      assert.doesNotMatch(uMainu, /nepregledano\.js/, 'nepregledana izmena ne sme u main');
    } else {
      assert.notEqual((await store.get(zadatak.data.id)).data.status, 'consolidated');
    }
  } finally {
    delete process.env.AGENT_2_0_MOCK_CODE_CMD;
    await vault.cleanup();
  }
});

test('R14: promenjena osnovica posle pregleda traži nov pregled', async () => {
  const { vault, store, coding, cilj, zadatak } = await pripremiCoding();
  process.env.AGENT_2_0_MOCK_CODE_CMD = await skriptaProgramera(ISPRAVKA);
  try {
    await coding.runCodeTask(zadatak.data.id);
    await coding.runCodeTask(zadatak.data.id);

    // Osnovica se pomera posle pregleda (bez uticaja na kandidata).
    await fs.writeFile(path.join(cilj.root, 'NEUTRALNO.md'), 'neutralna izmena\n');
    await gitExec(cilj.root, ['-c', 'user.name=x', '-c', 'user.email=x@local', 'add', '-A']);
    await gitExec(cilj.root, ['-c', 'user.name=x', '-c', 'user.email=x@local', 'commit', '-q', '-m', 'pomeren main']);

    const prihvatanje = await coding.runCodeTask(zadatak.data.id);
    assert.equal(prihvatanje.ok, false);
    assert.match(String(prihvatanje.reason), /nov pregled/);
    const t = await store.get(zadatak.data.id);
    assert.ok(!t.data.code_evidence.review, 'stari pregled mora biti poništen');
    assert.notEqual(t.data.status, 'consolidated');
  } finally {
    delete process.env.AGENT_2_0_MOCK_CODE_CMD;
    await vault.cleanup();
  }
});

test('R15: tuđi zakup sprečava prihvatanje', async () => {
  const { vault, store, coding, zadatak } = await pripremiCoding();
  process.env.AGENT_2_0_MOCK_CODE_CMD = await skriptaProgramera(ISPRAVKA);
  try {
    await coding.runCodeTask(zadatak.data.id);
    await coding.runCodeTask(zadatak.data.id);
    // Drugi proces preuzima zakup pod svojim tokenom pre nego što prvi prihvati.
    await store.claim(zadatak.data.id, 'agentctl', { force: true, token: 'tudji-token' });
    // Faza ne sme da preuzme tuđi zakup: prihvatanje je onemogućeno.
    const prihvatanje = await coding.runCodeTask(zadatak.data.id).catch((error) => ({ ok: false, reason: error.message }));
    assert.equal(prihvatanje.ok, false, JSON.stringify(prihvatanje));
    assert.notEqual((await store.get(zadatak.data.id)).data.status, 'consolidated');
  } finally {
    delete process.env.AGENT_2_0_MOCK_CODE_CMD;
    await vault.cleanup();
  }
});

test('R16: zakup ostaje živ i tokom duge provere na osnovi', async () => {
  // Dogfood P6: pod `--test-concurrency=4` zidni sat je pravio flaky pad.
  // TTL je podignut da heartbeat ima više od jednog promašenog otkucaja margine,
  // a test i dalje dokazuje da se zakup obnavlja tokom duge provere.
  const { vault, store, coding, zadatak } = await pripremiCoding({
    lease: { ttlMs: 1500, heartbeatMs: 200 },
    testCommand: 'sleep 0.6 && npm test',
  });
  process.env.AGENT_2_0_MOCK_CODE_CMD = await skriptaProgramera(ISPRAVKA);
  try {
    const tok = coding.runCodeTask(zadatak.data.id);
    let istekao = false;
    const gledaj = setInterval(async () => {
      try {
        const t = await store.get(zadatak.data.id);
        if (t.data.status === 'in_progress' && t.data.lease_expires_at
          && Date.parse(t.data.lease_expires_at) < Date.now()) istekao = true;
      } catch { /* zadatak je u prelazu */ }
    }, 50);
    const rezultat = await tok;
    clearInterval(gledaj);
    assert.equal(rezultat.ok, true, JSON.stringify(rezultat));
    assert.equal(istekao, false, 'zakup je istekao tokom faze');
  } finally {
    delete process.env.AGENT_2_0_MOCK_CODE_CMD;
    await vault.cleanup();
  }
});
test('R17: timeout (exit 124) nije dokaz buga i ako sadrži assertion poruku', async () => {
  const { vault, coding } = await pripremiCoding();
  try {
    assert.equal(coding.klasifikujPad({
      stdout: '✖ nula\nAssertionError [ERR_ASSERTION]', stderr: '', exitCode: 124,
    }), 'timeout');
    assert.equal(coding.klasifikujPad({ stdout: '', stderr: '', exitCode: 1, timedOut: true }), 'timeout');
    assert.equal(coding.klasifikujPad({
      stdout: '✖ nula\nAssertionError [ERR_ASSERTION]', stderr: '', exitCode: 1,
    }), 'assertion');
  } finally {
    await vault.cleanup();
  }
});

test('R18: test[`skip`] notacija se odbija kao preskakanje', async () => {
  const { vault, coding, zadatak } = await pripremiCoding();
  process.env.AGENT_2_0_MOCK_CODE_CMD = await skriptaProgramera([
    "import { readFileSync, writeFileSync } from 'node:fs';",
    "writeFileSync('src/parse.js', readFileSync('src/parse.js', 'utf8')",
    "  .replace('return n || podrazumevano;', 'return Number.isNaN(n) ? podrazumevano : n;'));",
    "const bt = String.fromCharCode(96);",
    "writeFileSync('tests/parse.zero.test.js', \"import test from 'node:test';\\ntest[\" + bt + \"skip\" + bt + \"](\\'nula\\', () => {});\\n\");",
  ].join('\n'));
  try {
    const rezultat = await coding.runCodeTask(zadatak.data.id);
    assert.equal(rezultat.ok, false);
    assert.match(String(rezultat.reason), /preskakanje/);
  } finally {
    delete process.env.AGENT_2_0_MOCK_CODE_CMD;
    await vault.cleanup();
  }
});

test('R19: gubitak zakupa tokom upisa taga sprečava prihvatanje', async () => {
  const { vault, store, coding, cilj, zadatak } = await pripremiCoding({ lease: { ttlMs: 300, heartbeatMs: 80 } });
  process.env.AGENT_2_0_MOCK_CODE_CMD = await skriptaProgramera(ISPRAVKA);
  try {
    await coding.runCodeTask(zadatak.data.id);
    await coding.runCodeTask(zadatak.data.id);
    const pre = (await gitExec(cilj.root, ['rev-parse', 'main'])).stdout.trim();

    // Usporen upis taga: hook zadržava referentnu transakciju.
    const hookDir = path.join(cilj.root, '.git', 'hooks');
    await fs.mkdir(hookDir, { recursive: true });
    const hook = path.join(hookDir, 'reference-transaction');
    await fs.writeFile(hook, '#!/bin/sh\nsleep 0.5\n', 'utf8');
    await fs.chmod(hook, 0o755);

    const tok = coding.runCodeTask(zadatak.data.id);
    await new Promise((r) => setTimeout(r, 250));
    const tudji = await store.claim(zadatak.data.id, 'agentctl', { force: true, token: 'tudji-token' }).then(() => true).catch(() => false);
    const rezultat = await tok.catch((e) => ({ ok: false, reason: e.message }));
    await fs.rm(hook, { force: true });

    const posle = (await gitExec(cilj.root, ['rev-parse', 'main'])).stdout.trim();
    if (tudji) {
      assert.equal(rezultat.ok, false, 'posle preuzimanja zakupa nema prihvatanja');
      assert.equal(posle, pre, 'main se ne sme promeniti');
    }
  } finally {
    delete process.env.AGENT_2_0_MOCK_CODE_CMD;
    await vault.cleanup();
  }
});

test('R20: greška pokretanja repro komande nije dokaz buga (spawn greška)', async () => {
  // `exec` baca grešku sa string `code` kada proces ne može da se pokrene ili
  // prekorači maxBuffer; to NIJE izlazni kod testa. Nepostojeća komanda kroz
  // shell daje 127 (legitiman kod), ali greška pokretanja/buffera ne sme da se
  // pretvori u 1 i prođe kao reprodukcija.
  const prelivanje = `node -e ${JSON.stringify("process.stdout.write('x'.repeat(17*1024*1024))")}`;
  const { vault, coding, zadatak } = await pripremiCoding({ reproCommand: prelivanje });
  try {
    const rezultat = await coding.runCodeTask(zadatak.data.id);
    assert.equal(rezultat.ok, false, 'greška izvršavanja ne sme da prođe kao reprodukcija');
    assert.match(String(rezultat.reason), /nije pokrenula|buffer|spawn/i);
    // Isti slučaj kroz klasifikaciju: greška izvršavanja, nikad tvrdnja o ponašanju.
    assert.equal(coding.klasifikujPad({ spawnError: 'ENOENT', stdout: '', stderr: '' }), 'error');
  } finally {
    await vault.cleanup();
  }
});

test('R21: nepostojeća komanda u shellu (127) nije dokaz buga', async () => {
  // Shell se pokrene i vrati 127; to nije pad testa nego komanda koje nema.
  const { vault, coding, zadatak } = await pripremiCoding({ reproCommand: 'nepostojeca-komanda-za-repro-xyz' });
  try {
    const rezultat = await coding.runCodeTask(zadatak.data.id);
    assert.equal(rezultat.ok, false, 'shell 127 ne sme da prođe kao reprodukcija');
    assert.match(String(rezultat.reason), /nije pokrenula|not-runnable/i);
  } finally {
    await vault.cleanup();
  }
});
