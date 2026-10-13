---
title: Revizija TASK-101
created: 2026-10-13T22:01:48.113Z
updated: 2026-10-13T22:01:48.113Z
authors:
  - verifier
status: review
tags:
  - revizija
  - TASK-101
---

# Revizija TASK-101

- zadatak: TASK-101 — Operativni vodic asinhronog sistema
- nacrt: wiki/drafts/Operativni_vodic_asinhronog_sistema.md
- izvor: raw/operativni-vodic.md
- revidirana revizija nacrta: `af6655fc59f16b0aad9715c5b8f7c778718f1555` (blob `b1b89a2f`)
- verdikt: **pass**
- nalaza protiv nacrta: **0**

## Metod

Nezavisna provera u worktree-u `TASK-101-verifier` (grana `agent/verifier/TASK-101`).
Nacrt je upoređen sa izvorom `raw/operativni-vodic.md`, sa ugovorom
`.agents/AGENTS.md`, konfiguracijom `tools/config/agents.yml` i implementacijom
(`tools/mcp/obsidian-mcp.mjs`, `tools/orchestrator/lib/worktree.mjs`,
`tools/orchestrator/lib/vault.mjs`). Svaki navod je proveren komandom; nijedan
citat nije prepisan napamet.

## Dokazi (provere koje potvrđuju nacrt)

### 1. Izvor je verzionisan i poklapa se sa manifestom

```
$ sha256sum raw/operativni-vodic.md
7e65a97ced628fc0508a4562f5ec5dc37782e77df5749f240de8f92297d00840  raw/operativni-vodic.md
$ grep -o '"7e65a97c[0-9a-f]*"' .agents/raw-manifest.json
"7e65a97ced628fc0508a4562f5ec5dc37782e77df5749f240de8f92297d00840"
```

Otisak se poklapa sa `.agents/raw-manifest.json` (red 12). Nalaz N1 prethodne
revizije (izvor nije bio verzionisan) je otklonjen: `git ls-tree -r HEAD -- raw/`
sada sadrži `raw/operativni-vodic.md` (blob `d673f8a2`, commit `f80e0d4`).

### 2. Svih 6 citata red-po-red odgovara izvoru

Normalizovana provera (spajanje preloma redova) nad `raw/operativni-vodic.md`
daje `OK` za svaki citirani isečak:

| Tvrdnja | Citirani opseg | Dokaz |
|---|---|---|
| 1. Zone upisa | L3–5 | `istraživač u wiki/drafts/, verifikator u tasks/reviews/, a konsolidator u wiki/`; `izvori nepromenljivi i čuvaju se sa otiskom bajtova` |
| 2. Zakup | L7–9 | `Zakup sadrži vlasnika, vreme zaključavanja i vreme isteka`; `zakup istekne i kontrolni sloj vrati zadatak u opticaj zajedno sa radnim stablom` |
| 3. Worktree | L11–14 | `svaka uloga dobija sopstveni direktorijum i sopstvenu granu`; `U main se ulazi isključivo sekvencijalnim spajanjem ... posle rebase-a na aktuelno stanje` |
| 4. Verifikacija | L16–18 | `Verifikaciju radi drugi model, ne autor nacrta`; `posle dozvoljenog broja pokušaja zadatak se blokira i traži ljudsku intervenciju` |
| 5. Indeks | L20–22 | `Indeks znanja je izveden artefakt`; `posle svakog spajanja, pa nijedna grana ne nosi indeks i nema konflikata tipa dodato na obe strane` |
| 6. MCP | L24–26 | `MCP server izlaže pretragu, čitanje zaglavlja, atomsku izmenu odeljka i backlinkove`; `Upis kroz MCP zahteva zadatak pod zakupom, a za produkciju i verifikacioni pečat` |

Nacrt nijednu tvrdnju ne pripisuje izvoru ako je izvor ne sadrži; sva tri
otvorena pitanja su eksplicitno označena kao `nepotvrđeno u izvoru`, što se
poklapa sa `raw/operativni-vodic.md` (nema numeričkih pragova, TTL-a ni tabele
harnesa).

### 3. Vikilinkovi su validni

Jedini Vikilink u nacrtu je `[[Index]]` (4 pojave: redovi 18, 46, 49, 68).
`wiki/Index.md` postoji, a `obsidian_backlinks` za `Index` vraća:

```
Index: 1 backlinkova
wiki/drafts/Operativni_vodic_asinhronog_sistema.md (4)  - [[Index]] x4
```

Nacrt svesno ne uvodi veze ka nepostojećim beleškama (u `wiki/` postoji samo
`Index.md`); to je u skladu sa pravilom iz `.agents/roles/researcher.md` red 16–17.

### 4. Zaglavlje i invarijante skladišta

`obsidian_lint_vault` vraća `OK — nema nalaza; ... grešaka: 0, upozorenja: 0`.
Nacrt nosi obavezna polja (`title`, `created`, `updated`, `authors`, `status`,
`tags`) sa `status: draft` — `.agents/AGENTS.md` invarijanta 3 (redovi 43–45).

### 5. Numeričke i kod-formulacije

```
$ grep -n "maxRevisions\|ttlMs\|heartbeatMs" tools/config/agents.yml
22:  ttlMs: 600000        # 10 minuta
23:  heartbeatMs: 120000  # obnova zakupa na 2 minuta
33:  maxRevisions: 3
```

- `maxRevisions: 3` (otvoreno pitanje 1) — tačno.
- `lease.ttlMs: 600000` (10 min) i `heartbeatMs: 120000` (2 min) (otvoreno
  pitanje 2) — tačno.
- Raspodela harnesa (otvoreno pitanje 3): `.agents/AGENTS.md` redovi 149–151 —
  `researcher` → `agy` (Antigravity/Gemini), `verifier` → `dsh` (DeepSeek
  headless), `consolidator` → `codex` (codex-rs) — tačno.

### 6. Navedeni kod zaista postoji i ponaša se kako nacrt tvrdi

- MCP upis: `tools/mcp/obsidian-mcp.mjs` red 228 `if (verdict !== 'pass')` (pečat),
  red 241 `task.data.lock_owner !== AGENT` (zakup), red 244–246 provera
  `lease_expires_at` (istek) — pokriva tvrdnju 6.
- Izvedeni indeks: `tools/orchestrator/lib/worktree.mjs` red 181 poziva
  `alignGeneratedPaths` (def. red 263) **pre** rebase-a (red 182); u
  `tools/orchestrator/lib/pipeline.mjs` red 419 `generatedPaths: [config.vault.index]`
  — pokriva tvrdnju 5 i mehanizam koji je zamenio netačnu premisu iz prethodne
  revizije (N2).
- Grane zaista nasleđuju indeks kao praćeni fajl:
  `git ls-tree -r agent/verifier/TASK-101 -- wiki/` daje `wiki/Index.md`
  (blob `fb59f00`), dok `main` ima noviji `5e9b8db` — pa je tvrdnja nacrta da se
  sadržaj indeksa ne spaja klasičnim putem (već se poravnava) tačna.
- Status indeksa: `wiki/Index.md` red 6 `status: consolidated`; generator
  `tools/orchestrator/lib/vault.mjs` red 176 upisuje istu vrednost — tvrdnja iz
  napomene red 69 je tačna (ispravljen N3 prethodne revizije).

## Zapažanja (informativna, nisu nalazi protiv nacrta)

1. **Zonska ortogonalnost je tačna, ali su identifikatori polja i izraz
   „append-only" preuzeti iz ugovora, ne iz sirovog izvora.** Izvor na L7–9
   opisuje zakup rečima („vlasnika, vreme zaključavanja i vreme isteka"), a
   `lock_owner` / `locked_at` / `lease_expires_at` i `(append-only)` dolaze iz
   `.agents/AGENTS.md` (redovi 16 i 131–133). Pošto je dodatna precizacija tačna
   i proverljiva, citiranje izvora na tom mestu nije greška, ali bi potpunija
   referenca uključila i `.agents/AGENTS.md`.
2. **Entitet „Crna tabla (`tasks/`)" navodi nepotpunu listu poddirektorijuma**
   (`inbox/`, `active/`, `completed/`; `.agents/AGENTS.md` redovi 20–24 definiše
   i `review/` i `reviews/`). Pošto je `tasks/reviews/` eksplicitno naveden u
   tvrdnji 1, čitalac nije doveden u zabludu; predlog (neusvajan, jer nacrt ne
   menjam): dopuniti listu sa `review/`, `reviews/`.

## Zaključak

Nijedan nalaz sa dokazom ne ide protiv nacrta: izvor je verzionisan i odgovara
manifestu, svih 6 citata je tačno, svi Vikilinkovi su validni, zaglavlje prolazi
lint, a numeričke i kod-tvrdnje odgovaraju konfiguraciji i implementaciji.
Prethodna tri nalaza (N1, N2, N3) su otklonjena u ovoj reviziji nacrta.

VERDICT: pass
