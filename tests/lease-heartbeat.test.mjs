import test from 'node:test';
import assert from 'node:assert/strict';
import { LeaseLostError, heartbeatPeriodMs, startLeaseHeartbeat } from '../tools/orchestrator/lib/lease-heartbeat.mjs';

const cekaj = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('heartbeatPeriodMs: jedan default za oba toka i minimum 50 ms', () => {
  assert.equal(heartbeatPeriodMs({}), 120_000);
  assert.equal(heartbeatPeriodMs({ lease: {} }), 120_000);
  assert.equal(heartbeatPeriodMs({ lease: { heartbeatMs: 200 } }), 200);
  assert.equal(heartbeatPeriodMs({ lease: { heartbeatMs: 10 } }), 50, 'minimum 50 ms');
  assert.equal(heartbeatPeriodMs({ lease: { heartbeatMs: 0 } }), 120_000, 'nula nije period');
});

test('startLeaseHeartbeat: obnavlja periodično i stop zaustavlja tajmer', async () => {
  const pozivi = [];
  const store = { renew: async (id, owner) => { pozivi.push([id, owner]); } };
  const lease = startLeaseHeartbeat({ store, id: 'TASK-101', owner: 'dsh', token: 't', config: { lease: { heartbeatMs: 50 } } });
  try {
    await cekaj(180);
    assert.ok(pozivi.length >= 2, `očekivana najmanje 2 obnove, bilo ${pozivi.length}`);
    assert.equal(lease.izgubljen, null);
  } finally {
    lease.stop();
  }
  const posleStopa = pozivi.length;
  await cekaj(120);
  assert.equal(pozivi.length, posleStopa, 'stop mora da zaustavi obnavljanje');
});

test('startLeaseHeartbeat: neuspeh obnove se pamti (nikad ne nestaje)', async () => {
  const store = { renew: async () => { throw new Error('lock_token se ne poklapa'); } };
  const lease = startLeaseHeartbeat({ store, id: 'TASK-101', owner: 'dsh', token: 't', config: { lease: { heartbeatMs: 50 } } });
  try {
    await cekaj(180);
    assert.ok(lease.izgubljen instanceof Error);
    assert.match(lease.izgubljen.message, /lock_token/);
  } finally {
    lease.stop();
  }
});

test('LeaseLostError nosi prepoznatljiv kod za faze', () => {
  const error = new LeaseLostError('zakup je izgubljen');
  assert.equal(error.code, 'LEASE_LOST');
  assert.equal(error.name, 'LeaseLostError');
});
