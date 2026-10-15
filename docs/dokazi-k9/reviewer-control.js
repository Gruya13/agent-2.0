import assert from 'node:assert/strict';
import { parseRange } from '../src/range.js';

console.log('--- Reviewer Control Cases: Testing zero boundary handling ---');

// 1. Valid zero boundaries with various positive values
{
  const res = parseRange('0-42');
  assert.deepEqual(res, { from: 0, to: 42 });
  assert.strictEqual(res.from, 0);
  assert.strictEqual(typeof res.from, 'number');
}

{
  const res = parseRange('99-0');
  assert.deepEqual(res, { from: 99, to: 0 });
  assert.strictEqual(res.to, 0);
  assert.strictEqual(typeof res.to, 'number');
}

// 2. Whitespace handling with zero
{
  const res = parseRange('   0   -   50   ');
  assert.deepEqual(res, { from: 0, to: 50 });
  assert.strictEqual(res.from, 0);
}

{
  const res = parseRange('   0   ');
  assert.deepEqual(res, { from: 0, to: 0 });
  assert.strictEqual(res.from, 0);
  assert.strictEqual(res.to, 0);
}

// 3. Numeric zero (not string)
{
  const res = parseRange(0);
  assert.deepEqual(res, { from: 0, to: 0 });
  assert.strictEqual(res.from, 0);
}

// 4. Zero padding representation
{
  const res = parseRange('00-05');
  assert.deepEqual(res, { from: 0, to: 5 });
  assert.strictEqual(res.from, 0);
  assert.strictEqual(res.to, 5);
}

// 5. Invalid syntax involving zero must be rejected (return null)
{
  assert.strictEqual(parseRange('0-'), null, 'Trailing dash with zero must return null');
  assert.strictEqual(parseRange('-0'), null, 'Leading dash with zero must return null');
  assert.strictEqual(parseRange('0-0-0'), null, 'Three boundaries must return null');
  assert.strictEqual(parseRange('0-invalid'), null, 'Invalid non-number with zero must return null');
  assert.strictEqual(parseRange('invalid-0'), null, 'Invalid non-number with zero must return null');
  assert.strictEqual(parseRange(''), null, 'Empty string must return null');
  assert.strictEqual(parseRange(null), null, 'null input must return null');
  assert.strictEqual(parseRange(undefined), null, 'undefined input must return null');
}

console.log('All reviewer control assertions PASSED.');
