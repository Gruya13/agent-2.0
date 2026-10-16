# Zatvaranje wiki faze — dopunski izveštaj

[Dokumentacija](README.md) · [Putanje i matrica](WIKI-ZASTITA-I-POKRIVENOST.md) · [Prethodni završni izveštaj](ZAVRSNI-IZVESTAJ-WIKI-FAZA.md) · [Dokazi](dokazi-wiki/zatvaranje/) · [Uputstvo](PORUKA-ZA-DSH-ZATVARANJE-WIKI-FAZE.md)

Datum: 16. oktobar 2026.

## 1. Revizija i skup

| | |
|---|---|
| Polazni HEAD (uputstvo) | `67765e6` |
| Završna revizija | `8e55194` |
| Testni skup | **201/201**, dva uzastopna izvođenja |
| Nezavisne Codex runde u ovom obimu | 5 (`mvaqxkwa`, `mvarceye`, `mvargoox` + 2 ranije u fazi) |

## 2. Četiri stavke

### 2.1 Semantika verifikacije i red-team nalaza — ZATVORENA

- Kriterijum (5 tačaka, proširen na **definiciju/ulogu entiteta**) je u
  [verifier.md](../.agents/roles/verifier.md) i [red-team.md](../.agents/roles/red-team.md).
- Parovi izvor/nacrt: [tools/fixtures/semantika.mjs](../tools/fixtures/semantika.mjs),
  izlaz [semanticki-parovi.log](dokazi-wiki/zatvaranje/semanticki-parovi.log).
  Sa **stvarnim dsh** harnesom: **6/6 usklađeno** — P1 parafraza i P2 pitanje
  prolaze; P3 broj, P4 neosnovana definicija, P5 jača tvrdnja i P6 definicija
  uloge padaju.
- Codex je nezavisno ocenio svaki par (saglasan), napravio **novi** par sa
  činjenicom skrivenom u pitanju i dobio `fail` ✓.
- Novi dokumentni ogled do objave: [/home/gru/k12f-vault](/home/gru/k12f-vault),
  [log](dokazi-wiki/zatvaranje/dokumentni-do-objave.log), `main @ c4cf59cf`.
  Verifikator je opravdano odbio prvi nacrt („Bubblewrap za instalaciju **i
  rad**" — izvor to ne kaže), a objavljena verzija je ispravljena.

### 2.2 PDF tok do dozvoljene objave — ZATVORENA

- Uzrok ranijeg zastoja: prompt konsolidatora nije navodio tačnu putanju, pa je
  model izabrao `wiki/tabela.md` po imenu izvora, a zonska kapija dozvoljava
  samo deklarisan artefakt. Sada i kapija i prompt koriste isti izvor istine
  (`productionPathsFor`), a prompt eksplicitno zabranjuje druge putanje.
- Kontrolni testovi: CP1 (putanja iz nacrta, ne iz izvora), CP2 (pogrešna meta
  odbijena), CP3 (lanac do objave).
- Ogled: [/home/gru/k12b-pdf-vault](/home/gru/k12b-pdf-vault),
  [log](dokazi-wiki/zatvaranje/pdf-do-objave.log), `main @ 92ed265d`,
  objavljeno **tačno** `wiki/Flatpak_tabela.md`; fragment nosi sve referentne
  vrednosti (700000, Bluetooth, PipeWire, mreža, fajlovi, Bubblewrap, OSTree,
  ChromeOS); pogrešna `wiki/tabela.md` nije objavljena.
- Popravljen i zastoj koji je usledio: konflikt rebase-a na **izvedenom**
  `wiki/Index.md` (menja ga i konsolidator i `reflect`). Sada se konflikt
  rešava u korist `main`-a **samo** za izvedene fajlove; konflikt na sadržaju
  ostaje odbijanje (RG1/RG2).

### 2.3 MCP kroz stvarne klijente — ZATVORENA (dva vendora)

| Klijent | Uloga | Dozvoljen upis | Nedozvoljen upis |
|---|---|---|---|
| `codex` (privremeni `CODEX_HOME`) | consolidator | `wiki/MCP_proba.md` → **OK** | `wiki/Nedozvoljena.md` → **odbijeno**: „nije artefakt zadatka TASK-101" |
| `dsh` (`--patch`) | verifier | `tasks/reviews/TASK-101.md` → **OK** | `wiki/Produkcija.md` → **odbijeno**: „uloga verifier ne sme u zonu production" |

Oba klijenta su stvarno pozvala MCP alat (u logu `mcp: obsidian/… started` i
`completed/failed`), a ne direktan upis. Dokazi: [mcp-codex.log](dokazi-wiki/zatvaranje/mcp-codex.log),
[mcp-dsh.log](dokazi-wiki/zatvaranje/mcp-dsh.log). Uloge `agy`/`researcher`,
`red-team` i `librarian` nisu proverene stvarnim klijentom.

### 2.4 Nagli prekid i oporavak — ZATVORENA

Testovi bez plaćenih modela, sa stvarnim `SIGKILL`-om kontrolnog procesa
([crash-recovery.test.mjs](../tests/crash-recovery.test.mjs)):

- **CR1** kill tokom izrade: zakup istekne i `reclaim` ga vrati, stari token ne
  vredi, nastavak prolazi.
- **CR2** kill posle prihvatanja a pre zapisa: nastavak izvršava **samo** zapis;
  merge nije dupliran.
- **CR3** merge u Gitu **bez** evidencije o prihvatanju: oporavak prepoznaje
  `merge-base --is-ancestor`, dopunjava i `accept` i `memory_write`, ponovni
  poziv vraća `done` (bez `NOT_READY`), merge nije dupliran.

Popravke koje su ovi testovi iznudili: uklanjanje zaostalog radnog stabla/grane
posle `SIGKILL`, upis `accept`-a **odmah** posle merge-a, oporavak iz Gita i
potpuna evidencija posle oporavka.

## 3. Nalazi i korekcije u ovom obimu

| # | Nalaz | Dokaz (pre) | Korekcija |
|---|---|---|---|
| 1 | Prompt konsolidatora ne navodi tačnu produkcionu putanju | PDF ogled blokiran | `productionPathsFor` u promptu i kapiji (CP1–CP3) |
| 2 | Rebase pada na konfliktu izvedenog `Index.md` | K12d blokiran | konflikt na izvedenim fajlovima u korist `main` (RG1/RG2) |
| 3 | Tekst izveštaja razbija YAML frontmatter | K12e zaglavljen | normalizacija uvlačenja blok skalara (Y1) |
| 4 | Parser gubi prazne linije u blok skalarima | Y2 pao | tokenizer + parser čuvaju prazne redove (Y2/Y3) |
| 5 | `|+` i folded `>` ne čuvaju vrednost | Codex kontraprimeri | stil prema završnim prelomima; fold čuva pasuse (Y4/Y5/Y6) |
| 6 | Tab u uvlačenju bloka tiho odseca sadržaj | Codex kontraprimer | tab se odbija (Y7) |
| 7 | Oporavak je ostavljao nepotpunu evidenciju | Codex `SIGKILL` proba | `memory_write` u evidenciji oporavka (CR3) |
| 8 | Objavljeni tekst može nositi nedokazanu definiciju | Codex čitanje k12f | kriterijum proširen; par P6 (fail) |

## 4. Otvorena ograničenja

1. **Opšti YAML rubovi** (ne koristi ih frontmatter put): clip/keep blok na kraju
   dokumenta bez zatvarača dodaje prelom; folded `>` sa jače uvučenim linijama
   gubi prelome. Frontmatter round-trip je dokazano veran (Y1–Y7).
2. **Objavljena beleška ogleda k12f** sadrži uvodnu definiciju („sistem za
   pakovanje") koju izvor ne uspostavlja. Kriterijum je proširen i P6 sada to
   hvata, ali sama beleška nije naknadno menjana (nema ručnog prepisivanja).
3. **MCP** je proveren stvarnim `codex` i `dsh` klijentom za dve uloge; `agy`
   i ostale uloge nisu.
4. **TOCTOU prozori**: pred `git merge`, između provere i upisa u MCP,
   `stat`→`rm` u `withFileLock`; konkurentna zamena putanje nije isključena.
5. Procesi istog OS korisnika mogu direktno da menjaju fajlove — ovo nije OS
   izolacija i dokument ne tvrdi potpunu sigurnost ni otpornost na prompt
   injection.

## 5. Prva akcija za nastavak

Obim je zatvoren; **nema blokirajućeg nalaza**. Sledeći korak je ono što
uputstvo predviđa posle zatvaranja: **mali stvarni coding zadatak** u zasebnom
postojećem projektu, sa unapred definisanim zahtevom i opsegom. Preporučena prva
dopuna posle toga je popravka opšteg YAML clip/keep ruba iz odeljka 4.1.
