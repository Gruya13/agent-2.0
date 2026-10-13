/**
 * Harness adapteri: jedini deo sistema koji stvarno izvršava spoljni model.
 *
 * Svaki adapter ima isti ugovor:
 *   run({ prompt, cwd, timeoutMs, env }) -> {
 *     ok, exitCode, output, durationMs, command, timedOut, stderr
 *   }
 *
 * Ništa se ne "veruje na reč": `ok` zavisi isključivo od izlaznog koda procesa.
 * Odluku da li je posao uspešan donosi kontrolni sloj nad artefaktima.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { withFileLock } from '../fsx.mjs';

export class HarnessError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'HarnessError';
    Object.assign(this, details);
  }
}

/**
 * Deklarativni opis komandi. `dsh` i `codex` su neinteraktivni režimi iz
 * arhitekture; `agy` je print režim istog SDK-a koji stoji iza Antigravity.
 */
export const HARNESS_COMMANDS = {
  dsh: {
    bin: 'dsh',
    build: (prompt) => ['--profile', 'headless', prompt],
    note: 'DeepSeek Harness, headless profil: jedan zadatak, jedan strukturisani odgovor.',
  },
  codex: {
    bin: 'codex',
    build: (prompt, cwd) => ['exec', '--sandbox', 'workspace-write', '-C', cwd, prompt],
    note: 'OpenAI Codex, neinteraktivno izvršavanje sa izolacijom radnog prostora.',
  },
  agy: {
    bin: 'agy',
    build: (prompt, cwd) => ['--print', '--dangerously-skip-permissions', '--add-dir', cwd, prompt],
    note: 'Google Antigravity (Gemini), print režim; nikad se ne poziva u paraleli.',
    serialized: true,
  },
};

function runProcess(command, args, { cwd, env, timeoutMs, onSpawn }) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;

    if (typeof onSpawn === 'function') onSpawn(child);

    const timer = timeoutMs > 0
      ? setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
        setTimeout(() => child.kill('SIGKILL'), 5_000).unref();
      }, timeoutMs)
      : null;

    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

    const finish = (code, error) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve({
        exitCode: code,
        stdout,
        stderr: error ? `${stderr}\n${error.message}` : stderr,
        timedOut,
        durationMs: Date.now() - started,
        command: `${command} ${args.map((a) => (a.length > 60 ? `${a.slice(0, 60)}…` : a)).join(' ')}`,
      });
    };

    child.on('error', (error) => finish(null, error));
    child.on('close', (code) => finish(code, null));
  });
}

/**
 * Izvrši harnes. `agy` je globalno serijalizovan (jedan proces u datom trenutku),
 * jer Antigravity ne trpi paralelne sesije.
 */
export async function runHarness(harness, { prompt, cwd, timeoutMs = 15 * 60 * 1000, env = {}, config } = {}) {
  const spec = HARNESS_COMMANDS[harness];
  if (!spec) throw new HarnessError(`nepoznat harness "${harness}"`);
  const bin = env.AGENT_2_0_BIN ?? spec.bin;
  const args = spec.build(prompt, cwd);
  const exec = () => runProcess(bin, args, { cwd, env, timeoutMs });

  let result;
  if (spec.serialized) {
    const lockRoot = config?.paths?.locks ?? path.join(cwd, '.locks');
    result = await withFileLock(path.join(lockRoot, `harness-${harness}.lock`), exec, { timeoutMs: timeoutMs + 30_000 });
  } else {
    result = await exec();
  }

  if (result.errno === 'ENOENT' || /ENOENT/.test(result.stderr ?? '')) {
    throw new HarnessError(`harnes "${harness}" nije instaliran (${bin})`, { harness, bin });
  }
  return {
    ok: result.exitCode === 0 && !result.timedOut,
    exitCode: result.exitCode,
    output: result.stdout.trim(),
    stderr: result.stderr.trim(),
    durationMs: result.durationMs,
    command: result.command,
    timedOut: result.timedOut,
    harness,
  };
}

/** Izvuci mašinski čitljiv verdikt iz izlaza verifikatora. */
export function parseVerdict(output) {
  const matches = [...String(output).matchAll(/^VERDICT:\s*(pass|fail)\s*$/gim)];
  if (!matches.length) return { verdict: null, reasons: null };
  const verdict = matches[matches.length - 1][1].toLowerCase();
  const reasonsMatch = /^REASONS:\s*(\d+)\s*$/im.exec(output);
  return { verdict, reasons: reasonsMatch ? Number.parseInt(reasonsMatch[1], 10) : null };
}
