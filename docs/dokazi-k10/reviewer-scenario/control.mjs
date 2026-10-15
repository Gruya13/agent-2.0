import assert from 'node:assert/strict';
const { parseRange } = await import(process.argv[2] || '../src/range.js');
let checked = 0;
// Nezavisna provera: rezultat sa razmacima i nulom mora odgovarati
// krajnjim tačkama generisanim iz numeričkih parova.
for (const [left, right] of [[0, 8], [12, 0], [0, 0], [2, 9]]) {
  const input = `  ${left} - ${right}  `;
  assert.deepEqual(parseRange(input), { from: left, to: right }, input);
  checked++;
}
assert.deepEqual(parseRange(' 00 '), { from: 0, to: 0 });
checked++;
for (const input of ['   ', '0-', '-0', '0-nope', 'nope-0', '0-2-4']) {
  assert.equal(parseRange(input), null, JSON.stringify(input));
  checked++;
}
console.log(`PASS: ${checked} nezavisnih provera`);
