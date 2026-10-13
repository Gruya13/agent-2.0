/**
 * Linter sprovodi invarijante iz `.agents/AGENTS.md`. On je taj koji od
 * "pravila na papiru" pravi nešto što može da obori posao.
 *
 * Nivoi:
 *   error   — kršenje ugovora; kontrolni sloj odbija dalji rad
 *   warning — sumnjivo, ali ne blokira (npr. prekinut Vikilink u nacrtu)
 *   info    — kontekst
 */
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { promisify } from 'node:util';
import { exists, sha256, sha256Bytes, sha256File, walkFiles } from './fsx.mjs';
import { listTasks, TASK_STATUSES, canTransition, validateTaskData } from './task.mjs';
import { noteFrontmatterProblems, noteName, normalizeName, readNote, listNotes, extractWikilinks } from './vault.mjs';

const execFileAsync = promisify(execFile);

export const RAW_MANIFEST = '.agents/raw-manifest.json';

export function makeFinding(level, code, target, message) {
  return { level, code, target, message };
}

/**
 * SVI regularni fajlovi u `raw/`, uključujući skrivene i binarne.
 * Nikakvo filtriranje po imenu ili formatu: fajl koji nije pod manifestom je
 * fajl koji se može izmeniti bez prijave.
 */
export async function rawFiles(config) {
  // Za `raw/` se ne preskače nijedan direktorijum osim `.git`: ni `.worktrees`,
  // ni `.runtime`, ni `node_modules`. Fajl u preskočenom direktorijumu nikad ne
  // uđe u manifest, pa bi se mogao izmeniti bez prijave.
  return walkFiles(config.paths.sources, {
    skipDirs: ['.git'],
    filter: (rel) => !rel.split('/').includes('.git'),
  });
}

/** Hash izvora: bajtovi za sve formate (vidi `sha256File`). */
export async function hashRawFile(file) {
  return sha256File(file);
}

/**
 * Da li se bajtovi mogu dekodirati u UTF-8 i vratiti bez promene?
 * Za takve fajlove je `sha256` teksta isto što i `sha256` bajtova, pa je stara
 * (v1) osnova uporediva. Za binarne fajlove nije: različiti bajtovi se
 * dekodiraju u isti zamenski znak, pa se izmena ne može isključiti.
 */
export function isRoundTripUtf8(buffer) {
  return Buffer.from(buffer.toString('utf8'), 'utf8').equals(buffer);
}

/** Uporedi trenutno stanje `raw/` sa manifestom; svaka izmena je error. */
export async function lintRawImmutability(config) {
  const findings = [];
  const manifestFile = path.join(config.root, RAW_MANIFEST);
  const files = await rawFiles(config);

  if (!(await exists(manifestFile))) {
    findings.push(makeFinding('warning', 'raw.no-manifest', RAW_MANIFEST, 'manifest izvora ne postoji; pokreni `agentctl index` da se uspostavi'));
    return findings;
  }

  let manifest;
  try {
    manifest = JSON.parse(await fs.readFile(manifestFile, 'utf8'));
  } catch (error) {
    findings.push(makeFinding('error', 'raw.bad-manifest', RAW_MANIFEST, `manifest se ne može pročitati: ${error.message}`));
    return findings;
  }

  const recorded = manifest.files ?? {};
  for (const rel of files) {
    const full = path.join(config.paths.sources, rel);
    const buffer = await fs.readFile(full);
    const hash = sha256Bytes(buffer);
    const legacyHash = sha256(buffer.toString('utf8'));
    const known = recorded[rel];
    if (!known) continue; // novo u raw/ je dozvoljeno (append-only)
    if (known.sha256 === hash) continue;

    if (!known.bytes) {
      // v1 osnova je hash dekodiranog teksta. Za validan UTF-8 je to isto što i
      // hash bajtova, pa je uporedivo; za binarne fajlove osnova ne dokazuje
      // ništa — izmenu ne smemo ni prijaviti kao sigurnu ni prećutati.
      if (known.sha256 === legacyHash && isRoundTripUtf8(buffer)) continue;
      findings.push(makeFinding('error', 'raw.legacy-unknown', `raw/${rel}`,
        'manifest v1 ne može da dokaže nepromenljivost binarnog izvora; potrebna je eksplicitna re-osnova (ukloni zapis iz manifesta pa pokreni `agentctl index`)'));
      continue;
    }
    findings.push(makeFinding('error', 'raw.modified', `raw/${rel}`, `izvorni fajl je izmenjen (očekivan ${String(known.sha256).slice(0, 12)}, stvarni ${hash.slice(0, 12)})`));
  }
  for (const rel of Object.keys(recorded)) {
    if (!files.includes(rel)) {
      findings.push(makeFinding('error', 'raw.deleted', `raw/${rel}`, 'izvorni fajl je uklonjen ili preimenovan; raw/ je append-only'));
    }
  }

  // Nezavisna provera kroz Git, kada je repozitorijum dostupan.
  try {
    const { stdout } = await execFileAsync('git', ['-C', config.root, 'diff', '--name-status', 'HEAD', '--', 'raw'], { maxBuffer: 4 * 1024 * 1024 });
    for (const line of stdout.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const [status, ...rest] = trimmed.split(/\s+/);
      if (status === 'A') continue;
      findings.push(makeFinding('error', 'raw.git-diff', `raw/${rest.join(' ')}`, `git prijavljuje izmenu izvora (${status}); raw/ je nepromenljiv`));
    }
  } catch {
    // Van Git repozitorijuma manifest je jedini izvor istine.
  }

  return findings;
}

/** Validacija svih belešaka: frontmatter i Vikilinkovi. */
export async function lintNotes(config) {
  const findings = [];
  const dirs = [config.vault.production];
  const notes = await listNotes(config.root, dirs);
  const names = new Map();
  for (const rel of notes) {
    names.set(normalizeName(noteName(rel)), rel);
  }

  for (const rel of notes) {
    const note = await readNote(config.root, rel);
    const isDraft = rel.includes('/drafts/');
    const isIndex = rel === 'wiki/Index.md';
    const problems = noteFrontmatterProblems(note.frontmatter);
    for (const problem of problems) {
      if (isIndex) {
        findings.push(makeFinding('error', 'note.frontmatter', rel, problem));
      } else {
        findings.push(makeFinding(isDraft ? 'warning' : 'error', 'note.frontmatter', rel, problem));
      }
    }
    // Fragmenti (multimodalni unos) moraju da dokažu poreklo: tačan put i heš
    // bajtova izvora. Bez toga transkript može da tvrdi bilo šta.
    if (rel.includes('/fragments/')) {
      const izvor = note.frontmatter?.source_path;
      const zapisani = note.frontmatter?.source_sha256;
      if (!izvor || !zapisani) {
        findings.push(makeFinding('error', 'fragment.schema', rel, 'fragment mora imati "source_path" i "source_sha256"'));
      } else {
        const putanja = path.join(config.root, izvor);
        if (!(await exists(putanja))) {
          findings.push(makeFinding('error', 'fragment.source-missing', rel, `izvor iz fragmenta ne postoji: ${izvor}`));
        } else {
          const stvarni = await sha256File(putanja);
          if (stvarni !== zapisani) {
            findings.push(makeFinding('error', 'fragment.source-mismatch', rel,
              `source_sha256 (${String(zapisani).slice(0, 12)}…) ne odgovara izvoru ${izvor} (${stvarni.slice(0, 12)}…)`));
          }
        }
      }
    }
    for (const link of extractWikilinks(note.text)) {
      const resolved = names.get(link.normalized);
      if (!resolved) {
        findings.push(makeFinding(
          isDraft ? 'warning' : 'error',
          'note.broken-link',
          rel,
          `Vikilink [[${link.target}]] ne pokazuje ni na jednu belešku`,
        ));
      }
    }
    if (!isDraft && !isIndex && note.frontmatter?.status === 'draft') {
      findings.push(makeFinding('error', 'note.draft-in-production', rel, 'nacrt (status: draft) se nalazi u produkcionom wiki/'));
    }
  }
  return findings;
}

/** Validacija zadataka: šema polja i konzistentnost istorije prelaza. */
export async function lintTasks(config) {
  const findings = [];
  const tasks = await listTasks(config);
  for (const task of tasks) {
    const id = String(task.data.id ?? path.basename(task.file));
    for (const problem of validateTaskData(task.data)) {
      findings.push(makeFinding('error', 'task.schema', `${id}`, problem));
    }
    const history = Array.isArray(task.data.history) ? task.data.history : [];
    let previous = null;
    for (const entry of history) {
      if (entry.status && !TASK_STATUSES.includes(entry.status)) {
        findings.push(makeFinding('error', 'task.history', id, `nepoznat status "${entry.status}" u istoriji`));
      }
      if (previous && entry.status && !canTransition(previous, entry.status)) {
        findings.push(makeFinding('error', 'task.history', id, `istorija sadrži nedozvoljen prelaz ${previous} -> ${entry.status}`));
      }
      previous = entry.status ?? previous;
    }
    if (task.data.status === 'review' && !(task.data.artifacts ?? []).length) {
      findings.push(makeFinding('error', 'task.no-artifact', id, 'zadatak je u review bez ijednog artefakta'));
    }
    if (task.data.status === 'verified' && task.data.verification?.verdict !== 'pass') {
      findings.push(makeFinding('error', 'task.no-verdict', id, 'status verified bez verdikta "pass"'));
    }
    if (task.phase === 'active' && !task.data.lock_owner) {
      findings.push(makeFinding('error', 'task.no-lease', id, 'zadatak je u tasks/active/ bez zakupa'));
    }
    if (task.data.status === 'in_progress') {
      const expires = Date.parse(task.data.lease_expires_at ?? '');
      if (Number.isFinite(expires) && expires <= Date.now()) {
        findings.push(makeFinding('warning', 'task.lease-expired', id, `zakup je istekao u ${task.data.lease_expires_at}`));
      }
    }
    const expectedPhase = { proposed: 'inbox', ready: 'inbox', blocked: 'inbox', in_progress: 'active', review: 'review', verified: 'review', consolidated: 'completed' }[task.data.status];
    if (expectedPhase && expectedPhase !== task.phase) {
      findings.push(makeFinding('error', 'task.wrong-phase', id, `status "${task.data.status}" pripada fazi "${expectedPhase}", a zadatak je u "${task.phase}"`));
    }
  }
  return findings;
}

/**
 * Uspostavi/obnovi manifest izvora. Postojeći zapisi se nikad ne prepisuju
 * drugačijim hash-om: ako se sadržaj promenio, to je prekršaj, a ne "ažuriranje
 * manifesta". Zato se novi hash upisuje samo za fajlove koji još nisu poznati.
 */
export async function updateRawManifest(config) {
  const manifestFile = path.join(config.root, RAW_MANIFEST);
  let manifest = { version: 2, files: {} };
  if (await exists(manifestFile)) {
    try {
      manifest = JSON.parse(await fs.readFile(manifestFile, 'utf8'));
      manifest.files ??= {};
    } catch {
      manifest = { version: 2, files: {} };
    }
  }
  const files = await rawFiles(config);
  let added = 0;
  let upgraded = 0;
  for (const rel of files) {
    const full = path.join(config.paths.sources, rel);
    const buffer = await fs.readFile(full);
    const byteHash = sha256Bytes(buffer);
    const existing = manifest.files[rel];
    if (!existing) {
      manifest.files[rel] = {
        sha256: byteHash,
        bytes: true,
        size: buffer.byteLength,
        registeredAt: new Date().toISOString(),
      };
      added += 1;
      continue;
    }
    // v1 zapis (hash teksta) se nadograđuje na hash bajtova SAMO kada je osnova
    // uporediva: validan UTF-8 i hash koji se poklapa. Za binarne fajlove se
    // zapis NE dira — nadogradnja bi izmenu pretvorila u novu osnovu.
    if (!existing.bytes) {
      const comparable = isRoundTripUtf8(buffer)
        && (existing.sha256 === byteHash || existing.sha256 === sha256(buffer.toString('utf8')));
      if (comparable) {
        manifest.files[rel] = { ...existing, sha256: byteHash, bytes: true, size: buffer.byteLength, upgradedFrom: 'v1' };
        upgraded += 1;
      }
    }
  }
  manifest.version = 2;
  manifest.updated = new Date().toISOString();
  await fs.mkdir(path.dirname(manifestFile), { recursive: true });
  await fs.writeFile(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return { manifestFile, added, upgraded, total: Object.keys(manifest.files).length };
}

export async function lintVault(config) {
  const findings = [
    ...await lintRawImmutability(config),
    ...await lintNotes(config),
    ...await lintTasks(config),
  ];
  const errors = findings.filter((f) => f.level === 'error');
  const warnings = findings.filter((f) => f.level === 'warning');
  const infos = findings.filter((f) => f.level === 'info');
  return { findings, errors, warnings, infos, ok: errors.length === 0 };
}

export function formatFindings(result) {
  const lines = [];
  for (const level of ['error', 'warning', 'info']) {
    const group = result.findings.filter((f) => f.level === level);
    for (const finding of group) {
      lines.push(`${level.toUpperCase().padEnd(7)} ${finding.code.padEnd(24)} ${finding.target}  ${finding.message}`);
    }
  }
  if (!lines.length) lines.push('OK — nema nalaza; invarijante ugovora su zadovoljene.');
  return lines.join('\n');
}
