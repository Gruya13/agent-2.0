# AGENTS.md — sistemski ugovor zajedničke baze znanja

Ovaj fajl je obavezujući ugovor za svaki harness (DeepSeek `dsh`, Google
Antigravity `agy`) i za kontrolni sloj (`agentctl`). OpenAI Codex je uklonjen iz
sistema (vidi `docs/PLAN-BEZ-CODEX.md`). Učitava se na
početku svake sesije i **ne sme se zaobići**. Ako je zahtev korisnika u koliziji
sa ovim ugovorom, ugovor pobeđuje dok se ne izmeni kroz `tasks/` proceduru.

Repozitorijum je Obsidian skladište (vault) koje je istovremeno i crna tabla
(Blackboard): agenti ne komuniciraju direktnim porukama, već isključivo stanjem
fajlova u ovom repozitorijumu.

## 1. Topologija i dozvoljene zone pisanja

| Zona | Namena | Ko sme da piše |
|---|---|---|
| `raw/` | nepromenljivi izvori (append-only) | **niko** — samo dodavanje novih fajlova od strane operatera |
| `wiki/` | produkciona, verifikovana enciklopedija | isključivo `consolidator` (agy) |
| `wiki/drafts/` | preliminarni nacrti | `researcher` (Gemini/agy) |
| `wiki/drafts/fragments/` | fragmenti multimodalnog unosa | `extractor` (agy) |
| `wiki/Index.md` | izveden centralni indeks | isključivo `agentctl` (faza 5) |
| `tasks/inbox/` | predloženi i spremni zadaci | operater i `agentctl` |
| `tasks/active/` | zadaci pod zakupom | vlasnik zakupa kroz `agentctl` |
| `tasks/review/` | zadaci na verifikaciji | `agentctl` |
| `tasks/completed/` | arhivirani zadaci | `agentctl` |
| `tasks/reviews/` | revizorski tragovi i primedbe | `verifier` (DeepSeek) |
| `tasks/audits/` | izveštaji o održavanju baze | `librarian` (dsh) |
| `tasks/challenges/` | red-team nalazi i reprodukcioni skripti | `red-team` (DeepSeek) |
| `.agents/raw-manifest.json` | otisci izvora (nepromenljivost) | `agentctl` |
| `tasks/events.jsonl` | append-only tok događaja kontrolnog sloja | `agentctl` |

Zone su **ortogonalne**: nijedan agent ne piše van svoje zone, čak i ako ima
tehničku mogućnost. `wiki/drafts/` je zona istraživača i nije „deo" konsolidatora
samo zato što počinje sa `wiki/`; produkciona beleška živi isključivo na vrhu
`wiki/` (`wiki/<Slug>.md`). Svi fajlovi u `raw/` — uključujući skrivene i
binarne — moraju biti pod manifestom izvora, jer neevidentiran fajl se može
izmeniti bez prijave. Pristup se sprovodi u `tools/mcp/obsidian-mcp.mjs` (MCP sloj)
i u `agentctl` kontrolnom sloju (Git sloj).

## 2. Invarijante

1. **Zabranjeno je direktno menjanje produkcionih datoteka u `wiki/`** pre
   uspešnog završetka verifikacije od strane `verifier` agenta. Nacrt živi u
   `wiki/drafts/` do pečata.
2. **`raw/` je strogo nepromenljiv.** Postojeći fajlovi u `raw/` se ne menjaju,
   ne preimenuju i ne brišu. `agentctl lint` i `git diff -- raw/` to proveravaju.
3. **Svaka nova beleška nosi standardizovano YAML zaglavlje** sa poljima:
   `title`, `created`, `updated`, `authors` (lista), `status`
   (`draft|review|verified|consolidated`), `tags` (lista).
4. **Semantičke reference koriste isključivo Obsidian format dvostrukih
   zagrada**: `[[Naziv beleške]]`, `[[Naziv|alias]]`, `[[Naziv#Odeljak]]`.
   Markdown linkovi ka drugim beleškama nisu dozvoljeni.
5. **Pre modifikacije baze harness mora imati važeći vremenski zakup (lease)**
   nad zadatkom u `tasks/active/`. Zakup se obnavlja; istekao zakup kontrolni
   sloj vraća u opticaj zajedno sa radnim stablom.
6. **Jedan pisac po radnom stablu.** Agent radi isključivo u svom
   `git worktree` direktorijumu (`.worktrees/<TASK-ID>`) na svojoj grani
   `agent/<uloga>/<TASK-ID>`. U `main` se ulazi isključivo sekvencijalnim
   merge-om koji izvodi kontrolni sloj.
7. **Nijedan model ne verifikuje sopstveni rad.** Nacrt koji je proizveo
   `researcher` verifikuje `verifier` (drugi vendor). Verifikator ne menja kod
   niti nacrt — on upisuje nalaz.
8. **Dokaz, ne tvrdnja.** Svaki nalaz u zadatku nosi komandu, fajl ili test koji
   ga potvrđuje ili obara. Nalaz bez dokaza se označava kao `unproven`.
9. **`raw/` → `wiki/` je jednosmeran tok.** Nijedan sadržaj ne ulazi u `wiki/`
   bez `id` zadatka u `tasks/completed/` i revizorskog traga.
10. **`wiki/Index.md` je izveden artefakt.** Generiše ga isključivo kontrolni
    sloj (`agentctl index`) u `main`, posle merge-a. Grane ga nasleđuju kao
    praćeni fajl i mogu da ga izmene, ali se njegov sadržaj **ne spaja**: pre
    rebase-a kontrolni sloj poravnava izvedene artefakte sa aktuelnim `main`
    (`alignGeneratedPaths`), pa nema konflikta tipa „dodato na obe strane".
    Isto važi za `.agents/raw-manifest.json`.
11. **Granа agenta se pre spajanja rebase-uje na `main`.** Tako grana ne nosi
    zastarelo stanje crne table (`tasks/`), a merge u `main` ostaje sekvencijalan
    i eksplicitan (`--no-ff`), sa autorstvom svakog doprinosa u Git dnevniku.
12. **MCP sloj ne veruje ulozi na reč.** Upis kroz `obsidian-mcp` zahteva
    `OBSIDIAN_TASK`: zadatak mora da postoji, da zakup nad njim drži taj agent i
    da zakup nije istekao. Za upis u produkciju (`wiki/`) dodatno se zahteva
    verifikacioni pečat (`verification.verdict: pass`) i da je ciljna beleška
    artefakt tog zadatka. Bez zadatka i pečata nema upisa u `wiki/`.
13. **Putanja se razrešava kroz simboličke linkove.** Zona upisa se proverava na
    realnoj putanji, pa link poput `wiki/drafts/link -> raw` ne može da izvede
    upis van zone. `raw/` i izvedeni artefakti (`wiki/Index.md`,
    `.agents/raw-manifest.json`, `tasks/events.jsonl`) nisu upisivi ni jednoj
    ulozi kroz MCP.
14. **Manifest izvora hashira bajtove, ne tekst.** Izmena jednog bajta u
    binarnom izvoru (`.pdf`, slika) mora biti prijavljena; `readFile(..., 'utf8')`
    bi različite bajtove sveo na isti zamenski znak. Zapis iz manifesta v1 se
    nadograđuje samo kada je osnova uporediva (validan UTF-8 i hash se poklapa);
    za binarne izvore se prijavljuje `raw.legacy-unknown` dok čovek ne uspostavi
    novu osnovu.
15. **Odluka o obaveznosti zadatka vezana je za skladište, ne za env.** Ako
    skladište koje se piše nosi `.agents/AGENTS.md`, upis bez zadatka, zakupa i
    (za `wiki/`) verifikacionog pečata je odbijen — bez obzira na
    `OBSIDIAN_TASK_ROOT`. Zadatak bez artefakata ne otvara produkciju.

16. **Grana zadatka menja samo zone znanja.** Kontrolni sloj odbija merge ako
    grana dira `raw/`, `tools/`, `tests/`, `scripts/` ili `.agents/`. Agent koji
    piše fajl-sistemom (mimo MCP-a) ne može da ubaci izmenu van svoje zone u
    `main` — provera je na merge-u, gde se odlučuje o produkcionoj grani.
17. **Zakup je vezan za proces, ne samo za ime harnesa.** Uz `lock_owner` zakup
    nosi i `lock_token`; drugi proces istog identiteta (`agy`) ne može da obnovi,
    otpusti ni piše pod živim zakupom prvog. MCP proverava isti token.
18. **`raw/` sadrži samo prave fajlove.** Simbolički link u `raw/` je prekršaj
    (`raw.symlink`), jer link nikad ne uđe u manifest i može da preusmeri čitanje
    na drugi sadržaj. Nedostatak `.agents/raw-manifest.json` uz postojeće izvore
    je **greška**, ne upozorenje: bez manifesta se nepromenljivost ne može
    dokazati, pa se izmene u `raw/` ne komituju.
19. **Revizija baze (`kind: audit`) menja samo postojeće beleške iz `audit_scope`.**
    Nova beleška kroz reviziju nije dozvoljena, `raw/` i izvedeni artefakti su i
    tada zabranjeni, a verifikacioni pečat dolazi **posle** izmene a **pre**
    merge-a (automat stanja to garantuje). Izmene van opsega obaraju fazu.

20. **Red-team kapija.** Posle verifikacionog pečata, a pre spajanja, zadatak
    prolazi kroz `red-team` na **zamrznutoj reviziji**. Nalaz blokira merge
    **samo ako je reproduktibilan**: kontrolni sloj pokrene skript koji je
    red-team napisao u svežem klonu te iste revizije. Skript koji ne obori
    tvrdnju je lažni nalaz — broji se i ne blokira. Red-team ne popravlja ono što
    napada i ne piše van `tasks/challenges/`. Izvršavanje skripti se može
    isključiti (`pipeline.challengeExecute: false`), ali tada nalaz ne blokira
    spajanje. Faza se može isključiti po pozivu (`pipeline.challenge: false`).

21. **Kapija zona razlikuje podzone i vrstu zadatka.** Grana sme da menja
    `wiki/drafts/` (nacrti i fragmenti), `wiki/<Slug>.md` **samo ako je to
    deklarisani artefakt zadatka**, `tasks/reviews/`, `tasks/audits/`,
    `tasks/challenges/`, izvedene artefakte koje održava kontrolni sloj, i — za
    revizorske zadatke — postojeće beleške iz `audit_scope`. Sve ostalo obara
    merge. Rename se broji sa **obe** strane (`--no-renames`), inače `git mv` iz
    zabranjene zone prolazi neopaženo.
22. **Konsolidacija ne prepisuje postojeću belešku.** `consolidator` radi samo na
    izvornim zadacima (`kind: ingest`) i samo stvara novu belešku; izmene
    postojećih idu kroz revizorski zadatak (`librarian`, `kind: audit`). Time se
    zone `librarian`-a i `consolidator`-a ne preklapaju, i tuđi rad se ne gazi.
23. **Knjigovodstvo komituje samo poznate fajlove.** `commitBookkeeping`
    komituje isključivo fajlove zadataka, `tasks/events.jsonl`, `wiki/Index.md`,
    `.agents/raw-manifest.json` i **nove** izvore u `raw/`. Sve što je u zoni
    crne table a nije na tom spisku se prijavljuje (`bookkeeping.foreign-change`)
    i **ne komituje** — inače bi upis mimo radnog stabla završio u `main` bez
    merge-a, pečata i kapije.
24. **Istekao reprodukcioni skript nije „nema nalaza".** Skript koji istekne ili
    nije izvršen daje verdikt `unexecuted` i **blokira** spajanje. Nalaz se
    priznaje samo ako skript izađe sa 0 **i** ispiše `OBORENO`.
25. **Kapija se preglasava samo svesno i uz zapis.** `agentctl override <id>
    --reason "<zašto>"` otvara kapiju za **jedan** zadatak; razlog, vreme i autor
    ostaju u zadatku i u `tasks/events.jsonl`. Isključivanje kroz konfiguraciju
    (`pipeline.challenge: false`) gasi kapiju za sve zadatke i tada se ne pravi
    `challenge` zapis — to je odluka operatera, ne tiho ponašanje sistema.

## 3. Životni ciklus zadatka

```
proposed ──▶ ready ──▶ in_progress ──▶ review ──▶ verified ──▶ consolidated
                 ▲           │              │            │
                 │           │              │            │
                 └───────────┴──────────────┘            │
                  (odbijen nalaz / istekao zakup)        │
                          blocked ◀──────────────────────┘
```

Konsolidator drži zakup (`in_progress`) dok ne spoji granu, pa iz tog stanja
prelazi direktno u `consolidated`. Prelaze izvodi isključivo kontrolni sloj
(`agentctl`); agent nikad ne menja status zadatka.

- `proposed` — zadatak je u `tasks/inbox/`, čeka evaluaciju.
- `ready` — zavisnosti su zadovoljene, posao je dostupan za preuzimanje.
- `in_progress` — agent je preuzeo zadatak i drži zakup.
- `review` — rad je komitovan na grani i čeka verifikaciju.
- `verified` — verifikator je dao pečat `pass`.
- `consolidated` — promene su spojene u `main`, zadatak je u `tasks/completed/`.
- `blocked` — zadatak je zaustavljen; obavezan `blocked_reason`.

Dozvoljeni prelazi su definisani u `tools/orchestrator/lib/task.mjs`
(`TRANSITIONS`) i svaki nedozvoljen prelaz je greška, ne upozorenje.

## 4. Polja zadatka

```yaml
---
id: TASK-101
title: Kratak naslov
status: ready
created: 2025-01-01T00:00:00.000Z
updated: 2025-01-01T00:00:00.000Z
source: raw/dokument.md
authors: []
assignee: null
lock_owner: null
locked_at: null
lease_expires_at: null
artifacts: []
verification: null
priority: normal
depends_on: []
tags: []
---
```

Zakup (`lock_owner`, `locked_at`, `lease_expires_at`) je jedini mehanizam
međusobnog isključivanja; istekao zakup se automatski opoziva.

## 5. Uloge

| Uloga | Harness | Zona pisanja | Zabranjeno |
|---|---|---|---|
| `extractor` | agy (Antigravity / Gemini) | `wiki/drafts/fragments/` | tumačenje i sažimanje; sve ostalo |
| `researcher` | agy (Antigravity / Gemini) | `wiki/drafts/` | `wiki/` produkcija, merge |
| `verifier` | dsh (DeepSeek headless) | `tasks/reviews/` | izmena nacrta, kod |
| `red-team` | dsh (DeepSeek) | `tasks/challenges/` | popravljanje onoga što napada; sve ostalo |
| `librarian` | dsh (DeepSeek headless) | `wiki/` u opsegu + `tasks/audits/` | novi članci, prepisivanje sadržaja, izlazak iz opsega |
| `consolidator` | agy (Antigravity / Gemini) | `wiki/` (bez `Index.md`) | izmišljanje sadržaja, merge |
| `programer` | dsh (DeepSeek) | izolovano radno stablo **ciljnog repoa**, u opsegu zadatka (`code_scope`) | kontrolni repo, kapije, tuđi testovi, van opsega |
| `reviewer` | agy (Antigravity / Gemini) | `.agent-review/<TASK-ID>.md` u svom checkout-u | popravka koda; sve van `.agent-review/` |

Kognitivna podela rada: Gemini sintetiše i konsoliduje, DeepSeek verifikuje i održava.
Dve coding uloge (`programer`, `reviewer`) pripadaju istoj podeli: programer piše
popravku i regresioni test, a reviewer — **drugi vendor** — piše sopstveni kontrolni
slučaj i nalaz u `.agent-review/`; nijedan ne popravlja ono što drugi proverava.

**Nezavisnost je precizno definisana, ne preširoko:**

- **Autor nikad nije verifikator.** Nacrt (`researcher`) i reviziju
  (`verifier`) rade različiti vendori; to je invarijanta 7 i ona se ne
  potkopa ni u jednom toku.
- **`extractor` i `researcher` mogu biti isti vendor** (oba `agy`): ekstraktor ne
  sudi o sadržaju, on transkribuje, pa tu nema „verifikacije sopstvenog rada".
- **Kada verifikator i red-team dele isti vendor** (`dsh`), njihove slepe tačke su
  korelisane. To se **beleži** u zadatku (`challenge.correlationRisk: true`) i
  vidljivo je u izveštaju; red-team nalaz ipak mora da se **izvrši** na
  zamrznutoj reviziji, pa dokaz ne zavisi od toga ko ga je napisao. Vendor se
  menja čim neki drugi bude mogao da izvrši ovu klasu zadatka (OpenAI Codex,
  koji je ranije nosio tu klasu, uklonjen je iz sistema — vidi `docs/PLAN-BEZ-CODEX.md`).

## 6. Operativne komande

```bash
node tools/orchestrator/cli.mjs status
node tools/orchestrator/cli.mjs ingest raw/dokument.md --title "Naslov"
node tools/orchestrator/cli.mjs run --rounds 5          # kontrolna petlja
node tools/orchestrator/cli.mjs lint                    # invarijante vault-a
node tools/orchestrator/cli.mjs index                   # rebuild wiki/Index.md
python3 -m json.tool tools/config/mcp/agy.json          # MCP konfiguracija
```

## 7. Kršenje ugovora

`agentctl lint` vraća izlazni kod `2` ako je bilo koja invarijanta prekršena.
Kontrolni sloj odbija dalji rad nad zadatkom čiji je lint nalaz `error` dok se
prekršaj ne ukloni. Prekršaj u `raw/` se tretira kao trajno onečišćenje istorije
i zahteva ljudsku intervenciju.
