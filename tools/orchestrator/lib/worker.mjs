/**
 * Poziv izolovanog DSH workera iz coding toka.
 *
 * Worker je izvršilac: radi u Docker kontejneru (read-only rootfs, internal
 * mreža, sidecar LLM proxy, bez tajni), menja kod i commit-uje granu; host
 * preuzima granu i NASTAVLJA kapije (testovi, baseline, pregled, merge). Host
 * ne veruje workerovom izveštaju — veruje izvršenim proverama nad njegovom granom.
 *
 * Skripta `spawn-worker.mjs` je vlasnik granice (flags, slika, proxy); ovaj modul
 * je samo adapter: napravi poziv, sačekaj ga, vrati parsiran JSON izveštaj.
 */
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

/** Putanja do spawn-worker skripte; testovi je zamenjuju (fake worker). */
export function workerScript() {
  return process.env.AGENT_2_0_WORKER_SCRIPT ?? path.join(os.homedir(), '.dsh', 'docker', 'spawn-worker.mjs');
}

function izvrsi(script, args, { timeoutMs, signal }) {
  return new Promise((resolve) => {
    const started = Date.now();
    let stdout = '';
    let stderr = '';
    let settled = false;
    const child = spawn(process.execPath, [script, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    const ubij = () => { try { child.kill('SIGKILL'); } catch { /* već mrtav */ } };
    const finish = (code, error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (signal !== undefined) signal.removeEventListener('abort', ubij);
      resolve({
        code,
        stdout,
        stderr: error ? `${stderr}\n${error.message}` : stderr,
        durationMs: Date.now() - started,
      });
    };
    const timer = setTimeout(ubij, timeoutMs + 120_000);
    if (signal !== undefined) {
      if (signal.aborted) ubij();
      else signal.addEventListener('abort', ubij, { once: true });
    }
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', (error) => finish(null, error));
    child.on('close', (code) => finish(code, null));
  });
}

/** Poslednji JSON objekat u stdout-u (spawn-worker ispisuje izveštaj na kraju). */
function poslednjiJson(stdout) {
  const linije = stdout.split('\n').map((l) => l.trim()).filter(Boolean).reverse();
  for (const linija of linije) {
    if (!linija.startsWith('{')) continue;
    try { return JSON.parse(linija); } catch { /* nije JSON linija */ }
  }
  return null;
}

/**
 * Pokreni worker i vrati `{ ok, status, branch, commits, diffStat, report, error, durationMs }`.
 * Nikad ne baca za neuspeh worker-a; pozivalac odlučuje šta dalje.
 */
export async function runWorkerTask({
  repo, base, name, brief, model, timeoutMs = 900_000, logger = () => {}, signal,
}) {
  const script = workerScript();
  const args = [
    '--repo', repo,
    '--task-text', brief,
    '--name', name,
    '--base', base,
    '--timeout', String(Math.ceil(timeoutMs / 1000)),
  ];
  if (model) args.push('--model', String(model));
  logger(`worker: pokrećem ${name} (base ${String(base).slice(0, 12)}, timeout ${Math.round(timeoutMs / 1000)} s)`);
  const r = await izvrsi(script, args, { timeoutMs, signal });
  const izvestaj = poslednjiJson(r.stdout);
  if (r.code !== 0 || !izvestaj || izvestaj.ok !== true) {
    return {
      ok: false,
      status: izvestaj?.status ?? 'failed',
      branch: izvestaj?.branch ?? null,
      commits: izvestaj?.commits ?? [],
      durationMs: r.durationMs,
      exitCode: r.code,
      error: izvestaj?.error ?? (r.stderr.trim().split('\n').slice(-3).join(' | ') || 'worker nije vratio izveštaj'),
      stderr: r.stderr,
    };
  }
  return {
    ok: true,
    status: izvestaj.status ?? 'done',
    branch: izvestaj.branch ?? null,
    commits: izvestaj.commits ?? [],
    diffStat: izvestaj.diffStat ?? '',
    report: izvestaj.report ?? '',
    logPath: izvestaj.logPath ?? null,
    durationMs: r.durationMs,
    exitCode: r.code,
    error: null,
  };
}
