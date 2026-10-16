# Zaštita wiki memorije, putanje upisa i pokrivenost slojeva

[Dokumentacija](README.md) · [Provera coding toka](CODING-PROVERA-I-OGLED.md) · [Uputstvo](PORUKA-ZA-DSH-WIKI-I-ZAVRSNA-PROVERA.md)

Datum: 15. oktobar 2026.
Polazna revizija: `95d2b4a`. Ovaj dokument pokriva odeljke 3, 4 i 5 uputstva.

**Model poverenja (ograničen):** sve ispod važi za podržani **lokalni režim** sa
jednim OS korisnikom. Procesi istog korisnika mogu direktno da čitaju i menjaju
fajlove; kontrolni sloj i MCP **nisu** OS izolacija. Prompt zabrana nije OS
granica. Ono što se tvrdi jeste: nijedan *podržani* tok ne menja/publikuje tuđe
znanje tiho i nijedan neuspeh ne ostaje prikriven.

## 1. Putanje upisa (ko menja šta)

| Operacija | Dozvoljeni pisac | Uslov | Tačno šta se piše/komituje | Provera |
|---|---|---|---|---|
| MCP `wiki.write` / `patch` | model kroz svoju ulogu | zadatak + **živ zakup** + zona uloge | putanja unutar zone uloge (`wiki/drafts/`, `wiki/`, `tasks/…`) | `tests/mcp.test.mjs` (19) |
| `researcher` → nacrt | `agy`/mock | `ready`, zakup | `wiki/drafts/*.md` (radna grana) | `pipeline.test.mjs` |
| `consolidator` → produkcija | `codex`/mock | `verified` + čist challenge | `wiki/*.md` iz `artifacts` zadatka | `pipeline.test.mjs` (zone, odbijena konsolidacija) |
| `librarian` → audit | `codex`/mock | `ready`, `audit_scope` | samo postojeće beleške u opsegu | `pipeline.test.mjs`, `scope.test.mjs` |
| `reflect` / `index` | `agentctl` | — | **samo** `wiki/Index.md` + `.agents/raw-manifest.json` | `vault.test.mjs`, `cli.test.mjs`, W3 |
| `commitBookkeeping` | `agentctl` | allow-lista regexa | tačno nabrojane knjigovodstvene putanje; tuđe se **prijavljuje** | `pipeline.test.mjs` |
| `mergeIntoMain` knjigovodstvo pre merge-a | `agentctl` | `bookkeepingPaths` koje zadaje pozivalac | samo prosleđene putanje; bez njih **ništa** | W2 |
| coding zapis u memoriju | `agentctl` | posle prihvaćene promene | **tačno** `wiki/Izmene/<TASK-ID>.md` | W1, W4 |
| coding: radna grana ciljnog repoa | `programer` | zadatak + zakup + `code_scope` | samo putanje u opsegu; `MEMORY.md`/kontekst se ne komituju | `coding.test.mjs`, R5–R8, W5 |
| coding: prihvatanje | `agentctl` | potpuna evidencija + `pass` + tačno pregledan SHA + integraciona proba | pregledan SHA u `main` ciljnog repoa + tag | `coding-robustness.test.mjs` (R1–R19) |
| `init` | `agentctl` (operator) | — | `.gitignore`, `.agents`, `tools`, `package.json` | `cli.test.mjs` |
| `ready` / `retry` | `operator` + `agentctl` | zadatak `blocked` | knjigovodstvo kroz `pipeline.commitBookkeeping` (allow-lista) | `cli.test.mjs`, W2 |
| `raw/` | čovek (append-only) | — | novi izvor + manifest | `lint.test.mjs` (imutabilnost, binarni hash) |

## 2. Matrica zaštite (pozitivna i negativna kontrola)

| Oblast | Dokaz | Test |
|---|---|---|
| zone i identitet | dozvoljeni pisac prolazi; tuđa uloga/vlasnik/token odbijeni | `mcp.test.mjs`, `pipeline.test.mjs` (zone), R4 |
| zakup | istekao/preuzet zakup ne dozvoljava upis ni prihvatanje; obnova radi | `task-store.test.mjs` (16), R2, R15, R16, R19 |
| putanje | `../`, symlink i realna putanja ne zaobilaze granicu | `worktree.test.mjs`, R7, `lint.test.mjs`, **MCP W8** (realpath) |
| izvor | promena teksta/bajtova/brisanje/link se detektuje | `lint.test.mjs` (17) |
| manifest | nedostajući/oštećen manifest nije tiha nova osnova | `lint.test.mjs`, `pipeline.test.mjs` |
| publikacija | nacrt bez važeće provere ne ulazi u produkciju; retry ne širi dozvoljene mete | `pipeline.test.mjs` (odbijena konsolidacija), `coding-robustness.test.mjs` (R3, R14) |
| audit | samo postojeće beleške u preciznom opsegu | `pipeline.test.mjs`, `scope.test.mjs` |
| knjigovodstvo | tuđi prljav fajl ne ulazi u komit, ne briše se | **W1–W3** (novo) |
| zapis u memoriju | postojeća beleška na putanji zapisa se ne prepisuje | **W7** (nalaz Codex scenarija \`code-collision\`) |
| izvedeni indeks | odgovara dogovorenom sadržaju i regeneriše se | `vault.test.mjs`, `cli.test.mjs` |
| dokaz | reference proverljive u svežem klonu; neuspeh čuvanja nije uspeh | `pipeline.test.mjs` (dokaz u klonu), R9, W4 |
| memorija → kod | tačno izabrane beleške se izvoze; projektni fajlovi netaknuti; kontekst se ne objavljuje | `coding.test.mjs` (memorija), R8 |
| kod → memorija | samo prihvaćen rezultat daje zapis; delimičan neuspeh nije lažan uspeh | W4, `coding.test.mjs` |
| prekid i nastavak | neuspeo pokušaj ne ostavlja granu, `implement` ni zarobljen zakup | **W6** |
| sadržaj memorije | instrukcija u sadržaju ne dobija ovlašćenje da menja pravila/opseg | **W5** (novo) |

## 3. Pokrivenost slojeva (šta je stvarno izvršeno)

| Sloj | Tvrdnja | Dokaz | Ograničenje |
|---|---|---|---|
| YAML i konfiguracija | parser, obavezna polja, prelazi zadatka | `yaml.test.mjs` (10), `task-store.test.mjs` (16) | — |
| Fajl operacije, lock, store, tokeni | atomski upis, realne putanje, lock, heartbeat | `task-store.test.mjs`, `fsx` kroz ostale testove | `stat`→`rm` prozor u `withFileLock` (dokumentovan) |
| Git worktree, opseg, merge, dokaz | izolacija, zone, rebase, dokazni tagovi | `worktree.test.mjs` (12), `pipeline.test.mjs`, R9 | race prozor pred `git merge` (dokumentovan) |
| Adapteri procesa | uspeh, greška, timeout, nedostatak binarnog fajla | `harness.test.mjs` (7), R17 | stvarni prekid provajdera nije simuliran |
| MCP protokol | čitanje/upisi po ulogama, zakup | `mcp.test.mjs` (19) | provereno env-simulacijom, ne živim klijentom |
| Dokumentni tok | extract → research → verify → challenge → consolidate | `pipeline.test.mjs` (34) + realni K8/K10 | — |
| Librarian audit | precizan opseg kroz ceo tok | `pipeline.test.mjs`, `scope.test.mjs` | — |
| Coding tok | reprodukcija, baseline assertion, očuvanje testova, pass, pregledan SHA, integracija | `coding.test.mjs` (6), `coding-robustness.test.mjs` (19) | — |
| Wiki memorija | oba smera, granice sadržaja, indeks | `wiki-integrity.test.mjs` (**7**), `vault.test.mjs` (9) | — |
| CLI, init, status, lint, oporavak | komande i nastavak posle prekinute faze | `cli.test.mjs` (11), W6, W10 | — |

Skup: **186 testova** u 15 fajlova (`npm test`, dva uzastopna izvođenja).

Završni izveštaj faze (uključujući prekid zbog kvote provajdera):
[ZAVRSNI-IZVESTAJ-WIKI-FAZA.md](ZAVRSNI-IZVESTAJ-WIKI-FAZA.md).

## 4. Otvorena ograničenja

1. **Race prozor pred `git merge`** u coding prihvatanju: poslednja provera
   grane/osnovice/zakupa i sam merge nisu atomski. Zatvoren za spore upise
   (dokazano), ali nije zatvoren u opštem slučaju.
2. **`stat`→`rm` prozor** u `withFileLock` (nasleđeno iz K2).
3. **MCP** je proveren simulacijom okruženja, ne živim harnes klijentom.
4. **`init` komituje `tools/`** namerno (radna stabla moraju da imaju alat);
   operatorska komanda, ne agentska putanja.
5. Procesi istog OS korisnika mogu direktno da menjaju fajlove — ovo nije OS
   izolacija i ovaj dokument ne tvrdi potpunu sigurnost.