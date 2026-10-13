import test from 'node:test';
import assert from 'node:assert/strict';
import { makeVault } from './helpers/vault.mjs';
import {
  buildNameIndex, extractWikilinks, findBacklinks, listNotes, noteFrontmatterProblems,
  noteName, noteSlug, normalizeName, readNote, renderIndex, uniqueLinkTargets, writeNote,
} from '../tools/orchestrator/lib/vault.mjs';

async function seedWiki(vault) {
  const now = '2025-01-01T00:00:00.000Z';
  await writeNote(vault.root, 'wiki/Crna_tabla.md', {
    frontmatter: { title: 'Crna tabla', created: now, updated: now, authors: ['researcher'], status: 'consolidated', tags: ['arhitektura'] },
    body: '# Crna tabla\n\nZajednička memorija. Vidi [[Izvori znanja]] i [[Kontrolni mehanizam|kontrolu]].\n',
  });
  await writeNote(vault.root, 'wiki/Izvori_znanja.md', {
    frontmatter: { title: 'Izvori znanja', created: now, updated: now, authors: ['researcher'], status: 'consolidated', tags: ['arhitektura', 'agenti'] },
    body: '# Izvori znanja\n\nAgenti se aktiviraju nad [[Crna tabla]].\n',
  });
  await writeNote(vault.root, 'wiki/drafts/Nacrt.md', {
    frontmatter: { title: 'Nacrt', created: now, updated: now, authors: ['researcher'], status: 'draft', tags: [] },
    body: '# Nacrt\n\nVidi [[Crna tabla]] i [[Nepostojeca beleska]].\n',
  });
}

test('noteSlug prati Obsidian konvenciju iz specifikacije', () => {
  assert.equal(noteSlug('Nova Tehnologija'), 'Nova_Tehnologija');
  assert.equal(noteSlug('Asinhroni multi-agentski sistem'), 'Asinhroni_multi-agentski_sistem');
  assert.equal(noteSlug('Naslov: sa dvotočkom?'), 'Naslov_sa_dvotočkom');
  assert.equal(noteSlug('   '), 'Beleška');
  assert.equal(noteSlug('a//b'), 'ab');
});

test('extractWikilinks: cilj, alias, odeljak i duplikati', () => {
  const links = extractWikilinks('[[A]] [[B|alias]] [[C#Odeljak]] [[A]]');
  assert.deepEqual(links.map((l) => l.target), ['A', 'B', 'C', 'A']);
  assert.equal(links[1].alias, 'alias');
  assert.equal(links[2].heading, 'Odeljak');
  assert.equal(uniqueLinkTargets('[[A]] [[A|b]] [[C]]').length, 2);
});

test('normalizeName izjednačava razmake, donje crte i velika slova', () => {
  assert.equal(normalizeName('Crna_tabla'), normalizeName('Crna tabla'));
  assert.equal(normalizeName('X.md'), 'x');
});

test('readNote i listNotes čitaju samo beleške u zadatim zonama', async () => {
  const vault = await makeVault();
  await seedWiki(vault);
  const notes = await listNotes(vault.root, ['wiki']);
  assert.deepEqual(notes, ['wiki/Crna_tabla.md', 'wiki/Izvori_znanja.md', 'wiki/drafts/Nacrt.md']);
  const note = await readNote(vault.root, 'wiki/Crna_tabla.md');
  assert.equal(note.title, 'Crna tabla');
  assert.equal(note.frontmatter.status, 'consolidated');
  assert.equal(noteName('wiki/Crna_tabla.md'), 'Crna_tabla');
  await vault.cleanup();
});

test('backlinkovi prate graf u oba smera', async () => {
  const vault = await makeVault();
  await seedWiki(vault);
  const backlinks = await findBacklinks(vault.root, 'Crna_tabla');
  assert.deepEqual(backlinks.map((b) => b.rel).sort(), ['wiki/Izvori_znanja.md', 'wiki/drafts/Nacrt.md']);
  assert.equal(backlinks.find((b) => b.rel === 'wiki/drafts/Nacrt.md').count, 1);
  const { map } = await buildNameIndex(vault.root);
  assert.ok(map.has('crna tabla'));
  await vault.cleanup();
});

test('frontmatter problems: obavezna polja, status, tipovi', () => {
  assert.deepEqual(noteFrontmatterProblems({ title: 'T', created: 'c', updated: 'u', authors: [], status: 'draft', tags: [] }), []);
  const problems = noteFrontmatterProblems({ title: 'T', status: 'nepoznato', authors: 'x', tags: 'y' });
  assert.equal(problems.length, 5, problems.join(' | '));
  assert.ok(problems.some((p) => /updated/.test(p)));
  assert.ok(problems.some((p) => /nije dozvoljen/.test(p)));
});

test('renderIndex generiše tabelu, oznake i ne uključuje sam sebe', async () => {
  const vault = await makeVault();
  await seedWiki(vault);
  const { text, entries } = await renderIndex(vault.root, { dirs: ['wiki'], generatedAt: '2025-01-01T00:00:00.000Z' });
  assert.equal(entries.length, 3);
  assert.ok(entries.some((e) => e.draft));
  assert.match(text, /\| \[\[Crna_tabla\]\] \| consolidated \|/);
  assert.match(text, /- #arhitektura \(2\)/);
  assert.match(text, /## Beleške \(3\)/);
  // Indeks je determinističan: isti ulaz daje isti izlaz.
  const again = await renderIndex(vault.root, { dirs: ['wiki'], generatedAt: '2025-01-01T00:00:00.000Z' });
  assert.equal(again.text, text);
  await vault.cleanup();
});

test('writeNote odbija izlazak iz vault-a', async () => {
  const vault = await makeVault();
  await assert.rejects(() => writeNote(vault.root, '../izvan.md', { body: 'x' }), /izlazi iz korena/);
  await assert.rejects(() => writeNote(vault.root, '/etc/passwd', { body: 'x' }), /apsolutna putanja/);
  await vault.cleanup();
});
