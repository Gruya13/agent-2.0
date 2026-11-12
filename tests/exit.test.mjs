import test from 'node:test';
import assert from 'node:assert/strict';
import { strictExit } from '../tools/orchestrator/lib/exit.mjs';

test('strictExit: 1 ako ijedna akcija nije uspela, 0 inače', () => {
  assert.equal(strictExit([]), 0);
  assert.equal(strictExit([{ ok: true }, { ok: true }]), 0);
  assert.equal(strictExit([{ ok: true }, { ok: false }]), 1);
  assert.equal(strictExit([{ ok: false }, { ok: false }]), 1);
});
