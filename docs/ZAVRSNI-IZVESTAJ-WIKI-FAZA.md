# Završni izveštaj — zaštita wiki memorije i zaokruživanje slojeva

[Dokumentacija](README.md) · [Putanje i matrica](WIKI-ZASTITA-I-POKRIVENOST.md) · [Codex parcijalni dokazi](dokazi-wiki/codex-parcijalno/) · [Uputstvo](PORUKA-ZA-DSH-WIKI-I-ZAVRSNA-PROVERA.md)

Datum: 15/16. oktobar 2026.

## 1. Revizija i model poverenja

| | |
|---|---|
| Polazna revizija (uputstvo) | `95d2b4a` |
| Završna revizija | `9f9afb6` |
| Testni skup | **181/181**, dva uzastopna izvođenja |
| Okruženje | Node v26.8.2, Git 2.55.0, Linux |

**Model poverenja (ograničen):** podržani **lokalni režim**, jedan OS korisnik.
Kontrolni sloj i MCP nisu OS izolacija; proces istog korisnika može direktno da
menja fajlove. Tvrdi se samo: nijedan *podržani* tok ne publikuje tuđe znanje
tiho i nijedan neuspeh nije prikriven. **Potpuna sigurnost nije dokazana.**

## 2. Status faze: DELIMIČNO ZAVRŠENA (prekid zbog kvote provajdera)

Po odeljku 9.E uputstva: **Codex je ostao bez kvote** i agentski pozivi su
zaustavljeni.

- Agent: `codex` (nit `verify`, `mode: full`), zadatak: nezavisna provera
  zaštite wiki-ja i matrice, revizija `7d656cb`.
- Poruka provajdera: `You've hit your usage limit. Upgrade to Pro … or try again
  at Oct 16th, 2026 12:43 AM.`
- Log: [provider-log.log](dokazi-wiki/codex-parcijalno/provider-log.log)
  (`codex-mva09x57-f8207357`, status `failed` posle 48 s).

Codex **nije** stigao da napiše finalni verdikt. Njegovi scenariji su ipak
izvršeni do kraja pre prekida i sačuvani su kao **parcijalan nezavisan dokaz** u
[dokazi-wiki/codex-parcijalno](dokazi-wiki/codex-parcijalno/) (15 modova +
negativna i pozitivna kontrola).

## 3. Potvrđeni nalazi i minimalne korekcije

Svi nalazi su prvo potvrđeni testom koji je **pao na neispravnom kodu**, pa
popravljeni u postojećim modulima (bez novih uloga, servisa ili sloja).

| # | Nalaz | Dokaz (pre) | Korekcija |
|---|---|---|---|
| 1 | Coding zapis u wiki komituje **tuđu** nekomitovanu belešku (`git add -A -- wiki`) | W1 pao | komituje se tačno `wiki/Izmene/<ID>.md` |
| 2 | Knjigovodstvo pre merge-a komituje **cela stabla** (`tasks/wiki/raw`) | W2 pao | `mergeIntoMain` prima `bookkeepingPaths`; bez njih ne komituje ništa |
| 3 | CLI `ready` koristi grubo `['tasks','wiki']` knjigovodstvo | (isti obrazac) | ide kroz `pipeline.commitBookkeeping` (allow-lista) |
| 4 | Neuspeh zapisa u memoriju se **guta**: status `consolidated`, `ok:true` | W4 pao, Codex `code-failure` | `memory_write_error` + događaj; zadatak ostaje `verified`; ponovni pokušaj samo zapisa |
| 5 | Neuspeo pokušaj izrade ostavlja **granu** i `implement` u evidenciji | W6 pao | grana se briše; `implement` se upisuje tek pri uspehu (dijagnostika ostaje u `outside_scope`) |
| 6 | Zapis **prepisuje postojeću** belešku na istoj putanji | Codex `code-collision` (`existing-survives false`) | marker u zapisu; tuđa beleška se ne prepisuje (`MEMORY_PATH_TAKEN`) |
| 7 | Instrukcija u sadržaju ne sme da proširi opseg | W5 (kontrola) | opseg zadatka se ne menja sadržajem memorije |

Novi testovi: `tests/wiki-integrity.test.mjs` (**W1–W7**). Ukupno **181**.

## 4. Autorovi i nezavisni dokazi (odvojeno)

**Autor (dsh) — izvršeno i ponovljivo lokalno:**

- `tests/wiki-integrity.test.mjs` W1–W7; ceo skup 181/181 (2×).
- Negativna kontrola za svaki nalaz: test je padao pre popravke (zabeleženo u
  istoriji komitova `9639409`, `249e08a`, `49e8040`, `9f9afb6`).

**Nezavisno (Codex) — parcijalno, prekinuto kvotom:**

| Scenario | Rezultat (Codex-ov izlaz) |
|---|---|
| `negative.log` | **W1 i W2 padaju na starom kodu** → testovi padaju iz očekivanog razloga |
| `positive.log` | W1 prolazi na kandidatu |
| `code-clean` | ceo coding tok: implement → review `pass` → accept → `consolidated` |
| `code-failure` | `accept ok:false`, status `verified`, greška zapisa zabeležena |
| `code-collision` | **nalaz**: `existing-survives false` (postojeća beleška prepisana) |
| `code-memory` | projektni `MEMORY.md` sačuvan; kontekst u `.agent-context/` |
| `reflect`, `init`, `ready`, `symlink` | bez prijavljene greške |
| `manifest-missing`, `manifest-corrupt` | pokrenuti; zaključak nije napisan (prekid) |
| `retry`, `proof`, `consolidate` | pokrenuti; sadrže `linter`/`ERROR 128` izlaze **bez Codex-ovog zaključka** |

## 5. Šta NIJE urađeno (otvoreno)

1. **Finalni nezavisni verdikt** nad revizijom `9f9afb6` (i nad korekcijom
   nalaza 6) **nedostaje** — kvota. Po odeljku 9.B/9.E to se ne sme
   predstavljati kao potvrđeno.
2. **Realni povezani ogledi iz 6.E nisu izvršeni**: stvarni coding prolaz na
   `9f9afb6`, dokumentni unos do objave, ekstrakcija malog PDF-a/tabele, audit
   nad nekoliko belešaka. Raniji realni ogledi ([K10](dokazi-k10/),
   [K8](DOKAZI-ZAVRSNI-PROLaz.md)) ostaju dokazi **svojih** revizija.
3. **`retry`/`proof`/`consolidate` scenariji** iz Codex-ovog skupa nisu
   protumačeni do zaključka (linter/`ERROR 128` izlazi). Prva akcija za nastavak
   je reprodukovati ih u mirnodopskom okruženju i utvrditi da li prijavljuju
   stvarni problem ili artefakt fixture-a.
4. **Poznata ograničenja** (i dalje otvorena): race prozor pred `git merge` u
   coding prihvatanju; `stat`→`rm` prozor u `withFileLock`; MCP proveren
   simulacijom okruženja, ne živim klijentom; `init` namerno komituje `tools/`.

## 6. Prva akcija za nastavak (tačno)

1. Sačekati povratak kvote (poruka provajdera: **16. oktobar 2026, 00:43**).
2. Poslati Codex-u isti zahtev (odeljak 9.A + 9.C) na **`9f9afb6`**, uz
   [parcijalne dokaze](dokazi-wiki/codex-parcijalno/) i nalaz iz `code-collision`
   koji je on sam prijavio.
3. Zatim izvršiti realne oglede iz 6.E na istoj reviziji i dati ih Codex-u na
   pregled artefakata (9.D).
4. Ako zatreba, nastaviti od reference `refs/heads/main` = `9f9afb6`; radno
   stablo je čisto, nema aktivnih zakupa ni zaostalih grana u kontrolnom repou.

**Ništa nije objavljeno na udaljeni repozitorijum i nijedan override nije
korišćen.** Zadatak je označen kao **nedovršen zbog resursa**, ne kao prolaz.
