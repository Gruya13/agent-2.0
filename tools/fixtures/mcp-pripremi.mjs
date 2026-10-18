/**
 * Pripremi fixture za MCP ogled sa STVARNIM harnes klijentom.
 * Ispisuje JSON sa putanjom radnog stabla i tokenom zakupa.
 */
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { loadConfig } from '../orchestrator/lib/config.mjs';
import { createStore } from '../orchestrator/lib/store.mjs';
import { createPipeline } from '../orchestrator/lib/pipeline.mjs';
import { writeNote } from '../orchestrator/lib/vault.mjs';
import { commitWorktree, createWorktree } from '../orchestrator/lib/worktree.mjs';

const root = process.argv[2];
const uloga = process.argv[3] ?? 'consolidator';
const agent = process.argv[4] ?? (uloga === 'verifier' ? 'dsh' : 'codex');
if (!root) { console.error('upotreba: mcp-pripremi.mjs <vault> [role] [agent]'); process.exit(2); }
const config = await loadConfig(root, { configFile: path.join(root, 'tools', 'config', 'agents.real.yml') });
const store = createStore(config);
const pipeline = createPipeline(config, { store });
const nov = '2026-01-01T00:00:00.000Z';

await pipeline.ingest({ source: 'raw/mcp.md', title: 'MCP proba' });
const id = 'TASK-101';

// 1) nacrt na granu istraživača
const rw = await createWorktree(config, { id, role: 'researcher', base: 'main' });
await writeNote(rw.path, 'wiki/drafts/MCP_proba.md', {
  frontmatter: { title: 'MCP proba', created: nov, updated: nov, authors: ['researcher'], status: 'draft', tags: ['mcp'] },
  body: '# MCP proba\n\nNacrt za proveru MCP putanje upisa.\n',
});
await commitWorktree(config, id, `researcher(${id}): nacrt`, { actor: 'researcher', role: 'researcher' });

// 2a) verifier: zadatak u `review` sa živim zakupom — upisuje nalaz, ne wiki.
if (uloga === 'verifier') {
  const vw = await createWorktree(config, { id, role: 'verifier', base: `agent/researcher/${id}` });
  await store.setFields(id, { artifacts: ['wiki/drafts/MCP_proba.md'] }, { actor: 'agentctl', note: 'fixture' });
  const c = await store.claim(id, agent);
  await fs.mkdir(path.join(vw.path, '.runtime'), { recursive: true });
  await fs.writeFile(path.join(vw.path, '.runtime', 'task-context.json'), JSON.stringify({
    task: id, taskRoot: root, role: 'verifier', agent, leaseToken: c.leaseToken, status: 'in_progress', writtenAt: nov,
  }, null, 2) + '\n', 'utf8');
  console.log(JSON.stringify({ vault: root, id, worktree: vw.path, token: c.leaseToken, role: 'verifier', agent }));
  process.exit(0);
}

// 2a-researcher) istraživač: draft zona
if (uloga === 'researcher') {
  const wt = await createWorktree(config, { id, role: 'researcher', base: 'main' });
  await store.setFields(id, { artifacts: [] }, { actor: 'agentctl', note: 'fixture' });
  const c = await store.claim(id, agent);
  await fs.mkdir(path.join(wt.path, '.runtime'), { recursive: true });
  await fs.writeFile(path.join(wt.path, '.runtime', 'task-context.json'), JSON.stringify({
    task: id, taskRoot: root, role: 'researcher', agent, leaseToken: c.leaseToken, status: 'in_progress', writtenAt: nov,
  }, null, 2) + '\\n', 'utf8');
  console.log(JSON.stringify({ vault: root, id, worktree: wt.path, token: c.leaseToken, role: 'researcher', agent }));
  process.exit(0);
}

// 2a-extractor) ekstraktor: samo fragment zona
if (uloga === 'extractor') {
  const wt = await createWorktree(config, { id, role: 'extractor', base: 'main' });
  await store.setFields(id, { artifacts: [] }, { actor: 'agentctl', note: 'fixture' });
  const c = await store.claim(id, agent);
  await fs.mkdir(path.join(wt.path, '.runtime'), { recursive: true });
  await fs.writeFile(path.join(wt.path, '.runtime', 'task-context.json'), JSON.stringify({
    task: id, taskRoot: root, role: 'extractor', agent, leaseToken: c.leaseToken, status: 'in_progress', writtenAt: nov,
  }, null, 2) + '\\n', 'utf8');
  console.log(JSON.stringify({ vault: root, id, worktree: wt.path, token: c.leaseToken, role: 'extractor', agent }));
  process.exit(0);
}

// 2a-red-team) red-team: zona challenge
if (uloga === 'red-team') {
  const wt = await createWorktree(config, { id, role: 'red-team', base: 'main' });
  await store.setFields(id, { artifacts: [] }, { actor: 'agentctl', note: 'fixture' });
  const c = await store.claim(id, agent);
  await fs.mkdir(path.join(wt.path, '.runtime'), { recursive: true });
  await fs.writeFile(path.join(wt.path, '.runtime', 'task-context.json'), JSON.stringify({
    task: id, taskRoot: root, role: 'red-team', agent, leaseToken: c.leaseToken, status: 'in_progress', writtenAt: nov,
  }, null, 2) + '\\n', 'utf8');
  console.log(JSON.stringify({ vault: root, id, worktree: wt.path, token: c.leaseToken, role: 'red-team', agent }));
  process.exit(0);
}

// 2a-librarian) revizor: kind audit + precizan opseg
if (uloga === 'librarian') {
  await store.setFields(id, {
    kind: 'audit', audit_scope: ['wiki/Flatpak.md'], artifacts: [],
  }, { actor: 'agentctl', note: 'fixture' });
  const wt = await createWorktree(config, { id, role: 'librarian', base: 'main' });
  const c = await store.claim(id, agent);
  await fs.mkdir(path.join(wt.path, '.runtime'), { recursive: true });
  await fs.writeFile(path.join(wt.path, '.runtime', 'task-context.json'), JSON.stringify({
    task: id, taskRoot: root, role: 'librarian', agent, leaseToken: c.leaseToken, status: 'in_progress', writtenAt: nov,
  }, null, 2) + '\\n', 'utf8');
  console.log(JSON.stringify({ vault: root, id, worktree: wt.path, token: c.leaseToken, role: 'librarian', agent }));
  process.exit(0);
}

// 2b) verifikatorova grana sa pečatom
const vw = await createWorktree(config, { id, role: 'verifier', base: `agent/researcher/${id}` });
await writeNote(vw.path, `tasks/reviews/${id}.md`, {
  frontmatter: { title: `Revizija ${id}`, created: nov, updated: nov, authors: ['verifier'], status: 'review', tags: ['revizija'] },
  body: `# Revizija ${id}\n\n- verdikt: pass\n- broj nalaza: 0\n\n## Nalazi\n\n- nema\n`,
});
await commitWorktree(config, id, `verifier(${id}): revizija`, { actor: 'verifier', role: 'verifier' });

// 3) polja zadatka i prelaz u verified
await store.setFields(id, {
  artifacts: ['wiki/drafts/MCP_proba.md'],
  verification: { verdict: 'pass', by: 'verifier', at: nov },
  challenge: { verdict: 'clean', by: 'red-team', at: nov },
}, { actor: 'agentctl', note: 'fixture: pečat' });
const c1 = await store.claim(id, 'agentctl');
await store.release(id, 'agentctl', { toStatus: 'verified', token: c1.leaseToken, note: 'fixture: verified' });

// 4) consolidator worktree + živ zakup na codex
const cw = await createWorktree(config, { id, role: 'consolidator', base: `agent/verifier/${id}` });
const claim = await store.claim(id, 'codex');
await fs.mkdir(path.join(cw.path, '.runtime'), { recursive: true });
await fs.writeFile(path.join(cw.path, '.runtime', 'task-context.json'), JSON.stringify({
  task: id, taskRoot: root, role: 'consolidator', agent: 'codex',
  leaseToken: claim.leaseToken, status: 'in_progress', writtenAt: nov,
}, null, 2) + '\n', 'utf8');

console.log(JSON.stringify({ vault: root, id, worktree: cw.path, token: claim.leaseToken }));