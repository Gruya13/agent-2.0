import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ISPRAVKA, pripremiCoding, skriptaProgramera } from './helpers/coding-fixture.mjs';

const FAKE_WORKER = "#!/usr/bin/env node\n// Minimalni fake spawn-worker: napravi granu od base, primeni mock popravku,\n// commit-uj i ispiši isti JSON oblik koji vraća pravi worker.\nimport { execSync } from 'node:child_process';\nimport { mkdtempSync, rmSync } from 'node:fs';\nimport os from 'node:os';\nimport path from 'node:path';\n\nconst argv = process.argv.slice(2);\nconst get = (flag) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : null; };\nconst repo = get('--repo');\nconst name = get('--name');\nconst base = get('--base');\nconst branch = `agent/worker/${name}`;\nconst tmp = mkdtempSync(path.join(os.tmpdir(), 'fake-worker-'));\nconst git = (args) => execSync(`git -C ${JSON.stringify(repo)} ${args}`, { stdio: 'pipe' });\ntry {\n  git(`worktree add -q -b ${branch} ${JSON.stringify(tmp)} ${base}`);\n  execSync(process.env.AGENT_2_0_MOCK_CODE_CMD, { cwd: tmp, stdio: 'pipe', shell: true });\n  execSync(`git -C ${JSON.stringify(tmp)} add -A`, { stdio: 'pipe' });\n  execSync(`git -C ${JSON.stringify(tmp)} -c user.name=worker -c user.email=w@local commit -q -m \"worker popravka\"`, { stdio: 'pipe' });\n  const commit = execSync(`git -C ${JSON.stringify(tmp)} rev-parse HEAD`, { encoding: 'utf8' }).trim();\n  process.stdout.write(JSON.stringify({ ok: true, status: 'done', branch, commits: [commit], diffStat: '2 files changed' }) + '\\n');\n} finally {\n  try { git(`worktree remove --force ${JSON.stringify(tmp)}`); } catch { /* već uklonjen */ }\n  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* tmpfs */ }\n}\n";

test('W1: programer radi u izolovanom workeru, host nastavlja kapije', async () => {
  const fakePath = path.join(os.tmpdir(), `fake-worker-${process.pid}-${Date.now()}.mjs`);
  await fs.writeFile(fakePath, FAKE_WORKER, 'utf8');
  const { vault, store, coding, zadatak } = await pripremiCoding({
    agents: { programer: { adapter: 'worker', harness: 'dsh', model: null, timeoutMs: 120_000 } },
  });
  process.env.AGENT_2_0_WORKER_SCRIPT = fakePath;
  process.env.AGENT_2_0_MOCK_CODE_CMD = await skriptaProgramera(ISPRAVKA);
  try {
    const rezultat = await coding.runCodeTask(zadatak.data.id);
    assert.equal(rezultat.ok, true, JSON.stringify(rezultat));
    // Prvi poziv završava izradu; pregled i prihvatanje su sledeći koraci toka.
    assert.equal(rezultat.step, 'implement');
    const posle = await store.get(zadatak.data.id);
    assert.equal(posle.data.status, 'verified');
    assert.equal(posle.data.code_evidence.implement.harness, 'worker');
    assert.match(posle.data.code_evidence.implement.worker.branch, /^agent\/worker\/code-task-101$/);
    // Testovi i baseline su izvršeni na HOSTU nad workerovom granom.
    assert.notEqual(posle.data.code_evidence.baseline.exitCode, 0, 'regresioni test je pao na osnovi');
    assert.equal(posle.data.code_evidence.check.exitCode, 0, 'provera posle popravke je prošla');
  } finally {
    delete process.env.AGENT_2_0_WORKER_SCRIPT;
    delete process.env.AGENT_2_0_MOCK_CODE_CMD;
    await vault.cleanup();
    await fs.rm(fakePath, { force: true });
  }
});
