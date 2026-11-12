# agent2-sandbox

Izolovani kontejner za izvršavanje **nepoverljivih reprodukcionih skripti**
(red-team nalazi). Koristi ga `agentctl` kroz `lib/sandbox.mjs` kada je
`pipeline.challengeSandbox: docker` (uključeno u `agents.real.yml`).

```bash
./build.sh    # docker build -t agent2-sandbox:latest .
```

| ograničenje | vrednost |
|---|---|
| rootfs | read-only (`--read-only`) |
| mreža | `--network none` |
| upisivi putevi | mountovan klon kao `/work:rw` i tmpfs `/tmp` (64 MB) |
| privilegije | `--cap-drop ALL`, `--security-opt no-new-privileges` |
| resursi | `--pids-limit 128`, `--memory 512m` |
| korisnik | `1000:1000` (ne-root) |
| sadržaj | `node:26.8.2-slim` + `bash`, `python3`, `git`, `ca-certificates` |

Kontejner ne vidi host `HOME`, `~/.dsh`, `~/.ssh` ni bilo koji drugi put osim
klona revizije. Ako Docker ili slika nisu dostupni, `reproduce.mjs` pada na
`bwrap`, pa na host.
