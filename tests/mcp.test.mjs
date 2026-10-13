import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { makeVault } from './helpers/vault.mjs';
import { PACKAGE_ROOT } from '../tools/orchestrator/lib/config.mjs';
import { writeNote } from '../tools/orchestrator/lib/vault.mjs';

const SERVER = path.join(PACKAGE_ROOT, 'tools', 'mcp', 'obsidian-mcp.mjs');
const NOW = '2025-01-01T00:00:00.000Z';
const BUDUCNOST = '2035-01-01T00:00:00.000Z';
const PROSLOST = '2020-01-01T00:00:00.000Z';

/** Minimalni MCP klijent preko stdio — testira pravi protokol, ne interne funkcije. */
async function connect(vaultRoot, role, agent = 'test', t = null, extraEnv = {}) {
  const child = spawn(process.execPath, [SERVER], {
    cwd: vaultRoot,
    env: { ...process.env, OBSIDIAN_VAULT: vaultRoot, OBSIDIAN_ROLE: role, OBSIDIAN_AGENT: agent, ...extraEnv },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const rl = createInterface({ input: child.stdout });
  const pending = new Map();
  let nextId = 0;
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
  rl.on('line', (line) => {
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    const resolver = pending.get(msg.id);
    if (resolver) {
      pending.delete(msg.id);
      resolver(msg);
    }
  });

  const call = (method, params) => new Promise((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => reject(new Error(`MCP poziv ${method} je istekao; stderr: ${stderr}`)), 8000);
    pending.set(id, (msg) => { clearTimeout(timer); resolve(msg); });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });

  const callTool = async (name, args = {}) => (await call('tools/call', { name, arguments: args })).result;

  await call('initialize', { protocolVersion: '2024-11-05' });
  const close = () => { try { child.kill(); } catch { /* već mrtav */ } };
  if (t) t.after(close);
  return { call, callTool, close, getStderr: () => stderr };
}

async function seededVault({ withContract = true } = {}) {
  const vault = await makeVault();
  if (!withContract) await fs.rm(path.join(vault.root, '.agents', 'AGENTS.md'), { force: true });
  await writeNote(vault.root, 'wiki/Crna_tabla.md', {
    frontmatter: { title: 'Crna tabla', created: NOW, updated: NOW, authors: ['researcher'], status: 'consolidated', tags: ['arhitektura'] },
    body: '# Crna tabla\n\nZajednička memorija sistema. Vidi [[Izvori znanja]].\n',
  });
  await writeNote(vault.root, 'wiki/Izvori_znanja.md', {
    frontmatter: { title: 'Izvori znanja', created: NOW, updated: NOW, authors: ['researcher'], status: 'consolidated', tags: ['agenti'] },
    body: '# Izvori znanja\n\nAgenti nad [[Crna tabla]].\n',
  });
  return vault;
}

/** Upiši zadatak u odgovarajuću faznu fasciklu (fixture za proveru zakupa). */
async function makeTask(vault, {
  id = 'TASK-101', status = 'in_progress', owner = 'researcher',
  leaseExpires = BUDUCNOST, artifacts = ['wiki/drafts/Produkcija.md'],
  verdict = status === 'verified' ? 'pass' : null,
} = {}) {
  const phase = { proposed: 'inbox', ready: 'inbox', blocked: 'inbox', in_progress: 'active', review: 'review', verified: 'review', consolidated: 'completed' }[status];
  const lines = [
    '---',
    `id: ${id}`,
    'title: Fixture zadatak',
    `status: ${status}`,
    `created: ${NOW}`,
    `updated: ${NOW}`,
    'source: raw/dokument.md',
    'authors:',
    '  - researcher',
    `assignee: ${owner}`,
    `lock_owner: ${owner}`,
    `locked_at: ${NOW}`,
    `lease_expires_at: ${leaseExpires}`,
    ...(artifacts.length ? ['artifacts:', ...artifacts.map((a) => `  - ${a}`)] : ['artifacts: []']),
    ...(verdict ? ['verification:', `  verdict: ${verdict}`, '  by: verifier', `  at: ${NOW}`] : ['verification: null']),
    'history:',
    `  - at: ${NOW}`,
    '    status: ready',
    '    actor: agentctl',
    `  - at: ${NOW}`,
    `    status: ${status}`,
    `    actor: ${owner}`,
    '---',
    '',
    '# Fixture zadatak',
    '',
  ];
  await vault.write(`tasks/${phase}/${id}.md`, lines.join('\n'));
  return id;
}

async function symlink(vault, target, link) {
  const full = path.join(vault.root, link);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.symlink(target, full);
}

// --------------------------------------------------------------- protokol

test('MCP: initialize i tools/list izlažu ugovorene alate', async (t) => {
  const vault = await seededVault();
  const client = await connect(vault.root, 'readonly', 'test', t);
  const response = await client.call('tools/list', {});
  const names = response.result.tools.map((tool) => tool.name);
  for (const expected of ['obsidian_search_notes', 'obsidian_read_notes', 'obsidian_patch_note', 'obsidian_backlinks']) {
    assert.ok(names.includes(expected), `nedostaje alat ${expected}`);
  }
  for (const tool of response.result.tools) {
    assert.equal(tool.inputSchema.type, 'object');
    assert.ok(tool.description.length > 20, `${tool.name} mora imati opis`);
  }
  const init = await client.call('initialize', { protocolVersion: '2025-06-18' });
  assert.equal(init.result.serverInfo.name, 'obsidian-mcp');
  assert.equal(init.result.protocolVersion, '2025-06-18');
});

test('MCP: pretraga, čitanje zaglavlja, backlinkovi', async (t) => {
  const vault = await seededVault();
  const client = await connect(vault.root, 'verifier', 'dsh', t);

  const search = await client.callTool('obsidian_search_notes', { query: 'memorija' });
  assert.equal(search.isError, false);
  assert.match(search.content[0].text, /wiki\/Crna_tabla\.md:\d+: Zajednička memorija sistema/);

  const read = await client.callTool('obsidian_read_notes', { path: 'wiki/Crna_tabla.md', frontmatter_only: true });
  assert.match(read.content[0].text, /status: consolidated/);
  assert.match(read.content[0].text, /samo zaglavlje/);
  assert.doesNotMatch(read.content[0].text, /Zajednička memorija/);

  const section = await client.callTool('obsidian_read_notes', { path: 'wiki/Crna_tabla.md', section: 'Crna tabla' });
  assert.match(section.content[0].text, /Zajednička memorija/);

  const backlinks = await client.callTool('obsidian_backlinks', { path: 'Crna tabla' });
  assert.match(backlinks.content[0].text, /wiki\/Izvori_znanja\.md/);

  const info = await client.callTool('obsidian_vault_info');
  assert.match(info.content[0].text, /role:\s+verifier/);
  await vault.cleanup();
});

// --------------------------------------------------------------- zone upisa

test('MCP: zone upisa se sprovode po ulozi, uz važeći zakup', async (t) => {
  const vault = await seededVault();
  const cases = [
    { role: 'researcher', owner: 'researcher', status: 'in_progress', allowed: ['wiki/drafts/Produkcija.md'], denied: ['wiki/Produkcija.md', 'raw/x.md', 'tasks/reviews/R.md'] },
    { role: 'verifier', owner: 'verifier', status: 'in_progress', allowed: ['tasks/reviews/TASK-101.md'], denied: ['wiki/Produkcija.md', 'wiki/drafts/Produkcija.md', 'raw/x.md'] },
    { role: 'consolidator', owner: 'consolidator', status: 'verified', allowed: ['wiki/Produkcija.md'], denied: ['raw/x.md', 'tasks/inbox/TASK-101.md', 'wiki/Druga.md'] },
    { role: 'readonly', owner: 'consolidator', status: 'verified', allowed: [], denied: ['wiki/Produkcija.md', 'wiki/drafts/Produkcija.md', 'tasks/reviews/R.md'] },
  ];

  for (const [index, entry] of cases.entries()) {
    const id = await makeTask(vault, {
      id: `TASK-1${String(index).padStart(2, '0')}`,
      owner: entry.owner,
      status: entry.status,
      artifacts: ['wiki/drafts/Produkcija.md'],
    });
    const c = await connect(vault.root, entry.role, entry.role, t, { OBSIDIAN_TASK: id });
    for (const allowed of entry.allowed) {
      const result = await c.callTool('obsidian_write_note', { path: allowed, content: '# proba\n' });
      assert.equal(result.isError, false, `${entry.role} mora moći da piše u ${allowed}: ${result.content[0].text}`);
    }
    for (const denied of entry.denied) {
      const result = await c.callTool('obsidian_write_note', { path: denied, content: '# proba\n' });
      assert.equal(result.isError, true, `${entry.role} ne sme da piše u ${denied}`);
      assert.match(result.content[0].text, /error:/);
    }
    const read = await c.callTool('obsidian_read_notes', { path: 'wiki/Crna_tabla.md' });
    assert.equal(read.isError, false);
    c.close();
  }
  await vault.cleanup();
});

test('MCP: upis bez zadatka, sa isteklim zakupom ili pogrešnim stanjem je odbijen', async (t) => {
  const vault = await seededVault();

  // 1. Nema OBSIDIAN_TASK.
  const bezZadatka = await connect(vault.root, 'consolidator', 'codex', t, {});
  const noTask = await bezZadatka.callTool('obsidian_write_note', { path: 'wiki/Neproverena.md', content: '# x\n' });
  assert.equal(noTask.isError, true, 'upis bez zadatka mora biti odbijen');
  assert.match(noTask.content[0].text, /OBSIDIAN_TASK/);
  bezZadatka.close();

  // 2. Zadatak postoji, ali zakup je istekao.
  await makeTask(vault, { id: 'TASK-201', owner: 'consolidator', status: 'verified', leaseExpires: PROSLOST });
  const istekao = await connect(vault.root, 'consolidator', 'codex', t, { OBSIDIAN_TASK: 'TASK-201' });
  const expired = await istekao.callTool('obsidian_write_note', { path: 'wiki/Produkcija.md', content: '# x\n' });
  assert.equal(expired.isError, true);
  assert.match(expired.content[0].text, /istekao/i);
  istekao.close();

  // 3. Zadatak nije verifikovan (nema pečata) — produkcioni upis je prekršaj.
  await makeTask(vault, { id: 'TASK-202', owner: 'consolidator', status: 'in_progress' });
  const bezPecata = await connect(vault.root, 'consolidator', 'codex', t, { OBSIDIAN_TASK: 'TASK-202' });
  const unverified = await bezPecata.callTool('obsidian_write_note', { path: 'wiki/Produkcija.md', content: '# x\n' });
  assert.equal(unverified.isError, true, 'produkcija bez verifikacije mora biti odbijena');
  assert.match(unverified.content[0].text, /verifikacioni pečat/);
  bezPecata.close();

  // 4. Zakup drži druga uloga.
  await makeTask(vault, { id: 'TASK-203', owner: 'researcher', status: 'verified' });
  const tudjiZakup = await connect(vault.root, 'consolidator', 'codex', t, { OBSIDIAN_TASK: 'TASK-203' });
  const stolen = await tudjiZakup.callTool('obsidian_write_note', { path: 'wiki/Produkcija.md', content: '# x\n' });
  assert.equal(stolen.isError, true);
  assert.match(stolen.content[0].text, /ne drži/);
  tudjiZakup.close();

  // 5. Beleška nije artefakt zadatka.
  await makeTask(vault, { id: 'TASK-204', owner: 'consolidator', status: 'verified', artifacts: ['wiki/drafts/Produkcija.md'] });
  const tudjaBeleska = await connect(vault.root, 'consolidator', 'codex', t, { OBSIDIAN_TASK: 'TASK-204' });
  const wrongArtifact = await tudjaBeleska.callTool('obsidian_write_note', { path: 'wiki/Nesto_drugo.md', content: '# x\n' });
  assert.equal(wrongArtifact.isError, true);
  assert.match(wrongArtifact.content[0].text, /nije artefakt/);
  tudjaBeleska.close();

  // 6. Zadatak bez artefakata ne otvara produkciju ("sme bilo šta").
  await makeTask(vault, { id: 'TASK-205', owner: 'consolidator', status: 'verified', artifacts: [] });
  const bezArtefakata = await connect(vault.root, 'consolidator', 'codex', t, { OBSIDIAN_TASK: 'TASK-205' });
  const noArtifact = await bezArtefakata.callTool('obsidian_write_note', { path: 'wiki/Bilo_sta.md', content: '# x\n' });
  assert.equal(noArtifact.isError, true, 'zadatak bez artefakata ne sme da otvori produkciju');
  assert.match(noArtifact.content[0].text, /nema artefakte/);
  bezArtefakata.close();

  assert.equal(await vault.exists('wiki/Neproverena.md'), false, 'odbijeni upis nije nastao');
  assert.equal(await vault.exists('wiki/Bilo_sta.md'), false);
  await vault.cleanup();
});

test('MCP: kontrolni koren se ne može zaobići praznim direktorijumom', async (t) => {
  const vault = await seededVault();
  // Skladište nosi ugovor, pa je zadatak obavezan — i kada je OBSIDIAN_TASK_ROOT
  // usmeren na prazan direktorijum koji nema ni ugovor ni tasks/.
  const prazan = await fs.mkdtemp(path.join(path.dirname(vault.root), 'agent2-empty-'));
  const client = await connect(vault.root, 'consolidator', 'codex', t, {
    OBSIDIAN_TASK_ROOT: prazan,
    OBSIDIAN_TASK: 'TASK-999',
  });
  const write = await client.callTool('obsidian_write_note', { path: 'wiki/NoStamp.md', content: '# x\n' });
  assert.equal(write.isError, true, 'prazan kontrolni koren ne sme da ukine zahtev za zadatkom');
  assert.match(write.content[0].text, /ugovor/);
  assert.equal(await vault.exists('wiki/NoStamp.md'), false);

  // Isto važi i bez OBSIDIAN_TASK, čak i kada kontrolni koren nema ugovor.
  const bez = await connect(vault.root, 'consolidator', 'codex', t, { OBSIDIAN_TASK_ROOT: prazan });
  const noTask = await bez.callTool('obsidian_write_note', { path: 'wiki/NoStamp2.md', content: '# x\n' });
  assert.equal(noTask.isError, true);
  await fs.rm(prazan, { recursive: true, force: true });
  await vault.cleanup();
});

test('MCP: izvedeni artefakti kontrolnog sloja su zaštićeni', async (t) => {
  const vault = await seededVault();
  await makeTask(vault, { id: 'TASK-301', owner: 'consolidator', status: 'verified', artifacts: ['wiki/Index.md', 'wiki/drafts/Index.md'] });
  const client = await connect(vault.root, 'consolidator', 'codex', t, { OBSIDIAN_TASK: 'TASK-301' });
  for (const target of ['wiki/Index.md', '.agents/raw-manifest.json', 'tasks/events.jsonl']) {
    const write = await client.callTool('obsidian_write_note', { path: target, content: '# x\n' });
    assert.equal(write.isError, true, `${target} ne sme biti upisiv kroz MCP`);
    const patch = await client.callTool('obsidian_patch_note', { path: target, section: 'X', content: 'y' });
    assert.equal(patch.isError, true, `${target} ne sme biti menjan ni patch-om`);
  }
  await vault.cleanup();
});

test('MCP: simbolički link ne može da izvede upis ili čitanje iz zone', async (t) => {
  const vault = await seededVault();
  await symlink(vault, '../../raw', 'wiki/drafts/raw-link');
  await makeTask(vault, { id: 'TASK-401', owner: 'researcher', status: 'in_progress' });

  const client = await connect(vault.root, 'researcher', 'agy', t, { OBSIDIAN_TASK: 'TASK-401' });
  const write = await client.callTool('obsidian_write_note', { path: 'wiki/drafts/raw-link/BYPASS.md', content: '# proba\n' });
  assert.equal(write.isError, true, 'upis kroz link u raw/ mora biti odbijen');
  assert.equal(await vault.exists('raw/BYPASS.md'), false, 'fajl ne sme da nastane u raw/');

  const patch = await client.callTool('obsidian_patch_note', { path: 'wiki/drafts/raw-link/BYPASS.md', section: 'X', content: 'y' });
  assert.equal(patch.isError, true);

  // Link ka spoljašnjem direktorijumu.
  const spolja = await fs.mkdtemp(path.join(path.dirname(vault.root), 'agent2-outside-'));
  await fs.writeFile(path.join(spolja, 'spoljni.md'), 'TAJNI-SADRZAJ-9417\n', 'utf8');
  await symlink(vault, spolja, 'wiki/drafts/outside-link');
  const read = await client.callTool('obsidian_read_notes', { path: 'wiki/drafts/outside-link/spoljni.md' });
  assert.equal(read.isError, true, 'čitanje izvan skladišta kroz link mora biti odbijeno');
  assert.doesNotMatch(read.content[0].text, /TAJNI-SADRZAJ-9417/, 'sadržaj izvan skladišta ne sme da procure');
  await fs.rm(spolja, { recursive: true, force: true });
  await vault.cleanup();
});

test('MCP: skladište bez ugovora zadržava samo zonska pravila', async (t) => {
  const vault = await seededVault({ withContract: false });
  const client = await connect(vault.root, 'researcher', 'agy', t);
  const allowed = await client.callTool('obsidian_write_note', { path: 'wiki/drafts/Nacrt.md', content: '# nacrt\n' });
  assert.equal(allowed.isError, false, 'bez ugovora nema zahteva za zakupom');
  const denied = await client.callTool('obsidian_write_note', { path: 'wiki/Nacrt.md', content: '# x\n' });
  assert.equal(denied.isError, true, 'zonska pravila i dalje važe');
  const raw = await client.callTool('obsidian_write_note', { path: 'raw/x.md', content: '# x\n' });
  assert.equal(raw.isError, true);
  await vault.cleanup();
});

// --------------------------------------------------------------- patch

test('MCP: patch menja samo zadati odeljak', async (t) => {
  const vault = await seededVault();
  await makeTask(vault, { id: 'TASK-501', owner: 'consolidator', status: 'verified', artifacts: ['wiki/Crna_tabla.md'] });
  const client = await connect(vault.root, 'consolidator', 'codex', t, { OBSIDIAN_TASK: 'TASK-501' });
  const original = await vault.read('wiki/Crna_tabla.md');

  await client.callTool('obsidian_patch_note', { path: 'wiki/Crna_tabla.md', section: 'Crna tabla', content: 'Novi sadržaj odeljka.' });
  const patched = await vault.read('wiki/Crna_tabla.md');
  assert.match(patched, /Novi sadržaj odeljka\./);
  assert.doesNotMatch(patched, /Zajednička memorija sistema/);
  assert.match(patched, /title: Crna tabla/, 'frontmatter ostaje netaknut');
  assert.match(patched, /updated:/);

  const afterFirstPatch = await vault.read('wiki/Crna_tabla.md');
  await client.callTool('obsidian_patch_note', { path: 'wiki/Crna_tabla.md', section: 'Nove napomene', content: '- prva' });
  const appended = await vault.read('wiki/Crna_tabla.md');
  assert.match(appended, /## Nove napomene\n\n- prva/);
  assert.ok(appended.length > afterFirstPatch.length, 'novi odeljak povećava belešku');
  assert.ok(original.includes('Zajednička memorija sistema'), 'kontrola: original je netaknut u memoriji testa');
  await vault.cleanup();
});

test('MCP: patch sa create=false odbija nepostojeći odeljak', async (t) => {
  const vault = await seededVault();
  await makeTask(vault, { id: 'TASK-502', owner: 'consolidator', status: 'verified', artifacts: ['wiki/Crna_tabla.md'] });
  const client = await connect(vault.root, 'consolidator', 'codex', t, { OBSIDIAN_TASK: 'TASK-502' });
  const result = await client.callTool('obsidian_patch_note', { path: 'wiki/Crna_tabla.md', section: 'Ne postoji', content: 'x', create: false });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /ne postoji/);
  await vault.cleanup();
});

// --------------------------------------------------------------- granice

test('MCP: putanje van vault-a i van zona su odbijene', async (t) => {
  const vault = await seededVault();
  const client = await connect(vault.root, 'consolidator', 'codex', t);
  for (const bad of ['../izvan.md', '/etc/passwd', 'tools/orchestrator/lib/config.mjs', '.worktrees/x.md']) {
    const read = await client.callTool('obsidian_read_notes', { path: bad });
    assert.equal(read.isError, true, `čitanje ${bad} mora biti odbijeno`);
    const write = await client.callTool('obsidian_write_note', { path: bad, content: 'x' });
    assert.equal(write.isError, true, `upis ${bad} mora biti odbijen`);
  }
  await vault.cleanup();
});

test('MCP: nepoznat alat vraća grešku, ne ruši server', async (t) => {
  const vault = await seededVault();
  const client = await connect(vault.root, 'readonly', 'test', t);
  const result = await client.callTool('nepostojeci_alat', {});
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /nepoznat alat/);
  const after = await client.callTool('obsidian_vault_info');
  assert.equal(after.isError, false);
  await vault.cleanup();
});

test('MCP: CLI režim radi bez pokrenutog Obsidiana', async () => {
  const vault = await seededVault();
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const run = promisify(execFile);
  const env = { ...process.env, OBSIDIAN_VAULT: vault.root, OBSIDIAN_ROLE: 'verifier', OBSIDIAN_AGENT: 'dsh' };

  const info = await run(process.execPath, [SERVER, 'info'], { env });
  assert.match(info.stdout, /obsidian-mcp/);

  const list = await run(process.execPath, [SERVER, 'list', '--dir', 'wiki'], { env });
  assert.match(list.stdout, /wiki\/Crna_tabla\.md/);

  const search = await run(process.execPath, [SERVER, 'search', 'agenti', '--limit', '5'], { env });
  assert.match(search.stdout, /wiki\/Izvori_znanja\.md/);

  const lint = await run(process.execPath, [SERVER, 'lint'], { env });
  assert.match(lint.stdout, /grešaka: \d+/);

  // Upis u raw/ se odbija; sadržaj ide iz fajla da proces ne čeka na stdin.
  await vault.write('sadrzaj.tmp', 'zlonamerni sadrzaj');
  await assert.rejects(
    () => run(process.execPath, [SERVER, 'write', 'raw/x.md', '--content-file', path.join(vault.root, 'sadrzaj.tmp')], { env }),
    (error) => /nepromenljiva/.test(error.stderr),
  );
  await vault.cleanup();
});
