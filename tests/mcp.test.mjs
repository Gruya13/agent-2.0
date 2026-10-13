import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { makeVault } from './helpers/vault.mjs';
import { PACKAGE_ROOT } from '../tools/orchestrator/lib/config.mjs';
import { writeNote } from '../tools/orchestrator/lib/vault.mjs';

const SERVER = path.join(PACKAGE_ROOT, 'tools', 'mcp', 'obsidian-mcp.mjs');

/** Minimalni MCP klijent preko stdio — testira pravi protokol, ne interne funkcije. */
async function connect(vaultRoot, role, agent = 'test', t = null) {
  const child = spawn(process.execPath, [SERVER], {
    cwd: vaultRoot,
    env: { ...process.env, OBSIDIAN_VAULT: vaultRoot, OBSIDIAN_ROLE: role, OBSIDIAN_AGENT: agent },
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

  const callTool = async (name, args = {}) => {
    const response = await call('tools/call', { name, arguments: args });
    return response.result;
  };

  await call('initialize', { protocolVersion: '2024-11-05' });
  const close = () => { try { child.kill(); } catch { /* već mrtav */ } };
  // Čak i ako tvrdnja padne usred testa, proces servera se gasi.
  if (t) t.after(close);
  return { call, callTool, close, getStderr: () => stderr };
}

async function seededVault() {
  const vault = await makeVault();
  const now = '2025-01-01T00:00:00.000Z';
  await writeNote(vault.root, 'wiki/Crna_tabla.md', {
    frontmatter: { title: 'Crna tabla', created: now, updated: now, authors: ['researcher'], status: 'consolidated', tags: ['arhitektura'] },
    body: '# Crna tabla\n\nZajednička memorija sistema. Vidi [[Izvori znanja]].\n',
  });
  await writeNote(vault.root, 'wiki/Izvori_znanja.md', {
    frontmatter: { title: 'Izvori znanja', created: now, updated: now, authors: ['researcher'], status: 'consolidated', tags: ['agenti'] },
    body: '# Izvori znanja\n\nAgenti nad [[Crna tabla]].\n',
  });
  return vault;
}

test('MCP: initialize i tools/list izlažu ugovorene alate', async (t) => {
  const vault = await seededVault();
  const client = await connect(vault.root, 'readonly', t);
  const response = await client.call('tools/list', {});
  const names = response.result.tools.map((t) => t.name);
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
  client.close();
  await vault.cleanup();
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
  client.close();
  await vault.cleanup();
});

test('MCP: zone upisa se sprovode po ulozi', async (t) => {
  const vault = await seededVault();
  const cases = [
    { role: 'researcher', allowed: ['wiki/drafts/Nacrt.md'], denied: ['wiki/Produkcija.md', 'raw/x.md', 'tasks/reviews/R.md'] },
    { role: 'verifier', allowed: ['tasks/reviews/R.md'], denied: ['wiki/Produkcija.md', 'wiki/drafts/Nacrt.md', 'raw/x.md'] },
    { role: 'consolidator', allowed: ['wiki/Produkcija.md'], denied: ['raw/x.md', 'tasks/inbox/TASK-001.md'] },
    { role: 'readonly', allowed: [], denied: ['wiki/Produkcija.md', 'wiki/drafts/Nacrt.md', 'tasks/reviews/R.md'] },
  ];
  // Svaka uloga je zaseban proces: identitet i zona se fiksiraju u env-u pri spawn-u.
  for (const entry of cases) {
    const c = await connect(vault.root, entry.role, entry.role, t);
    for (const allowed of entry.allowed) {
      const result = await c.callTool('obsidian_write_note', { path: allowed, content: '# proba\n' });
      assert.equal(result.isError, false, `${entry.role} mora moći da piše u ${allowed}: ${result.content[0].text}`);
    }
    for (const denied of entry.denied) {
      const result = await c.callTool('obsidian_write_note', { path: denied, content: '# proba\n' });
      assert.equal(result.isError, true, `${entry.role} ne sme da piše u ${denied}`);
      assert.match(result.content[0].text, /error:/);
    }
    // Patch poštuje ista pravila.
    const patchDenied = await c.callTool('obsidian_patch_note', { path: entry.denied[0], section: 'X', content: 'y' });
    assert.equal(patchDenied.isError, true, `patch u ${entry.denied[0]} mora biti odbijen za ${entry.role}`);
    // Čitanje je dozvoljeno svima u zonama znanja.
    const read = await c.callTool('obsidian_read_notes', { path: 'wiki/Crna_tabla.md' });
    assert.equal(read.isError, false);
    c.close();
  }
  await vault.cleanup();
});

test('MCP: patch menja samo zadati odeljak', async (t) => {
  const vault = await seededVault();
  const client = await connect(vault.root, 'consolidator', 'codex', t);
  const original = await vault.read('wiki/Crna_tabla.md');

  await client.callTool('obsidian_patch_note', { path: 'wiki/Crna_tabla.md', section: 'Crna tabla', content: 'Novi sadržaj odeljka.' });
  const patched = await vault.read('wiki/Crna_tabla.md');
  assert.match(patched, /Novi sadržaj odeljka\./);
  assert.doesNotMatch(patched, /Zajednička memorija sistema/);
  assert.match(patched, /title: Crna tabla/, 'frontmatter ostaje netaknut');
  assert.match(patched, /updated:/);

  // Dodavanje novog odeljka na kraj.
  const afterFirstPatch = await vault.read('wiki/Crna_tabla.md');
  await client.callTool('obsidian_patch_note', { path: 'wiki/Crna_tabla.md', section: 'Nove napomene', content: '- prva' });
  const appended = await vault.read('wiki/Crna_tabla.md');
  assert.match(appended, /## Nove napomene\n\n- prva/);
  assert.ok(appended.length > afterFirstPatch.length, 'novi odeljak povećava belešku');
  assert.ok(original.includes('Zajednička memorija sistema'), 'kontrola: original je netaknut u memoriji testa');
  client.close();
  await vault.cleanup();
});

test('MCP: patch sa create=false odbija nepostojeći odeljak', async (t) => {
  const vault = await seededVault();
  const client = await connect(vault.root, 'consolidator', 'codex', t);
  const result = await client.callTool('obsidian_patch_note', { path: 'wiki/Crna_tabla.md', section: 'Ne postoji', content: 'x', create: false });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /ne postoji/);
  client.close();
  await vault.cleanup();
});

test('MCP: putanje van vault-a i van zona su odbijene', async (t) => {
  const vault = await seededVault();
  const client = await connect(vault.root, 'consolidator', 'codex', t);
  for (const bad of ['../izvan.md', '/etc/passwd', 'tools/orchestrator/lib/config.mjs', '.worktrees/x.md']) {
    const read = await client.callTool('obsidian_read_notes', { path: bad });
    assert.equal(read.isError, true, `čitanje ${bad} mora biti odbijeno`);
    const write = await client.callTool('obsidian_write_note', { path: bad, content: 'x' });
    assert.equal(write.isError, true, `upis ${bad} mora biti odbijen`);
  }
  client.close();
  await vault.cleanup();
});

test('MCP: nepoznat alat vraća grešku, ne ruši server', async (t) => {
  const vault = await seededVault();
  const client = await connect(vault.root, 'readonly', t);
  const result = await client.callTool('nepostojeci_alat', {});
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /nepoznat alat/);
  // Server i dalje odgovara.
  const after = await client.callTool('obsidian_vault_info');
  assert.equal(after.isError, false);
  client.close();
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
  const tmpContent = path.join(vault.root, 'sadrzaj.tmp');
  await vault.write('sadrzaj.tmp', 'zlonamerni sadrzaj');
  await assert.rejects(
    () => run(process.execPath, [SERVER, 'write', 'raw/x.md', '--content-file', tmpContent], { env }),
    (error) => /nepromenljiva/.test(error.stderr),
  );
  await vault.cleanup();
});
