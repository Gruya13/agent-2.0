# Coding zadatak koji koristi wiki memoriju

[Wiki kao memorija](MEMORIJA-I-CODING.md) · [Prvi coding prolaz](CODING-PROLaz-1.md) · [Dokazi](dokazi-k9/)

Datum: 15. oktobar 2026.
Kontrolna revizija: **`0602f52`**. Ciljni repo: `/home/gru/k9-target-5`
(osnova `0afb8215b4d6393a20aede67337da93d0d8c7513`).
Trajanje: 10:38:51 → 10:42:05 (**3 min 14 s**), **2 model poziva**.

## 1. Memorija koja ulazi u zadatak

U bazi znanja kontrolnog vault-a stoji beleška
`wiki/Konvencije/Kod.md` (status `consolidated`, autor `operator`):

> - **Nula je validna vrednost**, nikad odsustvo vrednosti: provera ide preko
>   `Number.isNaN`, ne preko istinitosti (`||`).
> - Regresioni test za granične vrednosti ide u fajl **`tests/granice.test.js`**.
> - Postojeći testovi se ne menjaju i ne preskaču.

Zadatak je otvoren sa `--memory wiki/Konvencije/Kod.md`. Kontrolni sloj je pre
poziva programera izvezao memoriju u radno stablo ciljnog repoa kao
`MEMORY.md` (502 B, zapisano u `code_evidence.memory`), **samo za čitanje**.

## 2. Dokaz da je memorija stvarno korišćena

Konvencija iz memorije je **merljiva u ishodu**: regresioni test je nazvan tačno
onako kako memorija nalaže.

| | Bez memorije (prolaz K9, `8a7f837`) | Sa memorijom (ovaj prolaz) |
|---|---|---|
| Ime regresionog testa | `tests/range-zero.test.js` | **`tests/granice.test.js`** |
| Dokaz u evidenciji | — | `code_evidence.memory.notes = ['wiki/Konvencije/Kod.md']`, `bytes = 502` |

Isti harnes (`dsh`), isti zahtev, isti fixture — razlika je u tome što je
zadatak dobio memoriju.

## 3. Proverena izmena koda

| Korak | Ishod |
|---|---|
| reprodukcija na osnovi | `bash /home/gru/k9-repro.sh` → **exit 1** (`BUG: from = null`) |
| izmena (programer `dsh`) | `src/range.js`, `tests/granice.test.js`; opseg `outside: []` |
| provera posle popravke | `npm test` → **exit 0**; repro → **exit 0** |
| regresioni test na osnovi | **exit 1** (kontrolni sloj izveo dokaz 1) |
| nezavisan pregled (`agy`) | **`VERDICT: pass`**, sopstveni scenario u `tasks/reviews/TASK-101-review/` |
| prihvatanje | merge u `main` ciljnog repoa → `6cd4a66b…`, tag `dokaz/TASK-101-accept` |

U ciljni repozitorijum su ušla **samo dva fajla**:

```
git -C /home/gru/k9-target-5 diff --name-only 0afb8215 HEAD
src/range.js
tests/granice.test.js
```

`MEMORY.md` **nikad nije bio u istoriji ciljnog repoa**
(`git log --all -- MEMORY.md` je prazan): prvi prolaz sa memorijom ga je nosio u
merge, što je nađeno i ispravljeno u `0602f52`.

## 4. Kako se ishod vraća u memoriju

Posle prihvatanja kontrolni sloj upisuje `wiki/Izmene/TASK-101.md` i komituje ga:

```
94f671a agentctl: zapis o izmeni TASK-101 u memoriju
```

Zapis nosi frontmatter (`authors: [agentctl, dsh, agy]`, `status: consolidated`,
oznake `izmena, code, TASK-101`), zahtev, ishod (repo, osnova, popravka, merge,
izmene) i dokaze (reprodukcija, provera, test na osnovi, nezavisan pregled,
korišćena memorija). **Piše ga `agentctl`, ne radni agent.**

## 5. Zaštite wiki-ja su ostale

| Zaštita | Dokaz |
|---|---|
| `lib/scope.mjs` (opseg, globovi) | `git diff 480db23 0602f52 -- lib/scope.mjs` → prazno |
| `zonePolicyFor` i allow-lista u `mergeIntoMain` | nepromenjeni; `BOOKKEEPING_ALLOW` proširena **samo** na `tasks/reviews/` |
| `ROLE_ARTIFACT_ZONE` | dodate su dve nove uloge (`programer`, `reviewer`); postojeće zone netaknute |
| `raw/` + manifest izvora | nepromenjeni |
| pristup radnog agenta wiki-ju | nema ga: `code_scope` važi za ciljni repo, `MEMORY.md` je van opsega i uklanja se pre komita |

Radni agent je u ovom prolazu menjao isključivo `src/range.js` i
`tests/granice.test.js` ciljnog repoa; u kontrolnom repou nije menjao ništa.

## 6. Ograničenja

1. Nezavisan pregled je obavio `agy` (Codex je bio bez kvote); nezavisnost od
   autora je zadovoljena, ponavljanje Codex-om ostaje otvoreno.
2. „Korišćenje memorije“ je dokazano **posredno** — imenom testa koje memorija
   nalaže i sadržajem `MEMORY.md` u radnom stablu. Nije merено da li je model
   pročitao svaku liniju.
3. Beleška-konvencija je u ovom ogledu napisana ručno (operator); tok kojim
   memorija sama nastaje iz iskustva (reflect nad izmenama) nije predmet ovog
   dokaza.
