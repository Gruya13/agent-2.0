/**
 * Deterministički mock adapter.
 *
 * Svrha mu je da kontrolni sloj, izolacija radnih stabala, zakupi i ceo
 * petofazni tok budu testabilni bez trošenja kvota i bez nereproduktivnih
 * izlaza modela. On **poštuje isti ugovor o zonama upisa** kao pravi harnesi:
 * researcher piše samo u `wiki/drafts/`, verifier samo u `tasks/reviews/`,
 * consolidator samo u `wiki/`. Zato testovi nad mock-om zaista proveravaju
 * arhitekturu, a ne mock.
 *
 * Nikad se ne koristi kao dokaz kvaliteta sadržaja — samo kao dokaz toka.
 */
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { loadConfig } from '../config.mjs';
import { exists, sha256File } from '../fsx.mjs';
import { lintVault } from '../lint.mjs';
import {
  extractWikilinks, listNotes, noteFrontmatterProblems, noteName, noteSlug,
  normalizeName, readNote, writeNote,
} from '../vault.mjs';
import { parseVerdict } from './harness.mjs';

const MAX_SENTENCES = 5;

function sentences(text, limit = MAX_SENTENCES) {
  return text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 40)
    .slice(0, limit);
}

function firstParagraph(text) {
  const body = text.replace(/^---[\s\S]*?---\n/, '');
  const paragraphs = body.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const chosen = paragraphs.find((p) => p.length > 80) ?? paragraphs[0] ?? '';
  return chosen.replace(/\s+/g, ' ').slice(0, 600);
}

async function researcher(config, { task, cwd, now }) {
  const source = task.data.source;
  if (!source) return { ok: false, output: 'zadatak nema polje "source"', artifacts: [] };
  const sourcePath = path.resolve(cwd, source);
  if (!(await exists(sourcePath))) {
    return { ok: false, output: `izvor ne postoji u radnom stablu: ${source}`, artifacts: [] };
  }
  const raw = await fs.readFile(sourcePath, 'utf8');
  const slug = noteSlug(task.data.title);
  const rel = `wiki/drafts/${slug}.md`;
  const existing = await listNotes(cwd, ['wiki']);
  const names = new Set(existing.map((p) => normalizeName(noteName(p))));
  const candidateLinks = ['Index'].filter((n) => names.has(normalizeName(n)));

  const body = [
    `# ${task.data.title}`,
    '',
    '## Sažetak',
    '',
    firstParagraph(raw) || '_Izvor nema izdvojiv sažetak._',
    '',
    '## Ključne tvrdnje',
    '',
    ...(sentences(raw).length
      ? sentences(raw).map((s, i) => `${i + 1}. ${s} _(izvor: ${source})_`)
      : ['_Nema izdvojivih tvrdnji._']),
    '',
    '## Veze',
    '',
    ...(candidateLinks.length ? candidateLinks.map((n) => `- [[${n}]]`) : ['- _Nema postojećih belešaka za povezivanje._']),
    '',
    '## Otvorena pitanja',
    '',
    '- Mock adapter ne tumači sadržaj; pitanja ostaju za pravi harnes.',
    '',
  ].join('\n');

  await writeNote(cwd, rel, {
    frontmatter: {
      title: task.data.title,
      created: now,
      updated: now,
      authors: ['researcher'],
      status: 'draft',
      tags: (task.data.tags ?? []).length ? task.data.tags : ['mock'],
    },
    body,
  });

  return {
    ok: true,
    output: `MOCK researcher: nacrt upisan u ${rel} (${Buffer.byteLength(body)} B, ${candidateLinks.length} veza).`,
    artifacts: [rel],
  };
}

async function verifier(config, { task, cwd, now }) {
  // Fragment je sirovina, ne nacrt: bira se prvi artefakt koji nije fragment.
  const svi = (task.data.artifacts ?? []).length
    ? task.data.artifacts
    : await listNotes(cwd, ['wiki/drafts']).catch(() => []);
  const nacrti = svi.filter((rel) => rel.startsWith('wiki/drafts/') && !rel.includes('/fragments/'));
  const draftRel = nacrti[0] ?? svi.find((rel) => rel.startsWith('wiki/drafts/'));
  if (!draftRel) return { ok: false, output: 'nema nacrta za verifikaciju', artifacts: [] };

  const findings = [];
  let note;
  try {
    note = await readNote(cwd, draftRel);
  } catch (error) {
    findings.push(`- [error] nacrt se ne može pročitati: ${error.message}`);
    note = null;
  }

  if (note) {
    for (const problem of noteFrontmatterProblems(note.frontmatter)) {
      findings.push(`- [error] frontmatter: ${problem}`);
    }
    const all = await listNotes(cwd, ['wiki']);
    const names = new Set(all.map((p) => normalizeName(noteName(p))));
    for (const link of extractWikilinks(note.text)) {
      if (!names.has(link.normalized)) {
        findings.push(`- [error] [[${link.target}]] ne postoji u wiki/`);
      }
    }
    if (note.text.trim().length < 200) {
      findings.push('- [error] nacrt je kraći od 200 znakova; nema dovoljno sadržaja za verifikaciju');
    }
  }

  const forced = process.env.AGENT_2_0_MOCK_VERDICT;
  const errors = findings.filter((f) => f.startsWith('- [error]'));
  const verdict = forced === 'fail' ? 'fail'
    : forced === 'pass' ? 'pass'
      : errors.length ? 'fail' : 'pass';

  const reviewRel = `tasks/reviews/${task.data.id}.md`;
  const body = [
    `# Revizija ${task.data.id}`,
    '',
    `- nacrt: ${draftRel}`,
    `- verdikt: ${verdict}`,
    `- broj nalaza: ${findings.length}`,
    '',
    '## Nalazi',
    '',
    ...(findings.length ? findings : ['- nema nalaza; nacrt je strukturno ispravan']),
    '',
    '## Dokazi',
    '',
    `- frontmatter proveren preko \`noteFrontmatterProblems\``,
    `- Vikilinkovi provereni preko indeksa imena u \`wiki/\``,
    `- dužina tela: ${note ? note.text.trim().length : 0} znakova`,
    '',
  ].join('\n');

  await writeNote(cwd, reviewRel, {
    frontmatter: {
      title: `Revizija ${task.data.id}`,
      created: now,
      updated: now,
      authors: ['verifier'],
      status: 'review',
      tags: ['revizija', task.data.id],
    },
    body,
  });

  const output = [
    `MOCK verifier: pregledao ${draftRel}, ${findings.length} nalaza.`,
    ...findings,
    `VERDICT: ${verdict}`,
    ...(verdict === 'fail' ? [`REASONS: ${errors.length || 1}`] : []),
  ].join('\n');

  return { ok: true, output, artifacts: [reviewRel], verdict };
}

async function consolidator(config, { task, cwd, now }) {
  const svi = (task.data.artifacts ?? []).filter((rel) => rel.startsWith('wiki/drafts/'));
  const nacrti = svi.filter((rel) => !rel.includes('/fragments/'));
  const draftRel = nacrti[0] ?? svi[0] ?? (await listNotes(cwd, ['wiki/drafts']))[0];
  if (!draftRel) return { ok: false, output: 'nema verifikovanog nacrta za konsolidaciju', artifacts: [] };

  const draft = await readNote(cwd, draftRel);
  const slug = noteName(draftRel);
  const productionRel = `wiki/${slug}.md`;

  const frontmatter = {
    ...(draft.frontmatter ?? {}),
    title: draft.frontmatter?.title ?? slug,
    created: draft.frontmatter?.created ?? now,
    updated: now,
    authors: [...new Set([...(draft.frontmatter?.authors ?? []), 'consolidator'])],
    status: 'consolidated',
  };

  const all = await listNotes(cwd, ['wiki']);
  const names = new Map(all.map((p) => [normalizeName(noteName(p)), p]));
  const removed = [];
  const body = draft.body.replace(/\[\[([^\]|#]+)(#[^\]|]+)?(\|[^\]]+)?\]\]/g, (raw, target, heading, alias) => {
    if (names.has(normalizeName(target))) return raw;
    removed.push(target);
    return target; // zadrži tekst, skini link
  });

  await writeNote(cwd, productionRel, { frontmatter, body });
  await fs.rm(path.resolve(cwd, draftRel), { force: true });

  // `wiki/Index.md` se NE piše ovde: to je izveden artefakt koji kontrolni sloj
  // regeneriše u `main` posle merge-a (faza 5). Da ga svaka grana nosi, svaki
  // bi paralelni merge pukao na njemu.
  const worktreeConfig = await loadConfig(cwd);
  const lint = await lintVault(worktreeConfig);

  const output = [
    `MOCK consolidator: ${draftRel} -> ${productionRel}`,
    `- uklonjenih neispravnih linkova: ${removed.length}${removed.length ? ` (${removed.join(', ')})` : ''}`,
    `- Indeks.md: regeneriše kontrolni sloj posle merge-a`,
    `- lint: ${lint.errors.length} grešaka, ${lint.warnings.length} upozorenja`,
    `VERDICT: ${lint.errors.length ? 'fail' : 'pass'}`,
  ].join('\n');

  return {
    ok: true,
    output,
    artifacts: [productionRel],
    lintErrors: lint.errors.length,
  };
}

/**
 * Extractor: verna transkripcija u fragmente. Mock ne ume da čita slike, pa to i
 * kaže — fragment nosi tačan `source_sha256` i eksplicitnu napomenu šta nije
 * preuzeto. Time testira plumbing (šema, heš, zona), ne kvalitet transkripcije.
 */
async function extractor(config, { task, cwd, now }) {
  const source = task.data.source;
  if (!source) return { ok: false, output: 'zadatak nema polje "source"', artifacts: [] };
  const sourcePath = path.resolve(cwd, source);
  if (!(await exists(sourcePath))) {
    return { ok: false, output: `izvor ne postoji u radnom stablu: ${source}`, artifacts: [] };
  }
  const sha = await sha256File(sourcePath);
  const base = path.basename(source, path.extname(source));
  const tekstualan = /\.(md|txt|markdown)$/i.test(source);
  const raw = tekstualan ? await fs.readFile(sourcePath, 'utf8') : null;

  const body = [
    `# Fragment: ${base}`,
    '',
    `- izvor: \`${source}\``,
    `- sha256: \`${sha}\``,
    `- obim: ${tekstualan ? `${raw.split('\n').length} redova` : 'binarni format'}`,
    '',
    '## Transkript',
    '',
    ...(tekstualan
      ? ['<!-- ceo dokument -->', '```text', raw.replace(/```/g, "'''").trimEnd(), '```']
      : ['_Mock adapter ne transkribuje binarne formate (bez OCR-a); sadržaj nije preuzet._',
         '_Za pravu transkripciju koristi se harnes `agy` (multimodalni)._']),
    '',
    '## Nečitko / nepreuzeto',
    '',
    tekstualan ? '- nema' : '- ceo dokument (binarni format)',
    '',
  ].join('\n');

  const rel = `wiki/drafts/fragments/${noteSlug(base)}.md`;
  await writeNote(cwd, rel, {
    frontmatter: {
      title: `Fragment: ${base}`,
      created: now,
      updated: now,
      authors: ['extractor'],
      status: 'draft',
      tags: ['fragment'],
      source_path: source,
      source_sha256: sha,
      source_location: tekstualan ? 'ceo dokument' : 'binarni format',
    },
    body,
  });
  return {
    ok: true,
    output: `MOCK extractor: ${rel} (sha256 ${sha.slice(0, 12)}…, ${tekstualan ? 'tekstualni' : 'binarni'} izvor)`,
    artifacts: [rel],
  };
}

export async function runMock(config, { role, task, cwd, now = new Date().toISOString() }) {
  const started = Date.now();
  const handlers = { extractor, researcher, verifier, consolidator };
  const handler = handlers[role];
  if (!handler) throw new Error(`mock adapter ne poznaje ulogu "${role}"`);

  // Testni režim: harnes izlazi uspešno, ali ne proizvodi artefakt. Služi da se
  // dokaže da kontrolni sloj ne veruje izlaznom kodu, nego artefaktu.
  if (process.env.AGENT_2_0_MOCK_NOOP === '1') {
    return {
      ok: true,
      exitCode: 0,
      output: `MOCK ${role}: NOOP (namerno bez artefakta)`,
      stderr: '',
      durationMs: Date.now() - started,
      command: `mock:${role}`,
      timedOut: false,
      harness: 'mock',
      role,
      artifacts: [],
      verdict: null,
      lintErrors: null,
    };
  }

  let result;
  try {
    result = await handler(config, { task, cwd, now });
  } catch (error) {
    result = { ok: false, output: `MOCK ${role} pao: ${error.message}`, artifacts: [] };
  }

  const output = String(result.output ?? '');
  return {
    ok: result.ok === true,
    exitCode: result.ok === true ? 0 : 1,
    output,
    stderr: '',
    durationMs: Date.now() - started,
    command: `mock:${role}`,
    timedOut: false,
    harness: 'mock',
    role,
    artifacts: result.artifacts ?? [],
    verdict: result.verdict ?? parseVerdict(output).verdict,
    lintErrors: result.lintErrors ?? null,
  };
}
