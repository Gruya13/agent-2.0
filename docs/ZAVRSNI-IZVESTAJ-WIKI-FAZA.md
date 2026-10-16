# Završni izveštaj — zaštita wiki memorije i zaokruživanje slojeva

[Dokumentacija](README.md) · [Putanje i matrica](WIKI-ZASTITA-I-POKRIVENOST.md) · [Dokazi ogleda](dokazi-wiki/ogledi/) · [Uputstvo](PORUKA-ZA-DSH-WIKI-I-ZAVRSNA-PROVERA.md)

Datum: 16. oktobar 2026.

## 1. Revizija i model poverenja

| | |
|---|---|
| Polazna revizija (uputstvo) | `95d2b4a` |
| Završna revizija | `6081944` |
| Testni skup | **186/186**, dva uzastopna izvođenja |
| Okruženje | Node v26.8.2, Git 2.55.0, Linux |

**Model poverenja (ograničen):** podržani **lokalni režim**, jedan OS korisnik.
Kontrolni sloj i MCP nisu OS izolacija; proces istog korisnika može direktno da
menja fajlove. Tvrdi se: nijedan *podržani* tok ne publikuje tuđe znanje tiho i
nijedan neuspeh nije prikriven. **Potpuna sigurnost nije dokazana.**

## 2. Status: faza ZAVRŠENA (uz otvorena ograničenja u odeljku 6)

Sve stavke iz odeljka 7 uputstva imaju dokaz ili poimenično iskazan nedostatak.
Nezavisna provera je izvršena u **tri runde**; poslednja relevantna korekcija
(symlink granica) ima potvrdu.

## 3. Potvrđeni nalazi i minimalne korekcije

Svaki nalaz je prvo potvrđen testom koji je **pao na neispravnom kodu**.

| # | Nalaz | Dokaz (pre) | Korekcija |
|---|---|---|---|
| 1 | Coding zapis komituje **tuđu** wiki belešku (`git add -A -- wiki`) | W1 pao | komituje tačno `wiki/Izmene/<ID>.md` |
| 2 | Knjigovodstvo pre merge-a komituje **cela stabla** | W2 pao | `mergeIntoMain` prima `bookkeepingPaths`; bez njih ne komituje ništa |
| 3 | CLI `ready` grubo `['tasks','wiki']` | isti obrazac | ide kroz `pipeline.commitBookkeeping` (allow-lista) |
| 4 | Neuspeh wiki zapisa se **guta** (`consolidated`, `ok:true`) | W4 pao, Codex `code-failure` | `memory_write_error` + događaj; zadatak `verified`; ponavlja se samo zapis |
| 5 | Neuspeo pokušaj ostavlja **granu** i `implement` | W6 pao | grana se briše; `implement` tek pri uspehu |
| 6 | Zapis **prepisuje postojeću** belešku | Codex `code-collision` | marker + odbijanje (`MEMORY_PATH_TAKEN`) |
| 7 | **Oštećen/nestao manifest** tiho uspostavlja novu osnovu | W9 pao, Codex `manifest-*` | ako je manifest postojao u istoriji — greška, bez nove osnove |
| 8 | **Tuđ validan kontrolni koren** odobrava upis (MCP) | W8 (MCP) pao | skladište mora biti u tom korenu |
| 9 | Isto zaobilazeno **symlink-om** unutar tuđeg korena | Codex `linked-vault` | porede se **realne** putanje (`fs.realpath`) |
| 10 | `init` komituje **tuđi** fajl u `.agents/` | W10 pao | komituje tačno ugovor (`AGENTS.md`, `roles/<uloga>.md`) i alat |
| 11 | Instrukcija u sadržaju ne sme da proširi opseg | W5 (kontrola) | opseg ostaje iz zadatka |

## 4. Nezavisne provere (Codex, nit `verify`)

| Runda | Kandidat | Log | Ishod |
|---|---|---|---|
| 1 | `7c524e7` | `codex-mval8c1o-1399b8b5` | potvrđeno 5 tvrdnji; **oboreno 3** (manifest, tuđi koren, init) |
| 2 | `9f61db8` | `codex-mvalg62q-4ffdf942` | manifest ✓, init ✓; tuđi koren **oboren preko symlink-a** |
| 3 | `6081944` | `codex-mvannjey-574ee75b` | symlink granica ✓ (5 varijanti), artefakti ogleda ✓; jedan **semantički** nalaz otvoren |

Puni odgovori: [codex-finalni-pregled.md](dokazi-wiki/codex-finalni-pregled.md),
[codex-potvrda-tri-nalaza.md](dokazi-wiki/codex-potvrda-tri-nalaza.md),
[codex-zavrsna-provera.md](dokazi-wiki/codex-zavrsna-provera.md).
U rundo 1 je Codex bio bez kvote; prekid je zabeležen, a njegovi scenariji su
sačuvani ([codex-parcijalno](dokazi-wiki/codex-parcijalno/)).

## 5. Realni povezani ogledi (revizija `6081944`)

| Ogled | Rezultat | Dokaz |
|---|---|---|
| **A — coding sa wiki memorijom** | **uspešno**: `main @ 3c7cf7cd`; reviewer `codex` `pass`; `review.sha = accept.reviewed = 428a7ec6…`; u ciljni repo ušla samo `src/range.js`, `tests/range-zero.test.js`; projektni `MEMORY.md` nedirnut; zapis `wiki/Izmene/TASK-101.md` | [A-coding.log](dokazi-wiki/ogledi/A-coding.log) |
| **B — dokumentni unos do objave** | **blokiran (legitimno)**: 9 poziva, 24 min; challenge `reproducible`, verifikacija `fail` 3×, `blocked` („nacrt odbijen 4 puta“); nema produkcione beleške ni zakupa | [B-dokumentni.log](dokazi-wiki/ogledi/B-dokumentni.log) |
| **C — ekstrakcija malog PDF-a** | **ekstrakcija uspešna**: fragment nosi `700000`, Bluetooth, PipeWire, Bubblewrap, OSTree, ChromeOS; konsolidacija **odbijena** jer je konsolidator ciljao `wiki/tabela.md` van deklarisanog artefakta (zonska kapija radila) | [C-fragment.md](dokazi-wiki/ogledi/C-fragment.md), [C-pdf.log](dokazi-wiki/ogledi/C-pdf.log) |
| **D — audit u preciznom opsegu** | **uspešno**: librarian menjao samo `wiki/Flatpak.md` (u opsegu), verifikacija `pass`, challenge `clean`, revizorski merge `main @ 416aa59f` | [D-audit.log](dokazi-wiki/ogledi/D-audit.log) |
| **E — prekid i nastavak** | **pokriveno**: W6 (neuspeo pokušaj ne ostavlja granu, `implement` ni zakup; nastavak prolazi) | `tests/wiki-integrity.test.mjs` |

Codex je u trećoj rundi sam klonirao sve vault-ove i potvrdio da su sačuvani
zadaci **bajt-identični** klonovima i da nema aktivnih zakupa.

## 6. Otvorena ograničenja

1. **Semantički kriterijum red-team nalaza (ogled B)**: reprodukovani NALAZ-1
   dokazuje odsustvo reči u jednoj rečenici, ne nužno promenu značenja. Kapija je
   ispravno blokirala po svom pravilu, ali **opravdanost tog kriterijuma ostaje
   spor** i nije menjan u ovoj fazi.
2. **TOCTOU prozori**: race prozor pred `git merge` u coding prihvatanju;
   konkurentna zamena putanje između provere i upisa u MCP; `stat`→`rm` u
   `withFileLock`. Nijedan nije nazvan zatvorenim.
3. **MCP** je proveren stvarnim stdio protokolom iz testova, ali ne živim
   harnes klijentom u produkcionom okruženju.
4. **`init` komituje `tools/`** namerno (radna stabla moraju imati alat);
   operatorska komanda, ne agentska putanja.
5. Ogled C pokazuje da konsolidator može izabrati ime produkcione beleške koje
   ne odgovara deklarisanom artefaktu — kapija to odbija, ali tok tada staje bez
   objave.

## 7. Prva akcija za nastavak

Nema blokirajućeg nalaza. Sledeći korak je zadatak iz odeljka 7 uputstva:
**jedan mali stvarni bug u zasebnom postojećem projektu** korisnika, sa unapred
definisanim zahtevom i opsegom; zatim nezavisan pregled tog rezultata.
Preporučeno je da se pre toga razreši spor iz odeljka 6.1 (kriterijum red-team
nalaza), jer on određuje koliko će tok stajati na semantičkim nalazima.
