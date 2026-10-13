import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { makeVault, gitExec } from './helpers/vault.mjs';
import { loadConfig } from '../tools/orchestrator/lib/config.mjs';
import {
  alignGeneratedPaths, branchChangedPaths, createWorktree, deleteBranch, ensureMainBranch,
  listWorktrees, mergeIntoMain, removeWorktree, removeWorktreesForTask, worktreePath,
} from '../tools/orchestrator/lib/worktree.mjs';
import { headSha, log } from '../tools/orchestrator/lib/git.mjs';
import { exists } from '../tools/orchestrator/lib/fsx.mjs';

test('worktree: izolacija dva agenta nad istim fajlom', async () => {
  const vault = await makeVault();
  const config = await loadConfig(vault.root);
  await ensureMainBranch(config);

  const a = await createWorktree(config, { id: 'TASK-001', role: 'researcher' });
  const b = await createWorktree(config, { id: 'TASK-001', role: 'verifier' });

  assert.notEqual(a.path, b.path, 'svaka uloga dobija svoj direktorijum');
  assert.equal(a.branch, 'agent/researcher/TASK-001');
  assert.equal(b.branch, 'agent/verifier/TASK-001');
  assert.ok(await exists(a.path));
  assert.ok(await exists(b.path));

  // Agent A piše u svoje stablo — glavno stablo ne vidi ništa.
  await vault.write('.worktrees/TASK-001-researcher/wiki/drafts/A.md', '# A\n');
  assert.equal(await vault.exists('wiki/drafts/A.md'), false);

  // Ponovni poziv je idempotentan.
  const again = await createWorktree(config, { id: 'TASK-001', role: 'researcher' });
  assert.equal(again.reused, true);
  await vault.cleanup();
});

test('worktree: komit na grani nosi ime agenta, main ostaje netaknut', async () => {
  const vault = await makeVault();
  const config = await loadConfig(vault.root);
  await ensureMainBranch(config);
  await createWorktree(config, { id: 'TASK-002', role: 'researcher' });
  const wt = worktreePath(config, 'TASK-002', 'researcher');

  await vault.write('.worktrees/TASK-002-researcher/wiki/drafts/A.md', '# A\n');
  await gitExec(wt, ['-c', 'user.name=researcher', '-c', 'user.email=researcher@local', 'add', '-A']);
  await gitExec(wt, ['-c', 'user.name=researcher', '-c', 'user.email=researcher@local', 'commit', '-q', '-m', 'researcher: nacrt']);
  const commits = await log(wt, { limit: 1, format: '%an|%s' });
  assert.equal(commits[0], 'researcher|researcher: nacrt');

  assert.equal(await vault.exists('wiki/drafts/A.md'), false, 'main ne vidi rad grane');
  await vault.cleanup();
});

test('worktree: sekvencijalni merge u main i čišćenje', async () => {
  const vault = await makeVault();
  const config = await loadConfig(vault.root);
  await ensureMainBranch(config);

  // Dva zadatka koja menjaju različite fajlove: oba se spajaju bez konflikta.
  for (const [id, file] of [['TASK-010', 'wiki/Prvi.md'], ['TASK-011', 'wiki/Drugi.md']]) {
    await createWorktree(config, { id, role: 'consolidator' });
    await vault.write(`.worktrees/${id}-consolidator/${file}`, `# ${id}\n`);
    await gitExec(worktreePath(config, id, 'consolidator'), ['-c', 'user.name=codex', '-c', 'user.email=codex@local', 'add', '-A']);
    await gitExec(worktreePath(config, id, 'consolidator'), ['-c', 'user.name=codex', '-c', 'user.email=codex@local', 'commit', '-q', '-m', `consolidator: ${id}`]);
    const merge = await mergeIntoMain(config, {
      branch: `agent/consolidator/${id}`,
      message: `agentctl: ${id}`,
      // Kapija zona je stroga po defaultu: produkcija mora biti deklarisana.
      zonePolicy: { production: [file] },
    });
    assert.equal(merge.merged, true, merge.reason);
    await removeWorktreesForTask(config, id);
    await deleteBranch(config, `agent/consolidator/${id}`);
  }

  assert.ok(await vault.exists('wiki/Prvi.md'));
  assert.ok(await vault.exists('wiki/Drugi.md'));
  // Istorija čuva svaki doprinos sa autorom.
  const history = await log(config.root, { limit: 10, format: '%an|%s' });
  assert.ok(history.some((line) => line.startsWith('codex|consolidator: TASK-010')));
  assert.ok(history.some((line) => line.startsWith('codex|consolidator: TASK-011')));
  const worktrees = await listWorktrees(config);
  assert.equal(worktrees.length, 1, 'ostaje samo glavno radno stablo');
  await vault.cleanup();
});

test('worktree: grana koja menja zone van dozvole se ne spaja', async () => {
  const vault = await makeVault();
  const config = await loadConfig(vault.root);
  await ensureMainBranch(config);
  await createWorktree(config, { id: 'TASK-070', role: 'researcher' });
  const wt = worktreePath(config, 'TASK-070', 'researcher');

  // Agent piše fajl-sistemom, mimo MCP-a: `raw/` i `tools/` nisu njegova zona.
  await vault.write('.worktrees/TASK-070-researcher/raw/INJECTED.md', '# injektirano\n');
  await vault.write('.worktrees/TASK-070-researcher/tools/podmetnuto.mjs', '// podmetnuto\n');
  await gitExec(wt, ['-c', 'user.name=r', '-c', 'user.email=r@local', 'add', '-A']);
  await gitExec(wt, ['-c', 'user.name=r', '-c', 'user.email=r@local', 'commit', '-q', '-m', 'injection']);

  const merge = await mergeIntoMain(config, { branch: 'agent/researcher/TASK-070', message: 'probe' });
  assert.equal(merge.merged, false);
  assert.match(merge.reason, /zone van dozvole/);
  assert.deepEqual(merge.outOfZone.sort(), ['raw/INJECTED.md', 'tools/podmetnuto.mjs']);
  assert.equal(await vault.exists('raw/INJECTED.md'), false);
  assert.equal(await vault.exists('tools/podmetnuto.mjs'), false);
  await vault.cleanup();
});

test('worktree: rename iz zabranjene zone ne zaobilazi kapiju', async () => {
  const vault = await makeVault();
  const config = await loadConfig(vault.root);
  await ensureMainBranch(config);
  await createWorktree(config, { id: 'TASK-071', role: 'researcher' });
  const wt = worktreePath(config, 'TASK-071', 'researcher');

  // `git mv tools/x wiki/x` — bez `--no-renames` kapija bi videla samo odredište.
  // `wiki/` je u fixture-u prazan (git ne prati prazne direktorijume), pa ga
  // stvorimo u radnom stablu.
  await vault.write('.worktrees/TASK-071-researcher/wiki/.keep', '');
  await gitExec(wt, ['mv', 'tools/orchestrator/cli.mjs', 'wiki/podmetnuti-cli.mjs']);
  await gitExec(wt, ['-c', 'user.name=r', '-c', 'user.email=r@local', 'add', '-A']);
  await gitExec(wt, ['-c', 'user.name=r', '-c', 'user.email=r@local', 'commit', '-q', '-m', 'rename iz zabranjene zone']);

  const putanje = await branchChangedPaths(config, 'agent/researcher/TASK-071');
  assert.ok(putanje.includes('tools/orchestrator/cli.mjs'), `kapija mora da vidi obe strane rename-a (${putanje.join(', ')})`);
  const merge = await mergeIntoMain(config, { branch: 'agent/researcher/TASK-071', message: 'probe' });
  assert.equal(merge.merged, false);
  assert.match(merge.reason, /zone van dozvole/);
  assert.equal(await vault.exists('tools/orchestrator/cli.mjs'), true, 'infrastruktura je netaknuta u main-u');
  await vault.cleanup();
});

test('worktree: kapija razlikuje podzone — istraživač ne ulazi u produkciju', async () => {
  const vault = await makeVault();
  const config = await loadConfig(vault.root);
  await ensureMainBranch(config);
  await createWorktree(config, { id: 'TASK-072', role: 'researcher' });
  const wt = worktreePath(config, 'TASK-072', 'researcher');

  // Istraživač, fajl-sistemom, upiše produkcionu belešku (nije njegova podzona).
  await vault.write('.worktrees/TASK-072-researcher/wiki/Produkcija.md', '# podmetnuto\n');
  await gitExec(wt, ['-c', 'user.name=r', '-c', 'user.email=r@local', 'add', '-A']);
  await gitExec(wt, ['-c', 'user.name=r', '-c', 'user.email=r@local', 'commit', '-q', '-m', 'u produkciju']);

  const bezPolitike = await mergeIntoMain(config, { branch: 'agent/researcher/TASK-072', message: 'probe' });
  assert.equal(bezPolitike.merged, false, 'stroga politika po defaultu ne dozvoljava produkciju');
  assert.deepEqual(bezPolitike.outOfZone, ['wiki/Produkcija.md']);

  // Ista grana prolazi kada je ta beleška deklarisani artefakt zadatka.
  const saPolitikom = await mergeIntoMain(config, {
    branch: 'agent/researcher/TASK-072', message: 'probe', zonePolicy: { production: ['wiki/Produkcija.md'] },
  });
  assert.equal(saPolitikom.merged, true, saPolitikom.reason);
  await vault.cleanup();
});

test('worktree: konflikt se detektuje i main se vraća u pređašnje stanje', async () => {
  const vault = await makeVault();
  const config = await loadConfig(vault.root);
  await ensureMainBranch(config);

  await vault.write('wiki/Zajednicki.md', '# Osnova\n\nlinija\n');
  await gitExec(config.root, ['-c', 'user.name=base', '-c', 'user.email=base@local', 'add', '-A']);
  await gitExec(config.root, ['-c', 'user.name=base', '-c', 'user.email=base@local', 'commit', '-q', '-m', 'osnova']);
  const before = await headSha(config.root);

  await createWorktree(config, { id: 'TASK-020', role: 'consolidator' });
  const wt = worktreePath(config, 'TASK-020', 'consolidator');
  await vault.write('.worktrees/TASK-020-consolidator/wiki/Zajednicki.md', '# Grana\n\nlinija\n');
  await gitExec(wt, ['-c', 'user.name=codex', '-c', 'user.email=codex@local', 'add', '-A']);
  await gitExec(wt, ['-c', 'user.name=codex', '-c', 'user.email=codex@local', 'commit', '-q', '-m', 'grana']);

  // Main se menja na istom mestu -> tekstualni konflikt.
  await vault.write('wiki/Zajednicki.md', '# Main\n\nlinija\n');
  await gitExec(config.root, ['-c', 'user.name=main', '-c', 'user.email=main@local', 'add', '-A']);
  await gitExec(config.root, ['-c', 'user.name=main', '-c', 'user.email=main@local', 'commit', '-q', '-m', 'main']);

  const merge = await mergeIntoMain(config, {
    branch: 'agent/consolidator/TASK-020', message: 'agentctl', zonePolicy: { production: ['wiki/Zajednicki.md'] },
  });
  assert.equal(merge.merged, false);
  assert.equal(merge.conflict, true);
  assert.deepEqual(merge.files, ['wiki/Zajednicki.md']);
  assert.notEqual(before, await headSha(config.root));
  // Merge je abortovan: nema ostataka konflikta ni MERGE_HEAD.
  assert.equal(await vault.exists('.git/MERGE_HEAD'), false);
  assert.match(await vault.read('wiki/Zajednicki.md'), /^# Main/);
  await vault.cleanup();
});

test('worktree: izvedeni artefakti se poravnavaju pre merge-a (nema konflikta na Index.md)', async () => {
  const vault = await makeVault();
  const config = await loadConfig(vault.root);
  await ensureMainBranch(config);
  await vault.write('wiki/Index.md', '# Index\n\nv1\n');
  await gitExec(config.root, ['-c', 'user.name=base', '-c', 'user.email=base@local', 'add', '-A']);
  await gitExec(config.root, ['-c', 'user.name=base', '-c', 'user.email=base@local', 'commit', '-q', '-m', 'osnova']);

  await createWorktree(config, { id: 'TASK-030', role: 'consolidator' });
  const wt = worktreePath(config, 'TASK-030', 'consolidator');
  await vault.write('.worktrees/TASK-030-consolidator/wiki/Index.md', '# Index\n\ngrana\n');
  await vault.write('.worktrees/TASK-030-consolidator/wiki/Nova.md', '# Nova\n');
  await gitExec(wt, ['-c', 'user.name=codex', '-c', 'user.email=codex@local', 'add', '-A']);
  await gitExec(wt, ['-c', 'user.name=codex', '-c', 'user.email=codex@local', 'commit', '-q', '-m', 'grana']);

  // Main menja Index.md posle grananja -> klasican izvor konflikta.
  await vault.write('wiki/Index.md', '# Index\n\nmain se promenio\n');
  await gitExec(config.root, ['-c', 'user.name=main', '-c', 'user.email=main@local', 'add', '-A']);
  await gitExec(config.root, ['-c', 'user.name=main', '-c', 'user.email=main@local', 'commit', '-q', '-m', 'main']);

  const aligned = await alignGeneratedPaths(config, wt, [config.vault.index]);
  assert.deepEqual(aligned.aligned, ['wiki/Index.md']);

  const merge = await mergeIntoMain(config, {
    branch: 'agent/consolidator/TASK-030', message: 'agentctl', zonePolicy: { production: ['wiki/Nova.md'] },
  });
  assert.equal(merge.merged, true, merge.reason);
  assert.ok(await vault.exists('wiki/Nova.md'));
  await vault.cleanup();
});

test('worktree: uklanjanje radi i kada je stablo prljavo', async () => {
  const vault = await makeVault();
  const config = await loadConfig(vault.root);
  await ensureMainBranch(config);
  await createWorktree(config, { id: 'TASK-040', role: 'researcher' });
  await vault.write('.worktrees/TASK-040-researcher/radna-nacrt.md', 'nedovrseno');
  const result = await removeWorktree(config, 'TASK-040', { role: 'researcher' });
  assert.equal(result.removed, true);
  assert.equal(await exists(worktreePath(config, 'TASK-040', 'researcher')), false);
  await vault.cleanup();
});

test('worktree: brancheChangedPaths prijavljuje samo izmene grane', async () => {
  const vault = await makeVault();
  const config = await loadConfig(vault.root);
  await ensureMainBranch(config);
  await createWorktree(config, { id: 'TASK-050', role: 'researcher' });
  const wt = worktreePath(config, 'TASK-050', 'researcher');
  await vault.write('.worktrees/TASK-050-researcher/wiki/drafts/X.md', '# X\n');
  await gitExec(wt, ['-c', 'user.name=r', '-c', 'user.email=r@local', 'add', '-A']);
  await gitExec(wt, ['-c', 'user.name=r', '-c', 'user.email=r@local', 'commit', '-q', '-m', 'x']);
  const changed = await branchChangedPaths(config, 'agent/researcher/TASK-050');
  assert.deepEqual(changed, ['wiki/drafts/X.md']);
  await vault.cleanup();
});

test('ensureMainBranch: svež repo bez komita dobija main granu', async () => {
  const vault = await makeVault({ initGit: false });
  await gitExec(vault.root, ['init', '-q', '-b', 'main']);
  const config = await loadConfig(vault.root);
  const result = await ensureMainBranch(config);
  assert.equal(result.branch, 'main');
  assert.equal(result.created, true);
  const sha = await headSha(config.root);
  assert.match(sha, /^[0-9a-f]{40}$/);
  await vault.cleanup();
});

test('worktree putanja nikad ne izlazi iz vault-a', async () => {
  const vault = await makeVault();
  const config = await loadConfig(vault.root);
  const dir = worktreePath(config, 'TASK-060', 'researcher');
  assert.equal(path.relative(config.root, dir).startsWith('..'), false);
  assert.equal(path.basename(dir), 'TASK-060-researcher');
  await vault.cleanup();
});
