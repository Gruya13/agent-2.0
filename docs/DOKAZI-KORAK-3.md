# Dokazi — Korak 3: pravi tekstualni tok

[Dokumentacija](README.md) · [Preporuke za dalji razvoj](../Agent-2.0-Preporuke-za-dalji-razvoj.md) · [Korak 1](DOKAZI-KORAK-1.md) · [Korak 2](DOKAZI-KORAK-2.md)

Datum: 14. oktobar 2026.
Početna revizija: `0465164976f500e435b72479bace0e11cf109d74`.
Cilj: „pokrenuti postojeći ingest → research → verify → challenge → consolidate →
reflect tok sa stvarnim adapterima; pregledati produkcioni tekst i Git trag“.

## 1. Zamrznuto pre pokretanja

| Stavka | Vrednost |
|---|---|
| Izvor | `raw/flatpak.md` (izvod iz enciklopedijskog članka „Flatpak“, Wikipedia, pristupljeno 14.10.2026) |
| SHA-256 izvora | `e75f3f1ac30c2bdaa785b5be06006cf11b47e8c9085416ec461fca03f095be6d` |
| Zahtev | `--title "Flatpak" --tag "linux,paketi,sandbox"` |
| Konfiguracija | `tools/config/agents.real.yml` (researcher→agy, verifier→dsh, red-team→dsh, consolidator→codex) |
| Revizija | `0465164` |
| Referentna lista | `docs/K3-REFERENCA.md` (13 ključnih tvrdnji, pripremljena pre model poziva) |
| Budžet | 1 pokušaj, ≤ 60 min zidnog vremena, ≤ 10 poziva modela; prekid ako faza pređe 15 min |

## 2. Šta se stvarno dogodilo

| Vreme (lokalno) | Faza | Harnes | Ishod |
|---|---|---|---|
| 10:19:46 | ingest | — | `TASK-103 <- raw/flatpak.md` (manifest +1) |
| 10:19:46–10:20:06 | research | agy | **prekinuto**: petlja je prvo uzela parkirani `TASK-102` (vidi odeljak 5) |
| 10:20:23 | research | agy | ok → `wiki/drafts/Flatpak.md` |
| — | verify | dsh | **fail (pokušaj 1)** |
| — | research | agy | ok (prerađen nacrt) |
| — | verify | dsh | **ok — pečat `pass`** |
| — | challenge | dsh | `clean` — 2 skripta, **2 lažna nalaza**, korelacioni rizik zabeležen |
| 10:39:48 | consolidate | codex | **odbijeno**: „grana menja zone van dozvole: `wiki/Operativni_vodic_asinhronog_sistema.md`“ |
| 10:41:11–10:42:31 | consolidate (ponovo, po ispravci brief-a) | codex | **ok** → merge `3f3cca0` |
| — | reflect | agentctl | indeks regenerisan (2 beleške) |

Model pozivi (stvarni): agy 2 + dsh 3 + codex 2 = **7** za TASK-103, plus 1
prekinuti agy poziv nad TASK-102. Ukupno zidno vreme toka ≈ 23 min.

## 3. Pregled sadržaja prema referentnoj listi

Objavljena beleška `wiki/Flatpak.md` (79 redova) proverena je tačku-po-tačku:

| # | Ključna tvrdnja | U belešci |
|---|---|---|
| 1 | do 2016. zvao se xdg-app | DA (sažetak i tvrdnja 1) |
| 2 | distribucija softvera i upravljanje paketima za Linux | DA |
| 3 | peščanik / izolovano izvršavanje | DA |
| 4 | dozvole: Bluetooth, zvuk (PipeWire), mreža, datoteke | DA, sva četiri resursa |
| 5 | dozvole postavlja održavalac, korisnik menja | DA |
| 6 | direktna isporuka ažuriranja bez distribucija | DA |
| 7 | troši više prostora od nativnih paketa | DA |
| 8 | OSTree deduplikuje, prostor se kasnije koristi efikasnije | DA |
| 9 | Flathub (flathub.org) de facto standard | DA |
| 10 | do 2023. više od 700.000 preuzimanja dnevno | DA, broj očuvan |
| 11 | moguć je nezavisan repozitorijum | DA |
| 12 | potrebni Bubblewrap i OSTree | DA |
| 13 | radi i na ChromeOS-u | DA |

- **Izmišljenih nosivih činjenica nema.** Sve tvrdnje nose referencu na red izvora
  (`red 7` … `red 19`), a te linije odgovaraju izvoru.
- **Neizvesnost je odvojena od činjenica:** četiri otvorena pitanja eksplicitno
  nose oznaku `nepotvrđeno u izvoru`.
- **Veze:** 0 Vikilinkova. Beleška to objašnjava: u `wiki/` nema srodnih
  konsolidovanih belešaka, a ugovor zabranjuje veštačke veze. Nijedan link ne
  vodi ka nepostojećem cilju (proverio i verifikator: `grep '\[\['` → nema
  pogodaka).
- **Metapodaci:** `status: consolidated`, autori `researcher, verifier,
  consolidator`, oznake `#linux #paketi #sandbox`.
- **Tehničko stanje:** `TASK-103` je `consolidated` u `tasks/completed/`;
  `wiki/Index.md` prikazuje 2 beleške i sadrži `[[Flatpak]]`; `agentctl lint`
  → 0 grešaka, 0 upozorenja; nema aktivnih zakupa; zaostala radna stabla
  `TASK-102` su uklonjena.

## 4. Nalazi

| Oznaka | Nalaz | Vrsta po odeljku 9 | Odluka |
|---|---|---|---|
| N13 | Konsolidator (codex) je u svojoj grani izmenio **postojeću produkcionu belešku** `wiki/Operativni_vodic_asinhronog_sistema.md` (samo polje `updated`); kapija spajanja je to odbila i zadatak je otišao u `blocked` | sprečava da dogovoreni scenario završi | **kapija je ispravna**; ispravljen brief uloge i potvrđeno stvarnim pozivom |
| N14 | Posle odbijenog pokušaja, lista `artifacts` zadatka zadržava `wiki/Operativni_vodic_asinhronog_sistema.md` | **potvrđeno** (vidi ispravku ispod) | zabeleženo; ispravljeno u zadatku posle K4 |
| N15 | Red-team i verifikator dele vendor (`dsh`), pa su slepe tačke korelisane; oba red-team skripta su bila lažni nalazi | ograničenje podržanog režima | zabeleženo u zadatku (`correlationRisk: true`); nije greška |

**N13 — uzrok i ispravka.** Brief konsolidatora je u tački 2 tražio da „dopuni telo
beleške Vikilinkovima ka postojećim člancima“, što se može pročitati i kao „dopuni
postojeće članke vezama ka novoj belešci“. Kapija je postupila po invarijanti 22
(konsolidacija ne menja postojeće beleške; izmene idu kroz revizorski zadatak).
Ispravka: brief sada izričito zabranjuje izmenu bilo koje druge beleške u
`wiki/`, uz obrazloženje da kapija odbija i izmenu samo polja `updated`.
Potvrda: ponovljena faza konsolidacije sa ispravljenim brief-om prošla je bez
izmena postojećih belešaka (merge `3f3cca0`).

## 5. Ručne intervencije (sve zabeležene)

1. `TASK-102` je parkiran (`in_progress → blocked`, akter `operator`) da kontrolna
   petlja ne troši budžet na zadatak čiji izvor opisuje sam sistem. Razlog je u
   istoriji zadatka.
2. Brief `consolidator` je ispravljen (odeljak 4), pa je zadatak vraćen u tok
   preko `blocked → ready → in_progress → verified` (akter `operator`, sa
   obrazloženjem u istoriji).
3. `agentctl phase consolidate TASK-103` je pokrenut ručno — zato faza `reflect`
   nije išla automatski, pa je indeks naknadno regenerisan komandom
   `agentctl index`. **Ovaj tok uz ručnu intervenciju nije dokaz da kapija sama
   propušta ispravan sadržaj**; kapija je u ovom prolazu dokazala suprotno — da
   odbija neovlašćenu izmenu.


## 8. Ispravka ovog zapisa (posle pregleda od 14.10.2026)

**N14 je potvrđen i ima stvarne posledice.** Prvobitna tvrdnja da tuđa putanja
„nikad nije ušla u `main`“ **nije tačna**. Kontrolni sloj je posle odbijenog
pokušaja upisao sve promenjene putanje u `artifacts` zadatka (`setArtifacts` je
išao **pre** merge-a), a kapija čita `artifacts` kao dozvoljene produkcione mete
(`zonePolicyFor`). Zato je u **ponovljenom** pokušaju
`wiki/Operativni_vodic_asinhronog_sistema.md` postao deklarisan artefakt zadatka
i kapija ga je propustila:

```text
$ git show --stat 3f3cca0
 wiki/Operativni_vodic_asinhronog_sistema.md | 2 +-
```

Izmena u `main` je bila samo polje `updated` (i normalizacija zaglavlja), ali je
**neovlašćena**: nijedan zadatak nije smeo da menja tuđu produkcionu belešku.
Pravi koren je `detectArtifacts`, koji za ulogu `consolidator` vraća **sve**
beleške u `wiki/`, pa `normalizeConsolidatedNote` prepisuje i tuđe beleške.

Popravljeno u zadatku posle K4:
1. `detectArtifacts` dobija snimak `before` pre poziva harnesa (u fazama
   `research`, `extract` i `consolidate`), pa vraća samo ono što je **taj**
   zadatak proizveo;
2. `setArtifacts` se upisuje tek **posle uspešnog** merge-a;
3. odbijen pokušaj ostavlja predložene putanje u **istoriji zadatka** (telo), ne u
   `artifacts`;
4. regresioni scenario `E2E: odbijena konsolidacija ne upisuje tuđu putanju u
   artifacts (retry je ne prihvata)`.

## 6. Zaključak

- **Potvrđeno:** u definisanom lokalnom okruženju, na zamrznutom izvoru i
  konfiguraciji, sistem je od `raw/flatpak.md` proizveo tačnu produkcionu
  belešku, uz verifikaciju (uz jedan odbijen nacrt), nezavisnu red-team fazu i
  kapiju spajanja koja je **stvarno blokirala** izmenu koja nije dozvoljena.
- **Nije potvrđeno:** da kapija sama propušta ispravan sadržaj bez ručne
  intervencije — u ovom prolazu je bila potrebna jedna intervencija (N13).
- **Preostalo ograničenje:** beleška nema Vikilinkova jer u bazi nema srodnih
  belešaka; to je posledica sadržaja baze, ne toka. Red-team je dao dva lažna
  nalaza (korelacioni rizik je zabeležen).
