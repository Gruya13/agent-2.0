import test from 'node:test';
import assert from 'node:assert/strict';
import { runEvals } from '../tools/evals/run.mjs';

test('evali: zlatni set daje očekivane ishode', async () => {
  const rezultati = await runEvals();
  const pali = rezultati.filter((r) => !r.pass);
  assert.deepEqual(pali, [], `evali koji ne daju očekivani ishod: ${JSON.stringify(pali, null, 2)}`);
  assert.equal(rezultati.length >= 3, true);
});
