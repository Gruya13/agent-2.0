import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { makeVault } from './helpers/vault.mjs';
import { loadConfig } from '../tools/orchestrator/lib/config.mjs';
import { createStore } from '../tools/orchestrator/lib/store.mjs';
import {
  TRANSITIONS, TaskError, assertTransition, canTransition, defaultBody, formatTask,
  newTaskData, nextTaskId, parseTaskText, phaseFor, validateTaskData, writeTaskFile,
} from '../tools/orchestrator/lib/task.mjs';
import { clearLease, isLeaseLive, leaseExpired, leaseInfo, newLease } from '../tools/orchestrator/lib/lease.mjs';
import { readJsonl } from '../tools/orchestrator/lib/fsx.mjs';

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

async function listDir(dir) {
  return { files: (await fs.readdir(dir)).sort() };
}
