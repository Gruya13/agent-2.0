/**
 * Dispečer uloga: bira adapter iz konfiguracije i normalizuje rezultat.
 * Kontrolni sloj nikad ne zna koji je harnes pozvan — samo da li je posao
 * proizveo očekivani artefakt.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { roleOf } from '../config.mjs';
import { runHarness } from './harness.mjs';
import { runMock } from './mock.mjs';

export { parseVerdict, runHarness, HARNESS_COMMANDS } from './harness.mjs';
export { buildPrompt, loadRoleBrief, ROLE_ARTIFACT_ZONE } from './prompts.mjs';

/** Izvršno okruženje koje harnesu predaje identitet i zonu upisa. */
export function agentEnv({ role, harness, cwd, task, config = null }) {
  return {
    AGENT_2_0_ROLE: role,
    AGENT_2_0_HARNESS: harness,
    AGENT_2_0_TASK: task?.data?.id ?? '',
    // MCP server beleški identitet: isti ugovor kao u .agents/AGENTS.md.
    OBSIDIAN_AGENT: harness,
    OBSIDIAN_ROLE: role,
    OBSIDIAN_VAULT: cwd,
    // Zakup i status se proveravaju u kontrolnom korenu (main), ne u worktree-u
    // koji nosi kopiju crne table od trenutka grananja.
    OBSIDIAN_TASK: task?.data?.id ?? '',
    OBSIDIAN_TASK_ROOT: config?.root ?? cwd,
    OBSIDIAN_LEASE_TOKEN: task?.leaseToken ?? '',
    WIKI_AGENT: harness,
    WIKI_ROOT: cwd,
  };
}

export const TASK_CONTEXT_FILE = '.runtime/task-context.json';

/**
 * Identitet koji se upisuje kao vlasnik zakupa i kao autor Git komita.
 *
 * Za prave harnese to je IME VENDORA (`agy`, `dsh`), pa revizorski trag
 * kaže koji je model stvarno doprineo — ne samo koja uloga. Isti identitet mora
 * da vidi i MCP server (`OBSIDIAN_AGENT`), inače bi legitimni upis bio odbijen.
 * Deterministički zamenik se predstavlja kao `mock-<uloga>`, da se nikad ne
 * pomeša sa pravim modelom.
 */
export function identityFor(config, role) {
  const spec = config?.agents?.[role];
  if (!spec) return role;
  return spec.adapter === 'mock' ? `mock-${role}` : (spec.harness ?? role);
}

/**
 * Upiši kontekst zadatka u radno stablo pre poziva harnesa.
 *
 * MCP server beleški čita ovaj fajl kada `OBSIDIAN_TASK` nije u okruženju (vidi
 * `tools/mcp/obsidian-mcp.mjs`). Bez njega harnes koji ne nasleđuje env ne bi
 * mogao da dokaže zakup, pa bi svaki upis bio odbijen.
 */
export async function materializeTaskContext({ cwd, role, harness, task, config }) {
  const file = path.join(cwd, TASK_CONTEXT_FILE);
  const context = {
    task: task?.data?.id ?? null,
    taskRoot: config?.root ?? cwd,
    role,
    agent: harness,
    // Token zakupa: MCP server zahteva da se poklapa sa `lock_token` u zadatku,
    // pa drugi proces istog harnesa ne može da piše pod tuđim zakupom.
    leaseToken: task?.leaseToken ?? null,
    leaseExpiresAt: task?.data?.lease_expires_at ?? null,
    status: task?.data?.status ?? null,
    writtenAt: new Date().toISOString(),
  };
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(context, null, 2)}\n`, 'utf8');
  return file;
}

export async function runAgent(config, { role, task, cwd, prompt, now, signal, logger = () => {} }) {
  const spec = roleOf(config, role);
  const started = Date.now();
  await materializeTaskContext({
    cwd, role, harness: spec.adapter === 'mock' ? 'mock' : spec.harness, task, config,
  });
  logger(`poziv uloge ${role} (${spec.adapter}${spec.adapter === 'harness' ? `:${spec.harness}` : ''}) u ${cwd}`);

  let result;
  if (spec.adapter === 'mock') {
    result = await runMock(config, { role, task, cwd, now });
  } else {
    result = await runHarness(spec.harness, {
      prompt,
      cwd,
      timeoutMs: spec.timeoutMs ?? config.pipeline.agentTimeoutMs,
      env: agentEnv({ role, harness: spec.harness, cwd, task, config }),
      config,
      signal,
    });
    if (result.harness === 'dsh' || result.harness === 'agy') {
      // Verdikt se čita iz izlaza samo za ulogu verifikatora; ostalo odlučuje
      // kontrolni sloj nad artefaktima.
      const { parseVerdict } = await import('./harness.mjs');
      result.verdict = parseVerdict(result.output).verdict;
    }
  }

  return {
    ...result,
    role,
    adapter: spec.adapter,
    harness: spec.adapter === 'mock' ? 'mock' : spec.harness,
    durationMs: Date.now() - started,
  };
}
