/**
 * Zajednički fixture za coding testove.
 *
 * Mali ciljni git repo sa poznatim bugom (nula se gubi), mock programer koji
 * izvršava komandu iz okruženja i vault kontrolnog sloja.
 */
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '../../tools/orchestrator/lib/config.mjs';
import { createStore } from '../../tools/orchestrator/lib/store.mjs';
import { createCodingPipeline } from '../../tools/orchestrator/lib/coding.mjs';
import { gitExec, makeVault } from '../helpers/vault.mjs';

export const PARSE_SA_BUGOM = [
  'export function broj(tekst, podrazumevano = null) {',
  '  const n = Number(tekst);',
  '  return n || podrazumevano;',
  '}',
  '',
].join('\n');

export const POSTOJECI_TEST = [
  "import test from 'node:test';",
  "import assert from 'node:assert/strict';",
  "import { broj } from '../src/parse.js';",
  '',
  "test('broj cita vrednost', () => { assert.equal(broj('5', null), 5); });",
  "test('broj vraca podrazumevano za neispravan ulaz', () => { assert.equal(broj('x', 7), 7); });",
  '',
].join('\n');

export const ISPRAVKA = [
  "import { readFileSync, writeFileSync } from 'node:fs';",
  "writeFileSync('src/parse.js', readFileSync('src/parse.js', 'utf8')",
  "  .replace('return n || podrazumevano;', 'return Number.isNaN(n) ? podrazumevano : n;'));",
  "writeFileSync('tests/parse.zero.test.js', [",
  "  \"import test from 'node:test';\",",
  "  \"import assert from 'node:assert/strict';\",",
  "  \"import { broj } from '../src/parse.js';\",",
  "  '',",
  "  \"test('nula se ne gubi', () => { assert.equal(broj('0', null), 0); });\",",
  "  '',",
  "].join('\\n'));",
].join('\n');

/** Ciljni repo sa bugom (ili bez, za negativan scenario). */
export async function napraviCiljniRepo({ saBugom = true, extra = {} } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agent2-cilj-'));
  await fs.mkdir(path.join(root, 'src'), { recursive: true });
  await fs.mkdir(path.join(root, 'tests'), { recursive: true });
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({
    name: 'ciljni-fixture', private: true, type: 'module', scripts: { test: 'node --test tests/' },
  }, null, 2));
  await fs.writeFile(path.join(root, 'src', 'parse.js'), saBugom
    ? PARSE_SA_BUGOM
    : PARSE_SA_BUGOM.replace('return n || podrazumevano;', 'return Number.isNaN(n) ? podrazumevano : n;'));
  await fs.writeFile(path.join(root, 'tests', 'parse.test.js'), POSTOJECI_TEST);
  for (const [rel, sadrzaj] of Object.entries(extra)) {
    const put = path.join(root, rel);
    await fs.mkdir(path.dirname(put), { recursive: true });
    await fs.writeFile(put, sadrzaj);
  }
  await gitExec(root, ['init', '-q', '-b', 'main']);
  await gitExec(root, ['-c', 'user.name=f', '-c', 'user.email=f@local', 'add', '-A']);
  await gitExec(root, ['-c', 'user.name=f', '-c', 'user.email=f@local', 'commit', '-q', '-m', 'pocetno stanje']);
  const base = (await gitExec(root, ['rev-parse', 'HEAD'])).stdout.trim();
  return { root, base };
}

/** Komanda mock programera koja izvršava dati JS snimak u radnom stablu. */
export async function skriptaProgramera(telo) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent2-fix-'));
  const put = path.join(dir, 'fix.mjs');
  await fs.writeFile(put, telo, 'utf8');
  return `node ${put}`;
}

export const REPRO_SKRIPT = "import('./src/parse.js').then((m) => { const v = m.broj('0', null); if (v !== 0) process.exit(1); })";
export const reproKomanda = () => `node -e ${JSON.stringify(REPRO_SKRIPT)}`;

/**
 * Vault + store + coding pipeline + ciljni repo + zadatak.
 * `lease` dozvoljava kratak TTL za proveru životnog ciklusa zakupa.
 */
export async function pripremiCoding({
  saBugom = true, lease = null, scope = ['src/**', 'tests/**'], testCommand = 'npm test',
  extra = {}, memory = [],
} = {}) {
  const vault = await makeVault();
  const config = await loadConfig(vault.root);
  if (lease) config.lease = { ...config.lease, ...lease };
  const store = createStore(config);
  const coding = createCodingPipeline(config, { store });
  const cilj = await napraviCiljniRepo({ saBugom, extra });
  const zadatak = await coding.dodajCodeZadatak({
    title: 'Nula se gubi u broj()',
    requirement: 'Funkcija broj(tekst, podrazumevano) mora da vrati 0 kada je tekst "0".',
    target: cilj.root,
    base: cilj.base,
    scope,
    testCommand,
    reproCommand: reproKomanda(),
    memory,
  });
  return { vault, config, store, coding, cilj, zadatak };
}
