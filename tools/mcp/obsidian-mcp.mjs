#!/usr/bin/env node
/**
 * obsidian-mcp — MCP (stdio, JSON-RPC) server nad Obsidian skladištem znanja.
 *
 * Ovo je programski sloj preko koga harnesi (dsh, codex, agy) čitaju i menjaju
 * beleške, bez pisanja skripti specifičnih za svaki harnes. Server radi i kada
 * grafička aplikacija Obsidian nije pokrenuta.
 *
 * Pristup se sprovodi OVDE, ne na fajl sistemu: svi procesi rade kao isti
 * korisnik, pa samo server koji odbija operaciju može da razdvoji uloge.
 *
 *   OBSIDIAN_VAULT       koren skladišta (radno stablo agenta)  (default: cwd)
 *   OBSIDIAN_AGENT       identitet agenta, npr. "codex"         (default: anonymous)
 *   OBSIDIAN_ROLE        researcher|verifier|consolidator|readonly
 *   OBSIDIAN_TASK        id zadatka (TASK-NNN) koji nosi zakup   (obavezan za upis)
 *   OBSIDIAN_TASK_ROOT   kontrolni koren sa `tasks/` (default: OBSIDIAN_VAULT)
 *
 * Upis nije dozvoljen samo po ulozi: uz zonu se proverava i da zadatak iz
 * OBSIDIAN_TASK postoji, da je u odgovarajućem stanju i da zakup nad njim drži
 * ovaj agent (invarijante 5 i 9 iz `.agents/AGENTS.md`).
 *
 * Zonska pravila (ugovor iz .agents/AGENTS.md):
 *   raw/                 nikad upisiv — ni za jednu ulogu
 *   wiki/drafts/         upisuje researcher
 *   wiki/                upisuje consolidator (uključujući Index.md)
 *   tasks/reviews/       upisuje verifier
 *   tasks/**             ostalo menja isključivo agentctl
 *
 * Na stdout ide isključivo JSON-RPC; dijagnostika ide na stderr.
 *
 * Bez argumenata govori MCP na stdio; sa argumentima je CLI:
 *   node obsidian-mcp.mjs info
 *   node obsidian-mcp.mjs read wiki/Index.md --frontmatter
 *   node obsidian-mcp.mjs search "worktree" --limit 5
 *   node obsidian-mcp.mjs patch wiki/x.md --section Nalazi --content-file /tmp/c.md
 */
import { createInterface } from 'node:readline';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promises as fs, readFileSync } from 'node:fs';
import { exists, realRelativeTo, resolveInside, writeFileAtomic } from '../orchestrator/lib/fsx.mjs';
import { matchesScope } from '../orchestrator/lib/scope.mjs';
import { parseFrontmatter, stringifyFrontmatter } from '../orchestrator/lib/yaml.mjs';
import {
  extractWikilinks, findBacklinks, listNotes, noteName, noteFrontmatterProblems, readNote,
  uniqueLinkTargets,
} from '../orchestrator/lib/vault.mjs';

const SERVER_NAME = 'obsidian-mcp';
const SERVER_VERSION = '1.0.0';
const PROTOCOL_VERSION = '2024-11-05';

const VAULT = path.resolve(process.env.OBSIDIAN_VAULT || process.env.WIKI_ROOT || process.cwd());
const AGENT = process.env.OBSIDIAN_AGENT || process.env.WIKI_AGENT || 'anonymous';
const ROLE = process.env.OBSIDIAN_ROLE || 'readonly';

/**
 * Kontekst zadatka koji je kontrolni sloj materijalizovao u radnom stablu.
 *
 * Ne može se osloniti na nasleđeno okruženje: pokazalo se da neki harnesi
 * (npr. Codex) prosleđuju MCP serveru samo svoju `env` tabelu, pa bi
 * `OBSIDIAN_TASK` tiho nestao i legitimni upis bio odbijen. Fajl je u
 * `.runtime/` (gitignore), pa ne ulazi u granu.
 *
 * Redosled prioriteta: env > fajl > podrazumevano. Krivotvorenje fajla ne daje
 * nove privilegije: upis i tako ide u radno stablo agenta, a u `main` ulazi
 * samo kroz kontrolni sloj koji proverava stvarno stanje zadatka.
 */
const TASK_CONTEXT_FILE = path.join(VAULT, '.runtime', 'task-context.json');
const fileContext = (() => {
  try {
    return JSON.parse(readFileSync(TASK_CONTEXT_FILE, 'utf8'));
  } catch {
    return null;
  }
})();

// Stanje zadataka živi u kontrolnom korenu (`main`), a ne u izolovanom radnom
// stablu agenta: worktree nosi kopiju crne table od trenutka grananja, pa bi
// provera zakupa nad njom bila provera zastarelog stanja.
const TASK_ROOT = path.resolve(process.env.OBSIDIAN_TASK_ROOT || fileContext?.taskRoot || VAULT);
const TASK_ID = process.env.OBSIDIAN_TASK || fileContext?.task || null;
// Zakup je vezan za proces: kada zadatak nosi token, upis zahteva isti token.
const LEASE_TOKEN = process.env.OBSIDIAN_LEASE_TOKEN || fileContext?.leaseToken || null;

const NEVER_WRITABLE = ['raw'];
// Izvedeni artefakti kontrolnog sloja: nijedna uloga ih ne piše.
const PROTECTED_FILES = ['wiki/Index.md', '.agents/raw-manifest.json', 'tasks/events.jsonl'];
const READ_PREFIXES = ['wiki', 'raw', 'tasks', '.agents'];

/**
 * Zone su ortogonalne: svaka uloga piše tačno u svoju.
 * `consolidator` NE sme u `wiki/drafts/` iako je nacrt „unutar wiki/".
 */
const ROLE_WRITE_ZONES = {
  extractor: ['draft'],
  librarian: ['production', 'audit'],
  'red-team': ['challenge'],
  researcher: ['draft'],
  verifier: ['review'],
  consolidator: ['production'],
  readonly: [],
};

const ROLE_WRITE_PREFIXES = {
  extractor: ['wiki/drafts'],
  librarian: ['wiki', 'tasks/audits'],
  'red-team': ['tasks/challenges'],
  researcher: ['wiki/drafts'],
  verifier: ['tasks/reviews'],
  consolidator: ['wiki'],
  readonly: [],
};

/** Zona upisa za datu putanju (zahteva status zadatka i proveru artefakta). */
function zoneOf(relative) {
  if (relative === 'wiki/drafts' || relative.startsWith('wiki/drafts/')) return 'draft';
  if (relative === 'tasks/reviews' || relative.startsWith('tasks/reviews/')) return 'review';
  if (relative === 'tasks/audits' || relative.startsWith('tasks/audits/')) return 'audit';
  if (relative === 'tasks/challenges' || relative.startsWith('tasks/challenges/')) return 'challenge';
  if (relative.startsWith('wiki/')) return 'production';
  return 'other';
}

function log(...args) {
  process.stderr.write(`[${SERVER_NAME}:${AGENT}/${ROLE}] ${args.join(' ')}\n`);
}

export class AccessError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AccessError';
  }
}

function normalizeRel(rel) {
  if (typeof rel !== 'string' || !rel.trim()) throw new Error('putanja je obavezna');
  const clean = rel.replace(/\\/g, '/').replace(/^\/+/, '');
  // Beleške se zadaju i bez ekstenzije (Obsidian stil).
  return clean.endsWith('.md') || clean.includes('.') ? clean : `${clean}.md`;
}

/**
 * Razreši putanju kroz simboličke linkove i vrati REALNU relativnu putanju.
 * Leksička provera (`..`) je nedovoljna: `wiki/drafts/raw-link -> raw` bi prošao
 * kao da je u zoni nacrta, a upis bi završio u `raw/`.
 */
async function resolveReal(rel) {
  const lexical = resolveInside(VAULT, normalizeRel(rel));
  const resolved = await realRelativeTo(VAULT, lexical);
  if (resolved.escapes) {
    throw new AccessError(`putanja izlazi iz skladišta preko simboličkog linka: ${rel} -> ${resolved.real}`);
  }
  return { full: lexical, relative: resolved.relative };
}

export async function assertReadable(rel) {
  const { full, relative } = await resolveReal(rel);
  if (!READ_PREFIXES.some((prefix) => relative === prefix || relative.startsWith(`${prefix}/`))) {
    throw new AccessError(`čitanje van zona znanja nije dozvoljeno: ${relative}`);
  }
  return full;
}

/**
 * Dozvola za upis ima dva sloja:
 *   1. zona uloge (gde agent sme da piše), i
 *   2. zadatak + zakup (invarijante 5 i 9 iz `.agents/AGENTS.md`).
 *
 * Drugi sloj se preskače samo u skladištu koje ne nosi ugovor
 * (`.agents/AGENTS.md`), jer tada nije crna tabla nego običan wiki.
 */
export async function assertWritable(rel) {
  const { full, relative } = await resolveReal(rel);
  if (!READ_PREFIXES.some((prefix) => relative === prefix || relative.startsWith(`${prefix}/`))) {
    throw new AccessError(`upis van zona znanja nije dozvoljen: ${relative}`);
  }
  if (NEVER_WRITABLE.some((prefix) => relative === prefix || relative.startsWith(`${prefix}/`))) {
    throw new AccessError(`zona "${relative}" je nepromenljiva (append-only) i niko je ne menja`);
  }
  if (PROTECTED_FILES.includes(relative)) {
    throw new AccessError(`"${relative}" je izveden artefakt kontrolnog sloja i ne piše se kroz MCP`);
  }
  const zones = ROLE_WRITE_ZONES[ROLE];
  if (!zones) throw new AccessError(`nepoznata uloga "${ROLE}"`);
  if (!zones.length) throw new AccessError(`uloga "${ROLE}" je samo za čitanje`);
  const zone = zoneOf(relative);
  if (!zones.includes(zone)) {
    throw new AccessError(
      `uloga "${ROLE}" ne sme da piše u zonu "${zone}" (${relative}); dozvoljene zone: ${zones.join(', ')}`,
    );
  }
  if (zone === 'production' && !/^wiki\/[^/]+\.md$/.test(relative)) {
    throw new AccessError(`produkciona beleška mora biti na vrhu wiki/ (dobijeno: ${relative})`);
  }
  await requireTaskContext(relative);
  return full;
}

let cachedControlConfig = null;

/** Učitaj konfiguraciju kontrolnog korena (keširano za život procesa). */
async function controlConfig() {
  if (!cachedControlConfig) {
    const { loadConfig } = await import('../orchestrator/lib/config.mjs');
    cachedControlConfig = await loadConfig(TASK_ROOT);
  }
  return cachedControlConfig;
}

/**
 * Provera zakupa i stanja zadatka. Bez ovoga bi bilo ko sa ulogom
 * `consolidator` mogao da upiše proizvoljnu belešku u `wiki/` bez zadatka,
 * zakupa i verifikacionog pečata.
 */
async function requireTaskContext(relative) {
  // Odluka se donosi po SKLADIŠTU koje se piše, ne po kontrolnom korenu:
  // inače bi dovoljno bilo proslediti OBSIDIAN_TASK_ROOT na prazan direktorijum
  // i zaobići zahtev za zadatkom.
  if (!(await exists(path.join(VAULT, '.agents', 'AGENTS.md')))) {
    return { skipped: 'skladište ne nosi ugovor .agents/AGENTS.md' };
  }
  if (!(await exists(path.join(TASK_ROOT, '.agents', 'AGENTS.md')))) {
    throw new AccessError(`kontrolni koren ${TASK_ROOT} ne nosi ugovor .agents/AGENTS.md — upis je odbijen`);
  }
  if (!TASK_ID) {
    throw new AccessError(`upis u "${relative}" zahteva OBSIDIAN_TASK (id zadatka) — bez njega nema zakupa ni verifikacije`);
  }
  const config = await controlConfig();
  const { findTask } = await import('../orchestrator/lib/task.mjs');
  const task = await findTask(config, TASK_ID);
  if (!task) throw new AccessError(`zadatak ${TASK_ID} ne postoji u ${path.join(TASK_ROOT, 'tasks')}`);

  const zone = zoneOf(relative);
  const kind = task.data.kind ?? 'ingest';
  if (zone === 'production' && kind === 'audit') {
    // Revizorski zadatak menja POSTOJEĆE beleške, pa pečat ne može da prethodi
    // izmeni — verifikacija ide posle, pre merge-a (automat stanja je garantuje).
    // Zato je ovde granica OPSEG: sme se samo ono što je zadatkom stavljeno u
    // `audit_scope`, i to isključivo nad postojećim beleškama.
    if (!matchesScope(relative, task.data.audit_scope)) {
      throw new AccessError(
        `"${relative}" ne ulazi u opseg revizije zadatka ${TASK_ID} (${(task.data.audit_scope ?? []).join(', ') || 'prazan opseg'})`,
      );
    }
    if (!(await exists(path.join(VAULT, relative)))) {
      throw new AccessError(`revizija menja postojeće beleške; "${relative}" ne postoji`);
    }
  } else if (zone === 'production') {
    // Produkcija zahteva verifikacioni pečat (drugi vendor), ne samo zakup:
    // konsolidator drži zakup nad zadatkom koji JE verifikovan.
    const verdict = task.data.verification?.verdict;
    if (verdict !== 'pass') {
      throw new AccessError(
        `zadatak ${TASK_ID} nema verifikacioni pečat (verdict: ${verdict ?? 'nema'}) — upis u produkciju je zabranjen`,
      );
    }
  } else if (task.data.status !== 'in_progress') {
    throw new AccessError(
      `zadatak ${TASK_ID} je u stanju "${task.data.status}"; upis u "${relative}" zahteva stanje in_progress`,
    );
  }
  // Zakup je vezan za IDENTITET agenta (ime harnesa), ne za ulogu: sam `ROLE` ne
  // razlikuje dva procesa iste uloge, pa bi svaki od njih mogao da piše pod
  // tuđim zakupom.
  if (task.data.lock_owner !== AGENT) {
    throw new AccessError(`zadatak ${TASK_ID} ne drži "${AGENT}" (drži "${task.data.lock_owner}")`);
  }
  if (task.data.lock_token && task.data.lock_token !== LEASE_TOKEN) {
    throw new AccessError(`zakup nad zadatkom ${TASK_ID} drži drugi proces istog identiteta`);
  }
  const expires = Date.parse(task.data.lease_expires_at ?? '');
  if (!Number.isFinite(expires) || expires <= Date.now()) {
    throw new AccessError(`zakup nad zadatkom ${TASK_ID} je istekao (${task.data.lease_expires_at})`);
  }
  if (zone === 'production' && kind !== 'audit') {
    // Produkcioni upis mora biti konsolidacija deklarisanog artefakta. Prazna
    // lista artefakata ne znači "bilo šta sme" — znači da zadatak nije prošao
    // kroz fazu istraživanja. Revizorski zadatak je izuzetak: njegova granica je
    // `audit_scope`, proveren iznad.
    const target = path.basename(relative, '.md');
    const artifacts = (task.data.artifacts ?? []).map((rel) => path.basename(rel, '.md'));
    if (!artifacts.length) {
      throw new AccessError(`zadatak ${TASK_ID} nema artefakte — nema šta da se konsoliduje u "${target}"`);
    }
    if (!artifacts.includes(target)) {
      throw new AccessError(
        `beleška "${target}" nije artefakt zadatka ${TASK_ID} (artefakti: ${artifacts.join(', ')})`,
      );
    }
  }
  return { task: task.data.id, status: task.data.status, zone };
}

// ------------------------------------------------------------------ operacije

async function opList({ dir = null, prefix = '' } = {}) {
  const dirs = dir ? [dir] : ['wiki', 'raw', 'tasks'];
  const notes = await listNotes(VAULT, dirs);
  const filtered = prefix ? notes.filter((n) => n.startsWith(prefix)) : notes;
  if (!filtered.length) return `nema belešaka (zone: ${dirs.join(', ')}${prefix ? `, prefiks ${prefix}` : ''})`;
  return `${filtered.length} beleške\n\n${filtered.join('\n')}`;
}

/** Izvuci samo jedan odeljak (po naslovu) iz Markdown tela. */
export function extractSection(body, section) {
  const lines = body.split('\n');
  const wanted = section.trim().toLowerCase();
  let start = -1;
  let level = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const match = /^(#{1,6})\s+(.*)$/.exec(lines[i]);
    if (!match) continue;
    if (match[2].trim().toLowerCase() === wanted) {
      start = i;
      level = match[1].length;
      break;
    }
  }
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    const match = /^(#{1,6})\s+/.exec(lines[i]);
    if (match && match[1].length <= level) { end = i; break; }
  }
  return { start, end, level, lines, text: lines.slice(start, end).join('\n') };
}

async function opRead({ paths, path: single, frontmatter_only = false, section = null, max_bytes = 20000 } = {}) {
  const targets = paths ?? (single ? [single] : []);
  if (!targets.length) throw new Error('zadaj `path` ili `paths`');
  const chunks = [];
  for (const rel of targets) {
    const full = await assertReadable(rel);
    const relative = path.relative(VAULT, full).split(path.sep).join('/');
    let text;
    try {
      text = await fs.readFile(full, 'utf8');
    } catch (error) {
      chunks.push(`## ${relative}\n\nerror: ${error.code === 'ENOENT' ? 'beleška ne postoji' : error.message}`);
      continue;
    }
    const parsed = parseFrontmatter(text);
    const head = `## ${relative}${parsed.present ? '' : ' (bez frontmatter-a)'}`;
    const parts = [head, ''];
    if (parsed.present) {
      parts.push('```yaml', stringifyFrontmatter(parsed.data, '').trimEnd().replace(/^---\n/, '').replace(/\n---$/, ''), '```', '');
    }
    if (frontmatter_only) {
      parts.push(`_(samo zaglavlje; telo ima ${Buffer.byteLength(parsed.body)} B)_`);
    } else if (section) {
      const found = extractSection(parsed.body, section);
      parts.push(found ? found.text : `_(odeljak "${section}" ne postoji)_`);
    } else {
      const body = parsed.body.slice(0, max_bytes);
      parts.push(body + (parsed.body.length > max_bytes ? `\n\n_(skraćeno na ${max_bytes} B od ${Buffer.byteLength(parsed.body)})_` : ''));
    }
    chunks.push(parts.join('\n'));
  }
  return chunks.join('\n\n---\n\n');
}

async function opSearch({ query, tag = null, dir = null, limit = 20, context = 0 } = {}) {
  if (!query || typeof query !== 'string') throw new Error('`query` je obavezan');
  const dirs = dir ? [dir] : ['wiki', 'raw', 'tasks'];
  const needle = query.toLowerCase();
  const max = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 20;
  const hits = [];
  for (const zone of dirs) {
    const notes = await listNotes(VAULT, [zone]);
    for (const rel of notes) {
      const note = await readNote(VAULT, rel);
      if (tag && !(note.frontmatter?.tags ?? []).map(String).includes(tag)) continue;
      const lines = note.text.split('\n');
      for (let i = 0; i < lines.length; i += 1) {
        if (!lines[i].toLowerCase().includes(needle)) continue;
        const from = Math.max(0, i - context);
        const to = Math.min(lines.length, i + context + 1);
        hits.push(`${rel}:${i + 1}: ${lines.slice(from, to).map((l) => l.trim()).join(' ⏎ ').slice(0, 300)}`);
        if (hits.length >= max) return `${hits.length} pogodaka (skraćeno na ${max})\n\n${hits.join('\n')}`;
      }
    }
  }
  return hits.length ? `${hits.length} pogodaka\n\n${hits.join('\n')}` : `nema pogodaka za "${query}"`;
}

async function opBacklinks({ path: rel, dir = 'wiki' } = {}) {
  if (!rel) throw new Error('`path` je obavezan');
  // Prihvata se i putanja (wiki/Crna_tabla.md) i samo ime beleške (Crna tabla),
  // da bi se grafom moglo hodati direktno iz teksta Vikilinka.
  if (rel.includes('/')) await assertReadable(rel);
  const hits = await findBacklinks(VAULT, rel, { dirs: [dir] });
  if (!hits.length) return `${rel}: nema backlinkova`;
  const lines = [`${rel}: ${hits.length} backlinkova`, ''];
  for (const hit of hits) {
    lines.push(`${hit.rel} (${hit.count})`);
    for (const link of hit.links) lines.push(`  - ${link.raw}`);
  }
  return lines.join('\n');
}

async function opWrite({ path: rel, content, status = null, tags = null, title = null, authors = null } = {}) {
  if (!rel) throw new Error('`path` je obavezan');
  if (typeof content !== 'string') throw new Error('`content` je obavezan');
  const full = await assertWritable(rel);
  const relative = path.relative(VAULT, full).split(path.sep).join('/');
  const now = new Date().toISOString();
  const parsed = parseFrontmatter(content);
  let text;
  if (parsed.present) {
    text = content;
  } else {
    const frontmatter = {
      title: title ?? noteName(relative),
      created: now,
      updated: now,
      authors: authors ?? [AGENT],
      status: status ?? 'draft',
      tags: tags ?? [],
    };
    text = stringifyFrontmatter(frontmatter, content);
  }
  await writeFileAtomic(full, text);
  return `upisano ${relative} (${Buffer.byteLength(text)} B) uloga=${ROLE}`;
}

/** Atomska izmena jednog odeljka — bez prepisivanja cele beleške. */
async function opPatch({ path: rel, section, content, mode = 'replace', create = true } = {}) {
  if (!rel) throw new Error('`path` je obavezan');
  if (!section) throw new Error('`section` je obavezan');
  if (typeof content !== 'string') throw new Error('`content` je obavezan');
  const full = await assertWritable(rel);
  const relative = path.relative(VAULT, full).split(path.sep).join('/');
  let text = '';
  try {
    text = await fs.readFile(full, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const parsed = parseFrontmatter(text);
  const found = extractSection(parsed.body, section);

  let body;
  if (!found) {
    if (!create) throw new Error(`odeljak "${section}" ne postoji u ${relative} (create=false)`);
    const heading = section.startsWith('#') ? section : `## ${section}`;
    body = `${parsed.body.replace(/\s*$/, '')}\n\n${heading}\n\n${content}\n`;
  } else if (mode === 'replace') {
    const lines = [...found.lines];
    lines.splice(found.start, found.end - found.start, ...`${found.lines[found.start]}\n\n${content}`.split('\n'));
    body = lines.join('\n');
  } else if (mode === 'append') {
    const lines = [...found.lines];
    const insertAt = found.end;
    lines.splice(insertAt, 0, '', content);
    body = lines.join('\n');
  } else if (mode === 'prepend') {
    const lines = [...found.lines];
    lines.splice(found.start + 1, 0, '', content);
    body = lines.join('\n');
  } else {
    throw new Error(`nepoznat mode "${mode}" (replace|append|prepend)`);
  }

  const output = parsed.present
    ? stringifyFrontmatter({ ...parsed.data, updated: new Date().toISOString() }, body)
    : body;
  await writeFileAtomic(full, output);
  return `${mode} odeljka "${section}" u ${relative} (${Buffer.byteLength(output)} B)`;
}

async function opLint() {
  const { lintVault, formatFindings } = await import('../orchestrator/lib/lint.mjs');
  const { loadConfig } = await import('../orchestrator/lib/config.mjs');
  const config = await loadConfig(VAULT);
  const result = await lintVault(config);
  return `${formatFindings(result)}\n\ngrešaka: ${result.errors.length}, upozorenja: ${result.warnings.length}`;
}

async function opInfo() {
  const zones = await listNotes(VAULT, ['wiki', 'raw', 'tasks']);
  const zones4role = ROLE_WRITE_ZONES[ROLE] ?? [];
  return [
    `server:      ${SERVER_NAME} ${SERVER_VERSION}`,
    `vault:       ${VAULT}`,
    `agent:       ${AGENT}`,
    `role:        ${ROLE}`,
    `task:        ${TASK_ID || '(nije zadat)'}`,
    `task root:   ${TASK_ROOT}`,
    `write zones: ${zones4role.length ? zones4role.join(', ') : '(samo čitanje)'}`,
    `never write: ${NEVER_WRITABLE.join(', ')}`,
    `protected:   ${PROTECTED_FILES.join(', ')}`,
    `beleške:     ${zones.length}`,
  ].join('\n');
}

// ------------------------------------------------------------------ MCP

export const TOOLS = [
  {
    name: 'obsidian_search_notes',
    description: 'Pretraži beleške po sadržaju, opciono po oznaci (tag) i zoni. Vraća putanju, broj linije i kontekst. Koristi ovo PRE pisanja, da ne dupliraš postojeće znanje.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Podstring koji se traži (bez razlike velikih/malih slova)' },
        tag: { type: 'string', description: 'Ograniči na beleške sa ovom oznakom' },
        dir: { type: 'string', description: 'Zona: wiki, raw ili tasks' },
        limit: { type: 'number', description: 'Maksimalan broj pogodaka (podrazumevano 20)' },
        context: { type: 'number', description: 'Broj linija konteksta oko pogotka' },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'obsidian_read_notes',
    description: 'Pročitaj jednu ili više belešaka. `frontmatter_only` vraća samo YAML zaglavlje, a `section` samo jedan odeljak — oba štede kontekstni prozor.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relativna putanja jedne beleške, npr. wiki/Index.md' },
        paths: { type: 'array', items: { type: 'string' }, description: 'Više putanja odjednom' },
        frontmatter_only: { type: 'boolean', description: 'Vrati samo zaglavlje' },
        section: { type: 'string', description: 'Vrati samo odeljak sa ovim naslovom' },
        max_bytes: { type: 'number', description: 'Maksimalna dužina tela po belešci' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'obsidian_patch_note',
    description: 'Atomski izmeni JEDAN odeljak beleške (replace|append|prepend) bez prepisivanja ostatka. Ako odeljak ne postoji, dodaje ga na kraj (create=true).',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relativna putanja beleške' },
        section: { type: 'string', description: 'Naslov odeljka bez znakova #' },
        content: { type: 'string', description: 'Novi sadržaj odeljka' },
        mode: { type: 'string', enum: ['replace', 'append', 'prepend'], description: 'Način izmene' },
        create: { type: 'boolean', description: 'Dozvoli kreiranje odeljka ako ne postoji' },
      },
      required: ['path', 'section', 'content'],
      additionalProperties: false,
    },
  },
  {
    name: 'obsidian_backlinks',
    description: 'Prikaži koje sve beleške referenciraju datu belešku preko [[Vikilinkova]] — kretanje kroz graf znanja.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relativna putanja ili ime beleške' },
        dir: { type: 'string', description: 'Zona pretrage (podrazumevano wiki)' },
      },
      required: ['path'],
      additionalProperties: false,
    },
  },
  {
    name: 'obsidian_write_note',
    description: 'Upiši novu belešku ili zameni postojeću u svojoj zoni upisa. Ako sadržaj nema frontmatter, dodaje se standardno zaglavlje.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relativna putanja, npr. wiki/drafts/Nova_Tehnologija.md' },
        content: { type: 'string', description: 'Kompletan sadržaj beleške' },
        title: { type: 'string', description: 'Naslov za zaglavlje' },
        status: { type: 'string', enum: ['draft', 'review', 'verified', 'consolidated'] },
        tags: { type: 'array', items: { type: 'string' } },
        authors: { type: 'array', items: { type: 'string' } },
      },
      required: ['path', 'content'],
      additionalProperties: false,
    },
  },
  {
    name: 'obsidian_list_notes',
    description: 'Listaj beleške u zonama znanja, opciono filtrirano prefiksom putanje.',
    inputSchema: {
      type: 'object',
      properties: {
        dir: { type: 'string', description: 'Zona: wiki, raw, tasks' },
        prefix: { type: 'string', description: 'Samo putanje sa ovim prefiksom' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'obsidian_lint_vault',
    description: 'Pokreni linter invarijanti (frontmatter, Vikilinkovi, nepromenljivost raw/, konzistentnost zadataka).',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'obsidian_vault_info',
    description: 'Prikaži koren skladišta, identitet agenta, ulogu i dozvoljene zone upisa. Pozovi prvo ako nisi siguran šta smeš.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
];

const HANDLERS = {
  obsidian_search_notes: opSearch,
  obsidian_read_notes: opRead,
  obsidian_patch_note: opPatch,
  obsidian_backlinks: opBacklinks,
  obsidian_write_note: opWrite,
  obsidian_list_notes: opList,
  obsidian_lint_vault: opLint,
  obsidian_vault_info: opInfo,
};

function guardEpipe() {
  for (const stream of [process.stdout, process.stderr]) {
    stream.on('error', (error) => {
      if (error.code === 'EPIPE') process.exit(0);
      throw error;
    });
  }
}

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function textResult(text, isError = false) {
  return { content: [{ type: 'text', text }], isError };
}

async function handle(msg) {
  const { method, params } = msg;
  if (method === 'initialize') {
    const requested = params?.protocolVersion;
    return {
      protocolVersion: typeof requested === 'string' ? requested : PROTOCOL_VERSION,
      capabilities: { tools: {} },
      serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
    };
  }
  if (method === 'ping') return {};
  if (method === 'tools/list') return { tools: TOOLS };
  if (method === 'tools/call') {
    const name = params?.name;
    const args = params?.arguments ?? {};
    const handler = HANDLERS[name];
    if (!handler) return textResult(`nepoznat alat "${name}" — dostupno: ${Object.keys(HANDLERS).join(', ')}`, true);
    try {
      return textResult(String(await handler(args)));
    } catch (error) {
      log(`alat ${name} odbijen: ${error.message}`);
      return textResult(`error: ${error.message}`, true);
    }
  }
  const error = new Error(`metod nije podržan: ${method}`);
  error.code = -32601;
  throw error;
}

function startServer() {
  log(`servira | vault=${VAULT} | role=${ROLE}`);
  const rl = createInterface({ input: process.stdin, terminal: false });
  rl.on('line', (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let msg;
    try {
      msg = JSON.parse(trimmed);
    } catch {
      log('ignorišem ne-JSON liniju na stdin');
      return;
    }
    if (msg.id === undefined) return;
    handle(msg)
      .then((result) => send({ jsonrpc: '2.0', id: msg.id, result }))
      .catch((error) => {
        if (error.code) send({ jsonrpc: '2.0', id: msg.id, error: { code: error.code, message: error.message } });
        else send({ jsonrpc: '2.0', id: msg.id, result: textResult(`error: ${error.message}`, true) });
      });
  });
  rl.on('close', () => process.exit(0));
}

// ------------------------------------------------------------------ CLI

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

async function cliMain(argv) {
  const [command, ...rest] = argv;
  const flags = {};
  const positional = [];
  for (let i = 0; i < rest.length; i += 1) {
    if (rest[i].startsWith('--')) {
      const key = rest[i].slice(2);
      const next = rest[i + 1];
      if (next === undefined || next.startsWith('--')) flags[key] = true;
      else { flags[key] = next; i += 1; }
    } else positional.push(rest[i]);
  }
  switch (command) {
    case 'info': return opInfo();
    case 'list': return opList({ dir: flags.dir, prefix: flags.prefix ?? '' });
    case 'read': return opRead({
      path: positional[0],
      frontmatter_only: Boolean(flags.frontmatter),
      section: flags.section ?? null,
      max_bytes: flags['max-bytes'] ? Number(flags['max-bytes']) : 20000,
    });
    case 'search': return opSearch({ query: positional.join(' '), tag: flags.tag ?? null, dir: flags.dir ?? null, limit: flags.limit ? Number(flags.limit) : 20 });
    case 'backlinks': return opBacklinks({ path: positional[0], dir: flags.dir ?? 'wiki' });
    case 'write': return opWrite({ path: positional[0], content: flags['content-file'] ? await fs.readFile(flags['content-file'], 'utf8') : await readStdin() });
    case 'patch': return opPatch({
      path: positional[0],
      section: flags.section,
      content: flags['content-file'] ? await fs.readFile(flags['content-file'], 'utf8') : await readStdin(),
      mode: flags.mode ?? 'replace',
    });
    case 'lint': return opLint();
    default: {
      const error = new Error(`nepoznata komanda "${command}" — koristi: info, list, read, search, backlinks, write, patch, lint`);
      error.code = 2;
      throw error;
    }
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  guardEpipe();
  const argv = process.argv.slice(2);
  if (argv.length) {
    cliMain(argv)
      .then((text) => { process.stdout.write(`${text}\n`); })
      .catch((error) => { process.stderr.write(`obsidian-mcp: ${error.message}\n`); process.exitCode = error.code ?? 1; });
  } else {
    startServer();
  }
}
