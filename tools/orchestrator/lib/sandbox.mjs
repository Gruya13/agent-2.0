/**
 * Docker sandbox za izvršavanje nepoverljivih skripti (red-team reprodukcije).
 *
 * Kontejner: read-only rootfs, bez mreže, bez host HOME-a; jedini upisiv put je
 * privremeni klon mountovan kao `/work` (i tmpfs `/tmp`). Skripte koje pišu u
 * klon rade; ništa drugo ne mogu. Ako Docker ili slika nisu dostupni, pozivalac
 * pada na bwrap (vidi `reproduce.mjs`).
 */
import { spawn } from 'node:child_process';

export const SANDBOX_IMAGE = process.env.AGENT_2_0_SANDBOX_IMAGE ?? 'agent2-sandbox:latest';

function izvrsi(command, args, { timeoutMs = 120_000 } = {}) {
  return new Promise((resolve) => {
    const started = Date.now();
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const finish = (code, error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        code,
        stdout,
        stderr: error ? `${stderr}\n${error.message}` : stderr,
        timedOut,
        durationMs: Date.now() - started,
      });
    };
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
      finish(null, null);
    }, timeoutMs);
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', (error) => finish(null, error));
    child.on('close', (code) => finish(code, null));
  });
}

/** Da li su i Docker daemon i sandbox slika dostupni? */
export async function dockerSandboxDostupan() {
  const info = await izvrsi('docker', ['info', '--format', '{{.ServerVersion}}'], { timeoutMs: 5_000 });
  if (info.code !== 0) return false;
  const slika = await izvrsi('docker', ['image', 'inspect', SANDBOX_IMAGE], { timeoutMs: 5_000 });
  return slika.code === 0;
}

/**
 * Pokreni skript u kontejneru. `workdir` je privremeni klon revizije — jedini
 * put koji kontejner vidi (osim `/tmp`). `payload` je naredba koju je pripremio
 * `reproduce.mjs` (interpreter + marker), pa provera „da li je interpreter
 * startovao“ ostaje ista kao u ostalim režimima.
 */
export async function runInDockerSandbox({ workdir, payload, timeoutMs = 120_000 }) {
  const ime = `agent2-sandbox-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  const args = [
    'run', '--rm', '--name', ime,
    '--network', 'none',
    '--read-only',
    '--tmpfs', '/tmp:rw,size=64m',
    '--cap-drop', 'ALL',
    '--security-opt', 'no-new-privileges',
    '--pids-limit', '128',
    '--memory', '512m',
    '--user', '1000:1000',
    '-v', `${workdir}:/work:rw`,
    '-w', '/work',
    SANDBOX_IMAGE,
    ...payload,
  ];
  const rezultat = await izvrsi('docker', args, { timeoutMs });
  if (rezultat.timedOut) {
    // Klijent je ubijen; kontejner može da nastavi da visi.
    await izvrsi('docker', ['rm', '-f', ime], { timeoutMs: 5_000 });
  }
  return { ...rezultat, sandbox: 'docker' };
}
