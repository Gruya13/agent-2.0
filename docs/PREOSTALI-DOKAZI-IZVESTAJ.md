# Preostali dokazi — izveštaj sa preciznom ocenom

[Dokumentacija](README.md) · [Matrica](WIKI-ZASTITA-I-POKRIVENOST.md) · [Prethodni izveštaj](ZATVARANJE-WIKI-FAZE-IZVESTAJ.md) · [Uputstvo](PORUKA-ZA-DSH-PREOSTALI-DOKAZI.md) · [Dokazi](dokazi-wiki/)

Datum: 18. oktobar 2026.
Završna revizija: **4406d72** (poslednja izvršna izmena koda: 9a66fa6; poslednja izmena testova i konfiguracije: 4406d72)
Testni skup: **203/203** (više uzastopnih izvođenja, konkurentnost 4), lint 0/0

---

## 1. Nezavisna potvrda poslednje YAML korekcije — ZATVORENA (uz pošteno ograničen parser)

Codex je sopstvenim probama potvrdio (runda codex-mvdyqb2l):

| Popravka | Dokaz |
|---|---|
| tab u uvlačenju blok skalara se jasno odbija, ne skraćuje tekst | POTVRĐENO (proba: tab ispred alpha daje grešku, ne 'lpha') |
| dozvoljen tab unutar sadržaja ostaje sadržaj | POTVRĐENO (alpha + tab + beta ostaje) |
| folded blok sa uvlačenjem se odbija (ranije tiho spajao prelome) | POTVRĐENO za sva tri stila; roditelj 62f7e3b davao je spojene razmake |
| ručno pisani clip/keep/strip blokovi pred zatvaračem daju tačne PyYAML vrednosti | POTVRĐENO na 4406d72 (matrica 1-3 prazna reda) |
| frontmatter round-trip za stvarne višelinijske izveštaje | POTVRĐENO, uključujući dva sačuvana stvarna izveštaja |
| dosežnost: config, readNote, zadatak i MCP read stvarno čitaju ove blokove | POTVRĐENO; MCP čitanje odbija folded+uvlačenje jasnom greškom |

**Negativna kontrola:** ispravna revizija bez popravke je 62f7e3b (ne 958d3a6, koji već sadrži tab popravku). Codex je to sam ispravio i pokazao staro ponašanje.

**Preostali rubovi (pošteno ograničenje):**

1. Keep blok (|+) na kraju dokumenta BEZ zatvarača dodaje jedan prelom više od PyYAML-a. Reči se ne gube; frontmatter put (sa zatvaračem) je veran. Test Y9 ovo dokumentuje.
2. Serijalizacija teksta koji počinje razmacima normalizuje vodeću indentaciju. Namerno je (Y1): bez toga je tekst izveštaja razbijao frontmatter. Gubi se whitespace, ne reči.

---

## 2. MCP kroz stvarne klijente — ZATVORENA za svih šest MCP uloga (dva vendora)

| Uloga | Klijent | Dozvoljen upis | Odbijen upis | Dokaz |
|---|---|---|---|---|
| consolidator | codex | wiki/MCP_proba.md | nije artefakt zadatka | mcp-codex.log |
| verifier | dsh | tasks/reviews/TASK-101.md | ne sme u zonu production | mcp-dsh.log |
| researcher | agy | wiki/drafts/Kroz_klijenta.md | ne sme u zonu production | mcp-researcher.log |
| extractor | agy | wiki/drafts/fragments/Kroz_klijenta.md | ne sme u zonu draft | mcp-extractor.log |
| red-team | dsh | tasks/challenges/TASK-101/kroz-klijenta.sh | ne sme u zonu production | mcp-red-team.log |
| librarian | codex | izmena postojeće wiki/Flatpak.md | ne ulazi u opseg revizije | mcp-librarian.log |

Skripta: scripts/mcp-klijent.sh (izolovan vault, zadatak, živ zakup, privremena klijentska konfiguracija — ne dira se ~/.codex ni ~/.gemini).

Nezavisno (Codex, runda codex-mvdzdsl7): potvrdio je protokolski trag za codex/librarian i dsh/red-team i samostalno ponovio drugu agy ulogu (extractor) na kandidatu sa stream-json izlazom: dva događaja call_mcp_tool, fragment upisan, upis u draft zonu odbijen. Time je pokrivena ranija greška statično fiksirane prve uloge. Istorijski agy logovi nemaju zapis tools/call — to je navedeno kao granica tih logova.

Programer i reviewer nisu MCP uloge (nema ih u ROLE_WRITE_ZONES); dokazani su coding tokom (A-coding.log: programer=dsh, reviewer=codex).

---
## 3. Novi dokumentni prolaz sa konačnim pravilom — OTVOREN (novi neuspeh, dijagnostikovan)

Novi čist vault: /home/gru/k14-vault. Isti sačuvani izvor, referentna lista zapisana UNAPRED (docs/dokazi-wiki/zatvaranje/K14-referentna-lista.md).

Ishod: BLOKIRAN posle četiri odbijanja (dozvoljeno 3); status blocked, bez objave, bez aktivnog zakupa. Nije korišćen override ni ručna izmena.

Tri završna nalaza verifikatora (sva tri sadržajno opravdana — potvrdio i Codex):

1. definicija 'Flatpak — sistem za pakovanje' — izvor to ne daje;
2. otvoreno pitanje pretpostavlja kriptografski algoritam heširanja — izvor ne pominje heširanje;
3. otvoreno pitanje pretpostavlja ulogu Bubblewrap-a u izvršavanju — izvor ga vezuje za instalaciju.

Dakle: kriterijum sada hvata tačno klasu koju je ranije propuštao (P6), ali to ne znači da je novi tekst prihvaćen — tekst nije objavljen. Ovo je pošten ishod: kapija radi, model (agy) ponavlja iste greške, zadatak traži ljudsku odluku.

---

## 4. Konsolidacija dokaza i završni skup

- PDF do objave: dokaz važi za reviziju c82d5c3 (main 92ed265d). Codex je proverio da stari i novi YAML parser daju ista data/telo polja za završeni PDF zadatak i objavljenu belešku, pa YAML izmene ne ruše taj dokaz. Ogled NIJE ponavljan na 4406d72: briefovi verifikatora i red-teama menjaju kriterijum budućih modelskih odluka, pa stari prolaz ne bi dokazao isti ishod pri novom izvršavanju.
- SIGKILL: CR1-CR3 su automatizovani i izvršavaju se u skupu; izolovano 3/3 više puta.
- Završni skup: 203/203 više uzastopnih izvođenja na 4406d72; YAML 19/19; CR 3/3.

Flakiness pronađen i popravljen u ovom obimu:

1. CR2 je mogao pasti u prozoru pre upisa accept-a (Codex kontraprimer). Sada test čeka deterministički uslov: accept postoji i memory_write ne postoji, pa tek onda SIGKILL.
2. Ceo test fajl je povremeno padao bez detalja na mašini sa 16 jezgara (16 paralelnih fajlova, svaki sa git worktree-ovima — resursna iscrpljenost). npm test sada koristi --test-concurrency=4.

---

## 5. Precizna ocena — šta je zatvoreno, a šta nije

| Stavka | Ocena |
|---|---|
| YAML korekcije (tab, folded, chomp, stilovi, prazne linije) | ZATVORENO — nezavisno potvrđeno, parser pošteno ograničen (2 ruba navedena) |
| MCP za šest uloga (codex, dsh, agy) | ZATVORENO za tih šest; agy protokolski trag potvrđen ponovljenom probom, istorijski logovi bez tools/call traga |
| Novi dokumentni prolaz sa konačnim pravilom | NIJE ZATVORENO — blokiran sa tri opravdana nalaza; tekst nije objavljen |
| PDF i SIGKILL dokazi povezani sa revizijama | ZATVORENO za navedene revizije; PDF nije ponovljen na novoj reviziji i razlog je naveden |
| Završni skup na završnoj reviziji | ZATVORENO — 203/203 više puta |

### Poslednja korekcija bez nezavisne potvrde

Korekcije u 4406d72 (deterministički CR2 prozor + --test-concurrency=4) NISU dobile završnu nezavisnu potvrdu: Codex je u toj rundi ostao bez kvote (poruka provajdera: try again at 7:33 PM) posle 15 izvršenih radnji. Zato:

- ne tvrdi se da su te dve korekcije nezavisno potvrđene;
- stanje je sačuvano, a prva akcija nastavka je ponoviti istu proveru na 4406d72 kada kvota vrati.

### Ostale granice (nepromenjene)

- TOCTOU prozori (pred git merge, MCP provera ka upisu, stat pa rm) — nijedan nije nazvan zatvorenim.
- Nema OS izolacije; nema tvrdnje o potpunoj sigurnosti ni otpornosti na prompt injection.
- Semantički kriterijum zavisi od modela; K14 je pokazao da ista klasa grešaka može da se ponovi.

---

## 6. Prva akcija nastavka

1. Ponoviti nezavisnu proveru 4406d72 (CR2 deterministički prozor + konkurentnost) kada Codex kvota vrati.
2. Zatim mali stvarni coding zadatak u zasebnom projektu, sa unapred definisanim zahtevom i opsegom.
