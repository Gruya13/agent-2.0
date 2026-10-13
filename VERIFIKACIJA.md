# Nezavisna verifikacija

Ovaj dokument beleži kako je implementacija proveravana **od strane drugog
vendora**, sa slepim ulazom, i šta je tim proverama oboreno. Nalaz bez dokaza se
ne prihvata; svaki nalaz ispod ima komandu ili test koji ga potvrđuje.

## Metod

- **Verifikator:** OpenAI Codex (`codex` CLI), u odvojenoj `codex-verify` niti —
  nije video reasoning izvršioca ni zaključke orkestratora, samo specifikaciju
  (`raw/arhitektura-…md`), ugovor (`.agents/AGENTS.md`), artefakt (repo) i spisak
  **falsifikabilnih tvrdnji**.
- **Izolacija:** verifikator je radio u sopstvenom `git worktree`-u
  (`~/.agent-worktrees/verify-*`), glavni radni direktorijum nije menjan.
- **Dokaz:** za svaku tvrdnju je pisao **sopstveni** skript ili test i vraćao
  komandu, očekivano i dobijeno. Kontraprimer je obarao tvrdnju.
- **Odluka:** `VERDICT: pass|fail` + broj razloga.

## Runda 1 — `dcd56bb`

| # | Nalaz | Ishod |
|---|---|---|
| 1 | Manifest izvora hashira `readFile(..., 'utf8')`, pa izmena **binarnog** izvora (`0x80 → 0x81`) prolazi neprimećeno | potvrđen |
| 2 | Simbolički link `wiki/drafts/link -> raw` omogućava upis van zone | potvrđen |
| 3 | Konsolidator može da menja `wiki/Index.md` (izveden artefakt kontrolnog sloja) | potvrđen |
| 4 | Konsolidator bez zadatka, zakupa i pečata upisuje `wiki/Unverified.md` | potvrđen |

Verdikt: `fail`, 4 razloga.

## Runda 2 — `4c808ca`

| Nalaz iz runde 1 | Ishod |
|---|---|
| 2, 3, 4 | **oboreni** (verifikator je ponovio iste kontraprimere i oni više ne prolaze) |
| 1 (novi manifest v2) | oboren za v2; **ostaje** pri migraciji iz v1 |

Novi nalazi:

| # | Nalaz | Ishod |
|---|---|---|
| 5 | v1 manifest (hash teksta) nad binarnim fajlom: `index` pretvara izmenu u novu osnovu | potvrđen |
| 6 | Zadatak sa `artifacts: []` otvara produkciju za „bilo koju" belešku | potvrđen |
| 7 | `OBSIDIAN_TASK_ROOT` na prazan direktorijum ukida zahtev za zadatkom | potvrđen |

Pozitivna kontrola: legitiman tok (pečat + živ zakup + odgovarajući artefakt) je
prolazio i pre i posle izmena.

## Runda 3 — `24b9eaa`

| Nalaz | Ishod |
|---|---|
| 5, 6, 7 | **oboreni** |
| Kontrolni upisi (legitiman tok, skladište bez ugovora, istraživač u svojoj zoni) | prolaze |

Novi nalazi:

| # | Nalaz | Ishod |
|---|---|---|
| 8 | Fajl u `raw/` koji nije pod manifestom (skriveno ime, binarni sadržaj) se menja bez prijave | potvrđen |
| 9 | `consolidator` piše u `wiki/drafts/` jer je ta zona „unutar `wiki/`" | potvrđen |

## Runda 4 — izvršavanje verifikatorovih programa

Četvrti poziv verifikatoru je **odbijen od strane vendora** (filter za
adversarijalno formulisan bezbednosni zadatak), pa je sam nalaz ostao nedovršen.
Umesto novog poziva, izvršeni su **verifikatorovi sopstveni programi provere** iz
te runde (`/tmp/verify-739669-*.py`) nad finalnim commit-om. Logika provere je
njegova; orkestrator je samo runner — što je jače od testa koji je pisao izvršilac.

Rezultati nad `add444d7`:

| Program | Rezultat |
|---|---|
| `verify-739669-mcp.py` (26 adversarialnih i kontrolnih MCP proba) | **26/26** kako je verifikator očekivao, uključujući `new: different agent same role` i `valid lease pass artifact` |
| `verify-739669-raw.py` (5 lokacija izvora: skriveno, ugnježdeno, `node_modules/`, `.runtime/`, `.worktrees/`) | **5/5**: registrovan pod manifestom, nepromenjen → 0, izmenjen (i komitovan) → 2 |
| `verify-739669-plain.py` (skladište bez ugovora) | **5/5**: zone po ulozi prolaze bez zadatka, `raw/` odbijen |

Nalaz 10 (identitet): program je očekivao da **drugi proces iste uloge** ne može
da piše pod tuđim zakupom. Zakup je zato vezan za **identitet harnesa**
(`agy`/`dsh`/`codex`), a ne za ime uloge.

## Zatvaranje nalaza

| Nalaz | Ispravka | Gde je dokaz |
|---|---|---|
| 1 | manifest v2 hashira **bajtove** (`sha256Bytes`) | `tests/lint.test.mjs`: „izmena BINARNOG izvora…" |
| 2 | zona se proverava na **realnoj** putanji (`realpathDeepest`) | `tests/mcp.test.mjs`: „simbolički link ne može…" |
| 3 | spisak zaštićenih izvedenih artefakata | `tests/mcp.test.mjs`: „izvedeni artefakti… su zaštićeni" |
| 4 | upis zahteva zadatak + živ zakup + pečat (`OBSIDIAN_TASK`) | `tests/mcp.test.mjs`: „upis bez zadatka, sa isteklim zakupom…" |
| 5 | v1 zapis se nadograđuje samo kada je osnova uporediva; inače `raw.legacy-unknown` | `tests/lint.test.mjs`: „v1 manifest ne sme tiho…" |
| 6 | produkcija zahteva **deklarisan** artefakt (prazna lista ne otvara ništa) | `tests/mcp.test.mjs`: slučaj 6 |
| 7 | odluka o obaveznosti zadatka vezana za **skladište**, ne za env | `tests/mcp.test.mjs`: „kontrolni koren se ne može zaobići…" |
| 8 | `raw/` se skenira **bez preskakanja** direktorijuma (osim `.git`) | `tests/lint.test.mjs`: „skriveni fajl u `raw/`…" |
| 9 | zone su ortogonalne: `consolidator` → vrh `wiki/`, nikad `drafts/` | `tests/mcp.test.mjs`: „zone su ortogonalne…" |
| 10 | zakup je vezan za identitet harnesa | `tests/mcp.test.mjs`: slučaj 7 („uljez") |

## Završno stanje

```bash
node --test tests/                                    # 87 testova, 0 padova
node tools/orchestrator/cli.mjs lint                  # 0 grešaka, 0 upozorenja
node tools/orchestrator/cli.mjs status                # 0 zadataka, grana main
node scripts/demo.mjs                                 # ceo petofazni tok, lint 0
```

Pravi harnesi su provereni i direktno, kroz adapter (`runHarness`):

| Harnes | Poziv | Rezultat |
|---|---|---|
| `dsh` | `dsh --profile headless "<prompt>"` | `ok=true`, exit 0, 2.2 s |
| `codex` | `codex exec --sandbox workspace-write -C <cwd> "<prompt>"` | `ok=true`, exit 0, 9.1 s |
| `agy` | `agy --dangerously-skip-permissions --add-dir <cwd> --print="<prompt>"` | `ok=true`, exit 0, 8.0 s |

`agy` je pritom otkrio i stvarnu grešku u prvobitnoj integraciji: `--print` je
flag **sa vrednošću**, pa je odvojen prompt gutao sledeći flag. Oblik je sada
`--print=<prompt>`, a `tests/harness.test.mjs` to čuva od regresije.

## Ograničenje koje ostaje

Verifikator nije mogao da izvrši **kompletan** `node --test tests/` u svom
sandboxu: `spawnSync` iz Node-a vraća `EPERM` (blokada izvršavanja podprocesa),
pa su MCP i CLI testovi (koji pokreću server kao podproces) bili
„neproverljivi", ne „pali". Zato su njegove direktne protokolske provere iz
Python klijenta izvršene ručno i one su merodavan dokaz za MCP sloj; kompletan
test set je posledica izvršena u ovom radnom prostoru (`87/87`).
