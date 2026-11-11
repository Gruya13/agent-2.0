/**
 * Konfiguracija kontrolnog sloja. Podrazumevane vrednosti su u kodu, a
 * `tools/config/agents.yml` ih menja. Nikad se ne oslanja na cwd: koren vault-a
 * se eksplicitno prosleđuje ili izvodi iz lokacije ovog modula.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promises as fs } from 'node:fs';
import { parseYaml } from './yaml.mjs';
import { exists } from './fsx.mjs';

export const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

export const ROLES = ['extractor', 'researcher', 'verifier', 'red-team', 'librarian', 'consolidator', 'programer', 'reviewer'];

export const DEFAULT_CONFIG = {
  vault: {
    sources: 'raw',
    drafts: 'wiki/drafts',
    production: 'wiki',
    index: 'wiki/Index.md',
    tasks: 'tasks',
    reviews: 'tasks/reviews',
    events: 'tasks/events.jsonl',
    contracts: '.agents',
  },
  lease: {
    ttlMs: 10 * 60 * 1000,
    heartbeatMs: 2 * 60 * 1000,
  },
  worktree: {
    dir: '.worktrees',
    branchPrefix: 'agent',
  },
  pipeline: {
    challenge: true,
    challengeExecute: true,
    challengeTimeoutMs: 60_000,
    challengeMaxScripts: 3,
    maxRounds: 10,
    intervalMs: 0,
    agentTimeoutMs: 15 * 60 * 1000,
  },
  agents: {
    extractor: { harness: 'agy', adapter: 'mock', model: null, timeoutMs: 300000 },
    researcher: { harness: 'agy', adapter: 'mock', model: null },
    verifier: { harness: 'dsh', adapter: 'mock', model: null },
    'red-team': { harness: 'dsh', adapter: 'mock', model: null },
    librarian: { harness: 'dsh', adapter: 'mock', model: null },
    consolidator: { harness: 'agy', adapter: 'mock', model: null },
    // Coding tok: programer piše popravku, reviewer je DRUGI vendor.
    programer: { harness: 'dsh', adapter: 'mock', model: null },
    reviewer: { harness: 'agy', adapter: 'mock', model: null },
  },
};

function merge(base, override) {
  if (override === null || override === undefined) return base;
  if (Array.isArray(base) || Array.isArray(override)) return override;
  if (typeof base !== 'object' || typeof override !== 'object') return override;
  const out = { ...base };
  for (const key of Object.keys(override)) {
    out[key] = key in base ? merge(base[key], override[key]) : override[key];
  }
  return out;
}

/**
 * Učitaj konfiguraciju. `vaultRoot` je koren Obsidian skladišta; ako nije dat,
 * koristi se PACKAGE_ROOT (repozitorijum u kome je kod).
 */
export async function loadConfig(vaultRoot = PACKAGE_ROOT, options = {}) {
  const root = path.resolve(vaultRoot);
  const configFile = options.configFile ?? path.join(root, 'tools', 'config', 'agents.yml');
  let fileConfig = {};
  if (await exists(configFile)) {
    const text = await fs.readFile(configFile, 'utf8');
    fileConfig = parseYaml(text) ?? {};
    if (typeof fileConfig !== 'object' || Array.isArray(fileConfig)) {
      throw new Error(`konfiguracija mora biti mapiranje: ${configFile}`);
    }
  }
  const merged = merge(DEFAULT_CONFIG, fileConfig);

  for (const role of ROLES) {
    const entry = merged.agents?.[role];
    if (!entry) throw new Error(`konfiguracija ne definiše ulogu "${role}"`);
    if (entry.adapter !== 'mock' && entry.adapter !== 'harness') {
      throw new Error(`uloga "${role}": adapter mora biti "mock" ili "harness", dobijeno "${entry.adapter}"`);
    }
  }

  const resolve = (rel) => path.resolve(root, rel);
  return {
    ...merged,
    root,
    configFile,
    paths: {
      sources: resolve(merged.vault.sources),
      drafts: resolve(merged.vault.drafts),
      production: resolve(merged.vault.production),
      index: resolve(merged.vault.index),
      tasks: resolve(merged.vault.tasks),
      reviews: resolve(merged.vault.reviews),
      events: resolve(merged.vault.events),
      contracts: resolve(merged.vault.contracts),
      worktrees: resolve(merged.worktree.dir),
      locks: resolve('.locks'),
      runtime: resolve('.runtime'),
    },
    inbox: path.join(resolve(merged.vault.tasks), 'inbox'),
    active: path.join(resolve(merged.vault.tasks), 'active'),
    review: path.join(resolve(merged.vault.tasks), 'review'),
    completed: path.join(resolve(merged.vault.tasks), 'completed'),
  };
}

export function roleOf(config, role) {
  if (!ROLES.includes(role)) throw new Error(`nepoznata uloga "${role}"; dozvoljene: ${ROLES.join(', ')}`);
  return config.agents[role];
}
