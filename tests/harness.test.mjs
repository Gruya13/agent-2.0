import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { HARNESS_COMMANDS, runHarness, parseVerdict, HarnessError } from '../tools/orchestrator/lib/agents/harness.mjs';
import { agentEnv, materializeTaskContext, TASK_CONTEXT_FILE } from '../tools/orchestrator/lib/agents/index.mjs';

const PROMPT = 'Uradi nešto: sa dvotočkom i "navodnicima"';
const CWD = '/tmp/probni-cwd';

/** Napravi izvršnu "lažnu" harnes komandu za test procesnog sloja. */
async function fakeBin(script) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent2-bin-'));
  const file = path.join(dir, 'fake-harness');
  await fs.writeFile(file, `#!/usr/bin/env bash\n${script}\n`, 'utf8');
  await fs.chmod(file, 0o755);
  return { file, dir };
}

test('komandna linija harnesa: tačan oblik argumenata', () => {
  assert.deepEqual(HARNESS_COMMANDS.dsh.build('radi', CWD), ['--profile', 'headless', 'radi']);
  assert.deepEqual(HARNESS_COMMANDS.codex.build('radi', CWD), ['exec', '--sandbox', 'workspace-write', '-C', CWD, 'radi']);
  // `agy` prima prompt vezan uz flag; odvojen argument bi pojeo sledeći flag.
  assert.deepEqual(
    HARNESS_COMMANDS.agy.build('radi', CWD),
    ['--dangerously-skip-permissions', '--add-dir', CWD, '--print=radi'],
  );
  const agyArgs = HARNESS_COMMANDS.agy.build('radi', CWD);
  assert.ok(agyArgs.some((a) => a.startsWith('--print=')), 'agy prompt mora biti vezan uz --print');
  assert.equal(agyArgs.includes('radi'), false, 'agy prompt ne sme biti zaseban argument');
  assert.equal(HARNESS_COMMANDS.agy.serialized, true, 'agy se nikad ne poziva u paraleli');
});

test('runHarness: uspeh, izlazni kod, vremensko ograničenje i nedostatak binarne datoteke', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'agent2-run-'));

  const ok = await fakeBin('echo "izlaz: $*"');
  const success = await runHarness('dsh', { prompt: PROMPT, cwd, timeoutMs: 10_000, env: { AGENT_2_0_BIN: ok.file } });
  assert.equal(success.ok, true);
  assert.equal(success.exitCode, 0);
  assert.match(success.output, /--profile headless/);
  assert.match(success.output, /navodnicima/);
  assert.ok(success.durationMs >= 0);

  const failing = await fakeBin('echo "greska" >&2; exit 3');
  const failure = await runHarness('codex', { prompt: PROMPT, cwd, timeoutMs: 10_000, env: { AGENT_2_0_BIN: failing.file } });
  assert.equal(failure.ok, false);
  assert.equal(failure.exitCode, 3);
  assert.match(failure.stderr, /greska/);

  const slow = await fakeBin('sleep 5');
  const timedOut = await runHarness('codex', { prompt: PROMPT, cwd, timeoutMs: 400, env: { AGENT_2_0_BIN: slow.file } });
  assert.equal(timedOut.ok, false);
  assert.equal(timedOut.timedOut, true);
  assert.ok(timedOut.durationMs < 4000, `proces je moralo biti prekinut (${timedOut.durationMs} ms)`);

  await assert.rejects(
    () => runHarness('dsh', { prompt: PROMPT, cwd, timeoutMs: 5_000, env: { AGENT_2_0_BIN: '/nema/ovakve/komande' } }),
    HarnessError,
  );

  await assert.rejects(() => runHarness('nepoznat', { prompt: PROMPT, cwd }), /nepoznat harness/);
  await fs.rm(cwd, { recursive: true, force: true });
});

test('runHarness: ok zavisi isključivo od izlaznog koda, ne od teksta', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'agent2-run2-'));
  const lying = await fakeBin('echo "VERDICT: pass"; exit 1');
  const result = await runHarness('codex', { prompt: PROMPT, cwd, timeoutMs: 10_000, env: { AGENT_2_0_BIN: lying.file } });
  assert.equal(result.ok, false, 'izlazni kod je jedini izvor istine o uspehu');
  assert.match(result.output, /VERDICT: pass/);
  await fs.rm(cwd, { recursive: true, force: true });
});

test('parseVerdict: prepoznaje poslednji verdikt i broj razloga', () => {
  assert.deepEqual(parseVerdict('analiza\nVERDICT: pass'), { verdict: 'pass', reasons: null });
  assert.deepEqual(parseVerdict('VERDICT: fail\nREASONS: 3'), { verdict: 'fail', reasons: 3 });
  assert.equal(parseVerdict('VERDICT: pass\n...\nVERDICT: fail').verdict, 'fail');
  assert.equal(parseVerdict('nema verdikta').verdict, null);
  assert.equal(parseVerdict('  verdict: pass').verdict, null, 'verdikt mora biti na početku linije');
});

test('agentEnv: harnes dobija identitet i svoju zonu, ne tuđu', () => {
  const task = { data: { id: 'TASK-101' } };
  const env = agentEnv({ role: 'verifier', harness: 'dsh', cwd: '/radno/stablo', task });
  assert.equal(env.OBSIDIAN_ROLE, 'verifier');
  assert.equal(env.OBSIDIAN_AGENT, 'dsh');
  assert.equal(env.OBSIDIAN_VAULT, '/radno/stablo', 'MCP server mora gledati u radno stablo, ne u cwd hosta');
  assert.equal(env.WIKI_ROOT, '/radno/stablo');
  assert.equal(env.AGENT_2_0_TASK, 'TASK-101');
  assert.equal(env.AGENT_2_0_HARNESS, 'dsh');
});

test('materializeTaskContext: harnes dobija zadatak i kontrolni koren u radnom stablu', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'agent2-ctx-'));
  const task = { data: { id: 'TASK-101', status: 'in_progress', lease_expires_at: '2035-01-01T00:00:00.000Z' } };
  const file = await materializeTaskContext({ cwd, role: 'consolidator', harness: 'codex', task, config: { root: '/glavni/vault' } });
  assert.equal(path.relative(cwd, file), TASK_CONTEXT_FILE);
  const parsed = JSON.parse(await fs.readFile(file, 'utf8'));
  assert.deepEqual(
    { task: parsed.task, taskRoot: parsed.taskRoot, role: parsed.role, agent: parsed.agent },
    { task: 'TASK-101', taskRoot: '/glavni/vault', role: 'consolidator', agent: 'codex' },
  );
  // Bez zadatka i kontrolnog korena fajl i dalje postoji, ali bez izmišljenih vrednosti.
  await materializeTaskContext({ cwd, role: 'researcher', harness: 'agy', task: null, config: null });
  const drugi = JSON.parse(await fs.readFile(file, 'utf8'));
  assert.equal(drugi.task, null);
  assert.equal(drugi.taskRoot, cwd);
  await fs.rm(cwd, { recursive: true, force: true });
});
