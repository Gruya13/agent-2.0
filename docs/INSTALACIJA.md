# Instalacija i prvi koraci

[Dokumentacija](README.md) · [Korišćenje](KORISCENJE.md)

## Zahtevi

| Komponenta | Zahtev |
|---|---|
| Node.js | `>=20`, prema `package.json` |
| Git | dostupan u `PATH`; sistem koristi grane, worktree, rebase i merge |
| npm | za skripte `npm test`, `npm run status` i demo |
| Operativni sistem | Linux/POSIX je ciljno okruženje postojećih skripti |
| Obsidian | opciono, za pregled Markdown baze i grafa |
| `agy`, `dsh` | potrebni samo za uloge sa `adapter: harness` |
| Bash / Python 3 | za reprodukciju `.sh` / `.py` red-team skripti |
| `bwrap` | opciona izolacija reprodukcionih skripti |

Paket nema deklarisane spoljne npm zavisnosti. Kod koristi Node ugrađene module i sopstveni YAML parser. `npm install` nije neophodan za pokretanje komandi preko `node`. Instalacija i prijava kod vendora pripadaju spoljnim CLI alatima i nisu implementirane u ovom projektu.

## Otvaranje postojećeg projekta

```bash
cd '/home/gru/Projects/Agent 2.0'
node --version
git --version
node tools/orchestrator/cli.mjs --help
node tools/orchestrator/cli.mjs version
node tools/orchestrator/cli.mjs doctor
node tools/orchestrator/cli.mjs status
```

`doctor` proverava prisustvo fajlova i izvršnih programa. Ne proverava autentifikaciju, kvotu, dostupnost modela ili punu MCP integraciju. Nedostajući harnesi ne sprečavaju rad sa podrazumevanim `mock` adapterima.

## Bezbedan prvi prolaz

```bash
npm test
node scripts/demo.mjs
```

Demo kopira alate i ugovore u privremeni Git vault, otvara probni zadatak, izvršava research, verify, challenge, consolidate i reflect, pa briše privremeni vault nakon uspeha. Podrazumevano ne menja glavni projekat i ne poziva stvarne modele. Ako demo prekine greška, proveri ispisanu privremenu putanju; završno čišćenje možda nije izvršeno.

`node scripts/demo.mjs --in-place` radi nad ovim repozitorijumom i očekuje `raw/dokument.md`; nije preporučen za prvi probni prolaz. `--real` u demo skripti uključuje stvarne adaptere samo za researcher, verifier i consolidator. Za svih šest stvarnih uloga koristi `agents.real.yml` sa `agentctl`, kako opisuje korisnički vodič.

## Inicijalizacija skladišta

```bash
node tools/orchestrator/cli.mjs init
```

`init` pravi radne direktorijume, uspostavlja Git ako ga nema, obezbeđuje glavnu granu `main`, registruje izvore i regeneriše indeks. To je operacija upisa. U već pripremljenom projektu nije potrebno izvršavati je pri svakom pokretanju.

`--vault` bira drugi koren skladišta, ali `init` ne instalira kompletan projekat niti kopira brief-ove i konfiguracije. Za zaseban vault pripremi `tools/`, `package.json`, `.gitignore`, `.agents/` i konfiguraciju, kao što rade `scripts/demo.mjs` i testni helper. Kopirani `.agents/raw-manifest.json` mora pripadati njegovim stvarnim izvorima; ne preuzimaj manifest tuđeg vault-a kao novu osnovu.

## Prvi sopstveni zadatak

Dodaj novi dokument u `raw/` pod novim imenom. Ne prepisuj već registrovan izvor.

```bash
node tools/orchestrator/cli.mjs ingest raw/moj-izvor.md   --title 'Moja tema' --tag 'tema,dokumentacija'   --request 'Napravi belešku sa proverljivim tvrdnjama i vezama ka postojećoj bazi.'
node tools/orchestrator/cli.mjs run --rounds 10
node tools/orchestrator/cli.mjs list
node tools/orchestrator/cli.mjs lint
```

Zameni putanju stvarnim fajlom. ID novog zadatka preuzmi iz izlaza `ingest`; prvi ID u praznom vault-u je `TASK-101`, dok postojeći projekat nastavlja numeraciju. Uspeh potvrđuju status `consolidated`, beleška u `wiki/`, završni zadatak u `tasks/completed/` i provera lintera. Izlazni kod komande `run` sam po sebi ne potvrđuje uspeh svih faza.
