import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { makeVault, gitExec } from './helpers/vault.mjs';
import { loadConfig } from '../tools/orchestrator/lib/config.mjs';
import { formatFindings, lintVault, updateRawManifest } from '../tools/orchestrator/lib/lint.mjs';
import { writeNote } from '../tools/orchestrator/lib/vault.mjs';
import { sha256, sha256Bytes } from '../tools/orchestrator/lib/fsx.mjs';

const NOW = '2025-01-01T00:00:00.000Z';

function find(findings, code) {
  return findings.filter((f) => f.code === code);
}

test('lint: izmenjen izvor u raw/ je greška i linter to vidi', async () => {
  const vault = await makeVault();
  const config = await loadConfig(vault.root);
  await updateRawManifest(config);
  assert.deepEqual(find(await lintVault(config).then((r) => r.findings), 'raw.modified'), []);

  await vault.write('raw/dokument.md', 'sadrzaj je promenjen');
  const result = await lintVault(config);
  const modified = find(result.findings, 'raw.modified');
  assert.equal(modified.length, 1);
  assert.equal(modified[0].level, 'error');
  assert.equal(result.ok, false);
  await vault.cleanup();
});

test('lint: izmena BINARNOG izvora se detektuje (hash bajtova, ne teksta)', async () => {
  const vault = await makeVault();
  const config = await loadConfig(vault.root);
  // Bajt 0x80 i 0x81 su nevalidni UTF-8: dekodiranjem oba postaju isti U+FFFD,
  // pa bi hash teksta propustio izmenu.
  const original = Buffer.concat([Buffer.from('%PDF-1.7\n', 'utf8'), Buffer.from([0x80]), Buffer.from('\n', 'utf8')]);
  await fs.writeFile(path.join(vault.root, 'raw', 'binary.pdf'), original);
  await updateRawManifest(config);
  assert.deepEqual(find((await lintVault(config)).findings, 'raw.modified'), []);

  const changed = Buffer.concat([Buffer.from('%PDF-1.7\n', 'utf8'), Buffer.from([0x81]), Buffer.from('\n', 'utf8')]);
  await fs.writeFile(path.join(vault.root, 'raw', 'binary.pdf'), changed);
  const result = await lintVault(config);
  const modified = find(result.findings, 'raw.modified');
  assert.equal(modified.length, 1, 'jedan izmenjen bajt u binarnom izvoru mora biti prijavljen');
  assert.equal(modified[0].target, 'raw/binary.pdf');
  assert.equal(result.ok, false);
  await vault.cleanup();
});

test('lint: manifest v1 (hash teksta) se nadograđuje bez lažne prijave', async () => {
  const vault = await makeVault();
  const config = await loadConfig(vault.root);
  // Simuliraj stari manifest: hash UTF-8 dekodiranog teksta, bez oznake `bytes`.
  const text = await vault.read('raw/dokument.md');
  await fs.writeFile(path.join(vault.root, '.agents', 'raw-manifest.json'), JSON.stringify({
    version: 1,
    files: { 'dokument.md': { sha256: sha256(text), registeredAt: '2025-01-01T00:00:00.000Z' } },
  }, null, 2));
  const result = await lintVault(config);
  assert.deepEqual(find(result.findings, 'raw.modified'), [], 'nepromenjen izvor ne sme biti prijavljen');

  const upgrade = await updateRawManifest(config);
  assert.equal(upgrade.upgraded, 1);
  const manifest = JSON.parse(await vault.read('.agents/raw-manifest.json'));
  assert.equal(manifest.version, 2);
  assert.equal(manifest.files['dokument.md'].bytes, true);
  assert.deepEqual(find((await lintVault(config)).findings, 'raw.modified'), []);
  await vault.cleanup();
});

test('lint: v1 manifest ne sme tiho da "nadogradi" binarni izvor bez osnove', async () => {
  const vault = await makeVault();
  const config = await loadConfig(vault.root);
  const original = Buffer.concat([Buffer.from('%PDF-1.7\n', 'utf8'), Buffer.from([0x80]), Buffer.from('\n', 'utf8')]);
  await fs.writeFile(path.join(vault.root, 'raw', 'binary.pdf'), original);
  // v1 osnova: hash DEKODIRANOG teksta (dva različita bajta daju isti string).
  const legacyHash = sha256(original.toString('utf8'));
  await fs.writeFile(path.join(vault.root, '.agents', 'raw-manifest.json'), JSON.stringify({
    version: 1,
    files: { 'binary.pdf': { sha256: legacyHash, registeredAt: '2025-01-01T00:00:00.000Z' } },
  }, null, 2));

  const changed = Buffer.concat([Buffer.from('%PDF-1.7\n', 'utf8'), Buffer.from([0x81]), Buffer.from('\n', 'utf8')]);
  await fs.writeFile(path.join(vault.root, 'raw', 'binary.pdf'), changed);

  const result = await lintVault(config);
  assert.equal(result.ok, false, 'izmena se ne sme prećutati zbog neuporedive v1 osnove');
  assert.equal(find(result.findings, 'raw.legacy-unknown').length, 1);
  assert.deepEqual(find(result.findings, 'raw.modified'), [], 'ne tvrdimo izmenu koju ne možemo da dokažemo');

  // `index` ne sme da upiše izmenjene bajtove kao novu osnovu.
  const upgrade = await updateRawManifest(config);
  assert.equal(upgrade.upgraded, 0, 'binarni v1 zapis se ne nadograđuje automatski');
  const manifest = JSON.parse(await vault.read('.agents/raw-manifest.json'));
  assert.equal(manifest.files['binary.pdf'].sha256, legacyHash, 'osnova ostaje nepromenjena dok je čovek ne potvrdi');

  // Eksplicitna re-osnova (brisanje zapisa) uspostavlja novu, proverljivu osnovu.
  await fs.writeFile(path.join(vault.root, '.agents', 'raw-manifest.json'), JSON.stringify({ version: 2, files: {} }, null, 2));
  await updateRawManifest(config);
  assert.deepEqual(find((await lintVault(config)).findings, 'raw.legacy-unknown'), []);
  assert.deepEqual(find((await lintVault(config)).findings, 'raw.modified'), []);
  await fs.writeFile(path.join(vault.root, 'raw', 'binary.pdf'), Buffer.concat([Buffer.from('%PDF-1.7\n', 'utf8'), Buffer.from([0x82]), Buffer.from('\n', 'utf8')]));
  assert.equal(find((await lintVault(config)).findings, 'raw.modified').length, 1, 'posle re-osnove izmena je vidljiva');
  await vault.cleanup();
});

test('lint: skriveni fajl u raw/ je pod manifestom kao i svaki drugi', async () => {
  const vault = await makeVault();
  const config = await loadConfig(vault.root);
  await fs.writeFile(path.join(vault.root, 'raw', '.skriveni-izvor.bin'), Buffer.from([0x00, 0x80, 0xff]));

  const manifest = await updateRawManifest(config);
  assert.equal(manifest.total, 2, 'skriveni fajl mora biti registrovan');
  assert.deepEqual(find((await lintVault(config)).findings, 'raw.modified'), []);

  await fs.writeFile(path.join(vault.root, 'raw', '.skriveni-izvor.bin'), Buffer.from([0x00, 0x81, 0xff]));
  const result = await lintVault(config);
  const modified = find(result.findings, 'raw.modified');
  assert.equal(modified.length, 1, 'izmena skrivenog izvora mora biti prijavljena');
  assert.equal(modified[0].target, 'raw/.skriveni-izvor.bin');
  assert.equal(result.ok, false);
  await vault.cleanup();
});

test('lint: novo u raw/ je dozvoljeno (append-only)', async () => {
  const vault = await makeVault();
  const config = await loadConfig(vault.root);
  await updateRawManifest(config);
  await vault.write('raw/novi-izvor.md', 'novi sadrzaj');
  const result = await lintVault(config);
  assert.deepEqual(find(result.findings, 'raw.modified'), []);
  assert.deepEqual(find(result.findings, 'raw.deleted'), []);
  await vault.cleanup();
});

test('lint: uklonjen izvor je greška', async () => {
  const vault = await makeVault();
  const config = await loadConfig(vault.root);
  await updateRawManifest(config);
  await gitExec(vault.root, ['rm', '-q', 'raw/dokument.md']);
  const result = await lintVault(config);
  assert.equal(find(result.findings, 'raw.deleted').length, 1);
  await vault.cleanup();
});

test('lint: git izmena u raw/ je nezavisna greška', async () => {
  const vault = await makeVault();
  const config = await loadConfig(vault.root);
  await updateRawManifest(config);
  await vault.write('raw/dokument.md', 'promenjeno bez manifesta');
  const result = await lintVault(config);
  assert.ok(find(result.findings, 'raw.git-diff').length >= 1);
  await vault.cleanup();
});

test('lint: produkciona beleška bez zaglavlja je greška, nacrt je upozorenje', async () => {
  const vault = await makeVault();
  const config = await loadConfig(vault.root);
  await vault.write('wiki/Losa.md', '# Losa\n\nbez zaglavlja\n');
  await vault.write('wiki/drafts/Nacrt.md', '# Nacrt\n\nbez zaglavlja\n');
  const result = await lintVault(config);
  const frontmatterFindings = find(result.findings, 'note.frontmatter');
  assert.equal(frontmatterFindings.find((f) => f.target === 'wiki/Losa.md').level, 'error');
  assert.equal(frontmatterFindings.find((f) => f.target === 'wiki/drafts/Nacrt.md').level, 'warning');
  await vault.cleanup();
});

test('lint: prekinut Vikilink je greška u produkciji, upozorenje u nacrtu', async () => {
  const vault = await makeVault();
  const config = await loadConfig(vault.root);
  await writeNote(vault.root, 'wiki/A.md', {
    frontmatter: { title: 'A', created: NOW, updated: NOW, authors: ['r'], status: 'consolidated', tags: [] },
    body: '# A\n\n[[Ne postoji]]\n',
  });
  await writeNote(vault.root, 'wiki/drafts/B.md', {
    frontmatter: { title: 'B', created: NOW, updated: NOW, authors: ['r'], status: 'draft', tags: [] },
    body: '# B\n\n[[Takodje ne postoji]]\n',
  });
  const result = await lintVault(config);
  const broken = find(result.findings, 'note.broken-link');
  assert.equal(broken.find((f) => f.target === 'wiki/A.md').level, 'error');
  assert.equal(broken.find((f) => f.target === 'wiki/drafts/B.md').level, 'warning');
  await vault.cleanup();
});

test('lint: fragment bez tačnog heša izvora je greška', async () => {
  const vault = await makeVault();
  const config = await loadConfig(vault.root);
  const NOW2 = '2025-01-01T00:00:00.000Z';
  const telo = {
    frontmatter: {
      title: 'Fragment: probe', created: NOW2, updated: NOW2, authors: ['extractor'],
      status: 'draft', tags: ['fragment'], source_path: 'raw/dokument.md',
      source_sha256: 'a'.repeat(64), source_location: 'ceo dokument',
    },
    body: '# Fragment\n\ntekst\n',
  };
  await writeNote(vault.root, 'wiki/drafts/fragments/probe.md', telo);
  const pogresan = await lintVault(config);
  assert.equal(find(pogresan.findings, 'fragment.source-mismatch').length, 1);

  // Ispravan heš prolazi.
  await writeNote(vault.root, 'wiki/drafts/fragments/probe.md', {
    frontmatter: { ...telo.frontmatter, source_sha256: sha256Bytes(await fs.readFile(path.join(vault.root, 'raw', 'dokument.md'))) },
    body: telo.body,
  });
  assert.deepEqual(find((await lintVault(config)).findings, 'fragment.source-mismatch'), []);

  // Bez polja porekla je takođe greška.
  await writeNote(vault.root, 'wiki/drafts/fragments/probe.md', {
    frontmatter: { title: 'F', created: NOW2, updated: NOW2, authors: ['e'], status: 'draft', tags: [] },
    body: '# F\n',
  });
  assert.equal(find((await lintVault(config)).findings, 'fragment.schema').length, 1);
  await vault.cleanup();
});

test('lint: status draft u produkciji je greška', async () => {
  const vault = await makeVault();
  const config = await loadConfig(vault.root);
  await writeNote(vault.root, 'wiki/Prevaren.md', {
    frontmatter: { title: 'P', created: NOW, updated: NOW, authors: ['r'], status: 'draft', tags: [] },
    body: '# P\n',
  });
  const result = await lintVault(config);
  assert.equal(find(result.findings, 'note.draft-in-production').length, 1);
  await vault.cleanup();
});

test('lint: zadatak u pogrešnoj fazi i neispravna istorija prelaza se prijavljuju', async () => {
  const vault = await makeVault();
  const config = await loadConfig(vault.root);
  // Zadaci su u inbox/, a status je in_progress -> pogrešna faza + nema zakupa.
  await vault.write('tasks/inbox/TASK-001.md', [
    '---',
    'id: TASK-001',
    'title: Test',
    'status: in_progress',
    'created: 2025-01-01T00:00:00.000Z',
    'updated: 2025-01-01T00:00:00.000Z',
    'lock_owner: researcher',
    'locked_at: 2025-01-01T00:00:00.000Z',
    'lease_expires_at: 2035-01-01T00:00:00.000Z',
    'history:',
    '  - at: 2025-01-01T00:00:00.000Z',
    '    status: proposed',
    '    actor: operator',
    '  - at: 2025-01-01T00:00:00.000Z',
    '    status: consolidated',
    '    actor: agentctl',
    '---',
    '',
    '# Test',
    '',
  ].join('\n'));
  const result = await lintVault(config);
  const codes = result.findings.map((f) => f.code);
  assert.ok(codes.includes('task.wrong-phase'), codes.join(','));
  assert.ok(codes.includes('task.history'), codes.join(','));
  assert.equal(result.ok, false);
  await vault.cleanup();
});

test('lint: istekao zakup je upozorenje, ne greška', async () => {
  const vault = await makeVault();
  const config = await loadConfig(vault.root);
  await vault.write('tasks/active/TASK-002.md', [
    '---',
    'id: TASK-002',
    'title: Test',
    'status: in_progress',
    'created: 2020-01-01T00:00:00.000Z',
    'updated: 2020-01-01T00:00:00.000Z',
    'lock_owner: researcher',
    'locked_at: 2020-01-01T00:00:00.000Z',
    'lease_expires_at: 2020-01-01T00:10:00.000Z',
    'history:',
    '  - at: 2020-01-01T00:00:00.000Z',
    '    status: ready',
    '    actor: agentctl',
    '  - at: 2020-01-01T00:00:00.000Z',
    '    status: in_progress',
    '    actor: researcher',
    '---',
    '',
    '# Test',
    '',
  ].join('\n'));
  const result = await lintVault(config);
  const expired = find(result.findings, 'task.lease-expired');
  assert.equal(expired.length, 1);
  assert.equal(expired[0].level, 'warning');
  assert.equal(result.ok, true, formatFindings(result));
  await vault.cleanup();
});

test('lint: čist vault daje nula nalaza (osim upozorenja o manifestu)', async () => {
  const vault = await makeVault();
  const config = await loadConfig(vault.root);
  await updateRawManifest(config);
  await writeNote(vault.root, 'wiki/Index.md', {
    frontmatter: { title: 'Index', created: NOW, updated: NOW, authors: ['agentctl'], status: 'consolidated', tags: ['index'] },
    body: '# Index\n\n| Beleška |\n|---|\n',
  });
  const result = await lintVault(config);
  assert.equal(result.errors.length, 0, formatFindings(result));
  await vault.cleanup();
});
