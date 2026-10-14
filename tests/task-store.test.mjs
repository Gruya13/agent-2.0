import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { makeVault } from './helpers/vault.mjs';
import { PACKAGE_ROOT, loadConfig } from '../tools/orchestrator/lib/config.mjs';
import { createStore } from '../tools/orchestrator/lib/store.mjs';
import {
  TRANSITIONS, TaskError, assertTransition, canTransition, defaultBody, formatTask,
  newTaskData, nextTaskId, parseTaskText, phaseFor, validateTaskData, writeTaskFile,
} from '../tools/orchestrator/lib/task.mjs';
import { clearLease, isLeaseLive, leaseExpired, leaseInfo, newLease } from '../tools/orchestrator/lib/lease.mjs';
import { readJsonl, withFileLock } from '../tools/orchestrator/lib/fsx.mjs';

async function setup() {
  const vault = await makeVault();
  const config = await loadConfig(vault.root);
  return { vault, config };
}

async function seedTask(config, { id = 'TASK-001', status = 'ready', title = 'Test zadatak' } = {}) {
  const { data, body } = newTaskData({ id, title, source: 'raw/dokument.md', body: defaultBody(title) });
  const final = { ...data, status };
  await writeTaskFile(path.join(config.inbox, `${id}.md`), final, body);
  return final;
}

test('automat stanja: dozvoljeni i nedozvoljeni prelazi', () => {
  assert.equal(canTransition('proposed', 'ready'), true);
  assert.equal(canTransition('ready', 'in_progress'), true);
  assert.equal(canTransition('in_progress', 'review'), true);
  assert.equal(canTransition('review', 'verified'), true);
  assert.equal(canTransition('verified', 'consolidated'), true);
  assert.equal(canTransition('proposed', 'consolidated'), false);
  assert.equal(canTransition('ready', 'verified'), false);
  assert.equal(canTransition('consolidated', 'ready'), false);
  assert.throws(() => assertTransition('proposed', 'consolidated'), TaskError);
  assert.throws(() => assertTransition('ready', 'nepoznato'), TaskError);
  // Preuzimanje zadatka u sledeću fazu je dozvoljeno iz svih "čekajućih" stanja.
  for (const status of ['ready', 'review', 'verified']) {
    assert.equal(canTransition(status, 'in_progress'), true, `${status} -> in_progress`);
  }
  // Nijedan prelaz ne sme da vodi u konsolidaciju bez verifikacije osim iz verified/in_progress.
  assert.equal(TRANSITIONS.review.includes('consolidated'), false);
});

test('fazne fascikle prate status', () => {
  assert.equal(phaseFor('proposed'), 'inbox');
  assert.equal(phaseFor('ready'), 'inbox');
  assert.equal(phaseFor('blocked'), 'inbox');
  assert.equal(phaseFor('in_progress'), 'active');
  assert.equal(phaseFor('review'), 'review');
  assert.equal(phaseFor('verified'), 'review');
  assert.equal(phaseFor('consolidated'), 'completed');
});

test('validacija zadatka odbija neispravne šeme', () => {
  const base = { id: 'TASK-001', title: 'T', status: 'ready', created: '2025-01-01T00:00:00.000Z', updated: '2025-01-01T00:00:00.000Z' };
  assert.deepEqual(validateTaskData(base), []);
  assert.match(validateTaskData({ ...base, id: 'X-1' })[0], /neispravan id/);
  assert.match(validateTaskData({ ...base, status: 'izmišljeno' })[0], /nepoznat status/);
  assert.match(validateTaskData({ ...base, created: 12 })[0], /ISO-8601/);
  assert.match(validateTaskData({ ...base, status: 'blocked' })[0], /blocked_reason/);
  assert.match(validateTaskData({ ...base, status: 'in_progress' })[0], /lock_owner/);
  assert.equal(validateTaskData({ ...base, tags: 'nije-lista' }).length, 1);
});

test('zadatak: round-trip kroz Markdown + YAML frontmatter je idempotentan', () => {
  const { data, body } = newTaskData({ id: 'TASK-007', title: 'Naslov: sa dvotočkom', body: defaultBody('Naslov') });
  const text = formatTask(data, body);
  const parsed = parseTaskText(text, 'mem');
  assert.deepEqual(parsed.data, data);
  // Kanonski oblik uvodi tačno jedan prazan red posle zaglavlja.
  assert.equal(parsed.body.replace(/^\n/, ''), body);
  assert.equal(formatTask(parsed.data, parsed.body), text, 'drugi prolaz ne menja fajl');
  assert.throws(() => parseTaskText('bez frontmatter-a'), TaskError);
});

test('lease: matematika isteka i preuzimanja', () => {
  const now = new Date('2025-01-01T00:00:00.000Z');
  const lease = newLease('researcher', 60_000, now);
  const data = { ...lease };
  assert.equal(isLeaseLive(data, now), true);
  assert.equal(isLeaseLive(data, new Date('2025-01-01T00:00:59.000Z')), true);
  assert.equal(isLeaseLive(data, new Date('2025-01-01T00:01:01.000Z')), false);
  assert.equal(leaseExpired(data, new Date('2025-01-01T00:01:01.000Z')), true);
  const info = leaseInfo(data, now);
  assert.equal(info.owner, 'researcher');
  assert.equal(info.remainingMs, 60_000);
  assert.deepEqual(clearLease(), { lock_owner: null, locked_at: null, lease_expires_at: null, lock_token: null });
  assert.throws(() => newLease('', 1000, now), /vlasnik/);
  assert.throws(() => newLease('a', 0, now), /ttl/);
});

test('store: zakup, obnova, otimanje isteklog i oporavak', async () => {
  const { vault, config } = await setup();
  let current = new Date('2025-01-01T00:00:00.000Z');
  const store = createStore(config, { clock: () => current });
  await seedTask(config, { id: 'TASK-001' });

  const prvi = await store.claim('TASK-001', 'researcher', { ttlMs: 60_000 });
  const token = prvi.leaseToken;
  assert.ok(token, 'zakup dobija token koji vezuje zakup za proces');
  let task = await store.get('TASK-001');
  assert.equal(task.data.status, 'in_progress');
  assert.equal(task.phase, 'active');
  assert.equal(task.data.lock_owner, 'researcher');
  assert.equal(task.data.lease_expires_at, '2025-01-01T00:01:00.000Z');

  // Živ zakup se ne otima.
  await assert.rejects(() => store.claim('TASK-001', 'verifier'), /drži "researcher"/);

  // Obnova produžava zakup.
  current = new Date('2025-01-01T00:00:30.000Z');
  await store.renew('TASK-001', 'researcher', { ttlMs: 120_000, token });
  task = await store.get('TASK-001');
  assert.equal(task.data.lease_expires_at, '2025-01-01T00:02:30.000Z');

  // Tuđa obnova je odbijena.
  await assert.rejects(() => store.renew('TASK-001', 'verifier', { token }), /ne drži "verifier"/);
  // Drugi proces ISTOG identiteta ne sme da obnovi zakup (token je drugačiji).
  await assert.rejects(() => store.renew('TASK-001', 'researcher', { token: 'tudji-token' }), /drugi proces/);

  // Posle isteka, zadatak se vraća u opticaj i može ga preuzeti drugi.
  current = new Date('2025-01-01T00:05:00.000Z');
  const reclaimed = await store.reclaimExpired();
  assert.deepEqual(reclaimed.map((r) => r.id), ['TASK-001']);
  task = await store.get('TASK-001');
  assert.equal(task.data.status, 'ready');
  assert.equal(task.phase, 'inbox');
  assert.equal(task.data.lock_owner, null);

  const drugi = await store.claim('TASK-001', 'verifier', { ttlMs: 60_000 });
  task = await store.get('TASK-001');
  assert.equal(task.data.lock_owner, 'verifier');

  // Oslobađanje menja stanje i pomera fajl.
  await store.release('TASK-001', 'verifier', { toStatus: 'review', note: 'predato', token: drugi.leaseToken });
  task = await store.get('TASK-001');
  assert.equal(task.data.status, 'review');
  assert.equal(task.phase, 'review');

  // Dnevnik događaja je append-only i sadrži trag.
  const events = await readJsonl(config.paths.events);
  assert.ok(events.some((e) => e.kind === 'lease.reclaimed' && e.task === 'TASK-001'));
  assert.ok(events.some((e) => e.kind === 'task.write' && e.task === 'TASK-001'));
  await vault.cleanup();
});

test('store: nedozvoljen prelaz ne menja fajl (atomičnost)', async () => {
  const { vault, config } = await setup();
  const store = createStore(config);
  await seedTask(config, { id: 'TASK-002', status: 'proposed' });
  const before = await vault.read('tasks/inbox/TASK-002.md');
  await assert.rejects(() => store.transition('TASK-002', 'consolidated', { actor: 'agentctl' }), /nedozvoljen prelaz/);
  const after = await vault.read('tasks/inbox/TASK-002.md');
  assert.equal(after, before);
  await vault.cleanup();
});

test('nextTaskId: nastavlja od najvećeg postojećeg', async () => {
  const { vault, config } = await setup();
  await seedTask(config, { id: 'TASK-101' });
  await seedTask(config, { id: 'TASK-107' });
  assert.equal(await nextTaskId(config), 'TASK-108');
  await vault.cleanup();
});

test('store: dva istovremena preuzimanja — samo jedan prolazi', async () => {
  const { vault, config } = await setup();
  await seedTask(config, { id: 'TASK-003' });
  const storeA = createStore(config);
  const storeB = createStore(config);
  const results = await Promise.allSettled([
    storeA.claim('TASK-003', 'researcher', { ttlMs: 60_000 }),
    storeB.claim('TASK-003', 'verifier', { ttlMs: 60_000 }),
  ]);
  const fulfilled = results.filter((r) => r.status === 'fulfilled');
  const rejected = results.filter((r) => r.status === 'rejected');
  assert.equal(fulfilled.length, 1, 'tačno jedan proces sme da drži zakup');
  assert.equal(rejected.length, 1);
  const task = await storeA.get('TASK-003');
  assert.equal(task.data.status, 'in_progress');
  assert.ok(['researcher', 'verifier'].includes(task.data.lock_owner));
  await vault.cleanup();
});

test('store: dva procesa ISTOG identiteta ne mogu da drže isti zakup', async () => {
  const { vault, config } = await setup();
  await seedTask(config, { id: 'TASK-005' });
  const procesA = createStore(config);
  const procesB = createStore(config);

  // Isti vendor (`agy`), dva procesa: token je ono što ih razlikuje.
  await procesA.claim('TASK-005', 'agy', { ttlMs: 60_000, token: 'token-A' });
  await assert.rejects(
    () => procesB.claim('TASK-005', 'agy', { ttlMs: 60_000, token: 'token-B' }),
    /drugi proces istog identiteta/,
  );
  await assert.rejects(() => procesB.renew('TASK-005', 'agy', { token: 'token-B' }), /drugi proces/);
  await assert.rejects(() => procesB.release('TASK-005', 'agy', { toStatus: 'ready', token: 'token-B' }), /drugi proces/);

  // Vlasnik sa svojim tokenom i dalje može.
  await procesA.renew('TASK-005', 'agy', { ttlMs: 60_000, token: 'token-A' });
  await procesA.release('TASK-005', 'agy', { toStatus: 'ready', token: 'token-A' });
  assert.equal((await procesA.get('TASK-005')).data.status, 'ready');
  await vault.cleanup();
});

test('store: zakup važi i kad se fajl prebaci u drugu fazu', async () => {
  const { vault, config } = await setup();
  const store = createStore(config);
  await seedTask(config, { id: 'TASK-004' });
  const claimed = await store.claim('TASK-004', 'researcher', { ttlMs: 60_000 });
  const { files } = await listDir(vault.path('tasks', 'active'));
  assert.deepEqual(files, ['TASK-004.md']);
  await store.assertLease('TASK-004', 'researcher', { token: claimed.leaseToken });
  await assert.rejects(() => store.assertLease('TASK-004', 'codex'), /ne drži/);
  await assert.rejects(() => store.assertLease('TASK-004', 'researcher', { token: 'tudji' }), /drugi proces/);
  await vault.cleanup();
});


test('fajl-lock: živ vlasnik ne predaje lock, mrtav se preuzima', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent2-lock-'));
  const lock = path.join(dir, 'proba.lock');
  const fsxUrl = JSON.stringify(path.join(PACKAGE_ROOT, 'tools', 'orchestrator', 'lib', 'fsx.mjs'));

  // Dete drži lock 1200 ms. `staleMs` je 150 ms, pa bi pravilo po starosti
  // preuzelo lock dok je vlasnik još živ (nalaz K2: dva `agy` poziva su se
  // preklopila posle 30 s).
  const skript = [
    'import { withFileLock } from ' + fsxUrl + ';',
    'await withFileLock(' + JSON.stringify(lock) + ', async () => {',
    "  console.log('USAO ' + Date.now());",
    '  await new Promise((r) => setTimeout(r, 1200));',
    "  console.log('IZASAO ' + Date.now());",
    '}, { staleMs: 150, retryMs: 20, timeoutMs: 10000 });',
  ].join(String.fromCharCode(10));

  const dete = spawn(process.execPath, ['--input-type=module', '-e', skript], { stdio: ['ignore', 'pipe', 'pipe'] });
  let izlaz = '';
  dete.stdout.on('data', (c) => { izlaz += c.toString(); });
  const kraj = new Promise((resolve) => dete.on('close', resolve));
  while (!izlaz.includes('USAO')) await new Promise((r) => setTimeout(r, 10));

  let usao = null;
  await withFileLock(lock, async () => { usao = Date.now(); }, { staleMs: 150, retryMs: 20, timeoutMs: 10_000 });
  await kraj;
  const izasaoDete = Number((/IZASAO (\d+)/.exec(izlaz) ?? [])[1] ?? -1);

  assert.ok(usao !== null, 'drugi proces je morao da uđe posle deteta');
  assert.ok(
    usao >= izasaoDete,
    'lock je preuzet dok je vlasnik živ: vlasnik je izašao u ' + izasaoDete + ', drugi je ušao u ' + usao,
  );

  // Mrtav vlasnik: lock se preuzima odmah, bez čekanja starosti.
  const mrtav = spawn(process.execPath, ['-e', 'process.exit(0)'], { stdio: 'ignore' });
  const pid = mrtav.pid;
  await new Promise((resolve) => mrtav.on('close', resolve));
  await fs.writeFile(lock, JSON.stringify({ pid, at: new Date().toISOString() }), 'utf8');
  const tMrtav = Date.now();
  await withFileLock(lock, async () => {}, { staleMs: 10 * 60 * 1000, retryMs: 20, timeoutMs: 5_000 });
  assert.ok(Date.now() - tMrtav < 2_000, 'lock mrtvog procesa se preuzima odmah');
  await fs.rm(dir, { recursive: true, force: true });
});

test('fajl-lock: lock nikad nije prazan (nema trke sa čitanjem)', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent2-lock2-'));
  const lock = path.join(dir, 'proba.lock');
  let prazan = 0;
  let citaj = true;
  const citac = (async () => {
    while (citaj) {
      try {
        const text = await fs.readFile(lock, 'utf8');
        if (!text.trim()) prazan += 1;
      } catch { /* još ne postoji */ }
    }
  })();
  // 200 preuzimanja: dovoljno ciklusa da se prozor starog upisa uhvati.
  for (let i = 0; i < 200; i += 1) await withFileLock(lock, async () => {}, { retryMs: 1, timeoutMs: 5_000 });
  citaj = false;
  await citac;
  assert.equal(prazan, 0, 'lock fajl je bio prazan tokom držanja');
  await fs.rm(dir, { recursive: true, force: true });
});

test('fajl-lock: trka pri preuzimanju mrtvog locka ne pušta dva vlasnika', async () => {
  const fsxUrl = JSON.stringify(path.join(PACKAGE_ROOT, 'tools', 'orchestrator', 'lib', 'fsx.mjs'));
  const scenariji = [];
  // Tri scenarija sa startnom barijerom: svi procesi krenu u isti milisekund,
  // pa se prozor između odluke 'zastareo' i uklanjanja locka stvarno pogodi.
  for (let s = 0; s < 3; s += 1) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent2-lock3-'));
    const lock = path.join(dir, 'mrtav.lock');
    const barijera = path.join(dir, 'start');
    const mrtav = spawn(process.execPath, ['-e', 'process.exit(0)'], { stdio: 'ignore' });
    const pid = mrtav.pid;
    await new Promise((resolve) => mrtav.on('close', resolve));
    await fs.writeFile(lock, JSON.stringify({ pid, at: new Date().toISOString() }), 'utf8');

    const skript = [
      "import { promises as fs } from 'node:fs';",
      'import { withFileLock } from ' + fsxUrl + ';',
      'const barijera = ' + JSON.stringify(barijera) + ';',
      'while (true) { try { await fs.access(barijera); break; } catch { await new Promise((r) => setTimeout(r, 1)); } }',
      'await withFileLock(' + JSON.stringify(lock) + ', async () => {',
      "  console.log('S ' + Date.now());",
      '  await new Promise((r) => setTimeout(r, 60));',
      "  console.log('E ' + Date.now());",
      '}, { staleMs: 1, retryMs: 2, timeoutMs: 30000 });',
    ].join(String.fromCharCode(10));

    const deca = Array.from({ length: 10 }, () => spawn(process.execPath, ['--input-type=module', '-e', skript], { stdio: ['ignore', 'pipe', 'pipe'] }));
    const skupi = Promise.all(deca.map((d) => new Promise((resolve) => {
      let out = '';
      d.stdout.on('data', (c) => { out += c.toString(); });
      d.on('close', () => resolve(out));
    })));
    await new Promise((r) => setTimeout(r, 700));
    await fs.writeFile(barijera, 'x', 'utf8');
    const izlazi = await skupi;
    scenariji.push(izlazi
      .map((o) => /S (\d+)[\s\S]*E (\d+)/.exec(o))
      .filter(Boolean)
      .map((m) => [Number(m[1]), Number(m[2])])
      .sort((a, b) => a[0] - b[0]));
    await fs.rm(dir, { recursive: true, force: true });
  }

  for (const intervali of scenariji) {
    assert.equal(intervali.length, 10, 'svih 10 procesa je moralo da uđe');
    for (let i = 1; i < intervali.length; i += 1) {
      assert.ok(intervali[i][0] >= intervali[i - 1][1], 'dva procesa su istovremeno držala lock: ' + JSON.stringify(intervali));
    }
  }
});

test('fajl-lock: marker živog preuzimaoca se ne evakuiše po starosti', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent2-lock4-'));
  const lock = path.join(dir, 'mrtav.lock');
  const marker = lock + '.reclaim';

  // Lock je mrtav, ali marker drži ŽIV proces (ovaj test) — samo je fajl star.
  const mrtav = spawn(process.execPath, ['-e', 'process.exit(0)'], { stdio: 'ignore' });
  const pid = mrtav.pid;
  await new Promise((resolve) => mrtav.on('close', resolve));
  await fs.writeFile(lock, JSON.stringify({ pid, at: new Date().toISOString() }), 'utf8');
  await fs.writeFile(marker, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }), 'utf8');
  const staro = new Date(Date.now() - 10_000);
  await fs.utimes(marker, staro, staro);

  // Živ preuzimač je u toku: lock se ne sme preuzeti, ni posle isteka starosti.
  await assert.rejects(
    () => withFileLock(lock, async () => {}, { staleMs: 1, retryMs: 5, timeoutMs: 500 }),
    /nije moguće zaključati/,
    'živ preuzimač drži marker; tuđi lock se ne sme smeniti po starosti markera',
  );
  assert.match(await fs.readFile(lock, 'utf8'), new RegExp(String(pid)), 'tuđi lock nije smenjen');
  await fs.rm(dir, { recursive: true, force: true });
});

test('fajl-lock: rok se poštuje i kada je retryMs veći od preostalog vremena', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent2-lock5-'));
  const lock = path.join(dir, 'proba.lock');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const vlasnik = withFileLock(lock, async () => { await sleep(600); }, { retryMs: 5 });
  await sleep(50);
  const t1 = Date.now();
  let usao = false;
  await assert.rejects(
    () => withFileLock(lock, async () => { usao = true; }, { timeoutMs: 50, retryMs: 1000 }),
    /nije moguće zaključati/,
  );
  const proteklo = Date.now() - t1;
  assert.equal(usao, false, 'čekalac nije smeo da uđe posle isteka roka');
  assert.ok(proteklo < 400, 'rok je morao biti ispoštovan, a ne retryMs: ' + proteklo + ' ms');
  await vlasnik;
  await fs.rm(dir, { recursive: true, force: true });
});
async function listDir(dir) {
  return { files: (await fs.readdir(dir)).sort() };
}
