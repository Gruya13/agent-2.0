/**
 * Sastavljanje prompta za pojedinu ulogu. Uloga nije "persona" nego ugovor:
 * brief iz `.agents/roles/<uloga>.md` plus činjenično stanje zadatka.
 */
import path from 'node:path';
import { promises as fs } from 'node:fs';

export const ROLE_ARTIFACT_ZONE = {
  extractor: 'wiki/drafts/fragments/',
  librarian: 'tasks/audits/ i opseg zadatka (wiki/)',
  'red-team': 'tasks/challenges/',
  researcher: 'wiki/drafts/',
  verifier: 'tasks/reviews/',
  consolidator: 'wiki/',
  // Coding tok: zone su u CILJNOM repou i zadate su opsegom zadatka.
  programer: '(code_scope zadatka u ciljnom repou)',
  reviewer: '.agent-review/ (sopstveni radni checkout)',
};

export async function loadRoleBrief(config, role) {
  const file = path.join(config.paths.contracts, 'roles', `${role}.md`);
  try {
    return await fs.readFile(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return `# Uloga: ${role}\n\n(nema brief-a)\n`;
    throw error;
  }
}

function taskContext(config, task, { role, extra = {} }) {
  const { data } = task;
  const lines = [
    '## Stanje zadatka (crna tabla)',
    '',
    `- id: ${data.id}`,
    `- naslov: ${data.title}`,
    `- status: ${data.status}`,
    `- izvor: ${data.source ?? '(nema)'}`,
    `- artefakti: ${(data.artifacts ?? []).length ? data.artifacts.join(', ') : '(nema)'}`,
    `- vlasnik zakupa: ${data.lock_owner ?? '(nema)'}`,
    `- tvoja zona upisa: ${ROLE_ARTIFACT_ZONE[role]}`,
    '',
    '## Radni kontekst',
    '',
    `- Radi u isključivo svom radnom stablu: ${extra.worktree ?? '(nepoznato)'}`,
    '- Ne izlazi iz svog radnog stabla i ne pozivaj `git merge`.',
  ];
  // Prethodno odbijanje MORA biti u promptu: bez toga istraživač ponavlja iste
  // premise posle obrazloženog fail-a (potvrđeno na K14: četiri nacrta sa istom
  // definicijom i istim pretpostavkama u pitanjima).
  if (data.verification?.verdict === 'fail') {
    const sazetak = String(data.verification.summary ?? '').trim();
    lines.push(
      '',
      '## Prethodno odbijanje — obavezno pre novog nacrta',
      '',
      `- verdikt: fail (harnes: ${data.verification.harness ?? '?'}, revizija: ${data.verification.commit ?? '(nema)'})`,
      '- Ove premise su odbijene. UKLONI ih ili ispravi prema izvoru; oznaka `nepotvrđeno` NIJE dovoljna:',
      '',
      ...(sazetak ? sazetak.split('\n').slice(0, 80).map((l) => `  ${l}`) : ['  (sažetak nije sačuvan — vidi tasks/reviews/)']),
    );
  }
  if (extra.instructions) lines.push('', extra.instructions);
  return lines.join('\n');
}

/** Kompletan prompt koji se predaje harnesu. */
export async function buildPrompt(config, { role, task, extra = {} }) {
  const brief = await loadRoleBrief(config, role);
  return [
    brief.trim(),
    '',
    '---',
    '',
    taskContext(config, task, { role, extra }),
    '',
  ].join('\n');
}
