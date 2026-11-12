import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { gitExec, makeVault, runCli } from './helpers/vault.mjs';
import { PACKAGE_ROOT } from '../tools/orchestrator/lib/config.mjs';

test('CLI: init uspostavlja topologiju, main granu, manifest i indeks', async () => {
  const vault = await makeVault({ initGit: false });
  const result = await runCli(vault.root, ['init']);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /init: vault=/);
  assert.match(result.stdout, /manifest: 1 zapisa/);
  for (const rel of ['raw', 'wiki/drafts', 'tasks/inbox', 'tasks/active', 'tasks/review', 'tasks/completed', 'tasks/reviews', '.agents']) {
    assert.ok(await vault.exists(rel), `nedostaje ${rel}`);
  }
  assert.ok(await vault.exists('wiki/Index.md'));
  assert.ok(await vault.exists('.agents/raw-manifest.json'));
  await vault.cleanup();
});


test('CLI: init komituje ugovor i alate (radna stabla ih moraju imati)', async () => {
  const vault = await makeVault({ initGit: false });
  const result = await runCli(vault.root, ['init']);
  assert.equal(result.code, 0, result.stderr);
  const tracked = await gitExec(vault.root, ['ls-files', '.gitignore', '.agents/AGENTS.md']);
  assert.match(tracked.stdout, /^\.gitignore$/m, '.gitignore mora biti u git-u da bi ga radna stabla imala');
  assert.match(tracked.stdout, /^\.agents\/AGENTS\.md$/m, 'ugovor mora biti u git-u');
  await vault.cleanup();
});
test('CLI: ingest -> run -> status, list, show prikazuju konsolidovan zadatak', async () => {
  const vault = await makeVault();
  const init = await runCli(vault.root, ['init']);
  assert.equal(init.code, 0, init.stderr);

  const ingest = await runCli(vault.root, ['ingest', 'raw/dokument.md', '--title', 'Probna beleska', '--tag', 'test,cli']);
  assert.equal(ingest.code, 0, ingest.stderr);
  assert.match(ingest.stdout, /zadatak TASK-101 \(ready\)/);

  const run = await runCli(vault.root, ['run', '--rounds', '6']);
  assert.equal(run.code, 0, run.stderr);
  assert.match(run.stdout, /consolidate\s+TASK-101\s+ok/);

  const status = await runCli(vault.root, ['status', '--json']);
  assert.equal(status.code, 0, status.stderr);
  const parsed = JSON.parse(status.stdout);
  assert.equal(parsed.tasks.length, 1);
  assert.equal(parsed.tasks[0].status, 'consolidated');
  assert.equal(parsed.tasks[0].phase, 'completed');
  assert.equal(parsed.lint.errors, 0);

  const list = await runCli(vault.root, ['list']);
  assert.match(list.stdout, /TASK-101\s+consolidated/);

  const show = await runCli(vault.root, ['show', 'TASK-101']);
  assert.match(show.stdout, /# TASK-101 — Probna beleska/);
  assert.match(show.stdout, /Faza research/);

  const lint = await runCli(vault.root, ['lint']);
  assert.equal(lint.code, 0, lint.stdout);
  assert.match(lint.stdout, /grešaka: 0/);

  const log = await runCli(vault.root, ['log', '--limit', '20']);
  assert.match(log.stdout, /researcher\(TASK-101\)/);

  const worktrees = await runCli(vault.root, ['worktrees']);
  assert.match(worktrees.stdout, /PUTANJA/);
  assert.doesNotMatch(worktrees.stdout, /TASK-101-/, 'radna stabla su počišćena');
  await vault.cleanup();
});

test('CLI: lint vraća izlazni kod 2 kada je ugovor prekršen', async () => {
  const vault = await makeVault();
  await runCli(vault.root, ['init']);
  await vault.write('raw/dokument.md', 'izmenjen izvor bez odobrenja');
  const lint = await runCli(vault.root, ['lint']);
  assert.equal(lint.code, 2);
  assert.match(lint.stdout, /raw\.modified/);
  const json = await runCli(vault.root, ['lint', '--json']);
  assert.equal(json.code, 2);
  assert.ok(JSON.parse(json.stdout).errors.length >= 1);
  await vault.cleanup();
});

test('CLI: ručni zakup kroz claim/renew/release', async () => {
  const vault = await makeVault();
  await runCli(vault.root, ['init']);
  await runCli(vault.root, ['ingest', 'raw/dokument.md', '--title', 'Zakup test']);

  const claim = await runCli(vault.root, ['claim', 'TASK-101', '--owner', 'researcher', '--ttl', '60000']);
  assert.equal(claim.code, 0, claim.stderr);
  assert.match(claim.stdout, /TASK-101 -> researcher/);
  const token = /token: (\S+)/.exec(claim.stdout)?.[1];
  assert.ok(token, 'claim mora da ispiše token zakupa');

  const renew = await runCli(vault.root, ['renew', 'TASK-101', '--owner', 'researcher', '--token', token]);
  assert.equal(renew.code, 0, renew.stderr);

  // Isti identitet, ali bez tokena: zakup drži drugi proces.
  const bezTokena = await runCli(vault.root, ['renew', 'TASK-101', '--owner', 'researcher']);
  assert.equal(bezTokena.code, 1);
  assert.match(bezTokena.stderr, /drugi proces/);

  const conflict = await runCli(vault.root, ['claim', 'TASK-101', '--owner', 'verifier']);
  assert.equal(conflict.code, 1);
  assert.match(conflict.stderr, /drži "researcher"/);

  // Otpuštanje zakupa u samo `in_progress` je nevalidno: to stanje zahteva zakup.
  const badRelease = await runCli(vault.root, ['release', 'TASK-101', '--owner', 'researcher', '--to', 'in_progress']);
  assert.equal(badRelease.code, 1);
  assert.match(badRelease.stderr, /ne može da ostavi TASK-101 u stanju "in_progress"/);

  const release = await runCli(vault.root, ['release', 'TASK-101', '--owner', 'researcher', '--to', 'ready', '--token', token]);
  assert.equal(release.code, 0, release.stderr);
  assert.match(release.stdout, /TASK-101 -> ready/);

  const reclaim = await runCli(vault.root, ['reclaim']);
  assert.equal(reclaim.code, 0, reclaim.stderr);
  assert.match(reclaim.stdout, /nema isteklih zakupa/);
  await vault.cleanup();
});

test('CLI: phase izvršava jednu fazu i vraća 0', async () => {
  const vault = await makeVault();
  await runCli(vault.root, ['init']);
  await runCli(vault.root, ['ingest', 'raw/dokument.md', '--title', 'Fazni test']);
  const research = await runCli(vault.root, ['phase', 'research', 'TASK-101', '--json']);
  assert.equal(research.code, 0, research.stderr);
  const parsed = JSON.parse(research.stdout);
  assert.equal(parsed.ok, true);
  assert.match(parsed.artifacts[0], /^wiki\/drafts\//);

  const verify = await runCli(vault.root, ['phase', 'verify', 'TASK-101', '--json']);
  assert.equal(verify.code, 0, verify.stderr);
  assert.equal(JSON.parse(verify.stdout).verdict, 'pass');

  const challenge = await runCli(vault.root, ['phase', 'challenge', 'TASK-101', '--json']);
  assert.equal(challenge.code, 0, challenge.stderr);
  assert.equal(JSON.parse(challenge.stdout).verdict, 'clean');

  const consolidate = await runCli(vault.root, ['phase', 'consolidate', 'TASK-101', '--json']);
  assert.equal(consolidate.code, 0, consolidate.stderr);
  assert.equal(JSON.parse(consolidate.stdout).ok, true);
  await vault.cleanup();
});

test('CLI: audit otvara revizorski zadatak sa opsegom i proverava ga', async () => {
  const vault = await makeVault();
  await runCli(vault.root, ['init']);

  const bezOpsega = await runCli(vault.root, ['audit']);
  assert.equal(bezOpsega.code, 1);
  assert.match(bezOpsega.stderr, /opseg/);

  const audit = await runCli(vault.root, ['audit', '--title', 'Revizija baze', '--scope', 'wiki/*.md']);
  assert.equal(audit.code, 0, audit.stderr);
  assert.match(audit.stdout, /revizorski zadatak TASK-101 \(ready\) opseg: wiki\/\*\.md/);

  const show = await runCli(vault.root, ['show', 'TASK-101']);
  assert.match(show.stdout, /vrsta: audit/);
  assert.match(show.stdout, /opseg: wiki\/\*\.md/);
  await vault.cleanup();
});

test('CLI: doctor proverava okruženje i prijavljuje adaptere', async () => {
  const vault = await makeVault();
  await runCli(vault.root, ['init']);
  const doctor = await runCli(vault.root, ['doctor', '--json']);
  const checks = JSON.parse(doctor.stdout);
  assert.equal(doctor.code, checks.some((c) => !c.ok) ? 1 : 0, 'doctor exit kod mora da odražava neuspele provere');
  const names = checks.map((c) => c.name);
  assert.ok(names.some((n) => n.includes('git repozitorijum')));
  assert.ok(names.some((n) => n.includes('harnes dsh')));
  assert.ok(names.some((n) => n.includes('harnes agy')));
  assert.ok(names.some((n) => n.includes('harnes agy')));
  const roles = checks.filter((c) => c.name.startsWith('uloga '));
  // Šest dokumentnih uloga + dve coding uloge (programer, reviewer).
  assert.equal(roles.length, 8, 'extractor, researcher, verifier, red-team, librarian, consolidator, programer, reviewer');
  assert.match(roles.map((r) => r.detail).join(','), /mock/);
  await vault.cleanup();
});

test('CLI: nepoznata komanda i nepoznata faza daju grešku', async () => {
  const vault = await makeVault();
  const unknown = await runCli(vault.root, ['nepostojeca']);
  assert.equal(unknown.code, 2);
  assert.match(unknown.stderr, /nepoznata komanda/);

  await runCli(vault.root, ['init']);
  await runCli(vault.root, ['ingest', 'raw/dokument.md', '--title', 'X']);
  const badPhase = await runCli(vault.root, ['phase', 'nepostojeca', 'TASK-101']);
  assert.equal(badPhase.code, 1);
  assert.match(badPhase.stderr, /nepoznata faza/);

  const noSource = await runCli(vault.root, ['ingest']);
  assert.equal(noSource.code, 1);
  assert.match(noSource.stderr, /zahteva putanju izvora/);
  await vault.cleanup();
});

test('CLI: zatvorena cev (| head) ne obara proces', async () => {
  const vault = await makeVault();
  await runCli(vault.root, ['init']);

  const child = spawn(process.execPath, [
    path.join(PACKAGE_ROOT, 'tools', 'orchestrator', 'cli.mjs'), 'status', '--vault', vault.root,
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
  // Potrošač odustaje odmah, kao `head -1`.
  child.stdout.once('data', () => child.stdout.destroy());

  const code = await new Promise((resolve) => child.on('close', resolve));
  assert.equal(code, 0, `proces je morao tiho da se završi (kod ${code}); stderr: ${stderr}`);
  assert.doesNotMatch(stderr, /EPIPE|Unhandled 'error'/, 'zatvorena cev ne sme da proizvede stack trace');
  await vault.cleanup();
});

test('CLI: --help ispisuje komande', async () => {
  const vault = await makeVault();
  const help = await runCli(vault.root, ['help']);
  assert.equal(help.code, 0);
  for (const command of ['ingest', 'claim', 'run', 'lint', 'index', 'doctor']) {
    assert.match(help.stdout, new RegExp(`\\b${command}\\b`));
  }
  await vault.cleanup();
});

test('CLI: doctor vraća 1 kada provera nije ok', async () => {
  const vault = await makeVault();
  await runCli(vault.root, ['init']);
  await fs.rm(path.join(vault.root, 'tasks', 'review'), { recursive: true, force: true });
  const doctor = await runCli(vault.root, ['doctor', '--json']);
  assert.equal(doctor.code, 1, 'neuspešna provera mora da obori izlazni kod');
  const checks = JSON.parse(doctor.stdout);
  assert.ok(checks.some((c) => !c.ok && c.name.includes('tasks/review')), doctor.stdout.slice(0, 800));
  await vault.cleanup();
});

test('CLI: run --strict prihvata flag i uspešan tok ostaje 0', async () => {
  const vault = await makeVault();
  await runCli(vault.root, ['init']);
  const run = await runCli(vault.root, ['run', '--strict', '--rounds', '0']);
  assert.equal(run.code, 0, run.stderr);
  await vault.cleanup();
});
