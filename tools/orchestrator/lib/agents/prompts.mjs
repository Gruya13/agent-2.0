/**
 * Sastavljanje prompta za pojedinu ulogu. Uloga nije "persona" nego ugovor:
 * brief iz `.agents/roles/<uloga>.md` plus činjenično stanje zadatka.
 */
import path from 'node:path';
import { promises as fs } from 'node:fs';

export const ROLE_ARTIFACT_ZONE = {
  'red-team': 'tasks/challenges/',
  researcher: 'wiki/drafts/',
  verifier: 'tasks/reviews/',
  consolidator: 'wiki/',
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
