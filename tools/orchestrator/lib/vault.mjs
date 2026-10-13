/**
 * Vault sloj: beleške, YAML zaglavlja, Vikilinkovi, backlinkovi i centralni
 * indeks. Ovo je "baza znanja" iz arhitekture — Markdown + frontmatter +
 * semantički graf preko [[dvostrukih zagrada]].
 */
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { parseFrontmatter, stringifyFrontmatter } from './yaml.mjs';
import { assertRealInside, resolveInside, walkFiles, writeFileAtomic } from './fsx.mjs';

export const NOTE_STATUSES = ['draft', 'review', 'verified', 'consolidated'];
export const NOTE_REQUIRED_FIELDS = ['title', 'created', 'updated', 'authors', 'status', 'tags'];

/** Obsidian konvencija iz specifikacije: `Nova Tehnologija` -> `Nova_Tehnologija`. */
export function noteSlug(title) {
  const cleaned = String(title)
    .normalize('NFC')
    .replace(/[\\/:*?"<>|#^[\]]/g, '')
    .replace(/['’`]/g, '')
    .trim()
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_');
  return cleaned === '' ? 'Beleška' : cleaned;
}

export function noteName(file) {
  return path.basename(file).replace(/\.md$/, '');
}

/** Normalizacija imena za poređenje linkova: bez razmaka, donja slova, bez dijakritike se ne dira. */
export function normalizeName(name) {
  return String(name).replace(/\.md$/i, '').replace(/[_\s]+/g, ' ').trim().toLowerCase();
}

const WIKILINK_RE = /\[\[([^\]|#]+)(?:#([^\]|]+))?(?:\|([^\]]+))?\]\]/g;

/** Izvuci sve Vikilinkove iz teksta, uključujući duplikate (za brojanje). */
export function extractWikilinks(text) {
  const out = [];
  const re = new RegExp(WIKILINK_RE.source, 'g');
  let match;
  while ((match = re.exec(text)) !== null) {
    const target = match[1].trim();
    if (!target) continue;
    out.push({
      target,
      normalized: normalizeName(target),
      heading: match[2] ? match[2].trim() : null,
      alias: match[3] ? match[3].trim() : null,
      raw: match[0],
      index: match.index,
    });
  }
  return out;
}

export function uniqueLinkTargets(text) {
  const seen = new Map();
  for (const link of extractWikilinks(text)) {
    if (!seen.has(link.normalized)) seen.set(link.normalized, link);
  }
  return [...seen.values()];
}

export function noteFrontmatterProblems(data) {
  const problems = [];
  if (!data || typeof data !== 'object' || Array.isArray(data)) return ['nema YAML frontmatter-a'];
  for (const field of NOTE_REQUIRED_FIELDS) {
    const value = data[field];
    if (value === undefined || value === null || value === '') problems.push(`nedostaje polje "${field}"`);
  }
  if (data.status && !NOTE_STATUSES.includes(data.status)) {
    problems.push(`status "${data.status}" nije dozvoljen (${NOTE_STATUSES.join(', ')})`);
  }
  if (data.authors !== undefined && !Array.isArray(data.authors)) problems.push('polje "authors" mora biti lista');
  if (data.tags !== undefined && !Array.isArray(data.tags)) problems.push('polje "tags" mora biti lista');
  return problems;
}

/** Učitaj belešku iz vault-a; `rel` je putanja relativna na koren vault-a. */
export async function readNote(vaultRoot, rel) {
  const full = resolveInside(vaultRoot, rel);
  // Simbolički link unutar vault-a ne sme da odvede čitanje van njega.
  await assertRealInside(vaultRoot, full, { label: `beleška ${rel}` });
  const text = await fs.readFile(full, 'utf8');
  const { data, body, present } = parseFrontmatter(text);
  return {
    rel: rel.split(path.sep).join('/'),
    file: full,
    text,
    body,
    frontmatter: present ? data : null,
    title: present && data?.title ? String(data.title) : noteName(full),
  };
}

export async function writeNote(vaultRoot, rel, { frontmatter, body, order } = {}) {
  const full = resolveInside(vaultRoot, rel);
  await assertRealInside(vaultRoot, full, { label: `beleška ${rel}` });
  const text = frontmatter ? stringifyFrontmatter(frontmatter, body ?? '', order ? { order } : {}) : (body ?? '');
  await writeFileAtomic(full, text);
  return full;
}

/** Sve beleške pod datim direktorijumom (relativno na vault), sortirane. */
export async function listNotes(vaultRoot, dirs = ['.']) {
  const out = [];
  for (const dir of dirs) {
    const root = resolveInside(vaultRoot, dir);
    const rels = await walkFiles(root, { filter: (f) => f.endsWith('.md'), skipDirs: ['.git', 'node_modules', '.worktrees', '.locks', '.runtime'] });
    for (const rel of rels) out.push(path.posix.join(dir === '.' ? '' : dir, rel));
  }
  return out.sort();
}

/** Mapa naziv -> relativna putanja, za rezoluciju Vikilinkova. */
export async function buildNameIndex(vaultRoot, { dirs = ['wiki'] } = {}) {
  const notes = await listNotes(vaultRoot, dirs);
  const map = new Map();
  for (const rel of notes) {
    const name = normalizeName(noteName(rel));
    if (!map.has(name)) map.set(name, rel);
    else map.set(name, [...(Array.isArray(map.get(name)) ? map.get(name) : [map.get(name)]), rel]);
  }
  return { notes, map };
}

/** Backlinkovi: ko sve referencira datu belešku (po imenu ili putanji). */
export async function findBacklinks(vaultRoot, target, { dirs = ['wiki'] } = {}) {
  const wanted = new Set([normalizeName(target), normalizeName(noteName(target))]);
  const { notes } = await buildNameIndex(vaultRoot, { dirs });
  const hits = [];
  for (const rel of notes) {
    if (normalizeName(noteName(rel)) === normalizeName(noteName(target))) continue;
    const note = await readNote(vaultRoot, rel);
    const links = extractWikilinks(note.text).filter((l) => wanted.has(l.normalized));
    if (links.length) hits.push({ rel, count: links.length, links });
  }
  return hits.sort((a, b) => a.rel.localeCompare(b.rel));
}

/**
 * Generiši `wiki/Index.md` iz stanja vault-a. Indeks je izveden artefakt: nikad
 * se ne uređuje ručno.
 */
export async function renderIndex(vaultRoot, { dirs = ['wiki'], generatedAt = new Date().toISOString() } = {}) {
  const notes = await listNotes(vaultRoot, dirs);
  const entries = [];
  for (const rel of notes) {
    if (rel === 'wiki/Index.md') continue;
    const note = await readNote(vaultRoot, rel);
    const fm = note.frontmatter ?? {};
    entries.push({
      rel,
      name: noteName(rel),
      title: String(fm.title ?? noteName(rel)),
      status: String(fm.status ?? 'unknown'),
      tags: Array.isArray(fm.tags) ? fm.tags.map(String) : [],
      draft: rel.includes('/drafts/'),
      links: uniqueLinkTargets(note.text).length,
    });
  }
  entries.sort((a, b) => a.title.localeCompare(b.title, 'sr'));

  const tagSet = new Map();
  for (const entry of entries) {
    for (const tag of entry.tags) tagSet.set(tag, (tagSet.get(tag) ?? 0) + 1);
  }

  const lines = [
    '---',
    'title: Index',
    `created: ${generatedAt}`,
    `updated: ${generatedAt}`,
    'authors: [agentctl]',
    'status: consolidated',
    'tags: [index]',
    '---',
    '',
    '# Index — centralni indeks baze znanja',
    '',
    `_Generisano: ${generatedAt}. Ne uređivati ručno; pokreni \`agentctl index\`._`,
    '',
    `## Beleške (${entries.length})`,
    '',
    '| Beleška | Status | Oznake | Veze |',
    '|---|---|---|---|',
  ];
  for (const entry of entries) {
    const tags = entry.tags.length ? entry.tags.map((t) => `#${t}`).join(' ') : '—';
    lines.push(`| [[${entry.name}]] | ${entry.status} | ${tags} | ${entry.links} |`);
  }
  if (!entries.length) lines.push('| _nema belešaka_ | — | — | — |');

  lines.push('', '## Oznake', '');
  const tags = [...tagSet.entries()].sort((a, b) => a[0].localeCompare(b[0], 'sr'));
  if (tags.length) {
    for (const [tag, count] of tags) lines.push(`- #${tag} (${count})`);
  } else {
    lines.push('- _nema oznaka_');
  }
  lines.push('');
  return { text: `${lines.join('\n')}`, entries };
}
