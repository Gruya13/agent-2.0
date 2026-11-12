#!/usr/bin/env node
/**
 * Zlatni set evala — poznati scenariji sa poznatim ishodom.
 *
 * Ne meri se „osećaj“ modela nego ishod toka na slučajevima gde znamo šta sme
 * da se desi: uspešna popravka, bug koji se ne reprodukuje (mora biti odbijen),
 * izmena van opsega (mora biti odbijena). Podrazumevano koristi mock adaptere,
 * pa je deterministički i brz; `--harness` ostavlja isti set pravim modelima
 * (tada se ishod ne mora poklopiti sa očekivanim — to je merenje, ne test).
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ISPRAVKA, pripremiCoding, skriptaProgramera } from '../../tests/helpers/coding-fixture.mjs';

export const CASES = [
  {
    id: 'bug-fix',
    opis: 'programer popravi bug i doda regresioni test — tok prihvata',
    priprema: {},
    expectedOk: true,
  },
  {
    id: 'bug-se-ne-reprodukuje',
    opis: 'bug ne postoji — tok ne sme da prihvati popravku',
    priprema: { saBugom: false },
    expectedOk: false,
  },
  {
    id: 'van-opsega',
    opis: 'programer menja tests/ van opsega src/** — kapija odbija',
    priprema: { scope: ['src/**'] },
    expectedOk: false,
  },
];

export async function runEvals() {
  const rezultati = [];
  for (const cas of CASES) {
    const started = Date.now();
    const { vault, coding, zadatak } = await pripremiCoding(cas.priprema);
    const stari = process.env.AGENT_2_0_MOCK_CODE_CMD;
    process.env.AGENT_2_0_MOCK_CODE_CMD = await skriptaProgramera(ISPRAVKA);
    try {
      const rezultat = await coding.runCodeTask(zadatak.data.id);
      const actual = rezultat?.ok === true;
      rezultati.push({
        id: cas.id, opis: cas.opis, expected: cas.expectedOk, actual,
        pass: actual === cas.expectedOk, durationMs: Date.now() - started,
        reason: rezultat?.reason ?? null,
      });
    } catch (error) {
      rezultati.push({
        id: cas.id, opis: cas.opis, expected: cas.expectedOk, actual: false,
        pass: cas.expectedOk === false, durationMs: Date.now() - started, reason: error.message,
      });
    } finally {
      if (stari === undefined) delete process.env.AGENT_2_0_MOCK_CODE_CMD;
      else process.env.AGENT_2_0_MOCK_CODE_CMD = stari;
      await vault.cleanup();
    }
  }
  return rezultati;
}

function jeDirektnoPokrenut() {
  return process.argv[1] !== undefined
    && pathToFileUrl(process.argv[1]) === import.meta.url;
}
function pathToFileUrl(p) {
  return new URL(`file://${path.resolve(p)}`).href;
}

const direktno = jeDirektnoPokrenut();
if (direktno) {
  const rezultati = await runEvals();
  for (const r of rezultati) {
    const status = r.pass ? 'PROLAZ' : 'PAD';
    process.stdout.write(`${status}  ${r.id}: ${r.opis} (${r.durationMs} ms)${r.pass ? '' : ` — ${r.reason ?? ''}`}\n`);
  }
  const palo = rezultati.filter((r) => !r.pass).length;
  process.stdout.write(`eval: ${rezultati.length - palo}/${rezultati.length} prošlo\n`);
  process.exitCode = palo === 0 ? 0 : 1;
}
