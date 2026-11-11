# Izolovane kopije DSH-a (worker)

Worker je jednokratna kopija DSH-a koja radi u Docker kontejneru i vraća
commit na sopstvenoj grani. Orkestrator je jedini koji spaja; worker nikad ne
vidi pravi repozitorijum, host home, internet, Docker socket ni tajne.

Dokument opisuje arhitekturu, granicu i način provere. Uputstvo za upotrebu je
u `~/.dsh/docker/README.md`; ugovor worker-a je `~/.dsh/roles/worker.md`.

## Zašto

Rad u `git worktree`-u izoluje promene Git sadržaja, ali ne daje OS zabranu
pristupa drugim fajlovima: proces istog korisnika vidi sve što korisnik vidi.
Worker to menja — agent dobija jedno okruženje sa tačno jednim ulazom (brief),
jednim izlazom (git grana) i jednim servisom (LLM proxy).

## Topologija

```
host                                          docker
──────────────────────────────────────────────────────────────────────────────
spawn-worker.mjs
  ├─ bare single-branch mirror  ──────────────►  /export   (rw, jedini git kanal)
  ├─ runs/<id>/work/            ──────────────►  /work     (svež klon, rw)
  ├─ runs/<id>/brief/           ──────────────►  /brief    (ro)
  ├─ runs/<id>/worker.log       ◄──────────────  stdout (NDJSON)
  ├─ docker logs / proxy.jsonl  ◄── dsh-worker-proxy
  │                                  │ 172.20.0.10:8765
  │                                  └─ dsh-edge (egress) ─► api.deepseek.com
  └─ dsh-workers (internal)  ◄───────┴──── worker kontejneri (nema egressa)
```

Mreže su namerno dve: `dsh-workers` je `internal` (nema rute ka svetu), a
`dsh-edge` je obična bridge mreža koju ima **samo** proxy kontejner. Proxy je
jedini proces sa pravim DeepSeek ključem i jedini izlaz ka modelu.

## Tok jednog runa

1. `spawn-worker.mjs` napravi bare mirror (`git clone --bare --single-branch`).
2. Napravi brief (`/brief/task.md`): role ugovor + zadatak + metadata.
3. Osigura da sidecar proxy radi (i mreže postoje).
4. Podigne worker kontejner sa `/work`, `/brief`, `/export` i LLM proxyjem.
5. Entrypoint klonira `/export` u `/work`, checkoutuje granu, pokrene DSH.
6. Worker radi, commit-uje. Entrypoint pushuje granu u `/export`.
7. `spawn-worker` fetchuje granu u pravi repo, vrati JSON (`branch`, `commits`,
   `diffStat`, `report`, `logPath`).
8. Orkestrator pregleda `git diff <base>..agent/worker/<name>` pa spaja ili
   odbija run.

## Granica

| Sloj | Mehanizam |
|---|---|
| rootfs | `--read-only`, `--tmpfs /tmp:noexec`, `--tmpfs /home/node/.dsh` |
| proces | uid 1000, `--cap-drop=ALL`, `no-new-privileges`, `--pids-limit 512`, `--memory 2g`, `--cpus 2`, `--init` |
| mreža | `internal` mreža; jedino dostupno je proxy na `172.20.0.10:8765` |
| tajne | worker dobija `DEEPSEEK_API_KEY=worker-proxy`; pravi ključ drži proxy |
| git | worker vidi jednu granu u mirroru; ne vidi pravi repo, druge grane ni `.git` hosta |
| pluginovi | worker profil montira samo `dsh-base` + `dsh-headless`; nema MCP, web, terminal |
| native cache | `NARB_DISABLE_NATIVE_CACHE=1` — binding se čita iz read-only slike |

Ovaj poslednji uslov nije stilski: bez njega loader kopira `.node` u tmpfs i
`dlopen` padne sa „failed to map segment from shared object“ pod `--read-only`.
Otkrio ga je `verify.mjs`, pa je uslov deo ugovora, a ne slučajna konfiguracija.

## Uloge i nezavisnost

Worker je **izvršilac, ne verifikator**: to je kopija istog modela, pa nema
nezavisnosti. Verifikuje drugi vendor (`agy`) u slepoj `*-verify` niti, uz
determinističke provere (test-lock, evidence, linter). Orkestrator ne menja
testove i ne prihvata diff bez pregleda.

## Provera

```bash
node ~/.dsh/docker/verify.mjs
```

Proverava: slika postoji; proxy sidecar radi i ima ključ; kontejner je uid 1000;
host home nije vidljiv; Docker socket nije montiran; rootfs je read-only;
`/tmp` je writable; worker doseže proxy ali ne internet; `--dry-run` drži
granicu; e2e run napravi commit i očekivani fajl.

## Ograničenja

- Docker deli kernel; nije granica protiv kernel exploita (rootless/gVisor su
  sledeći korak, ne sadašnja tvrdnja).
- Worker ne dobija MCP; zadaci koji traže kontrolni vault trebaju novu odluku o
  sandboxu (read-only glavni vault + upis samo u worktree).
- Paralelno najviše 3 workera, na disjunktnim granama/fajlovima.
- `docker` CLI mora biti dostupan orkestratoru na hostu; orkestrator ne ide u
  kontejner (socket u kontejneru bio bi beg iz njega).
