/**
 * Izvršavanje reprodukcionih skripti red-teama.
 *
 * Pravilo iz ugovora: nalaz blokira spajanje **samo ako je reproduktibilan**.
 * Zato kontrolni sloj ne veruje izveštaju, nego uzme skript koji je red-team
 * napisao i pokrene ga u svežem klonu **zamrznute revizije**. Skript koji ne
 * uspe da obori tvrdnju je lažni nalaz i tako se i broji.
 *
 * BEZBEDNOSNA NAPOMENA: ovim se izvršava kod koji je napisao model, pod
 * korisničkim nalogom koji pokreće kontrolni sloj. Zato se izvršava u
 * privremenom klonu (ne u glavnom radnom stablu), sa ograničenim vremenom i
 * ograničenim brojem skripti, i može se isključiti preko
 * `pipeline.challengeExecute: false`. To je svesna odluka, ne slučajnost.
 */
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { git } from './git.mjs';

const SKRIPT_RE = /NALAZ-.*\.(sh|py)$/i;

/** Da li fajl izgleda kao reprodukcioni skript? */
export function isReproductionScript(rel) {
  return SKRIPT_RE.test(rel);
}

function runProcess(command, args, { cwd, timeoutMs }) {
  return new Promise((resolve) => {
    const started = Date.now();
    // Sopstvena procesna grupa: skript red-teama često pokreće podprocese, a na
    // isteku vremena mora da se prekine celo stablo — inače `sleep` drži cevi
    // otvorene i „prekid" se ne dogodi do prirodnog kraja.
    const child = spawn(command, args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const killTree = (signal) => {
      try {
        if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, signal);
        else child.kill(signal);
      } catch {
        try { child.kill(signal); } catch { /* već mrtav */ }
      }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      killTree('SIGKILL');
    }, timeoutMs);
    child.stdout.on('data', (c) => { stdout += c.toString(); });
    child.stderr.on('data', (c) => { stderr += c.toString(); });
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ code: null, stdout, stderr: `${stderr}\n${error.message}`, timedOut, durationMs: Date.now() - started });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut, durationMs: Date.now() - started });
    });
  });
}

/**
 * Pokreni skripte u svežem klonu `repoRoot` na `revision`.
 * Vraća po skriptu: `{ script, reproduced, exitCode, timedOut, output }`.
 */
export async function runReproductionScripts({
  repoRoot, revision, worktreeDir, scripts, max = 3, timeoutMs = 60_000,
}) {
  const odabrani = scripts.slice(0, max);
  const rezultati = [];
  for (const rel of odabrani) {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'agent2-repro-'));
    const klon = path.join(tmp, 'repo');
    try {
      await git(tmp, ['clone', '--quiet', '--no-local', repoRoot, klon]);
      await git(klon, ['checkout', '--quiet', revision]);
      const ime = path.basename(rel);
      await fs.copyFile(path.join(worktreeDir, rel), path.join(klon, ime));
      const interpreter = ime.toLowerCase().endsWith('.py') ? 'python3' : 'bash';
      const r = await runProcess(interpreter, [ime], { cwd: klon, timeoutMs });
      const izlaz = `${r.stdout}\n${r.stderr}`.trim();
      rezultati.push({
        script: rel,
        exitCode: r.code,
        timedOut: r.timedOut,
        durationMs: r.durationMs,
        // Reprodukovano = skript je uspeo da obori tvrdnju (izlazni kod 0) i to
        // je i napisao. Kod koji padne ili istekne ne blokira spajanje.
        reproduced: r.code === 0 && !r.timedOut,
        output: izlaz.slice(-2000),
      });
    } catch (error) {
      rezultati.push({ script: rel, reproduced: false, error: error.message, output: '' });
    } finally {
      await fs.rm(tmp, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    }
  }
  return rezultati;
}
