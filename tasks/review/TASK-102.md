---
id: TASK-102
title: Sest uloga i dve kapije
status: review
created: 2026-10-13T22:42:31.949Z
updated: 2026-10-13T22:47:09.493Z
kind: ingest
source: raw/sest-uloga-i-dve-kapije.md
audit_scope: []
extract_required: false
extracted: true
priority: normal
tags:
  - arhitektura
  - proces
depends_on: []
authors:
  - researcher
assignee: null
lock_owner: null
locked_at: null
lease_expires_at: null
artifacts:
  - wiki/drafts/Sest_uloga_i_dve_kapije.md
verification: null
challenge: null
blocked_reason: null
history:
  - at: 2026-10-13T22:42:31.949Z
    status: proposed
    actor: operator
  - at: 2026-10-13T22:42:31.952Z
    status: ready
    actor: agentctl
    note: zavisnosti zadovoljene
  - at: 2026-10-13T22:42:31.954Z
    status: ready
    actor: agentctl
  - at: 2026-10-13T22:42:35.703Z
    status: in_progress
    actor: agy
  - at: 2026-10-13T22:47:09.489Z
    status: in_progress
    actor: agy
    note: "nacrt: wiki/drafts/Sest_uloga_i_dve_kapije.md"
  - at: 2026-10-13T22:47:09.491Z
    status: in_progress
    actor: agy
    note: faza research završena
  - at: 2026-10-13T22:47:09.493Z
    status: review
    actor: agy
    note: "nacrt spreman: wiki/drafts/Sest_uloga_i_dve_kapije.md"
lock_token: null
---

# Sest uloga i dve kapije

## Zahtev

_Operater nije ostavio opis; vidi `source`._

## Nalazi

_Prazno do prvog nalaza._

### Faza research (2026-10-13T22:47:09.490Z)

- harnes: agy
- trajanje: 273720 ms
- grana: agent/researcher/TASK-102 @ 7945aa5381e33658af40a93e4b5e064e278391fa

```
### Izveštaj istraživača (`researcher`) za zadatak TASK-102

- **Putanja nacrta**: [`wiki/drafts/Sest_uloga_i_dve_kapije.md`](file:///home/gru/Projects/Agent%202.0/.worktrees/TASK-102-researcher/wiki/drafts/Sest_uloga_i_dve_kapije.md)
- **Broj ključnih tvrdnji**: 6
  1. *Struktura od šest uloga i zonska dokazivost autorstva* (4 uloge pišu, 1 održava, 1 napada; striktna zonska ortogonalnost garantuje tačno jednog autora po izmeni). Referenca: [`raw/sest-uloga-i-dve-kapije.md#L3-L5`](file:///home/gru/Projects/Agent%202.0/.worktrees/TASK-102-researcher/raw/sest-uloga-i-dve-kapije.md#L3-L5).
  2. *Ulazna obrada izvora kroz istraživača i ekstraktora* (`researcher` prevodi izvor u nacrt i vezuje tvrdnje za mesta u izvoru; `extractor` doslovno prenosi tekst, tabele i skenove bez interpretacije uz priložen heš bajtova izvora). Referenca: [`raw/sest-uloga-i-dve-kapije.md#L7-L10`](file:///home/gru/Projects/Agent%202.0/.worktrees/TASK-102-researcher/raw/sest-uloga-i-dve-kapije.md#L7-L10).
  3. *Nezavisna verifikacija zasnovana na dokazima* (`verifier` kao drugi vendor procenjuje isključivo tačnost; svaki nalaz mora imati proverljiv dokaz, a nalaz bez dokaza se odbacuje kao mišljenje). Referenca: [`raw/sest-uloga-i-dve-kapije.md#L12-L14`](file:///home/gru/Projects/Agent%202.0/.worktrees/TASK-102-researcher/raw/sest-uloga-i-dve-kapije.md#L12-L14).
  4. *Adversarijalno ispitivanje kroz izvršive red-team skripte* (pre spajanja a posle pečata, `red-team` prilaže izvršivi skript koji se pokreće u svežem klonu zamrznute revizije; obaranje tvrdnje zaustavlja spajanje, dok se neuspešan skript broji kao lažni nalaz bez blokade). Referenca: [`raw/sest-uloga-i-dve-kapije.md#L16-L19`](file:///home/gru/Projects/Agent%202.0/.worktrees/TASK-102-researcher/raw/sest-uloga-i-dve-kapije.md#L16-L19).
  5. *Produkciona konsolidacija i selektivno održavanje bibliotekara* (`consolidator` prebacuje verifikovan nacrt u `wiki/`; `librarian` rešava duplikate, siročiće, oznake i pokvarene veze isključivo u okviru zadatog opsega). Referenca: [`raw/sest-uloga-i-dve-kapije.md#L21-L23`](file:///home/gru/Projects/Agent%202.0/.worktrees/TASK-102-researcher/raw/sest-uloga-i-dve-kapije.md#L21-L23).
  6. *Dve kapije zaštite od tihe degradacije agenata* (Prva kapija: dozvoljene zone znanja na spajanju; Druga kapija: čist red-team nalaz bez reproduktibilnih propusta). Referenca: [`raw/sest-uloga-i-dve-kapije.md#L25-L27`](file:///home/gru/Projects/Agent%202.0/.worktrees/TASK-102-researcher/raw/sest-uloga-i-dve-kapije.md#L25-L27).
- **Spisak novih Vikilinkova**:
  - `[[Operativni_vodic_asinhronog_sistema]]` (referenca na postojeću konsolidovanu belešku [`wiki/Operativni_vodic_asinhronog_sistema.md`](file:///home/gru/Projects/Agent%202.0/.worktrees/TASK-102-researcher/wiki/Operativni_vodic_asinhronog_sistema.md))
  - `[[Index]]` (referenca na izvedeni centralni indeks [`wiki/Index.md`](file:///home/gru/Projects/Agent%202.0/.worktrees/TASK-102-researcher/wiki/Index.md))
  *(Napomena: U skladištu postoje isključivo ove dve produkcione beleške; u skladu sa ugovorom, nisu dodavani Vikilinkovi ka nepostojećim konceptima).*
- **Spisak otvorenih pitanja**:
  1. *Definicija i obuhvat „zona znanja” za Prvu kapiju*: Izvor navodi pravilo „grana sme da menja samo zone znanja”, ali ne definiše taksativnu listu putanja (`nepotvrđeno u izvoru`; u sistemskom ugovoru [`.agents/AGENTS.md`](file:///home/gru/Projects/Agent%202.0/.worktrees/TASK-102-researcher/.agents/AGENTS.md) i kodu [`tools/orchestrator/lib/worktree.mjs`](file:///home/gru/Projects/Agent%202.0/.worktrees/TASK-102-researcher/tools/orchestrator/lib/worktree.mjs#L163-L165) dozvoljene su `wiki/`, `tasks/reviews/`, `tasks/audits/`, `tasks/challenges/`, dok su zabranjene `raw/`, `tools/`, `tests/`, `scripts/` i `.agents/`).
  2. *Prag i sankcije za lažne nalaze red-team-a*: Izvor navodi da se lažni nalazi broje ali ne blokiraju spajanje, bez preciziranja praga tolerancije ili kaznenih mera (`nepotvrđeno u izvoru`).
  3. *Specifikacija ha
```
