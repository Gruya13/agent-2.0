import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRange } from '../src/range.js';

test('opseg', () => {
  assert.deepEqual(parseRange('1-5'), { from: 1, to: 5 });
});

test('pojedinačan broj', () => {
  assert.deepEqual(parseRange('7'), { from: 7, to: 7 });
});
