# Dokazi — potvrdni stvarni prolaz (K8)

[Dokumentacija](README.md) · [Ponovljivost](DOKAZI-PONOVLJIVOST.md) · [Nezavisna provera](NEZAVISNA-PROVERA-CODEX.md) · [Codex nalaz](NEZAVISNA-PROVERA-K8.md)

Datum: 15. oktobar 2026.

## 1. Zamrznuta revizija

| Šta | Vrednost |
|---|---|
| Završni KOD (prošao Codex proveru) | `bd9a6f0785953bb6871a570208f9e44a0e559a8c` |
| HEAD repozitorijuma u vreme ogleda | `b403f2c` (menja samo `docs/`) |
| Dokaz da je kod nepromenjen | `git diff --quiet bd9a6f0 HEAD -- tools/ tests/ package.json` → **isto** |
| Izvor | `raw/flatpak.md`, sha256 `e75f3f1ac30c2bdaa785b5be06006cf11b47e8c9085416ec461fca03f095be6d` |
| Referentna lista | [K3-REFERENCA.md](K3-REFERENCA.md), 13 tvrdnji |

Tokom ogleda **nije menjan ni kod, ni konfiguracija, ni kriterijumi**.

## 2. Vault

`/home/gru/k8-vault-1`, pripremljen samo postojećim alatima (`agentctl init` +
`agentctl ingest`), sa `tools/config/agents.real.yml`. Bez starih zadataka,
grana, zakupa i tuđeg manifesta:

- jedan zadatak `TASK-101`, status `ready`, zakup `—`;
- manifest: samo `flatpak.md` (isti sha256 kao izvor);
- `git branch --list` → prazno; `.worktrees/` → prazno;
- `.gitignore` i `.agents/AGENTS.md` u Gitu (radna stabla ih vide);
- lint: 0 grešaka, 0 upozorenja.

## 3. Prolaz

Budžet: **najviše 60 minuta i 15 sadržajnih model poziva**, šta prvo nastupi.
Potrošeno: **19 min 10 s** (08:14:33 → 08:33:43) i **6 poziva**.

| Faza | Uloga / harnes | Ishod |
|---|---|---|
| research | istraživač / `agy` | `wiki/drafts/Flatpak.md` |
| verify | verifikator / `dsh` | **fail** (pokušaj 1) |
| research | istraživač / `agy` | ispravka nacrta |
| verify | verifikator / `dsh` | **pass** |
| challenge | red-team / `dsh` | **clean** (0 skripti, 0 lažnih, korelacioni rizik) |
| consolidate | konsolidator / `codex` | **merge `70f4d08`** |

- **Odbijanja:** 1 (`verify` na prvom pokušaju). Automatska ispravka je usledila
  sama; challenge je bio čist iz prvog prolaza.
- **Ručne intervencije: nema.** Nijedno podešavanje statusa, pečata, polja ni
  `override`; nijedna izmena koda ili konfiguracije.
- Petlja je stala sama posle 7 krugova (6 akcija, pa krug bez promene).

## 4. Završni rezultat (provera kriterijuma)

| Kriterijum | Ishod | Dokaz |
|---|---|---|
| zadatak je `consolidated` | **DA** | `status` iz `agentctl status --json` |
| svih 13 referentnih tvrdnji i važni brojevi | **DA** | sve 13 prisutno i tačno; `700.000` uz „do 2023. godine“; bez izmišljenih verzija/cena |
| `created` = vreme zadatka, nije posle `updated` | **DA** | `created 2026-10-15T06:14:28.985Z` = `created` zadatka; `updated 06:33:43.424Z`; nacrt je nosio modelov `06:22:00Z` |
| `artifacts` samo rezultati tog zadatka | **DA** | `["wiki/Flatpak.md"]` |
| nema nedozvoljenih promena | **DA** | merge `70f4d08` menja samo `tasks/reviews/TASK-101.md` i `wiki/Flatpak.md`; pod `wiki/` su samo `Flatpak.md` i `Index.md` |
| nema aktivnog zakupa | **DA** | `lock_owner: null`, `lease_expires_at: null` |
| nema lint grešaka | **DA** | 0 grešaka, 0 upozorenja (vault i klon) |
| indeks odgovara objavljenoj belešci | **DA** | `| [[Flatpak]] | consolidated | #linux #paketi #sandbox | 1 |` |

## 5. Svež `git clone --no-local`

Klon napravljen iz vault-a; u njemu:

| Provera | Ishod |
|---|---|
| oba dokazna taga postoje | `dokaz/TASK-101-verify` → `8b61073…`, `dokaz/TASK-101-challenge` → `f3ea29a…` |
| tagovi odgovaraju evidenciji | poklapaju se sa `verification.commit` i `challenge.revision` iz `tasks/completed/TASK-101.md` |
| revizije su dosežne u klonu | `cat-file -e` za obe → kod 0 |
| artefakti postoje | `wiki/Flatpak.md` u klonu |
| veza verifikovanog nacrta i objavljenog sadržaja | blob nacrta isti na `challenge` i `verification.commit` (`cc092095…`); **telo identično**, 6473 bajta, sha256 `a121b416…` |
| tuđe promene | nema; u klonu su samo `wiki/Flatpak.md`, `wiki/Index.md`, `wiki/drafts/Flatpak.md` |

## 6. Nezavisna provera (Codex)

Zadatak prosleđen kroz postojeći DSH mehanizam (`external_agent`, nit `verify`,
`mode: full`); Codex je radio u svom worktree-u i **sopstvenom** svežem klonu.
Pun nalaz: [NEZAVISNA-PROVERA-K8.md](NEZAVISNA-PROVERA-K8.md), log
`~/.dsh/external-agents/runs/codex-mv95yv2d-a9596a24.log`.

**Potvrđeno nezavisno:** svež klon i dostupnost oba dokazna komita; poklapanje
tagova sa evidencijom; integritet izvora; `created` iz zadatka i poredak;
`artifacts` i odsustvo zakupa; granice objave i istorije (nema tuđih beleški);
identitet tela nacrta i objavljene beleške (isti body blob i sha256, 6473 bajta);
lint 0/0; **svih 13 referentnih tvrdnji** sa tačnim brojem iz tvrdnje 10.

**Oboreno u strogom obliku (jedan nalaz):** rečenica u odeljku „Otvorena
pitanja“ (red 59) uvodi pretpostavke koje izvor ne daje — „neophodnost podrške
za neprivilegovane korisničke prostore imena“ (čita se kao utvrđen tehnički
uslov) i „nestandardne C biblioteke (poput musl libc)“ (dodaje klasifikaciju).
Codex izričito ne tvrdi da su te pretpostavke netačne, nego da nisu potkrepljene
dostavljenim izvorom. To je **sadržajni nalaz (klasa A)**, ne defekt kontrolnog
sloja: kapija je pustila tekst koji zadovoljava zadate kriterijume (tvrdnje iz
izvora su tačne), ali nije sprečila hipoteze u odeljku o otvorenim pitanjima.

Codex-ova konačna ocena: *„Rezultat ovog prolaza potvrđen je za dokazni trag,
granice, metapodatke, identitet tela i svih 13 referentnih tvrdnji. Nije
bezuslovno potvrđen kao tekst sastavljen isključivo od izvorom potkrepljenih
tvrdnji, zbog navedenih formulacija u Otvorenim pitanjima.“*

## 7. Ograničenja i otvoreno

1. **Nalaz iz reda 59 ostaje otvoren.** Nije ispravljan nakon provere (zadatak je
   tražio potvrdu, ne novu izmenu), a nije ni preglasan: zapisan je ovde i u
   [nezavisnom nalazu](NEZAVISNA-PROVERA-K8.md).
2. Git i logovi ne mogu dokazati odsustvo svake nezabeležene ručne intervencije;
   dokaz je ono što je zabeleženo (6 poziva, 1 odbijanje, nijedna izmena koda).
3. Ovo je jedan prolaz na jednoj reviziji i jednom izvoru — ne dokaz opšte
   ponovljivosti ni bezbednosti sistema.
4. Kada je `consolidate` u pitanju, dokazni tagovi se postavljaju **pre**
   merge-a; u ovom prolazu su oba taga nastala i prenesena kroz svež klon.

**Ishod: prolaz je uspešan za sve zadate kriterijume (zadatak `consolidated`,
tačan sadržaj, ispravni metapodaci, čiste granice, dokaz u svežem klonu), uz
jedan otvoren sadržajni nalaz o formulacijama u odeljku „Otvorena pitanja“.**
