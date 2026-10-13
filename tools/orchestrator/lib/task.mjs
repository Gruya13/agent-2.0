/**
 * Zadatak (task) je jedinica crne table. Živi kao Markdown fajl sa YAML
 * frontmatter-om, a njegovo stanje je ono što agenti posmatraju — nema
 * direktne razmene poruka.
 *
 * Ovaj modul poseduje: šemu polja, strogi automata stanja i atomski upis.
 */
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { parseFrontmatter, stringifyFrontmatter, YamlError } from './yaml.mjs';
import { writeFileAtomic, walkFiles } from './fsx.mjs';

export const TASK_STATUSES = ['proposed', 'ready', 'in_progress', 'review', 'verified', 'consolidated', 'blocked'];

/**
 * Dozvoljeni prelazi. Svaki drugi prelaz je greška, ne upozorenje — automat je
 * ono što sprečava da nacrt "preskoči" verifikaciju.
 */
export const TRANSITIONS = {
  proposed: ['ready', 'blocked'],
  ready: ['in_progress', 'blocked'],
  // Konsolidator drži zakup (`in_progress`) dok ne spoji granu, pa iz tog stanja
  // sme direktno u `consolidated`. Prelaze izvodi isključivo kontrolni sloj —
  // agenti nikad ne menjaju status zadatka.
  in_progress: ['review', 'ready', 'verified', 'consolidated', 'blocked'],
  // `review -> ready` je odbijen nacrt: vraća se istraživaču, ne produkcionom wiki-ju.
  review: ['verified', 'ready', 'blocked'],
  verified: ['consolidated', 'review', 'ready', 'blocked'],
  consolidated: [],
  blocked: ['ready'],
};

export const TASK_FIELD_ORDER = [
  'id', 'title', 'status', 'created', 'updated', 'source', 'priority', 'tags',
  'depends_on', 'authors', 'assignee', 'lock_owner', 'locked_at',
  'lease_expires_at', 'artifacts', 'verification', 'blocked_reason', 'history',
];

export const REQUIRED_FIELDS = ['id', 'title', 'status', 'created', 'updated'];

const ID_RE = /^TASK-\d{3,}$/;

export class TaskError extends Error {
  constructor(message, code = 'TASK_ERROR') {
    super(message);
    this.name = 'TaskError';
    this.code = code;
  }
}

// ------------------------------------------------------------------ šema

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/;

export function validateTaskData(data) {
  const problems = [];
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return ['frontmatter zadatka mora biti mapiranje'];
  }
  for (const field of REQUIRED_FIELDS) {
    if (data[field] === undefined || data[field] === null || data[field] === '') {
      problems.push(`nedostaje obavezno polje "${field}"`);
    }
  }
  if (data.id && !ID_RE.test(String(data.id))) problems.push(`neispravan id "${data.id}" (očekivano TASK-NNN)`);
  if (data.status && !TASK_STATUSES.includes(data.status)) {
    problems.push(`nepoznat status "${data.status}" (dozvoljeni: ${TASK_STATUSES.join(', ')})`);
  }
  for (const field of ['created', 'updated', 'locked_at', 'lease_expires_at']) {
    const value = data[field];
    if (value === undefined || value === null) continue;
    if (typeof value !== 'string' || !ISO_RE.test(value)) {
      problems.push(`polje "${field}" mora biti ISO-8601 UTC vreme`);
    }
  }
  if (Array.isArray(data.authors) === false && data.authors !== undefined && data.authors !== null) {
    problems.push('polje "authors" mora biti lista');
  }
  if (!Array.isArray(data.tags) && data.tags !== undefined && data.tags !== null) {
    problems.push('polje "tags" mora biti lista');
  }
  if (!Array.isArray(data.artifacts) && data.artifacts !== undefined && data.artifacts !== null) {
    problems.push('polje "artifacts" mora biti lista');
  }
  if (data.status === 'in_progress') {
    for (const field of ['lock_owner', 'locked_at', 'lease_expires_at']) {
      if (!data[field]) problems.push(`status "in_progress" zahteva polje "${field}"`);
    }
  }
  if (data.status === 'blocked' && !data.blocked_reason) {
    problems.push('status "blocked" zahteva polje "blocked_reason"');
  }
  return problems;
}

export function canTransition(from, to) {
  if (from === to) return true;
  return (TRANSITIONS[from] ?? []).includes(to);
}

export function assertTransition(from, to) {
  if (!TASK_STATUSES.includes(to)) throw new TaskError(`nepoznat ciljni status "${to}"`, 'BAD_STATUS');
  if (!canTransition(from, to)) {
    throw new TaskError(`nedozvoljen prelaz ${from} -> ${to}`, 'BAD_TRANSITION');
  }
}

// ------------------------------------------------------------------ serde

export function parseTaskText(text, file = '<string>') {
  let parsed;
  try {
    parsed = parseFrontmatter(text);
  } catch (error) {
    if (error instanceof YamlError) throw new TaskError(`${file}: ${error.message}`, 'BAD_YAML');
    throw error;
  }
  if (!parsed.present) throw new TaskError(`${file}: zadatak nema YAML frontmatter`, 'NO_FRONTMATTER');
  return { data: parsed.data, body: parsed.body };
}

export function formatTask(data, body) {
  return stringifyFrontmatter(data, body, { order: TASK_FIELD_ORDER });
}

export async function readTaskFile(file) {
  const text = await fs.readFile(file, 'utf8');
  const { data, body } = parseTaskText(text, file);
  return { file, data, body, text };
}

export async function writeTaskFile(file, data, body) {
  const problems = validateTaskData(data);
  if (problems.length) throw new TaskError(`zadatak nije validan: ${problems.join('; ')}`, 'INVALID_TASK');
  await writeFileAtomic(file, formatTask(data, body));
  return file;
}

// ------------------------------------------------------------------ faze

/** Fizička fascikla u kojoj zadatak živi za dato stanje. */
export function phaseFor(status) {
  switch (status) {
    case 'proposed':
    case 'ready':
    case 'blocked':
      return 'inbox';
    case 'in_progress':
      return 'active';
    case 'review':
    case 'verified':
      return 'review';
    case 'consolidated':
      return 'completed';
    default:
      throw new TaskError(`nepoznat status "${status}"`, 'BAD_STATUS');
  }
}

export function dirForPhase(config, phase) {
  switch (phase) {
    case 'inbox': return config.inbox;
    case 'active': return config.active;
    case 'review': return config.review;
    case 'completed': return config.completed;
    default: throw new TaskError(`nepoznata faza "${phase}"`, 'BAD_PHASE');
  }
}

// ------------------------------------------------------------------ id

export async function nextTaskId(config) {
  const seen = [];
  for (const phase of ['inbox', 'active', 'review', 'completed']) {
    const dir = dirForPhase(config, phase);
    for (const rel of await walkFiles(dir, { filter: (f) => f.endsWith('.md') })) {
      const match = /^TASK-(\d{3,})\.md$/.exec(path.basename(rel));
      if (match) seen.push(Number.parseInt(match[1], 10));
    }
  }
  const next = seen.length ? Math.max(...seen) + 1 : 101;
  return `TASK-${String(next).padStart(3, '0')}`;
}

/** Pronađi zadatak po id-u u svim fazama. Vraća null ako ne postoji. */
export async function findTask(config, id) {
  if (!ID_RE.test(String(id))) throw new TaskError(`neispravan id "${id}"`, 'BAD_ID');
  for (const phase of ['inbox', 'active', 'review', 'completed']) {
    const file = path.join(dirForPhase(config, phase), `${id}.md`);
    try {
      const task = await readTaskFile(file);
      return { ...task, phase };
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
  }
  return null;
}

/** Svi zadaci u svim fazama, sortirani po id-u. */
export async function listTasks(config) {
  const out = [];
  for (const phase of ['inbox', 'active', 'review', 'completed']) {
    const dir = dirForPhase(config, phase);
    const files = await walkFiles(dir, { filter: (f) => /^TASK-\d{3,}\.md$/.test(path.basename(f)) });
    for (const rel of files) {
      const file = path.join(dir, rel);
      const task = await readTaskFile(file);
      out.push({ ...task, phase });
    }
  }
  out.sort((a, b) => String(a.data.id).localeCompare(String(b.data.id)));
  return out;
}

// ------------------------------------------------------------------ mutacije

export function newTaskData({ id, title, source = null, priority = 'normal', tags = [], dependsOn = [], now = new Date().toISOString(), body = '' }) {
  const data = {
    id,
    title,
    status: 'proposed',
    created: now,
    updated: now,
    source,
    priority,
    tags,
    depends_on: dependsOn,
    authors: [],
    assignee: null,
    lock_owner: null,
    locked_at: null,
    lease_expires_at: null,
    artifacts: [],
    verification: null,
    blocked_reason: null,
    history: [{ at: now, status: 'proposed', actor: 'operator' }],
  };
  return { data, body };
}

export function defaultBody(title, request = '') {
  return [
    `# ${title}`,
    '',
    '## Zahtev',
    '',
    request || '_Operater nije ostavio opis; vidi `source`._',
    '',
    '## Nalazi',
    '',
    '_Prazno do prvog nalaza._',
    '',
  ].join('\n');
}

export function appendHistory(data, { status, actor, note = null, now = new Date().toISOString() }) {
  const history = Array.isArray(data.history) ? [...data.history] : [];
  const entry = { at: now, status, actor };
  if (note) entry.note = note;
  history.push(entry);
  return { ...data, history, updated: now };
}
