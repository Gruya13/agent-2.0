# Dokazi — Korak 4: odbijanje, povratak na korekciju i brojač pokušaja

[Dokumentacija](README.md) · [Preporuke za dalji razvoj](../Agent-2.0-Preporuke-za-dalji-razvoj.md) · [K1](DOKAZI-KORAK-1.md) · [K2](DOKAZI-KORAK-2.md) · [K3](DOKAZI-KORAK-3.md)

Datum: 14. oktobar 2026.
Revizija na početku koraka: `ccab6d7`.
Cilj: „poznata greška zaustavlja objavljivanje, nalaz ostaje vidljiv, pokušaji se
broje po jasno definisanom pravilu, a ispravljen artefakt može proći bez
prikrivanja istorije“.

## 1. Ogled: verifikacija obara dokazivu grešku (stvarni harnes)

Dokaz je iz Koraka 3, gde je **pravi** verifikator (`dsh`) odbio nacrt sa dva
nalaza koja se mogu proveriti komandom:

| Nalaz | Tvrdnja nacrta | Zašto je oborena |
|---|---|---|
| N1 (red 18) | nacrt je „evidentiran u centralnom indeksu [[Index]]“ | `grep -n "Flatpak" wiki/Index.md` → nema pogodaka. **Preciznije:** `renderIndex` preskače sam indeks i fragmente, ali ne filtrira sve nacrte — za fizički prisutne nacrte beleži i status `draft`. Zato ovaj konkretan nalaz važi za tadašnje stanje, ali se **ne** sme generalizovati na „indeks sadrži samo consolidated beleške“. |
| N2 (red 23) | aplikacije se pokreću „u potpunoj izolaciji“ | jače od izvora (L7: „in isolation“) i protivreči tvrdnji 2 istog nacrta o dozvolama za Bluetooth, zvuk, mrežu i fajlove |

Verdikt prvog prolaza: `VERDICT: fail / REASONS: 2`. Posle ispravke istraživača
verifikator je izričito potvrdio da su **oba nalaza otklonjena** i dao
`VERDICT: pass` (`tasks/reviews/TASK-103.md`). Time je dokazano i da ispravljen
artefakt može proći, i da istorija nije prikrivena.

## 2. Ogled: neispravan rezultat ne ulazi u main

Isti tok, konsolidacija: grana konsolidatora je pored nove beleške menjala i
**postojeću** produkcionu belešku `wiki/Operativni_vodic_asinhronog_sistema.md`
(samo polje `updated`). Kapija spajanja je odbila merge:

```text
[agentctl] consolidate: TASK-103 -> KONFLIKT/ODBIJENO (grana menja zone van dozvole: wiki/Operativni_vodic_asinhronog_sistema.md)
```

Zadatak je otišao u `blocked`, ništa nije objavljeno, a izlaz iz blokade je
zabeležen (vidi K3, odeljak 5). Ovo je dokaz da kapija zaustavlja i **delimično**
ispravan rezultat, ne samo očigledno pogrešan.

## 3. Ogled: nalaz red-teama mora da se vrati AUTORU (defekt i ispravka)

- Postupak: mock red-team koji uvek daje reproduktivan nalaz
  (`AGENT_2_0_MOCK_CHALLENGE=fail`), pa kontrolna petlja `run({rounds: 8})`.
- Stvarni rezultat **pre** ispravke:

```text
research:ok -> verify:ok -> challenge:reproducible -> verify:ok -> challenge:reproducible
-> verify:ok -> challenge:reproducible -> verify:ok
```

Istraživač se pojavljuje **samo jednom** (prvi prolaz). Posle svakog nalaza
zadatak ide u `review`, a `review` je red **verifikatora** (`runOnce` vezuje fazu
`verify` za status `review`), dok istraživač radi isključivo iz `ready` —
`runResearch` je odbio rad sa porukom
`TASK-101 nije u stanju ready (review)`. Zadatak se zato samo vrti između
`verify` i `challenge` i na kraju blokira, **bez ijedne ispravke nacrta**.
- Ispravka: posle reproduktivnog/neizvršenog nalaza zadatak se otpušta u `ready`
  (isto kako se ponaša i odbijen nacrt u fazi `verify`).
- Stvarni rezultat **posle** ispravke:

```text
research:ok -> verify:ok -> challenge:reproducible -> research:ok -> verify:ok
-> challenge:reproducible -> research:ok -> verify:ok
```

Istraživač dobija priliku posle **svakog** nalaza, pa zahtev „ispravljen
artefakt može proći“ ima put kroz sistem. Regresioni test
`E2E: posle red-team nalaza autor dobija priliku da ispravi nacrt`.

## 4. Ogled: brojač pokušaja iz review istorije

- Pravilo u kodu: `attempts = history.filter(h => h.status === 'review').length`
  (pipeline, faze `verify` i `challenge`); kada `attempts > maxRevisions` zadatak
  ide u `blocked`.
- Stvarni tok (mock, `maxRevisions = 2`):

| Korak | Akcija | Status | `review` u istoriji | Prijavljeni pokušaj |
|---|---|---|---|---|
| 1 | research | review | 1 | — |
| 2 | verify fail | ready | 1 | 1 |
| 3 | research | review | 2 | — |
| 4 | verify pass | verified | 2 | — |
| 5 | challenge reproducible | ready (pre ispravke: review) | 3 | 2 |

- **Značenje (tačan izraz):** brojač je `history.filter(h => h.status === 'review').length`
  — broj **zapisa** u istoriji kojima je status `review`, a ne broj stvarnih
  ulazaka u to stanje. Istorija može sadržati ponovljene statuse (npr. dva uzastopna
  zapisa sa istim statusom), pa se te dve vrednosti ne poklapaju u svim uslovima.
  Brojač zato treba čitati kao približan pokazatelj, a ne kao garantovan broj
  pokušaja; pravilo je zapisano ovim izrazom, bez jačeg obećanja.

## 5. Ogled: reprodukcija čuva svoju reviziju

U istom toku (`TASK-103`) kontrolni sloj je u zadatak upisao
`challenge.revision: e926c2408b63ba2ece86a1e848c7863c16be1978` i pokrenuo
`NALAZ-1.sh` i `NALAZ-2.sh` u **svežem klonu te revizije**; oba su bila lažni
nalazi (`falsePositives: 2`) i nisu blokirala spajanje, uz zabeležen korelacioni
rizik (verifikator i red-team dele `dsh`).

## 6. Nalazi

| Oznaka | Nalaz | Vrsta po odeljku 9 | Odluka |
|---|---|---|---|
| N16 | Posle red-team nalaza zadatak se vraćao u `review` (red verifikatora), pa istraživač **nikad** nije mogao da ispravi nacrt; petlja se vrtela `verify↔challenge` do blokade | sprečava da dogovoreni scenario završi | **popravljeno** (`ready`), sa regresionim testom |
| N17 | Brojač pokušaja je izveden iz ulazaka u `review`, što nije isto što i broj odbijanja | nepotvrđena sumnja / dokumentacija | **zapisano** pravilo (odeljak 4) |
| N15 | Red-team i verifikator dele vendor | ograničenje podržanog režima | zabeleženo u zadatku |

## 7. Zaključak

- **Potvrđeno:** verifikacija obara dokazivu grešku (stvarni nalazi N1/N2 sa
  komandama), neispravan rezultat ne ulazi u `main` (kapija je odbila granu),
  nalaz ostaje vidljiv u zadatku i u `tasks/reviews/`, a ispravljen artefakt
  prolazi bez prikrivanja istorije.
- **Popravljeno u ovom koraku:** putanja ispravke posle red-team nalaza (N16).
- **Preostalo:** brojač pokušaja ostaje približan (N17) — nije menjan jer bi
  uvođenje posebnog brojača odbijanja bilo nova mehanika; pravilo je zapisano.
- Skup posle izmene: **141 prolaz, 0 padova**, dva uzastopna izvođenja.
