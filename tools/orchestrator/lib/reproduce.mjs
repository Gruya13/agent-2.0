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

/**
 * Does bwrap actually work here? `which` alone lies: the binary can exist while
 * the kernel forbids user namespaces (containers, hardened hosts). The probe is
 * the same operation the sandbox needs, so a failing probe means "do not wrap"
 * instead of "every script is unexecuted".
 */
function bwrapRadi() {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn('bwrap', ['--ro-bind', '/usr', '/usr', '--', '/usr/bin/true'], {
        stdio: 'ignore', timeout: 1500,
      });
    } catch { resolve(false); return; }
    child.on('error', () => resolve(false));
    child.on('close', (code) => resolve(code === 0));
  });
}

const SKRIPT_RE = /(^|\/)NALAZ-[^/]*\.(sh|py)$/i;

/** Da li fajl izgleda kao reprodukcioni skript? */
export function isReproductionScript(rel) {
  return SKRIPT_RE.test(rel);
}

/**
 * Izolacija izvršavanja kad je dostupna: `bwrap` daje klonu sopstveni korisnički
 * prostor (samo klon upisiv, mreža isključena). Bez njega se skript izvršava kao
 * običan proces u klonu — i to je u dokumentaciji označeno kao rizik.
 */
/** Marker koji ispisuje sam interpreter, pre nego što pokrene skript. */
const POKRENUT = '__AGENT2_INTERPRETER_POKRENUT__';

/**
 * Naredba koja pokreće skript tako da se iz izlaza vidi da li je interpreter
 * uopšte startovao. Bez markera se "sandbox je pukao pre skripta" ne razlikuje
 * od "skript je izašao bez nalaza", a pogadjanje po tekstu izlaza je pogrešno:
 * skript koji sam ispiše `bwrap: …` nije neizvršena provera.
 */
function pokretac(interpreter, ime) {
  // Marker se ispisuje tek kad je telo skripta uspesno ucitano (Python: compile
  // pre markera; bash: `bash -n` pre markera). Sintaksna greska u skriptu tako
  // ostaje NEIZVRSENA provera, a ne "lazni nalaz" koji otvara kapiju.
  // Marker se sastavlja u izvršavanju, a ne stoji kao literal u izvoru: inače
  // bi ga traceback (npr. Python SyntaxError) ispisao i lažno dokazao da je
  // provera pokrenuta.
  if (interpreter === 'python3') {
    // Skript se pokreće kao `python3 <ime>` iz klona: `sys.argv[0]` je ono što
    // je zadato, a `__file__` je APSOLUTAN (Python >= 3.9). `exec` sa
    // eksplicitnim globals-ima to postavlja tačno; `runpy.run_path` bi ostavio
    // relativan `__file__`, pa skript koji ga koristi pada i greška se lažno
    // broji kao nalaz bez osnova.
    return ['python3', '-c',
      [
        'import os, sys',
        'ime = sys.argv[1]',
        'sys.argv = [ime]',
        "src = open(ime, 'rb').read()",
        "code = compile(src, ime, 'exec')",
        "print('__AGENT2' '_INTERPRETER' '_POKRENUT__', flush=True)",
        "exec(code, {'__name__': '__main__', '__file__': os.path.abspath(ime), 'builtins': __builtins__, '__builtins__': __builtins__, '__spec__': None, '__package__': None, '__cached__': None, '__loader__': None})",
      ].join('\n'),
      ime];
  }
  // Isto za bash: skript se pokreće kao datoteka (`exec bash "$0"`), pa je
  // `$0` tačan; `bash -n` proverava sintaksu pre markera.
  return ['bash', '-c',
    `M='__AGENT2''_INTERPRETER''_POKRENUT__'; bash -n "$0" || exit 2; printf '%s\\n' "$M"; exec bash "$0"`,
    ime];
}

function omotaj(bwrap, klon, ime, interpreter) {
  const payload = pokretac(interpreter, ime);
  if (!bwrap) return { command: payload[0], args: payload.slice(1) };
  return {
    command: 'bwrap',
    args: [
      '--ro-bind', '/usr', '/usr',
      '--ro-bind', '/lib', '/lib',
      '--ro-bind-try', '/lib64', '/lib64',
      '--ro-bind-try', '/bin', '/bin',
      '--ro-bind', '/etc', '/etc',
      '--proc', '/proc', '--dev', '/dev', '--tmpfs', '/tmp',
      '--bind', klon, klon,
      '--chdir', klon,
      '--unshare-pid', '--unshare-net', '--die-with-parent',
      '--', ...payload,
    ],
  };
}

function runProcess(command, args, { cwd, timeoutMs, env }) {
  return new Promise((resolve) => {
    const started = Date.now();
    // Sopstvena procesna grupa: skript red-teama često pokreće podprocese, a na
    // isteku vremena mora da se prekine celo stablo — inače `sleep` drži cevi
    // otvorene i „prekid" se ne dogodi do prirodnog kraja.
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, ...(env ?? {}) },
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
      // Proces nije ni pokrenut (nema izvršnog fajla ili sandboxa): to nije
      // isto kao skript koji je izašao bez nalaza.
      resolve({ code: null, failed: true, stdout, stderr: `${stderr}\n${error.message}`, timedOut, durationMs: Date.now() - started });
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
  repoRoot, revision, worktreeDir, scripts, max = 3, timeoutMs = 60_000, bwrap = null,
}) {
  const sandbox = bwrap ?? (await bwrapRadi() ? 'bwrap' : null);
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
      const { command, args } = omotaj(sandbox, klon, ime, interpreter);
      const r = await runProcess(command, args, {
        cwd: klon,
        timeoutMs,
        // Bez bwrap-a skript vidi pravi $HOME; dajemo mu privremeni da bar ne
        // piše u korisničke fajlove.
        env: sandbox ? {} : { HOME: tmp },
      });
      const izlaz = `${r.stdout}\n${r.stderr}`.trim();
      const prijavio = /OBORENO/i.test(r.stdout);
      // Sandbox koji je pukao nije „lažni nalaz": bwrap se prekida pre nego što
      // pokrene interpreter (npr. zabranjen AF_NETLINK socket), pa izlaz nije
      // sud o tvrdnji. Takav rezultat je NEIZVRŠENA provera (invarijanta 24).
      // Odluka se ne donosi po tekstu izlaza, nego po markeru interpreterа.
      const izvrsen = r.failed !== true && r.code !== null && !r.timedOut && izlaz.includes(POKRENUT);
      rezultati.push({
        script: rel,
        exitCode: r.code,
        executed: izvrsen,
        timedOut: r.timedOut,
        durationMs: r.durationMs,
        // Reprodukovano = skript je oborio tvrdnju I to napisao. Sam izlazni kod
        // nije dovoljan: skript koji greškom izađe sa 0, a ništa ne obori, ne
        // sme da blokira spajanje.
        reproduced: r.code === 0 && !r.timedOut && prijavio,
        reported: prijavio,
        output: izlaz.replace(POKRENUT, '').trim().slice(-2000),
      });
    } catch (error) {
      // Ni klon ni skript nisu napravljeni: neizvršena provera, ne lažni nalaz.
      rezultati.push({ script: rel, reproduced: false, reported: false, executed: false, error: error.message, output: '' });
    } finally {
      await fs.rm(tmp, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    }
  }
  return rezultati;
}
