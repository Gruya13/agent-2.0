---
id: TASK-101
title: Operativni vodic asinhronog sistema
status: consolidated
created: 2026-10-13T21:44:35.592Z
updated: 2026-10-13T22:02:56.008Z
source: raw/operativni-vodic.md
priority: normal
tags:
  - operativa
  - arhitektura
depends_on: []
authors:
  - researcher
  - consolidator
assignee: codex
lock_owner: null
locked_at: null
lease_expires_at: null
artifacts:
  - wiki/Operativni_vodic_asinhronog_sistema.md
verification:
  verdict: pass
  harness: dsh
  at: 2026-10-13T22:02:14.197Z
  commit: feae9990972e766a69c9b7fa43ecbf2d9174654f
  summary: |-
    Revizija je završena; trag je upisan u `tasks/reviews/TASK-101.md`.
    **Provera nacrta `wiki/drafts/Operativni_vodic_asinhronog_sistema.md` (blob `b1b89a2f`, commit `af6655f`):**
    - **Izvor:** `raw/operativni-vodic.md` je sada verzionisan; `sha256` se poklapa sa `.agents/raw-manifest.json` (`7e65a97c…00840`) — N1 prethodne revizije otklonjen.
    - **Citati:** svih 6 opsega (L3–5, L7–9, L11–14, L16–18, L20–22, L24–26) tačno odgovara izvoru, uključujući prelome redova — nema izmišljenih citata.
    - **Vikilinkovi:** `[[Index]]` (4 pojave) je validan; `wiki/Index.md` postoji, `obsidian_lint_vault` vraća 0 grešaka/upozorenja.
    - **Kod i brojevi:** `alignGeneratedPaths` (`worktree.mjs:181,263`) pre rebase-a, `generatedPaths: [Index]` (`pipeline.mjs:419`), MCP provera `verdict === 'pass'`/`lock_owner`/`lease_expires_at` (`obsidian-mcp.mjs:228,241,244`), `status: consolidated` (`Index.md:6`, `vault.mjs:176`), `maxRevisions: 3`, `ttlMs: 600000`, `heartbeatMs: 120000` — sve tačno. N2 i N3 otklonjeni.
    - **Nalaza protiv nacrta:** 0. Dva informativna zapažanja (identifikatori polja potiču iz `.agents/AGENTS.md`, a ne iz sirovog izvora; nepotpuna lista poddirektorijuma `tasks/`) nisu defekti i ne obaraju nacrt.
    Ništa van zone verifikatora nije menjano (`git status` prikazuje samo `?? tasks/reviews/`; `wiki/`, `raw/` i `wiki/Index.md` nisu dirani).
    VERDICT: pass
  by: verifier
blocked_reason: null
history:
  - at: 2026-10-13T21:44:35.592Z
    status: proposed
    actor: operator
  - at: 2026-10-13T21:44:35.595Z
    status: ready
    actor: agentctl
    note: zavisnosti zadovoljene
  - at: 2026-10-13T21:44:35.598Z
    status: ready
    actor: agentctl
  - at: 2026-10-13T21:44:38.588Z
    status: in_progress
    actor: agy
  - at: 2026-10-13T21:51:44.326Z
    status: in_progress
    actor: researcher
    note: "nacrt: wiki/drafts/Operativni_vodic_asinhronog_sistema.md"
  - at: 2026-10-13T21:51:44.328Z
    status: in_progress
    actor: researcher
    note: faza research završena
  - at: 2026-10-13T21:51:44.330Z
    status: review
    actor: agy
    note: "nacrt spreman: wiki/drafts/Operativni_vodic_asinhronog_sistema.md"
  - at: 2026-10-13T21:51:44.388Z
    status: in_progress
    actor: dsh
  - at: 2026-10-13T21:55:22.964Z
    status: in_progress
    actor: verifier
    note: "verdikt: fail"
  - at: 2026-10-13T21:55:22.966Z
    status: in_progress
    actor: verifier
    note: "faza verify: fail"
  - at: 2026-10-13T21:55:22.969Z
    status: ready
    actor: dsh
    note: odbijen nacrt (pokušaj 1); vraćeno istraživaču
  - at: 2026-10-13T21:56:48.175Z
    status: in_progress
    actor: agy
  - at: 2026-10-13T21:59:46.090Z
    status: in_progress
    actor: researcher
    note: "nacrt: wiki/drafts/Operativni_vodic_asinhronog_sistema.md"
  - at: 2026-10-13T21:59:46.093Z
    status: in_progress
    actor: researcher
    note: faza research završena
  - at: 2026-10-13T21:59:46.095Z
    status: review
    actor: agy
    note: "nacrt spreman: wiki/drafts/Operativni_vodic_asinhronog_sistema.md"
  - at: 2026-10-13T21:59:46.166Z
    status: in_progress
    actor: dsh
  - at: 2026-10-13T22:02:14.198Z
    status: in_progress
    actor: verifier
    note: "verdikt: pass"
  - at: 2026-10-13T22:02:14.200Z
    status: in_progress
    actor: verifier
    note: "faza verify: pass"
  - at: 2026-10-13T22:02:14.202Z
    status: verified
    actor: dsh
    note: verifikator dao pečat
  - at: 2026-10-13T22:02:14.269Z
    status: in_progress
    actor: codex
  - at: 2026-10-13T22:02:55.858Z
    status: in_progress
    actor: consolidator
    note: "konsolidovano: wiki/Operativni_vodic_asinhronog_sistema.md"
  - at: 2026-10-13T22:02:56.005Z
    status: consolidated
    actor: agentctl
    note: merge a186fc8c
  - at: 2026-10-13T22:02:56.008Z
    status: consolidated
    actor: agentctl
---

# Operativni vodic asinhronog sistema

## Zahtev

_Operater nije ostavio opis; vidi `source`._

## Nalazi

_Prazno do prvog nalaza._

### Faza research (2026-10-13T21:51:44.327Z)

- harnes: agy
- trajanje: 425678 ms
- grana: agent/researcher/TASK-101 @ 05e872c5cb8a2db1839f03d725f674d9c898692d

```
### Izveštaj istraživača (`researcher`) za zadatak TASK-101

- **Putanja nacrta**: [`wiki/drafts/Operativni_vodic_asinhronog_sistema.md`](file:///home/gru/Projects/Agent%202.0/.worktrees/TASK-101-researcher/wiki/drafts/Operativni_vodic_asinhronog_sistema.md)
- **Broj ključnih tvrdnji**: 6
  1. *Zonska ortogonalnost upisa* (`researcher` → `wiki/drafts/`, `verifier` → `tasks/reviews/`, `consolidator` → `wiki/`, `raw/` je nepromenljiv / append-only). Referenca: `raw/operativni-vodic.md#L3-L5`.
  2. *Upravljanje vremenskim zakupom (Lease)* (`lock_owner`, `locked_at`, `lease_expires_at` i automatski oporavak u slučaju prekida rada). Referenca: `raw/operativni-vodic.md#L7-L9`.
  3. *Fizička izolacija kroz Git radna stabla* (odvojeni `git worktree` direktorijumi i sekvencijalni merge u `main` nakon rebase-a). Referenca: `raw/operativni-vodic.md#L11-L14`.
  4. *Nezavisna verifikacija i arbitraža* (verifikaciju sprovodi drugi model uz mašinski čitljiv ishod `pass`/`fail` i eskalaciju u `blocked` nakon prekoračenja limita pokušaja). Referenca: `raw/operativni-vodic.md#L16-L18`.
  5. *Izvedeni centralni indeks bez konflikata* (generiše ga isključivo kontrolni sloj nakon spajanja grana; eliminiše konflikte "dodato na obe strane"). Referenca: `raw/operativni-vodic.md#L20-L22` i [`[[Index]]`](file:///home/gru/Projects/Agent%202.0/.worktrees/TASK-101-researcher/wiki/Index.md).
  6. *Programska kontrola pristupa kroz MCP server* (provera aktivnog zakupa za upis i verifikacionog pečata za produkciju `wiki/`). Referenca: `raw/operativni-vodic.md#L24-L26`.
- **Spisak novih Vikilinkova**:
  - `[[Index]]` (jedina postojeća beleška u produkciji `wiki/`; u skladu sa ugovorom, nisu izmišljane veze ka nepostojećim konceptima).
- **Spisak otvorenih pitanja**:
  1. *Maksimalan broj pokušaja revizije*: Izvor navodi prelazak u stanje `blocked` „posle dozvoljenog broja pokušaja“, ali tačan numerički prag nije definisan. (`nepotvrđeno`)
  2. *Dužina trajanja zakupa (Lease TTL)*: Izvor definiše polje `lease_expires_at`, ali ne navodi podrazumevani vremenski interval zakupa. (`nepotvrđeno`)
  3. *Specifikacija modela po ulogama*: Izvor zahteva da verifikaciju radi „drugi model“, ali ne precizira tačnu raspodelu konkretnih modela ili harnesa po ulogama. (`nepotvrđeno`)
```

### Faza verify (2026-10-13T21:55:22.965Z)

- harnes: dsh
- trajanje: 218520 ms
- verdikt: fail
- grana: agent/researcher/TASK-101 -> verifier @ 49de4f36186e3db23f0772a232c9cea77e7b74bb

```
Revizorski trag je upisan u `tasks/reviews/TASK-101.md` (zona verifikatora; `git status` pokazuje samo `?? tasks/reviews/`, `wiki/`, `wiki/drafts/`, `raw/` i `wiki/Index.md` nisu dirani).

## Sažetak provere

**Metod:** nezavisna provera u `agent/verifier/TASK-101` worktree-u. Izvor **nije** u radnom stablu — `obsidian_lint_vault` ga prijavljuje kao `raw.deleted` — pa je pročitan primerak iz kontrolnog korena zadatka; njegov `sha256` (`7e65a97c…00840`) se poklapa sa `.agents/raw-manifest.json`. Uz to, **svih 6 citata se poklapa red-po-red** (3–5, 7–9, 11–14, 16–18, 20–22, 24–26), `[[Index]]` je validan (4 povratne veze), a kod-formulacije (`blocked`, `verification.verdict: pass`, `lock_owner/locked_at/lease_expires_at`) odgovaraju implementaciji.

**Nalazi sa dokazom protiv nacrta:**

1. **N1 — izvor nije verzionisan.** `git ls-tree -r HEAD -- raw/` daje samo `raw/arhitektura-…md`, a `HEAD:.agents/raw-manifest.json` očekuje `operativni-vodic.md`; lint zato vraća `raw.deleted`. Citati nisu reproduktivni iz isporučenog repozitorijuma.
2. **N2 — netačna premisa u tački 5.** Nacrt tvrdi „nijedna agentska grana ne sadrži indeks"; `git ls-tree -r agent/researcher/TASK-101 -- wiki/` pokazuje `wiki/Index.md` (blob `c6cb3c12…`, različit od `main:914ca39a…`, `3 insertions/3 deletions`). Stvarni mehanizam je `alignGeneratedPaths` (`worktree.mjs:263-281`, pozvan u `pipeline.mjs:365-370`) i nije pomenut.
3. **N3 — pogrešna oznaka statusa.** `wiki/Index.md` je nazvan „verifikovana" beleška, a `status: consolidated` (red 6; `vault.mjs:176` to uvek upisuje).

Zapažanje N4 (nije razlog za fail): otvorena pitanja 1–3 su odgovoriva iz `tools/config/agents.yml` (`maxRevisions: 3`, `lease.ttlMs: 600000`) i `.agents/AGENTS.md:145-151`.

VERDICT: fail
REASONS: 3
```

### Faza research (2026-10-13T21:59:46.092Z)

- harnes: agy
- trajanje: 177850 ms
- grana: agent/researcher/TASK-101 @ af6655fc59f16b0aad9715c5b8f7c778718f1555

```
### Izveštaj istraživača (`researcher`) za zadatak TASK-101

- **Putanja nacrta**: [`wiki/drafts/Operativni_vodic_asinhronog_sistema.md`](file:///home/gru/Projects/Agent%202.0/.worktrees/TASK-101-researcher/wiki/drafts/Operativni_vodic_asinhronog_sistema.md)
- **Broj ključnih tvrdnji**: 6
  1. *Zonska ortogonalnost upisa* (`researcher` piše u `wiki/drafts/`, `verifier` u `tasks/reviews/`, `consolidator` u `wiki/`, `raw/` je nepromenljiv / append-only). Referenca: [`raw/operativni-vodic.md#L3-L5`](file:///home/gru/Projects/Agent%202.0/.worktrees/TASK-101-researcher/raw/operativni-vodic.md#L3-L5).
  2. *Upravljanje vremenskim zakupom (Lease)* (`lock_owner`, `locked_at`, `lease_expires_at` i automatski oporavak zadatka i radnog stabla pri prekidu rada). Referenca: [`raw/operativni-vodic.md#L7-L9`](file:///home/gru/Projects/Agent%202.0/.worktrees/TASK-101-researcher/raw/operativni-vodic.md#L7-L9).
  3. *Fizička izolacija kroz Git radna stabla* (zasebni `git worktree` direktorijumi po ulogama i sekvencijalni merge u `main` nakon rebase-a). Referenca: [`raw/operativni-vodic.md#L11-L14`](file:///home/gru/Projects/Agent%202.0/.worktrees/TASK-101-researcher/raw/operativni-vodic.md#L11-L14).
  4. *Nezavisna verifikacija i arbitraža* (verifikaciju sprovodi zaseban model uz binarni verdikt `pass`/`fail` i eskalaciju u `blocked` nakon prekoračenja limita pokušaja). Referenca: [`raw/operativni-vodic.md#L16-L18`](file:///home/gru/Projects/Agent%202.0/.worktrees/TASK-101-researcher/raw/operativni-vodic.md#L16-L18).
  5. *Izvedeni centralni indeks i prevencija konflikata* (generisanje indeksa u `main` posle svakog spajanja; sprečavanje konflikata tipa „dodato na obe strane” kroz usklađivanje izvedenih artefakata pre rebase-a procedurom `alignGeneratedPaths`). Referenca: [`raw/operativni-vodic.md#L20-L22`](file:///home/gru/Projects/Agent%202.0/.worktrees/TASK-101-researcher/raw/operativni-vodic.md#L20-L22), [`.agents/AGENTS.md#L63-L68`](file:///home/gru/Projects/Agent%202.0/.worktrees/TASK-101-researcher/.agents/AGENTS.md#L63-L68) i [[Index]].
  6. *Programska kontrola pristupa kroz MCP server* (provera aktivnog zakupa nad zadatkom za operacije upisa i verifikacionog pečata `verification.verdict: pass` za produkciju `wiki/`). Referenca: [`raw/operativni-vodic.md#L24-L26`](file:///home/gru/Projects/Agent%202.0/.worktrees/TASK-101-researcher/raw/operativni-vodic.md#L24-L26).
- **Spisak novih Vikilinkova**:
  - `[[Index]]` (referenca na postojeću konsolidovanu belešku [`wiki/Index.md`](file:///home/gru/Projects/Agent%202.0/.worktrees/TASK-101-researcher/wiki/Index.md); u skladu sa ugovorom, nisu izmišljane hipotetičke veze ka nepostojećim beleškama).
- **Spisak otvorenih pitanja**:
  1. *Maksimalan broj pokušaja revizije pre blokiranja*: Izvor [`raw/operativni-vodic.md#L17-L18`](file:///home/gru/Projects/Agent%202.0/.worktrees/TASK-101-researcher/raw/operativni-vodic.md#L17-L18) navodi prelazak u stanje `blocked` „posle dozvoljenog broja pokušaja“, ali tačan numerički prag nije definisan u tekstu (`nepotvrđeno u izvoru`; u sistemskoj konfiguraciji [`tools/config/agents.yml`](file:///home/gru/Projects/Agent%202.0/.worktrees/TASK-101-researcher/tools/config/agents.yml) definisano je `maxRevisions: 3`).
  2. *Dužina trajanja zakupa (Lease TTL)*: Izvor [`raw/operativni-vodic.md#L7-L9`](file:///home/gru/Projects/Agent%202.0/.worktrees/TASK-101-researcher/raw/operativni-vodic.md#L7-L9) definiše polje `lease_expires_at`, ali ne navodi vremenski interval trajanja zakupa pre isteka (`nepotvrđeno u izvoru`; u konfiguraciji [`tools/config/agents.yml`](file:///home/gru/Projects/Agent%202.0/.worktrees/TASK-101-researcher/tools/config/agents.yml) definisano je `lease.ttlMs: 600000`).
  3. *Specifikacija harnesa i modela po ulogama*: Izvor [`raw/operativni-vodic.md#L16`](file:///home/gru/Projects/Agent%202.0/.worktrees/TASK-101-researcher/raw/operativni-vodic.md#L16) navodi da verifikaciju vrši „drugi model, ne autor nacrta“, ali ne navodi konkretnu raspodelu ha
```

### Faza verify (2026-10-13T22:02:14.199Z)

- harnes: dsh
- trajanje: 147973 ms
- verdikt: pass
- grana: agent/researcher/TASK-101 -> verifier @ feae9990972e766a69c9b7fa43ecbf2d9174654f

```
Revizija je završena; trag je upisan u `tasks/reviews/TASK-101.md`.

**Provera nacrta `wiki/drafts/Operativni_vodic_asinhronog_sistema.md` (blob `b1b89a2f`, commit `af6655f`):**

- **Izvor:** `raw/operativni-vodic.md` je sada verzionisan; `sha256` se poklapa sa `.agents/raw-manifest.json` (`7e65a97c…00840`) — N1 prethodne revizije otklonjen.
- **Citati:** svih 6 opsega (L3–5, L7–9, L11–14, L16–18, L20–22, L24–26) tačno odgovara izvoru, uključujući prelome redova — nema izmišljenih citata.
- **Vikilinkovi:** `[[Index]]` (4 pojave) je validan; `wiki/Index.md` postoji, `obsidian_lint_vault` vraća 0 grešaka/upozorenja.
- **Kod i brojevi:** `alignGeneratedPaths` (`worktree.mjs:181,263`) pre rebase-a, `generatedPaths: [Index]` (`pipeline.mjs:419`), MCP provera `verdict === 'pass'`/`lock_owner`/`lease_expires_at` (`obsidian-mcp.mjs:228,241,244`), `status: consolidated` (`Index.md:6`, `vault.mjs:176`), `maxRevisions: 3`, `ttlMs: 600000`, `heartbeatMs: 120000` — sve tačno. N2 i N3 otklonjeni.
- **Nalaza protiv nacrta:** 0. Dva informativna zapažanja (identifikatori polja potiču iz `.agents/AGENTS.md`, a ne iz sirovog izvora; nepotpuna lista poddirektorijuma `tasks/`) nisu defekti i ne obaraju nacrt.

Ništa van zone verifikatora nije menjano (`git status` prikazuje samo `?? tasks/reviews/`; `wiki/`, `raw/` i `wiki/Index.md` nisu dirani).

VERDICT: pass
```
