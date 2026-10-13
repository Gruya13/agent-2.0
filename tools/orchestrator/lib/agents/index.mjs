/**
 * Dispečer uloga: bira adapter iz konfiguracije i normalizuje rezultat.
 * Kontrolni sloj nikad ne zna koji je harnes pozvan — samo da li je posao
 * proizveo očekivani artefakt.
 */
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
    WIKI_AGENT: harness,
    WIKI_ROOT: cwd,
  };
}

export async function runAgent(config, { role, task, cwd, prompt, now, logger = () => {} }) {
  const spec = roleOf(config, role);
  const started = Date.now();
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
    });
    if (result.harness === 'dsh' || result.harness === 'codex' || result.harness === 'agy') {
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
