import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRange } from './baseline-range.mjs';

// Regresioni test za graničnu vrednost: nula je validna granica opsega i ne
// sme da se izgubi. Na početnoj reviziji (bug) svaki od ovih slučajeva pada.

test('granica: nula kao donja granica opsega', () => {
  assert.deepEqual(parseRange('0-3'), { from: 0, to: 3 });
});

test('granica: nula kao pojedinačan broj', () => {
  assert.deepEqual(parseRange('0'), { from: 0, to: 0 });
});

test('granica: nula sa obe strane opsega', () => {
  assert.deepEqual(parseRange('0-0'), { from: 0, to: 0 });
});

test('granica: nula kao gornja granica opsega', () => {
  assert.deepEqual(parseRange('1-0'), { from: 1, to: 0 });
});

test('granica: prazan ulaz se odbija', () => {
  assert.equal(parseRange(''), null);
});

test('granica: neispravan ulaz se odbija', () => {
  assert.equal(parseRange('abc'), null);
});
