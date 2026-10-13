/**
 * Fajl-sistemski pomoćnici: atomski upisi, šetnja stablon, JSONL append,
 * hashiranje i bezbedno razrešavanje putanja unutar zadatog korena.
 */
import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

/** Atomski upis: piši u privremeni fajl u istom direktorijumu pa `rename`. */
export async function writeFileAtomic(file, content) {
  const dir = path.dirname(file);
  await fs.mkdir(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(file)}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`);
  try {
    await fs.writeFile(tmp, content, 'utf8');
    await fs.rename(tmp, file);
  } catch (error) {
    await fs.rm(tmp, { force: true });
    throw error;
  }
  return file;
}

export async function readText(file) {
  return fs.readFile(file, 'utf8');
}

export async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

export async function isDirectory(dir) {
  try {
    return (await fs.stat(dir)).isDirectory();
  } catch {
    return false;
  }
}

/** Sortirana rekurzivna lista relativnih putanja svih fajlova pod `root`. */
export async function walkFiles(root, options = {}) {
  const { filter = () => true, skipDirs = ['.git', 'node_modules', '.worktrees', '.runtime'] } = options;
  const out = [];
  async function visit(dir) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.') && entry.name !== '.agents') {
        if (skipDirs.includes(entry.name)) continue;
      }
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (skipDirs.includes(entry.name)) continue;
        await visit(full);
      } else if (entry.isFile()) {
        const rel = path.relative(root, full).split(path.sep).join('/');
        if (filter(rel)) out.push(rel);
      }
    }
  }
  await visit(root);
  return out.sort();
}

/**
 * Razreši relativnu putanju unutar korena i odbij svaki izlazak iz njega
 * (`..`, apsolutne putanje). Vraća normalizovanu apsolutnu putanju.
 */
export function resolveInside(root, relative) {
  if (typeof relative !== 'string' || !relative.trim()) throw new Error('putanja je obavezna');
  if (path.isAbsolute(relative)) throw new Error(`apsolutna putanja nije dozvoljena: ${relative}`);
  const clean = path.normalize(relative.replace(/^[/\\]+/, ''));
  if (clean === '.' || clean === '..' || clean.startsWith(`..${path.sep}`)) {
    throw new Error(`putanja izlazi iz korena: ${relative}`);
  }
  const base = path.resolve(root);
  const full = path.resolve(base, clean);
  if (full !== base && !full.startsWith(base + path.sep)) {
    throw new Error(`putanja izlazi iz korena: ${relative}`);
  }
  return full;
}

export function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** Hash BAJTOVA, ne dekodiranog teksta: binarni izvori (.pdf, .png) moraju biti
 *  proverljivi. `readFile(..., 'utf8')` bi različite bajtove sveo na isti
 *  U+FFFD, pa bi izmena binarnog fajla prošla neprimećeno. */
export function sha256Bytes(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

export async function sha256File(file) {
  return sha256Bytes(await fs.readFile(file));
}

/**
 * Realna putanja najdubljeg postojećeg pretka + ostatak putanje.
 * Koristi se za odbranu od simboličkih linkova: leksička provera (`..`) ne vidi
 * da `wiki/drafts/link -> raw` vodi van zone upisa.
 */
export async function realpathDeepest(target) {
  const missing = [];
  let probe = path.resolve(target);
  for (;;) {
    try {
      const real = await fs.realpath(probe);
      return path.join(real, ...missing.slice().reverse());
    } catch (error) {
      if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error;
      const parent = path.dirname(probe);
      if (parent === probe) throw error;
      missing.push(path.basename(probe));
      probe = parent;
    }
  }
}

/** Razreši `full` kroz simboličke linkove i vrati relativnu putanju u odnosu na `root`. */
export async function realRelativeTo(root, full) {
  const realRoot = await fs.realpath(path.resolve(root)).catch(() => path.resolve(root));
  const real = await realpathDeepest(full);
  const relative = path.relative(realRoot, real);
  return { realRoot, real, relative: relative.split(path.sep).join('/'), escapes: relative === '..' || relative.startsWith(`..${path.sep}`) };
}

/** Baci grešku ako `full` (kroz linkove) izlazi iz `root`. */
export async function assertRealInside(root, full, { label = 'putanja' } = {}) {
  const resolved = await realRelativeTo(root, full);
  if (resolved.escapes) {
    throw new Error(`${label} izlazi iz korena preko simboličkog linka: ${full} -> ${resolved.real}`);
  }
  return resolved;
}

/** Dopuni JSONL tok jednim zapisom (append-only; nikad se ne prepisuje). */
export async function appendJsonl(file, record) {
  const line = `${JSON.stringify(record)}\n`;
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.appendFile(file, line, 'utf8');
  return record;
}

export async function readJsonl(file) {
  let text;
  try {
    text = await fs.readFile(file, 'utf8');
  } catch {
    return [];
  }
  const out = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      out.push(JSON.parse(trimmed));
    } catch {
      out.push({ _malformed: trimmed });
    }
  }
  return out;
}

/**
 * Međuprocesni mutex nad fajlom. `fs.open(..., 'wx')` je atomska operacija na
 * POSIX-u, pa je to jedini pouzdan način da dva procesa ne uđu u kritičnu
 * sekciju istovremeno. Držanje je ograničeno `staleMs` da zaglavljen proces ne
 * blokira sistem zauvek.
 */
export async function withFileLock(lockFile, fn, options = {}) {
  const { staleMs = 30_000, retryMs = 25, timeoutMs = 10_000 } = options;
  const deadline = Date.now() + timeoutMs;
  await fs.mkdir(path.dirname(lockFile), { recursive: true });

  let handle;
  for (;;) {
    try {
      handle = await fs.open(lockFile, 'wx');
      await handle.writeFile(JSON.stringify({ pid: process.pid, at: new Date().toISOString() }), 'utf8');
      break;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      let stale = false;
      try {
        const info = JSON.parse(await fs.readFile(lockFile, 'utf8'));
        const age = Date.now() - Date.parse(info.at ?? 0);
        stale = (Number.isFinite(age) && age > staleMs) || !isProcessAlive(info.pid);
      } catch {
        stale = true;
      }
      if (stale) {
        await fs.rm(lockFile, { force: true });
        continue;
      }
      if (Date.now() > deadline) {
        throw new Error(`nije moguće zaključati ${path.basename(lockFile)} u zadatom roku`);
      }
      await new Promise((resolve) => setTimeout(resolve, retryMs));
    }
  }

  try {
    return await fn();
  } finally {
    await handle.close().catch(() => {});
    await fs.rm(lockFile, { force: true }).catch(() => {});
  }
}

export function toPosix(p) {
  return p.split(path.sep).join('/');
}

/**
 * Da li proces još postoji? Zaglavljen lock mrtvog procesa ne sme da blokira
 * sistem do isteka `staleMs`.
 */
export function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}
