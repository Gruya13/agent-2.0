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
import { exists, sha256File, writeFileAtomic } from '../fsx.mjs';
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
  // Testni režim: upis van zone znanja (u `raw/`), da se dokaže da ga kontrolni
  // sloj zaustavlja na merge-u — agent to može fajl-sistemom, mimo MCP-a.
  if (process.env.AGENT_2_0_MOCK_INJECT_RAW === '1') {
    await writeFileAtomic(path.join(cwd, 'raw', 'INJECTED.md'), '# injektirano\n');
  }
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
  // Revizija baze se proverava drugačije: nema nacrta, ali postoje izveštaj i
  // izmenjene produkcione beleške.
  if ((task.data.kind ?? 'ingest') === 'audit') {
    const izvestaj = `tasks/audits/${task.data.id}.md`;
    const problemi = [];
    if (!(await exists(path.resolve(cwd, izvestaj)))) {
      problemi.push('- [error] nema izveštaja revizije');
    } else {
      const n = await readNote(cwd, izvestaj);
      for (const p of noteFrontmatterProblems(n.frontmatter)) problemi.push(`- [error] izveštaj: ${p}`);
      if (!/## Nalazi/.test(n.body)) problemi.push('- [error] izveštaj nema odeljak "Nalazi"');
    }
    for (const rel of (task.data.artifacts ?? []).filter((r) => r.startsWith('wiki/'))) {
      try {
        const n = await readNote(cwd, rel);
        for (const p of noteFrontmatterProblems(n.frontmatter)) problemi.push(`- [error] ${rel}: ${p}`);
      } catch {
        problemi.push(`- [error] ${rel} se ne može pročitati`);
      }
    }
    const forced = process.env.AGENT_2_0_MOCK_VERDICT;
    const verdikt = forced === 'fail' ? 'fail' : forced === 'pass' ? 'pass' : (problemi.length ? 'fail' : 'pass');
    const reviewRel = `tasks/reviews/${task.data.id}.md`;
    await writeNote(cwd, reviewRel, {
      frontmatter: {
        title: `Revizija revizije ${task.data.id}`, created: now, updated: now,
        authors: ['verifier'], status: 'review', tags: ['revizija', task.data.id],
      },
      body: [
        `# Revizija revizije ${task.data.id}`, '',
        `- opseg: ${(task.data.audit_scope ?? []).join(', ')}`,
        `- verdikt: ${verdikt}`,
        `- nalaza: ${problemi.length}`, '',
        '## Nalazi', '',
        ...(problemi.length ? problemi : ['- nema nalaza; revizija je u opsegu i izveštaj je potpun']), '',
        '## Dokazi', '',
        `- izveštaj postoji: ${await exists(path.resolve(cwd, izvestaj))}`,
        `- izmenjenih belešaka: ${(task.data.artifacts ?? []).filter((r) => r.startsWith('wiki/')).length}`, '',
      ].join('\n'),
    });
    return {
      ok: true,
      output: [`MOCK verifier (revizija baze): ${problemi.length} nalaza.`, ...problemi,
        `VERDICT: ${verdikt}`, ...(verdikt === 'fail' ? [`REASONS: ${problemi.length || 1}`] : [])].join('\n'),
      artifacts: [reviewRel],
      verdict: verdikt,
    };
  }

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

  // Testni režim: konsolidator menja i TUĐU postojeću belešku (kao što je stvarni
  // codex uradio na TASK-103). Služi da se kapija i evidencija artefakata
  // provere nad stvarnim kontraprimerom, a ne nad izmišljenim stanjem.
  const dodir = process.env.AGENT_2_0_MOCK_CONSOLIDATE_TOUCH;
  if (dodir) {
    const tekst = await fs.readFile(path.resolve(cwd, dodir), 'utf8');
    await fs.writeFile(
      path.resolve(cwd, dodir),
      tekst.replace(/^updated: .*$/m, `updated: ${now}`),
      'utf8',
    );
  }

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

/**
 * Librarian: pregled opsega i strukturne popravke. Mock radi deterministički
 * ono što je merljivo: skida pokvarene Vikilinkove iz produkcionih belešaka i
 * normalizuje oznake na mala slova, pa o svemu tome napiše izveštaj.
 */
async function librarian(config, { task, cwd, now }) {
  const opseg = task.data.audit_scope ?? [];
  const sve = await listNotes(cwd, ['wiki']);
  const mete = sve.filter((rel) => !rel.includes('/drafts/') && rel !== 'wiki/Index.md'
    && opseg.some((scope) => new RegExp(`^${scope.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\*\\\*/g, '.*').replace(/\\\*/g, '[^/]*')}$`).test(rel)));
  if (!mete.length) return { ok: false, output: `nijedna beleška ne ulazi u opseg (${opseg.join(', ')})`, artifacts: [] };

  const imena = new Set(sve.map((p) => normalizeName(noteName(p))));
  const nalazi = [];
  const izmene = [];
  let linkova = 0;
  let oznaka = 0;

  for (const rel of mete) {
    const note = await readNote(cwd, rel);
    let telo = note.text;
    const pokvareni = extractWikilinks(note.text).filter((l) => !imena.has(l.normalized));
    if (pokvareni.length) {
      for (const link of pokvareni) telo = telo.split(link.raw).join(link.target);
      linkova += pokvareni.length;
      nalazi.push(`- ${rel}: ${pokvareni.length} pokvarenih Vikilinkova (${pokvareni.map((l) => l.raw).join(', ')})`);
    }
    const norm = (note.frontmatter?.tags ?? []).map((x) => String(x).toLowerCase());
    const promenaOznaka = norm.join(',') !== (note.frontmatter?.tags ?? []).join(',');
    if (promenaOznaka) {
      oznaka += 1;
      nalazi.push(`- ${rel}: oznake normalizovane (${(note.frontmatter?.tags ?? []).join(', ')} -> ${norm.join(', ')})`);
    }
    if (pokvareni.length || promenaOznaka) {
      await writeNote(cwd, rel, {
        frontmatter: { ...note.frontmatter, updated: now, tags: norm },
        body: telo,
      });
      izmene.push(rel);
    }
  }

  // Testni režim: namerna izmena van opsega, da se dokaže da kontrolni sloj to
  // zaustavlja pre nego što uđe u granu (agent to može i fajl-sistemom).
  if (process.env.AGENT_2_0_MOCK_OUT_OF_SCOPE === '1') {
    await writeNote(cwd, 'wiki/Van_opsega.md', {
      frontmatter: {
        title: 'Van opsega', created: now, updated: now, authors: ['librarian'],
        status: 'consolidated', tags: [],
      },
      body: '# Van opsega\n\nne sme da uđe u granu\n',
    });
  }

  const izvestaj = `tasks/audits/${task.data.id}.md`;
  await writeNote(cwd, izvestaj, {
    frontmatter: {
      title: `Revizija baze ${task.data.id}`,
      created: now,
      updated: now,
      authors: ['librarian'],
      status: 'review',
      tags: ['revizija', 'baza'],
    },
    body: [
      `# Revizija baze ${task.data.id}`,
      '',
      `- opseg: ${opseg.join(', ')}`,
      `- pregledano belešaka: ${mete.length}`,
      `- izmenjeno belešaka: ${izmene.length}`,
      `- uklonjenih pokvarenih linkova: ${linkova}`,
      `- normalizovanih oznaka: ${oznaka}`,
      '',
      '## Nalazi',
      '',
      ...(nalazi.length ? nalazi : ['- nema strukturnih nalaza u opsegu']),
      '',
      '## Izmene',
      '',
      ...(izmene.length ? izmene.map((r) => `- ${r}`) : ['- nema izmena']),
      '',
      '## Ostaje čoveku',
      '',
      '- sadržajne kontradikcije i duplikati se prijavljuju, ne prepisuju',
      '',
    ].join('\n'),
  });

  return {
    ok: true,
    output: `MOCK librarian: ${mete.length} pregledanih, ${izmene.length} izmenjenih, ${linkova} linkova, ${oznaka} oznaka`,
    artifacts: [...izmene, izvestaj, ...(process.env.AGENT_2_0_MOCK_OUT_OF_SCOPE === '1' ? ['wiki/Van_opsega.md'] : [])],
  };
}

/**
 * Red-team: pokušaj da obori tvrdnje zadatka. Mock radi deterministički ono što
 * se može izmeriti — proverava da artefakti postoje, da im je zaglavlje ispravno
 * i da fragmenti imaju tačan heš izvora — i po potrebi ispisuje namerni nalaz
 * (testni režim `AGENT_2_0_MOCK_CHALLENGE`).
 */
async function redTeam(config, { task, cwd, now }) {
  const id = task.data.id;
  const dir = `tasks/challenges/${id}`;
  const problemi = [];
  for (const rel of task.data.artifacts ?? []) {
    try {
      const n = await readNote(cwd, rel);
      for (const p of noteFrontmatterProblems(n.frontmatter)) problemi.push(`- ${rel}: ${p}`);
    } catch {
      problemi.push(`- ${rel}: ne može da se pročita u zamrznutoj reviziji`);
    }
  }

  // Testni režim: red-team piše van svoje zone (ne sme da prođe).
  if (process.env.AGENT_2_0_MOCK_CHALLENGE_OUTSIDE === '1') {
    await writeNote(cwd, 'wiki/Podmetnuto.md', {
      frontmatter: { title: 'Podmetnuto', created: now, updated: now, authors: ['red-team'], status: 'consolidated', tags: [] },
      body: '# Podmetnuto\n',
    });
  }

  const rezim = process.env.AGENT_2_0_MOCK_CHALLENGE;
  const skripti = [];
  // Testni režim: četiri skripta, gde je reproduktivni TAČNO iza granice limita.
  if (rezim === 'four') {
    for (const n of [1, 2, 3]) {
      await writeFileAtomic(path.join(cwd, `${dir}/NALAZ-${n}.sh`), `#!/usr/bin/env bash\necho "nije oboreno"\nexit 1\n`);
      skripti.push(`${dir}/NALAZ-${n}.sh`);
    }
    await writeFileAtomic(path.join(cwd, `${dir}/NALAZ-4.sh`), '#!/usr/bin/env bash\necho "OBORENO: nalaz iza granice limita"\nexit 0\n');
    skripti.push(`${dir}/NALAZ-4.sh`);
    problemi.push(`- OBORENO: nalaz iza granice limita (${dir}/NALAZ-4.sh)`);
  }
  if (rezim === 'fail' || rezim === 'false-positive') {
    const reprodukuje = rezim === 'fail';
    const rel = `${dir}/NALAZ-1.sh`;
    await writeFileAtomic(path.join(cwd, rel), [
      '#!/usr/bin/env bash',
      '# Reprodukcioni skript red-teama (mock): 0 = tvrdnja oborena, 1 = nije.',
      reprodukuje ? 'echo "OBORENO: mock nalaz se reprodukuje"' : 'echo "nije oboreno (mock lazni nalaz)"',
      `exit ${reprodukuje ? 0 : 1}`,
      '',
    ].join('\n'));
    skripti.push(rel);
    problemi.push(`- ${reprodukuje ? 'OBORENO' : 'sumnja'}: mock nalaz (${rel})`);
  }

  const izvestaj = `tasks/challenges/${id}.md`;
  await writeNote(cwd, izvestaj, {
    frontmatter: {
      title: `Red-team nalaz ${id}`,
      created: now, updated: now,
      authors: ['red-team'], status: 'review', tags: ['red-team', id],
    },
    body: [
      `# Red-team nalaz ${id}`, '',
      `- artefakti pod napadom: ${(task.data.artifacts ?? []).join(', ') || '(nema)'}`,
      `- skripti: ${skripti.length}`,
      '',
      '## Nalazi', '',
      ...(problemi.length ? problemi : ['- nijedna tvrdnja nije oborena u ovom prolazu']),
      '',
      '## Sumnje', '',
      '- mock ne izmišlja nove vektore; sumnje ostaju za pravi harnes', '',
    ].join('\n'),
  });

  const pao = process.env.AGENT_2_0_MOCK_CHALLENGE_CRASH === '1';
  return {
    ok: !pao,
    exitCode: pao ? 1 : 0,
    output: [
      `MOCK red-team: ${problemi.length} nalaza, ${skripti.length} skripti.${pao ? ' (harnes se srušio posle pisanja)' : ''}`,
      ...problemi,
      `NALAZI: ${rezim === 'fail' ? 1 : 0}`,
      `LAZNI: ${rezim === 'false-positive' ? 1 : 0}`,
    ].join('\n'),
    artifacts: [...skripti, izvestaj],
  };
}

/**
 * Implementacioni agent (coding tok).
 *
 * Mock ne ume da napiše popravku, pa izvršava komandu iz okruženja: tako test
 * deterministički simulira i uspešnu popravku, i izmenu van opsega, i nikakvu
 * izmenu. `ok` zavisi od izlaznog koda, isto kao kod pravog harnesa.
 */
async function programer(config, { cwd }) {
  const cmd = process.env.AGENT_2_0_MOCK_CODE_CMD;
  if (!cmd) return { ok: true, output: 'MOCK programer: nema AGENT_2_0_MOCK_CODE_CMD (bez izmene)', artifacts: [] };
  const { exec } = await import('node:child_process');
  const { promisify } = await import('node:util');
  try {
    const { stdout, stderr } = await promisify(exec)(cmd, { cwd, maxBuffer: 8 * 1024 * 1024 });
    return { ok: true, output: `MOCK programer: ${cmd}\n${stdout}\n${stderr}`.trim(), artifacts: [] };
  } catch (error) {
    return {
      ok: false,
      output: `MOCK programer pao: ${error.message}\n${error.stdout ?? ''}\n${error.stderr ?? ''}`,
      artifacts: [],
    };
  }
}

/**
 * Nezavisni pregled (coding tok): nalaz se piše u sopstveni checkout
 * (`.agent-review/<id>.md`), pa ga kontrolni sloj preuzima u evidenciju.
 */
async function reviewer(config, { task, cwd, now }) {
  const rel = `.agent-review/${task.data.id}.md`;
  await writeFileAtomic(path.join(cwd, rel), [
    `# Nezavisan pregled ${task.data.id}`,
    '',
    `- vreme: ${now}`,
    '- metod: mock (deterministički nalaz za test toka)',
    '- kontrolni slučaj: mock ne pravi sopstveni scenario',
    '',
    'VERDICT: pass',
    '',
  ].join('\n'));
  return { ok: true, output: `MOCK reviewer: nalaz upisan u ${rel}`, artifacts: [rel], verdict: 'pass' };
}

export async function runMock(config, { role, task, cwd, now = new Date().toISOString() }) {
  const started = Date.now();
  const handlers = { extractor, researcher, verifier, 'red-team': redTeam, librarian, consolidator, programer, reviewer };
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
