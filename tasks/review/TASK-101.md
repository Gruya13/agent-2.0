---
id: TASK-101
title: Operativni vodic asinhronog sistema
status: review
created: 2026-10-13T21:44:35.592Z
updated: 2026-10-13T21:51:44.330Z
source: raw/operativni-vodic.md
priority: normal
tags:
  - operativa
  - arhitektura
depends_on: []
authors:
  - researcher
assignee: null
lock_owner: null
locked_at: null
lease_expires_at: null
artifacts:
  - wiki/drafts/Operativni_vodic_asinhronog_sistema.md
verification: null
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
