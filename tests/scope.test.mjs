import test from 'node:test';
import assert from 'node:assert/strict';
import { assertInScope, filterScope, globToRegExp, matchesScope, normalizeRel } from '../tools/orchestrator/lib/scope.mjs';

test('glob: zvezdica ne prelazi direktorijum, dvostruka prelazi', () => {
  assert.equal(matchesScope('wiki/Alfa.md', ['wiki/*.md']), true);
  assert.equal(matchesScope('wiki/pod/Alfa.md', ['wiki/*.md']), false);
  assert.equal(matchesScope('wiki/pod/Alfa.md', ['wiki/**/*.md']), true);
  assert.equal(matchesScope('wiki/pod/duboko/Alfa.md', ['wiki/**/*.md']), true);
  assert.equal(matchesScope('wiki/Alfa.md', ['wiki/**']), true);
  assert.equal(matchesScope('raw/Alfa.md', ['wiki/**']), false);
});

test('glob: tačan put i upitnik', () => {
  assert.equal(matchesScope('wiki/Index.md', ['wiki/Index.md']), true);
  assert.equal(matchesScope('wiki/Index.md', ['wiki/index.md']), false, 'velika/mala slova se razlikuju');
  assert.equal(matchesScope('wiki/A.md', ['wiki/?.md']), true);
  assert.equal(matchesScope('wiki/AB.md', ['wiki/?.md']), false);
});

test('scope: prazan opseg ne dozvoljava ništa', () => {
  assert.equal(matchesScope('wiki/A.md', []), false);
  assert.equal(matchesScope('wiki/A.md', null), false);
  assert.throws(() => assertInScope('wiki/A.md', []), /ne ulazi u opseg/);
});

test('normalizeRel i filterScope', () => {
  assert.equal(normalizeRel('./wiki/A.md'), 'wiki/A.md');
  assert.equal(normalizeRel('wiki\\A.md'), 'wiki/A.md');
  assert.equal(normalizeRel('/wiki/A.md'), 'wiki/A.md');
  assert.deepEqual(filterScope(['wiki/A.md', 'raw/B.md', 'tasks/x.md'], ['wiki/*.md']), ['wiki/A.md']);
  assert.equal(globToRegExp('wiki/*.md').test('wiki/A.md'), true);
});
