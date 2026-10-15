---
title: Nezavisan pregled TASK-101
created: 2026-10-15T08:23:11.693Z
updated: 2026-10-15T08:23:11.693Z
authors: [agentctl]
status: review
tags: [TASK-101, code]
---

# Pregled zadatka TASK-101: Nula se gubi u parseRange

## 1. Analiza zahteva i diff-a

Zahtev traži da funkcija `parseRange` u `src/range.js` ispravno tretira nulu (`0`) kao validnu granicu opsega (`'0-3'` -> `{ from: 0, to: 3 }`, `'0'` -> `{ from: 0, to: 0 }`), dok neispravni ili prazni ulazi i dalje vraćaju `null`.

U inicijalnoj verziji koda (`5157b69`), granice su parsirane pomoću:
```javascript
const from = Number(a) || null;
const to = b === undefined ? from : Number(b) || null;
```
Budući da je `Number('0') === 0` falsy vrednost u JavaScript-u, izraz `0 || null` je evaluirao u `null`, čime se gubila nula kao granica.

Izvršene izmene:
- U `src/range.js`: Implementirana je pomoćna funkcija `parseBoundary` koja proverava `Number.isNaN(n) ? null : n`, čime je `0` prihvaćen kao validan broj, a samo nevalidni ili prazni unosi vraćaju `null`.
- U `tests/range-zero.test.js`: Dodat je set regresionih testova koji pokrivaju donju granicu 0, gornju granicu 0, 0 kao pojedinačan broj, opseg 0-0 i nevalidne/prazne unose.
- `tests/range.test.js`: Ostao je netaknut (`git diff main -- tests/range.test.js` je prazan).

## 2. Provera regresionih testova

- Testovi nisu oslabljeni niti preskočeni (nema `test.skip` niti lažnih asercija).
- Postojeći testovi u `tests/range.test.js` nisu menjani.
- Novi testovi u `tests/range-zero.test.js` direktno i strogo verifikuju traženo ponašanje preko `assert.deepEqual`.

Izvršavanje `npm test`:
```
> test
> node --test tests/

✔ nula je validna donja granica opsega (1.817195ms)
✔ nula je validna gornja granica opsega (0.250381ms)
✔ nula kao pojedinačan broj (0.146946ms)
✔ opseg 0-0 (0.975959ms)
✔ neispravan ili prazan ulaz se odbija (0.23732ms)
✔ opseg (1.455ms)
✔ pojedinačan broj (0.160286ms)
ℹ tests 7
ℹ suites 0
ℹ pass 7
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 79.345842
```

## 3. Sopstveni kontrolni slučaj (Reviewer Control Case)

Kreiran je nezavisan kontrolni test `.agent-review/reviewer-control.js` koji proverava:
1. Donju i gornju nultu granicu sa različitim vrednostima (`0-42`, `99-0`) uz striktnu proveru tipa (`typeof res.from === 'number'` i `res.from === 0`).
2. Tretman razmaka oko nule (`   0   -   50   `, `   0   `).
3. Direktno prosleđivanje numeričke nule `0`.
4. Nule sa vodećim nulama (`00-05`).
5. Odbijanje neispravnih formata koji sadrže nulu (`0-`, `-0`, `0-0-0`, `0-invalid`, `invalid-0`, `''`, `null`, `undefined`).

Sadržaj fajla `.agent-review/reviewer-control.js`:
```javascript
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
```

Izlaz komande `node .agent-review/reviewer-control.js`:
```
--- Reviewer Control Cases: Testing zero boundary handling ---
All reviewer control assertions PASSED.
```

## 4. Zaključak

- Zahtev je u potpunosti zadovoljen.
- Tuđi regresioni testovi nisu oslabljeni niti preskočeni.
- Postojeći testovi (`tests/range.test.js`) prolaze neizmenjeni.
- Sopstveni kontrolni slučaj potvrđuje ispravnost implementacije i ne obara popravku.

VERDICT: pass

