#!/usr/bin/env node
/**
 * agentctl — kontrolni sloj (Control Shell).
 *
 * Jedini ulaz koji sme da menja stanje crne table. Agenti menjaju samo svoje
 * zone; status zadatka, zakup i spajanje grana idu isključivo ovuda.
 */
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { createRequire } from 'node:module';
import { PACKAGE_ROOT, ROLES, loadConfig } from './lib/config.mjs';
import { createStore } from './lib/store.mjs';
import { createPipeline } from './lib/pipeline.mjs';
import { createWorktree as _createWorktree, ensureMainBranch, listWorktrees, removeWorktreesForTask, MAIN_BRANCH } from './lib/worktree.mjs';
import { formatFindings, lintVault, updateRawManifest, RAW_MANIFEST } from './lib/lint.mjs';
import { renderIndex } from './lib/vault.mjs';
import { exists } from './lib/fsx.mjs';
import { git, log as gitLog, isGitRepo } from './lib/git.mjs';
import { HARNESS_COMMANDS } from './lib/agents/index.mjs';

const require = createRequire(import.meta.url);
const pkg = require('../../package.json');

function parseArgs(argv) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--') { positional.push(...argv.slice(i + 1)); break; }
    if (token.startsWith('--')) {
      const key = token.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) flags[key] = true;
      else { flags[key] = next; i += 1; }
    } else {
      positional.push(token);
    }
  }
  return { flags, positional };
}

const out = (text) => process.stdout.write(`${text}\n`);
const json = (value) => process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);

function table(rows, headers) {
  if (!rows.length) return '_(nema zapisa)_';
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i] ?? '').length)));
  const line = (cells) => cells.map((c, i) => String(c ?? '').padEnd(widths[i])).join('  ');
  return [line(headers), widths.map((w) => '-'.repeat(w)).join('  '), ...rows.map(line)].join('\n');
}

const HELP = `agentctl ${pkg.version} — kontrolni sloj zajedničke baze znanja

Upotreba: agentctl <komanda> [opcije]

Komande:
  init                      uspostavi topologiju vault-a i glavnu granu
  ingest <raw/fajl>         otvori zadatak iz izvornog dokumenta
  list [--status <s>]       prikaži zadatke
  show <TASK-ID>            prikaži zadatak
  claim <TASK-ID> --owner   preuzmi zadatak pod vremenski zakup
  renew <TASK-ID> --owner   obnovi zakup
  release <TASK-ID> --owner oslobodi zakup
  reclaim                   vrati zadatke sa isteklim zakupom u opticaj
  phase <faza> <TASK-ID>    izvrši jednu fazu (research|verify|consolidate)
  run [--rounds N]          kontrolna petlja kroz sve faze
  status [--json]           stanje sistema
  lint [--json]             proveri invarijante ugovora
  index                     regeneriši wiki/Index.md i manifest izvora
  log [--limit N]           Git revizorski trag
  worktrees                 prikaži izolovana radna stabla
  doctor [--json]           proveri okruženje i harnese
  merge-log                 isto kao log

Globalne opcije:
  --vault <putanja>         koren vault-a (podrazumevano: repozitorijum koda)
  --json                    mašinski čitljiv izlaz
  --title <tekst>           naslov zadatka pri ingest-u
  --request <tekst>         opis zahteva
  --tag a,b                 oznake zadatka
  --depends TASK-001,...    zavisnosti
  --owner <ime>             vlasnik zakupa
  --ttl <ms>                trajanje zakupa
  --rounds <n>              broj krugova kontrolne petlje
  --only <faza>             ograniči run na jednu fazu
  --config <fajl>           alternativna konfiguracija
`;

async function buildContext(flags) {
  const vaultRoot = flags.vault ? path.resolve(flags.vault) : PACKAGE_ROOT;
  const config = await loadConfig(vaultRoot, flags.config ? { configFile: path.resolve(flags.config) } : {});
  const store = createStore(config);
  const pipeline = createPipeline(config, {
    store,
    logger: (message) => process.stderr.write(`[agentctl] ${message}\n`),
  });
  return { config, store, pipeline, flags };
}

const COMMANDS = {
  async init({ config, pipeline }) {
    for (const dir of [config.paths.sources, config.paths.drafts, config.paths.production,
      config.paths.tasks, config.paths.reviews, config.inbox, config.active, config.review,
      config.completed, config.paths.contracts, config.paths.locks, config.paths.worktrees]) {
      await fs.mkdir(dir, { recursive: true });
    }
    if (!(await isGitRepo(config.root))) {
      await git(config.root, ['init', '-q', '-b', MAIN_BRANCH]);
    }
    await ensureMainBranch(config);
    const manifest = await updateRawManifest(config);
    const reflect = await pipeline.reflect();
    out(`init: vault=${config.root}`);
    out(`manifest: ${manifest.total} zapisa (${RAW_MANIFEST})`);
    out(`index: ${reflect.notes} belešaka`);
    return 0;
  },

  async ingest({ flags, pipeline, config }, positional) {
    const source = positional[0];
    if (!source) throw new Error('ingest zahteva putanju izvora, npr. raw/dokument.md');
    const tags = flags.tag ? String(flags.tag).split(',').map((t) => t.trim()).filter(Boolean) : [];
    const dependsOn = flags.depends ? String(flags.depends).split(',').map((t) => t.trim()).filter(Boolean) : [];
    const task = await pipeline.ingest({
      source,
      title: typeof flags.title === 'string' ? flags.title : null,
      request: typeof flags.request === 'string' ? flags.request : '',
      tags,
      dependsOn,
    });
    out(`zadatak ${task.data.id} (${task.data.status}) <- ${task.data.source}`);
    return 0;
  },

  async list({ store, flags }) {
    const tasks = await store.list(flags.status ? { status: flags.status } : {});
    if (flags.json) {
      json(tasks.map((t) => ({ ...t.data, phase: t.phase })));
      return 0;
    }
    out(table(tasks.map((t) => [
      t.data.id, t.data.status, t.phase, t.data.lock_owner ?? '—',
      (t.data.artifacts ?? []).join(',') || '—', String(t.data.title).slice(0, 40),
    ]), ['ID', 'STATUS', 'FAZA', 'ZAKUP', 'ARTEFAKTI', 'NASLOV']));
    return 0;
  },

  async show({ store, flags }, positional) {
    const id = positional[0];
    if (!id) throw new Error('show zahteva TASK-ID');
    const task = await store.get(id);
    if (flags.json) { json({ ...task.data, phase: task.phase }); return 0; }
    out(`# ${task.data.id} — ${task.data.title}`);
    out(`status: ${task.data.status}   faza: ${task.phase}   zakup: ${task.data.lock_owner ?? '—'}`);
    out(`izvor: ${task.data.source ?? '—'}`);
    out(`artefakti: ${(task.data.artifacts ?? []).join(', ') || '—'}`);
    if (task.data.verification) out(`verifikacija: ${task.data.verification.verdict} (${task.data.verification.harness ?? '?'})`);
    out('');
    out(task.body.trim());
    return 0;
  },

  async claim({ store, config, flags }, positional) {
    const id = positional[0];
    const owner = flags.owner;
    if (!id) throw new Error('claim zahteva TASK-ID');
    const ttl = flags.ttl ? Number(flags.ttl) : config.lease.ttlMs;
    const task = await store.claim(id, owner, { ttlMs: ttl });
    out(`zakup: ${task.data.id} -> ${task.data.lock_owner} do ${task.data.lease_expires_at}`);
    return 0;
  },

  async renew({ store, config, flags }, positional) {
    const id = positional[0];
    const task = await store.renew(id, flags.owner, { ttlMs: flags.ttl ? Number(flags.ttl) : config.lease.ttlMs });
    out(`zakup obnovljen: ${task.data.id} do ${task.data.lease_expires_at}`);
    return 0;
  },

  async release({ store, flags }, positional) {
    const id = positional[0];
    const status = typeof flags.to === 'string' ? flags.to : 'ready';
    const task = await store.release(id, flags.owner, { toStatus: status });
    out(`zakup oslobođen: ${task.data.id} -> ${task.data.status}`);
    return 0;
  },

  async reclaim({ store, config }) {
    const reclaimed = await store.reclaimExpired();
    for (const entry of reclaimed) await removeWorktreesForTask(config, entry.id);
    out(reclaimed.length ? `opozvano zakupa: ${reclaimed.map((r) => r.id).join(', ')}` : 'nema isteklih zakupa');
    return 0;
  },

  async phase({ pipeline, flags }, positional) {
    const [phase, id] = positional;
    if (!phase || !id) throw new Error('phase zahteva: phase <research|verify|consolidate> <TASK-ID>');
    const run = { research: pipeline.runResearch, verify: pipeline.runVerify, consolidate: pipeline.runConsolidate }[phase];
    if (!run) throw new Error(`nepoznata faza "${phase}"`);
    const result = await run(id);
    if (flags.json) json(result); else out(JSON.stringify(result, null, 2));
    if (result.ok) return 0;
    if (result.blocked || result.conflict || result.reason) return 1;
    return 1;
  },

  async run({ pipeline, config, flags }) {
    const rounds = flags.rounds ? Number(flags.rounds) : config.pipeline.maxRounds;
    const only = typeof flags.only === 'string' ? flags.only : null;
    if (only) {
      const result = await pipeline.runOnce({ only });
      if (flags.json) json(result);
      else out(`faza ${only}: ${result.actions.length} akcija`);
      return 0;
    }
    const roundsResult = await pipeline.run({ rounds });
    if (flags.json) { json(roundsResult); return 0; }
    const actions = roundsResult.flatMap((r) => r.actions);
    out(table(actions.map((a) => [a.phase, a.task ?? '—', a.ok ? 'ok' : `neuspeh${a.reason ? `: ${a.reason}` : ''}`]),
      ['FAZA', 'ZADATAK', 'ISHOD']));
    out(`krugova: ${roundsResult.length}, akcija: ${actions.length}`);
    return 0;
  },

  async status({ pipeline, flags }) {
    const status = await pipeline.status();
    if (flags.json) { json(status); return 0; }
    out(`vault: ${status.root}`);
    out(`grana: ${status.branch}`);
    out(`zadaci: ${status.tasks.length}   lint: ${status.lint.errors} grešaka, ${status.lint.warnings} upozorenja`);
    out('');
    out(table(status.tasks.map((t) => [t.id, t.status, t.phase, t.owner ?? '—', t.expires ?? '—', String(t.title).slice(0, 36)]),
      ['ID', 'STATUS', 'FAZA', 'ZAKUP', 'ISTEKA', 'NASLOV']));
    return status.lint.errors ? 2 : 0;
  },

  async lint({ config, flags }) {
    const result = await lintVault(config);
    if (flags.json) { json(result); return result.ok ? 0 : 2; }
    out(formatFindings(result));
    out('');
    out(`grešaka: ${result.errors.length}, upozorenja: ${result.warnings.length}`);
    return result.ok ? 0 : 2;
  },

  async index({ config, pipeline, flags }) {
    const reflect = await pipeline.reflect();
    if (flags.json) { json(reflect); return 0; }
    out(`Index.md: ${reflect.notes} belešaka`);
    out(`manifest izvora: +${reflect.manifest.added} novih (ukupno ${reflect.manifest.total})`);
    return 0;
  },

  async log({ config, flags }) {
    const lines = await gitLog(config.root, { limit: flags.limit ? Number(flags.limit) : 20 });
    out(lines.length ? lines.join('\n') : '(nema komita)');
    return 0;
  },

  async worktrees({ config, flags }) {
    const entries = await listWorktrees(config);
    if (flags.json) { json(entries); return 0; }
    out(table(entries.map((e) => [path.relative(config.root, e.path) || '.', e.branch ?? '(detached)', e.head ?? '']),
      ['PUTANJA', 'GRANA', 'HEAD']));
    return 0;
  },

  async doctor({ config, flags }) {
    const checks = [];
    checks.push({ name: 'git repozitorijum', ok: await isGitRepo(config.root), detail: config.root });
    checks.push({ name: 'konfiguracija', ok: Boolean(config.configFile), detail: config.configFile });
    checks.push({ name: 'raw/ + manifest', ok: await exists(path.join(config.root, RAW_MANIFEST)), detail: RAW_MANIFEST });
    for (const dir of [config.inbox, config.active, config.review, config.completed, config.paths.drafts]) {
      checks.push({ name: `direktorijum ${path.relative(config.root, dir)}`, ok: await exists(dir), detail: '' });
    }
    for (const [harness, spec] of Object.entries(HARNESS_COMMANDS)) {
      const which = await new Promise((resolve) => {
        import('node:child_process').then(({ execFile }) => {
          execFile('which', [spec.bin], (error, stdout) => resolve(error ? null : stdout.trim()));
        });
      });
      checks.push({ name: `harnes ${harness} (${spec.bin})`, ok: Boolean(which), detail: which ?? 'nije instaliran — koristi adapter "mock"' });
    }
    for (const role of ROLES) {
      checks.push({ name: `uloga ${role}`, ok: true, detail: `${config.agents[role].adapter}${config.agents[role].adapter === 'harness' ? `:${config.agents[role].harness}` : ''}` });
    }
    if (flags.json) { json(checks); return checks.some((c) => !c.ok && c.name.startsWith('git')) ? 1 : 0; }
    out(table(checks.map((c) => [c.ok ? 'OK' : 'FAIL', c.name, c.detail]), ['STANJE', 'PROVERA', 'DETALJ']));
    return 0;
  },

  async 'merge-log'({ config, flags }) {
    return COMMANDS.log({ config, flags });
  },

  async help() {
    out(HELP);
    return 0;
  },
};

async function main() {
  const argv = process.argv.slice(2);
  if (!argv.length || argv[0] === '--help' || argv[0] === '-h') {
    out(HELP);
    return 0;
  }
  const { flags, positional } = parseArgs(argv);
  const [command, ...rest] = positional;

  if (command === 'version' || flags.version) { out(pkg.version); return 0; }

  const handler = COMMANDS[command];
  if (!handler) {
    process.stderr.write(`agentctl: nepoznata komanda "${command}"\n\n${HELP}`);
    return 2;
  }

  const context = await buildContext(flags);
  return handler(context, rest);
}

main()
  .then((code) => { process.exitCode = code ?? 0; })
  .catch((error) => {
    process.stderr.write(`agentctl: ${error.message}\n`);
    if (process.env.AGENTCTL_DEBUG) process.stderr.write(`${error.stack}\n`);
    process.exitCode = 1;
  });
