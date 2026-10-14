# CLI referenca — agentctl

[Dokumentacija](README.md) · [Konfiguracija](KONFIGURACIJA.md)

Ulaz je `node tools/orchestrator/cli.mjs <komanda> [argumenti] [opcije]`. Naziv `agentctl` dostupan je ako je paket povezan ili instaliran tako da se njegov `bin` nalazi u `PATH`; direktni Node oblik ne zahteva tu instalaciju.

## Sve komande

| Komanda | Argumenti / opcije | Efekat |
|---|---|---|
| `help`, `--help`, `-h` | — | pomoć |
| `version` | — | verzija iz paketa |
| `init` | — | direktorijumi, Git/main, manifest, indeks |
| `ingest` | `<raw/fajl>`, title, request, tag, depends, extract/no-extract | otvaranje izvornog zadatka |
| `audit` | `--scope A,B` ili pozicione putanje, title, request, tag | otvaranje revizije baze |
| `list` | `--status S`, `--json` | svi zadaci ili filter statusa |
| `show` | `<TASK-ID>`, `--json` | metapodaci i telo zadatka; JSON vraća metapodatke i fizičku fazu |
| `claim` | `<TASK-ID> --owner IME`, `--ttl MS` | zakup; tekstualni izlaz sadrži token |
| `renew` | `<TASK-ID> --owner IME --token TOKEN`, `--ttl MS` | obnavljanje zakupa |
| `release` | `<TASK-ID> --owner IME --token TOKEN`, `--to STATUS` | otpuštanje; podrazumevano ready |
| `reclaim` | — | opoziv isteklih zakupa i uklanjanje worktree-a |
| `ready` | `<TASK-ID>`, `--reason TEKST` | blocked → ready |
| `override` | `<TASK-ID> --reason TEKST` | zapisano preglasavanje challenge verdikta u clean |
| `phase` | `<extract\|research\|verify\|challenge\|audit\|consolidate> <TASK-ID>`, json | jedna faza |
| `run` | `--rounds N`, `--only FAZA`, json | konačna kontrolna petlja ili jedan ograničeni prolaz |
| `status` | json | zadaci, grana i broj lint nalaza |
| `lint` | json | puni lint nalaz |
| `index` | json | reflect: regeneracija indeksa/manifesta i knjigovodstvo |
| `log` | `--limit N` | Git trag, podrazumevano 20 zapisa |
| `merge-log` | `--limit N` | alias za log, bez posebnog filtriranja merge komita |
| `worktrees` | json | radna stabla, grane i revizije |
| `doctor` | json | pregled okruženja i izabranih adaptera |

`init`, `ingest`, `audit`, komande zakupa, ready, override, phase, run i index upisuju podatke; neke prave i Git komite. Status i lint ne regenerišu indeks.

## Opcije

| Opcija | Značenje |
|---|---|
| `--vault PUTANJA` | apsolutni/relativni koren vault-a; default je koren paketa |
| `--config FAJL` | alternativni YAML, razrešen u odnosu na trenutni shell direktorijum |
| `--json` | strukturisan izlaz u komandama koje ga eksplicitno podržavaju |
| `--title TEKST`, `--request TEKST` | naslov i zahtev unosa/revizije |
| `--tag A,B` | oznake kao lista razdvojena zarezima |
| `--depends TASK-101,TASK-102` | zavisnosti pri ingest-u |
| `--scope A,B` | audit opseg; glob stavi u navodnike |
| `--extract`, `--no-extract` | eksplicitni izbor ekstrakcije; extract ima prednost ako su oba prisutna |
| `--owner IME`, `--token TOKEN` | vlasnik i token zakupa |
| `--ttl MS` | trajanje zakupa u milisekundama |
| `--to STATUS` | ciljno stanje release-a |
| `--reason TEKST` | obrazloženje ready/override; obavezno za override |
| `--rounds N` | maksimalni broj krugova; default iz konfiguracije |
| `--only FAZA` | jedan prolaz faze; bez automatskog reflect-a |
| `--status STATUS` | filter list komande |
| `--limit N` | broj Git zapisa |

Parser ne podržava GNU oblik `--opcija=vrednost`. Koristi `--opcija vrednost`. Logičke zastavice stavi na kraj ili pre druge opcije: parser može sledeći običan argument protumačiti kao vrednost zastavice. `--` završava parsiranje opcija. Nepoznate opcije nisu centralno strogo odbijene, a sve numeričke vrednosti nisu validirane; koristi pozitivne smislene brojeve.

`--json` nije univerzalni format: claim i ingest, na primer, i dalje ispisuju tekst. Na stderr odlaze napredak i greške; za automatizaciju odvoji stdout i stderr.

## Primeri

```bash
node tools/orchestrator/cli.mjs list --status blocked --json
node tools/orchestrator/cli.mjs show TASK-103 --json
node tools/orchestrator/cli.mjs phase verify TASK-103 --json
node tools/orchestrator/cli.mjs audit --scope 'wiki/A.md,wiki/B.md' --title 'Usklađivanje'
node tools/orchestrator/cli.mjs run --only challenge --json
node tools/orchestrator/cli.mjs log --limit 30
node tools/orchestrator/cli.mjs claim TASK-103 --owner operator --ttl 600000
node tools/orchestrator/cli.mjs renew TASK-103 --owner operator --token '<token iz claim>'
node tools/orchestrator/cli.mjs release TASK-103 --owner operator --token '<isti token>' --to ready
```

Ne uzimaj ručni zakup pre standardnog `phase` ili `run`: oni sami uzimaju zakup i neće moći da preuzmu već zauzet zadatak.

## Izlazni kodovi

| Kod | Značenje |
|---|---|
| `0` | komanda završena po njenoj semantici |
| `1` | izuzetak/greška; phase takođe koristi 1 za neuspešan rezultat |
| `2` | lint/status sa lint greškama; nepoznata komanda |

`run` vraća `0` i kada pojedine akcije imaju `ok: false`. `doctor` u tekstualnom režimu vraća `0` i kada ispisuje `FAIL`; JSON režim vraća `1` za neuspelu Git proveru. Za automatizaciju proveri sadržaj rezultata i završni status zadatka.

## npm skripte

```bash
npm test
npm run lint
npm run index
npm run status
npm run demo
```

Dodatne argumente prosledi posle npm separatora, npr. `npm run status -- --json`. `AGENTCTL_DEBUG=1` uključuje stack trace pri grešci.
