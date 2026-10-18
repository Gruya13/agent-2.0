# Runda 19. oktobar 2026 — dopuna ocene

Dodatak uz [PREOSTALI-DOKAZI-IZVESTAJ.md](PREOSTALI-DOKAZI-IZVESTAJ.md), po uputstvu [PORUKA-ZA-DSH-NASTAVAK-19-OKTOBAR.md](PORUKA-ZA-DSH-NASTAVAK-19-OKTOBAR.md).

Revizija: **8968481** · Node **v26.8.2** · testni skup **205/205** (2×) · lint 0/0

---

## 1. Coding/test tok — nova nalaz i ishod

### 1.1 Klasifikacija pada (Node 26) — POTVRĐENO

**Nalaz:** Node 26 podrazumevani runner za grešku učitavanja test fajla ispisuje samo `'test failed'` (bez `AssertionError`). `klasifikujPad` je to davao kao `unknown`, pa regresioni test nije prihvaćen kao dokaz buga.

**Korekcija:** `'test failed'` je sada `error` (greška izvršavanja), a assertion (`ERR_ASSERTION`) se proverava pre tog signala. Kontrolni slučajevi: assertion → `assertion`; TypeError → `error`; `'test failed'` → `error`; `ERR_MODULE_NOT_FOUND` → `error`; timeout → `timeout`; nenulti exit bez signala → `unknown`.

**Nezavisno (Codex, runda `codex-mveea88z`):** pokrenuo je stvarne Node test fajlove — import greška → `classified: error`, assertion → `assertion`, timeout → `timeout`. POTVRĐENO.

### 1.2 Zaostali `git index.lock` posle SIGKILL-a — korekcija čeka potvrdu

**Nalaz:** `git commit` ubijen SIGKILL-om ostavlja `.git/index.lock`; svaki sledeći upis trajno pada (CR2 je padao na `fatal: Unable to create index.lock`).

**Prva korekcija je OBORENA:** brisala je lock posle 2 s — i kada ga drži **živ** spor git proces (Codex kontraprimer: `git add` sa clean filterom → `unable to write new index file`).

**Sadašnja korekcija:** lock se uklanja **samo ako je stariji od 60 s**; mlađi se ne dira i upis pada sa jasnom greškom. Testovi `GL1` (živ lock ostaje) i `GL2` (star lock se uklanja, `lockCleared: true`) prolaze.

**Status: NEPOTVRĐENO nezavisno** — Codex je u toj rundi ostao bez kvote (`try again at 3:17 AM`) posle 22 izvršene radnje. To je poslednja relevantna korekcija i mora dobiti proveru.

### 1.3 CR2 i W4 — POTVRĐENO

CR2 sada asertuje uspeh izrade i pregleda i čeka `accept` bez `memory_write` pre prekida; W4 više ne koristi `index.lock` kao smetnju nego direktorijum na putanji zapisa (stvarna greška upisa). Codex: CR2 prošao u sva četiri tražena režima, W4 u oba puna skupa.

### 1.4 Testovi — POTVRĐENO

`node --test --test-isolation=none tests/crash-recovery.test.mjs` → 3/3; `node --test tests/crash-recovery.test.mjs` 3× → 3/3; `npm test` 2× → 205/205. Node v26.8.2.

---

## 2. Dokumentni prolaz K15 — OBJAVLJEN i sadržajno potvrđen

Vault `/home/gru/k15-vault`, objavljeno **main @ 327e543e**, 4 kruga, **verify pass iz prvog pokušaja**, challenge **clean** (0 skripti). Referentna lista zapisana pre pokretanja (`K15-referentna-lista.md`).

**Codex (runda `codex-mveea88z`) je pročitao ceo izvor i objavljenu belešku i potvrdio:** definicija OSTree, uloge Flatpak-a, dozvole, Flathub i broj „više od 700.000 dnevno do 2023.“ odgovaraju izvoru; beleška **ne** pripisuje Bubblewrap-u izvršnu ulogu, **ne** uvodi heširanje ni „punu podršku“; otvorena pitanja ne podmeću odgovore.

**Git dokaz:** `git diff --name-status 327e543e^1 327e543e` → samo `tasks/reviews/TASK-101.md` i `wiki/OSTree-i-Flatpak.md`; svež `git clone --no-local` prenosi tagove `dokaz/TASK-101-verify` i `dokaz/TASK-101-challenge`; završeni zadatak ima `lock_owner: null`, `lease_expires_at: null`.

**Poštena ograničenja (Codex):**

1. „Referentna lista zapisana pre izvršavanja“ — fajl je napisan pre pokretanja, ali Git commit (`00:16:21`) to ne dokazuje u odnosu na log (`00:16:07`). Ostaje NEPROVERENO iz Gita.
2. Challenge artefakt ne postoji jer nije bilo nalaza (clean, 0 skripti); zapis je u `K15-challenge.md` sa tagom i revizijom.
3. `correlationRisk: true` — verifier i red-team su oba `dsh`.
4. Telo objavljene beleške razlikuje se u jednoj reči od zamrznutog nacrta („druge“) — posledica normalizacije konsolidacije, ne ručne izmene.

---
## 3. Dokazi — tokeni i MCP

### 3.1 Redakcija sirovih tokena zakupa — POTVRĐENO

- Svi komitovani MCP logovi u `docs/dokazi-wiki/` su redigovani: `"token":"[redigovano]"`.
- `scripts/mcp-klijent.sh` više ne upisuje polje `token` u `priprema` liniju (uklanja ga pre ispisa).
- Codex: 8 starih sirovih vrednosti, 0 u aktuelnim logovima, 0 neredigovanih polja.
- **Starije Git revizije i dalje sadrže te kratkotrajne vrednosti** — istorija nije prepisivana (bez posebnog dogovora).
- Ograničenje: ovo ne garantuje da proizvoljan budući izlaz klijenta nikad neće ispisati tajnu.

### 3.2 MCP uloge — precizna ocena

Šest MCP uloga ima žive dozvoljene i odbijene upise (codex/consolidator, dsh/verifier, agy/researcher, agy/extractor, dsh/red-team, codex/librarian).

**Za agy/researcher tačno je potvrđeno:** klijentski rezultat kaže `upisano wiki/drafts/Kroz_klijenta.md … uloga=researcher` i odbijanje `wiki/Produkcija.md` zbog zone `production`; na disku dozvoljeni fajl postoji i sadrži marker, zabranjeni ne postoji. **Nije** potvrđen sirov `tools/call` trag u istorijskom logu — to nije isto što i „svaki poziv protokolski potvrđen“.

Za `agy/extractor` protokolski trag je potvrdio Codex sopstvenom ponovljenom probom (`call_mcp_tool` događaji). Za codex/librarian i dsh/red-team protokolski trag je u logovima (`mcp: … started/completed/failed`).

---

## 4. Šta je potvrđeno, odbijeno i nedokazano

| Stavka | Ishod | Autor provere |
|---|---|---|
| Klasifikacija pada na Node 26 (assertion / import / timeout) | POTVRĐENO | dsh + Codex (`codex-mveea88z`) |
| Zaostali `index.lock` posle SIGKILL-a | **Prva verzija OD BIJENA; nova korekcija NEPOTVRĐENA** (kvota) | Codex je oborio prvu; druga čeka |
| CR2 prozor i W4 smetnja | POTVRĐENO | dsh + Codex |
| Testni skup 205/205 na Node 26 | POTVRĐENO (dsh, 2×); Codex (2×) na prethodnoj reviziji | dsh + Codex |
| K15 dokumentni sadržaj | POTVRĐENO (Codex čitao ceo izvor i belešku) | Codex |
| K15 „referentna lista pre izvršavanja“ | NEDOKAZANO iz Gita | Codex |
| K15 challenge artefakt | NE POSTOJI (clean, 0 skripti) — zapis sa tagom | dsh |
| Redakcija tokena | POTVRĐENO za komitovane logove i skriptu; istorija sadrži stare vrednosti | dsh + Codex |
| MCP šest uloga | POTVRĐENO za dozvoljen/odbijen upis; protokolski trag: 4 potvrđena, agy/researcher iz rezultata i stanja fajla | dsh + Codex |

**Nepromenjene granice:** TOCTOU prozori (pred `git merge`, MCP provera→upis, `stat`→`rm`), odsustvo OS izolacije, zavisnost semantičkog kriterijuma od modela. Nijedna nije nazvana zatvorenom.

---

## 5. Prva akcija nastavka

1. **Ponoviti nezavisnu proveru `8968481`** (lock pravilo: mlad lock se ne dira, star > 60 s se uklanja; da 60 s ne može obrisati legitimnu operaciju) kada Codex kvota vrati (`try again at 3:17 AM`).
2. Zatim **mali stvarni coding zadatak** u zasebnom postojećem projektu, sa unapred zadatim zahtevom, granicama izmena i testom: dsh piše popravku i regresioni test; Codex nezavisno proverava diff, sopstveni kontraprimer, bazni pad, završni prolaz, pregledani SHA, merge i wiki zapis.

K14 ostaje otvoren (blokiran sa tri opravdana nalaza) i ne ponavlja se bez promene uslova; K15 je uspešan dokaz da kapija propušta dobar sadržaj.
