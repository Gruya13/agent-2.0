---
title: Operativni vodic asinhronog sistema
created: 2026-10-13T21:44:35.592Z
updated: 2026-10-13T21:58:00.000Z
authors:
  - researcher
status: draft
tags:
  - operativa
  - arhitektura
  - asinhroni-sistem
---

# Operativni vodič asinhronog sistema

## Sažetak

Ovaj operativni vodič dokumentuje arhitekturu i pravila funkcionisanja asinhronog multi-agentskog sistema nad zajedničkom bazom znanja (Obsidian vault). Sistem organizuje kognitivnu podelu rada kroz strogu zonsku i fizičku izolaciju agenata, temporalno upravljanje zakupima zadataka nad crnom tablom, nezavisnu višemodelnu verifikaciju i kontrolisano sekvencijalno integrisanje u centralni indeks [[Index]].

## Ključne tvrdnje

1. **Zonska ortogonalnost upisa**: Svaki agent ima strogo definisanu zonu u koju sme da piše:
   - Uloga `researcher` piše isključivo u direktorijum `wiki/drafts/`.
   - Uloga `verifier` piše isključivo u direktorijum `tasks/reviews/`.
   - Uloga `consolidator` piše isključivo u produkcioni direktorijum `wiki/`.
   - Zona `raw/` je strogo nepromenljiva (append-only) sa evidencijom heša bajtova i nijedan agent u nju ne piše.
   *(Izvor: `raw/operativni-vodic.md`, redovi 3–5)*

2. **Upravljanje vremenskim zakupom (Lease)**: Pre izvođenja bilo koje modifikacije nad bazom, agent mora obezbediti važeći vremenski zakup nad zadatkom.
   - Zakup evidentira vlasnika (`lock_owner`), vreme zaključavanja (`locked_at`) i vreme isteka (`lease_expires_at`).
   - U slučaju pada ili prekida rada agenta, automatski istek zakupa omogućava kontrolnom sloju da vrati zadatak u opticaj zajedno sa povezanim radnim stablom.
   *(Izvor: `raw/operativni-vodic.md`, redovi 7–9)*

3. **Fizička izolacija kroz Git radna stabla (Worktrees)**:
   - Svaka uloga radi u sopstvenom izolovanom radnom stablu (`git worktree`) i na namenskoj grani, sprečavajući međusobno preklapanje ili kvarenje radnog direktorijuma među agentima.
   - Spajanje promena u glavnu granu (`main`) vrši isključivo kontrolni sloj putem sekvencijalnog spajanja, nakon prethodnog rebase-a na aktuelno stanje.
   *(Izvor: `raw/operativni-vodic.md`, redovi 11–14)*

4. **Nezavisna verifikacija i arbitraža**:
   - Verifikaciju predloženog nacrta vrši zaseban model (različit od autora nacrta).
   - Ishod verifikacije je mašinski čitljiv binarni verdikt: `pass` ili `fail`.
   - Odbijen nacrt se vraća istraživaču uz prateće nalaze; nakon prekoračenja dozvoljenog broja pokušaja zadatak se prebacuje u stanje `blocked` i zahteva ljudsku intervenciju.
   *(Izvor: `raw/operativni-vodic.md`, redovi 16–18)*

5. **Izvedeni centralni indeks i prevencija konflikata**:
   - Indeks znanja (`wiki/Index.md`, povezan sa [[Index]]) je izvedeni artefakt koji kontrolni sloj automatski generiše iz stvarnog stanja skladišta u `main` posle svakog spajanja.
   - Izvor navodi da „nijedna grana ne nosi indeks i nema konflikata tipa dodato na obe strane” (`raw/operativni-vodic.md`, redovi 20–22).
   - U implementaciji i ugovoru sistema (`.agents/AGENTS.md` tačka 10, `worktree.mjs`), radne grane nasleđuju `wiki/Index.md` kao praćeni fajl, ali se njegov sadržaj ne spaja klasičnim putem: pre rebase-a kontrolni sloj poravnava izvedene artefakte sa aktuelnim `main` mehanizmom `alignGeneratedPaths`, čime se eliminišu Git konflikti tipa „dodato na obe strane”.
   *(Izvor: `raw/operativni-vodic.md`, redovi 20–22; referenca na postojeću belešku [[Index]])*

6. **Programska kontrola pristupa kroz MCP server**:
   - Model Context Protocol (MCP) server pruža operacije za pretragu, čitanje zaglavlja, atomsku izmenu odeljaka i analizu povratnih veza (backlinkova).
   - Zahtevi za upis kroz MCP server proveravaju postojanje aktivnog zakupa nad zadatkom, dok upis u produkciju (`wiki/`) zahteva i verifikacioni pečat (`verification.verdict: pass`).
   *(Izvor: `raw/operativni-vodic.md`, redovi 24–26)*

## Entiteti

- **researcher (istraživač)**: Agent zadužen za dekompoziciju sirovih izvora iz `raw/` i sintezu preliminarnih nacrta u `wiki/drafts/`.
- **verifier (verifikator)**: Nezavisni agent koji sprovodi logičku i faktografsku proveru nacrta i upisuje nalaze u `tasks/reviews/`.
- **consolidator (konsolidator)**: Agent zadužen za integraciju odobrenih beležaka u produkcioni prostor `wiki/`.
- **agentctl (kontrolni sloj)**: Orkestratorski sistem koji upravlja stanjima zadataka, zakupima, radnim stablima, generisanjem indeksa i spajanjem u granu `main`.
- **obsidian-mcp (MCP server)**: Programski posrednik koji sprovodi bezbednosne polise, zonska pravila i proveru zakupa pri interakciji sa skladištem znanja.
- **Git Worktree**: Mehanizam izolacije grana i radnih direktorijuma po ulogama i zadacima.
- **Crna tabla (tasks/)**: Strukturisani sistem datoteka za praćenje stanja i asinhronu koordinaciju agenata (`inbox/`, `active/`, `completed/`).

## Veze ka postojećim konceptima

- [[Index]]: Centralni indeks baze znanja koji agregira sve produkcione beleške i njihove oznake.
  *(Napomena: U trenutnom stanju skladišta, `wiki/Index.md` je izvedena konsolidovana beleška (`status: consolidated`), a ne `verified`, i jedina je postojeća beleška u produkciji `wiki/`. U skladu sa pravilom o semantičkim vezama, nisu kreirane hipotetičke veze ka nepostojećim člancima).*

## Otvorena pitanja

1. **Maksimalan broj pokušaja revizije pre blokiranja**: Izvor `raw/operativni-vodic.md` (redovi 17–18) navodi prelazak u stanje `blocked` „posle dozvoljenog broja pokušaja“, ali tačan numerički prag nije definisan u samom izvoru (`nepotvrđeno u izvoru`). Prema sistemskoj konfiguraciji (`tools/config/agents.yml`), parametar iznosi `maxRevisions: 3`.
2. **Dužina trajanja zakupa (Lease TTL)**: Izvor `raw/operativni-vodic.md` (redovi 7–9) specificira polje `lease_expires_at`, ali ne definiše vremenski interval trajanja zakupa pre isteka (`nepotvrđeno u izvoru`). Prema konfiguraciji sistema (`tools/config/agents.yml`), podrazumevani zakup traje 10 minuta (`lease.ttlMs: 600000`) uz obnovu na svaka 2 minuta (`heartbeatMs: 120000`).
3. **Specifikacija harnesa i modela po ulogama**: Izvor `raw/operativni-vodic.md` (red 16) navodi da verifikaciju radi „drugi model, ne autor nacrta“, ali ne navodi konkretne modele ili harnese po ulogama (`nepotvrđeno u izvoru`). Prema sistemskom ugovoru (`.agents/AGENTS.md`, sekcija 5) i konfiguraciji (`tools/config/agents.yml`), uloge su raspodeljene na: `researcher` (agy / Google Antigravity / Gemini), `verifier` (dsh / DeepSeek headless) i `consolidator` (codex / OpenAI Codex).
