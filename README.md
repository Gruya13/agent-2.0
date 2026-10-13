# Agent 2.0 — asinhroni multi-agentski sistem nad zajedničkom bazom znanja

Implementacija arhitekture opisane u
[`raw/arhitektura-asinhronog-multi-agentskog-sistema.md`](raw/arhitektura-asinhronog-multi-agentskog-sistema.md):
DeepSeek Harness (`dsh`), Google Antigravity (`agy`) i OpenAI Codex (`codex`) ne
razmenjuju poruke direktno, već koordinišu **isključivo stanjem fajlova u
Obsidian skladištu** koje je istovremeno crna tabla (Blackboard), Git
repozitorijum i baza znanja.

```bash
npm test                                   # 71 testa: jedinica + E2E + MCP protokol
node scripts/demo.mjs                      # cela petofazna demonstracija u privremenom vault-u
node tools/orchestrator/cli.mjs status     # stanje sistema u ovom repozitorijumu
node tools/orchestrator/cli.mjs doctor     # provera okruženja i harnesa
```

## Šta je implementirano

| Sloj | Fajl | Šta radi |
|---|---|---|
| Sistemski ugovor | [`.agents/AGENTS.md`](.agents/AGENTS.md) | zone upisa, 11 invarijanti, automat stanja zadatka |
| Uloge | [`.agents/roles/`](.agents/roles/) | brief-ovi za `researcher`, `verifier`, `consolidator` |
| Kontrolni sloj | [`tools/orchestrator/cli.mjs`](tools/orchestrator/cli.mjs) | `agentctl`: unos, zakup, faze, petlja, lint, indeks, doctor |
| Pet faza | [`lib/pipeline.mjs`](tools/orchestrator/lib/pipeline.mjs) | ingest → research → verify → consolidate → reflect |
| Crna tabla | [`lib/store.mjs`](tools/orchestrator/lib/store.mjs) | atomske promene zadataka, prelasci stanja, dnevnik događaja |
| Zakup | [`lib/lease.mjs`](tools/orchestrator/lib/lease.mjs) | `lock_owner` / `locked_at` / `lease_expires_at`, oporavak isteklih |
| Izolacija | [`lib/worktree.mjs`](tools/orchestrator/lib/worktree.mjs) | `git worktree` po (zadatak, uloga), rebase, `merge --no-ff`, konflikti |
| Baza znanja | [`lib/vault.mjs`](tools/orchestrator/lib/vault.mjs) | beleške, frontmatter, Vikilinkovi, backlinkovi, izvedeni indeks |
| Linter | [`lib/lint.mjs`](tools/orchestrator/lib/lint.mjs) | nepromenljivost `raw/`, šema zadataka, frontmatter, prekinuti linkovi |
| MCP server | [`tools/mcp/obsidian-mcp.mjs`](tools/mcp/obsidian-mcp.mjs) | `obsidian_search_notes`, `obsidian_read_notes`, `obsidian_patch_note`, `obsidian_backlinks` |
| Adapteri | [`lib/agents/`](tools/orchestrator/lib/agents/) | `dsh headless`, `codex exec`, `agy --print`, deterministički `mock` |
| Konfiguracija | [`tools/config/agents.yml`](tools/config/agents.yml) | uloga → adapter/harnes; prelazak na prave harnese je izmena ovog fajla |
| MCP konfiguracije | [`tools/config/mcp/`](tools/config/mcp/) | gotovi blokovi za dsh, codex i agy + `register.sh` |

## Kako se pokreće

```bash
# 1. Topologija, glavna grana, manifest izvora i prazan indeks.
node tools/orchestrator/cli.mjs init

# 2. Izvor u raw/ (nepromenljivo) + zadatak u tasks/inbox/.
node tools/orchestrator/cli.mjs ingest raw/dokument.md --title "Naslov beleške" --tag tema

# 3. Kontrolna petlja: dovršava započeto, pa otvara novi posao.
node tools/orchestrator/cli.mjs run --rounds 10

# Pojedinačne faze (isto što i petlja radi redom):
node tools/orchestrator/cli.mjs phase research   TASK-101
node tools/orchestrator/cli.mjs phase verify     TASK-101
node tools/orchestrator/cli.mjs phase consolidate TASK-101

# Nadzor
node tools/orchestrator/cli.mjs status            # zadaci, faze, zakupi, lint
node tools/orchestrator/cli.mjs lint              # invarijante ugovora (exit 2 na prekršaj)
node tools/orchestrator/cli.mjs log --limit 20    # Git revizorski trag (autor | poruka)
node tools/orchestrator/cli.mjs worktrees         # izolovana radna stabla
```

## Pet faza u praksi

```
raw/<izvor>.md
   │  1. ingest      agentctl  → tasks/inbox/TASK-NNN.md (status ready)
   ▼
.git worktrees/TASK-NNN-researcher   (grana agent/researcher/TASK-NNN)
   │  2. research    agy/Gemini → wiki/drafts/<Slug>.md, status review
   ▼
.git worktrees/TASK-NNN-verifier     (grana nad istraživačevom)
   │  3. verify      dsh/DeepSeek → tasks/reviews/TASK-NNN.md + VERDICT: pass|fail
   ▼
.git worktrees/TASK-NNN-consolidator (grana nad verifikatorovom)
   │  4. consolidate codex → wiki/<Slug>.md, status consolidated
   │                  rebase na main → merge --no-ff → čišćenje grana i stabala
   ▼
main: wiki/<Slug>.md + wiki/Index.md       5. reflect → izvedeni indeks i manifest
     tasks/completed/TASK-NNN.md
```

Odbijen verdikt (`fail`) vraća zadatak u `ready` sa nalazima u telu zadatka;
posle `maxRevisions` pokušaja zadatak ide u `blocked` (nikad u produkcioni
`wiki/`). Istekao zakup se automatski opoziva, a radno stablo uklanja.

## Veza specifikacija ↔ implementacija

| Tvrdnja iz specifikacije | Gde je dokaziva |
|---|---|
| „zajednička crna tabla … stanje problema, hipoteze, parcijalna rešenja" | `tasks/*/TASK-*.md` + `tasks/events.jsonl` (append-only tok događaja) |
| „izvori znanja se aktiviraju kada prepoznaju relevantno stanje" | `pipeline.runOnce()` bira zadatke po statusu, ne po porukama |
| „kontrolni mehanizam raspodeljuje resurse i rešava konflikte" | `store.claim/reclaimExpired`, `mergeIntoMain` (konflikt → `blocked` sa spiskom fajlova) |
| „`raw/` je nepromenljiv (append-only)" | `lint.mjs: raw.modified / raw.deleted / raw.git-diff`, `.agents/raw-manifest.json` |
| „`wiki/` se ne menja pre verifikacije" | nacrt živi u grani; `tests/pipeline.test.mjs` tvrdi da main ne vidi nacrt |
| „YAML zaglavlje sa datumom, autorima, statusom i oznakama" | `vault.mjs: NOTE_REQUIRED_FIELDS`, `lint: note.frontmatter` |
| „Vikilinkovi `[[…]]` grade semantički graf" | `vault.extractWikilinks/findBacklinks`, `lint: note.broken-link` |
| „zakup: `lock_owner`, `locked_at`, `lease_expires_at`" | `lease.mjs`, testovi isteka i otimanja |
| „izolacija kroz `git worktree`" | `worktree.mjs`, `tests/worktree.test.mjs` (izolacija, konflikt, merge) |
| „Gemini sintetiše, DeepSeek arbitrira, Codex integriše" | `agents.yml` + `agents/index.mjs` (dispečer po ulozi) |
| „MCP server sa tipiziranim alatima" | `tools/mcp/obsidian-mcp.mjs` + `tests/mcp.test.mjs` (pravi JSON-RPC preko stdio) |
| „pre modifikacije baze harness mora imati važeći zakup" | MCP proverava `OBSIDIAN_TASK` + status + zakup + pečat pre svakog upisa |
| „`raw/` je nepromenljiv" i za binarne izvore | manifest v2 hashira bajtove (`sha256Bytes`), test sa `.pdf` bajtom 0x80 → 0x81 |
| „revizorski uvid u doprinos svakog modela" | Git autor po komitu (`-c user.name=<agent>`), `agentctl log` |

## Prelazak na prave harnese

Podrazumevano su sva tri adaptera `mock`: to je deterministički zamenik istog
ugovora (iste zone upisa, isti izlazni format) koji omogućava da testovi i demo
provere **arhitekturu**, a ne kvalitet sadržaja. Pravi harnesi se uključuju
svesno, po pozivu, kroz odvojen config — da testovi ostanu deterministički i
besplatni:

```bash
node tools/orchestrator/cli.mjs ingest raw/<izvor>.md --title "Naslov" \
  --config tools/config/agents.real.yml
node tools/orchestrator/cli.mjs run --rounds 4 \
  --config tools/config/agents.real.yml
```

[`tools/config/agents.real.yml`](tools/config/agents.real.yml) je isti config sa
`adapter: harness` (`agy` → `dsh` → `codex`). Izlazni kod harnesa nije dokaz
uspeha: faza se priznaje samo ako je artefakt stvarno nastao u njenoj zoni.

Harnesi se pozivaju neinteraktivno, sa `cwd` postavljenim na njihovo izolovano
radno stablo i sa `OBSIDIAN_ROLE`/`OBSIDIAN_VAULT` u okruženju, pa im MCP server
automatski daje tačno onu zonu upisa koja im pripada:

```bash
./tools/config/mcp/register.sh --print   # ispiši blokove za dsh, codex i agy
./tools/config/mcp/register.sh --agy     # registruj kod Antigravity
./tools/config/mcp/register.sh --check   # proveri da server radi
node scripts/demo.mjs --real             # demo sa pravim harnesima (troši kvotu)
```

Antigravity se nikad ne poziva u paraleli: `runHarness` za `agy` uzima
globalni fajl-lock (`agy` ne trpi paralelne sesije).

## Odluke koje odstupaju od bukvalnog teksta specifikacije

1. **`wiki/Index.md` je izveden artefakt i njegov sadržaj se ne spaja.** Grane
   ga nasleđuju (praćen je fajl) i mogu da ga izmene, pa bi ga bez zaštite svaka
   grana menjala na svoj način i paralelni merge bi padao — ili, gore, na
   konfliktu tipa „dodato na obe strane". Zato kontrolni sloj pre rebase-a
   poravnava izvedene artefakte sa aktuelnim `main` (`alignGeneratedPaths`), a
   posle spajanja ih regeneriše iz stvarnog stanja skladišta (`agentctl index`).
   Isto važi za `.agents/raw-manifest.json`.
2. **Grana se pre spajanja rebase-uje na `main`.** Bez toga grana nosi i
   zastarelo stanje crne table (`tasks/`), jer je nastala u trenutku kada je
   zadatak bio u drugoj fazi, i Git odbija merge. Autorstvo komita se ne menja —
   rebase samo menja osnovu.
3. **Petlja dovršava započeto pre novog posla** (konsolidacija → verifikacija →
   istraživanje). Oportunistički redosled iz specifikacije, ali deterministički.
4. **`agy` piše u svom radnom stablu.** Uloga istraživača po specifikaciji
   podrazumeva upis nacrta; izolacija je ta koja sprečava da to ugrozi `main`.
   Konsolidaciju i merge i dalje radi isključivo `codex`/kontrolni sloj.

## Struktura repozitorijuma

```
.agents/            sistemski ugovor (AGENTS.md) i brief-ovi uloga
raw/                nepromenljivi izvori (append-only) + manifest u .agents/
wiki/               produkcione beleške i izvedeni Index.md
wiki/drafts/        nacrti istraživača (samo u granama)
tasks/inbox|active|review|completed/   stanje crne table
tasks/reviews/      revizorski tragovi verifikatora
tasks/events.jsonl  append-only tok događaja kontrolnog sloja
tools/orchestrator/ kontrolni sloj (agentctl + lib)
tools/mcp/          MCP server beleški
tools/config/       konfiguracija uloga i MCP blokovi
tests/              jedinični, integracioni i protokolski testovi
scripts/demo.mjs    petofazna demonstracija
.worktrees/         izolovana radna stabla (gitignore)
```

## Bezbednosni sloj MCP servera

Upis kroz MCP ima tri kapije, i sve tri su pokrivene testovima:

1. **Zona uloge (ortogonalna)** — `researcher` → `wiki/drafts/`, `verifier` →
   `tasks/reviews/`, `consolidator` → `wiki/<Slug>.md` (vrh, bez `drafts/`),
   `readonly` → ništa; `raw/` nikad.
2. **Zadatak i zakup** — `OBSIDIAN_TASK` mora da postoji u kontrolnom korenu
   (`OBSIDIAN_TASK_ROOT`, podrazumevano `main`), zakup mora biti živ i vlasništvo
   tog agenta. Za upis u produkciju dodatno je obavezan `verification.verdict:
   pass` i poklapanje imena beleške sa artefaktom zadatka.
3. **Realna putanja** — zona se proverava kroz `realpath`, pa simbolički link
   (`wiki/drafts/link -> raw`) ne može da izvede upis van zone; izvedeni
   artefakti (`wiki/Index.md`, `.agents/raw-manifest.json`, `tasks/events.jsonl`)
   nisu upisivi.

Kapija 2 se ne može zaobići preusmeravanjem `OBSIDIAN_TASK_ROOT` na prazan
direktorijum: odluka „da li je zadatak obavezan" donosi se po skladištu koje se
piše, a kontrolni koren mora sam da nosi `.agents/AGENTS.md`. Zadatak bez
artefakata ne otvara produkciju — prazna lista ne znači „sme bilo šta", nego da
zadatak nije prošao kroz fazu istraživanja.

## Manifest izvora (v1 → v2)

Manifest v2 čuva hash **bajtova**. Zapis iz v1 (hash dekodiranog teksta)
nadograđuje se automatski **samo** kada je osnova uporediva: fajl je validan
UTF-8 i hash se poklapa. Za binarne izvore stara osnova ne dokazuje ništa, pa
linter prijavljuje `raw.legacy-unknown` (greška) i ne dozvoljava da `index`
izmenu pretvori u novu osnovu. Rešenje je svesna ljudska radnja: ukloni zapis iz
`.agents/raw-manifest.json` i pokreni `agentctl index` — tada se uspostavlja
proverljiva osnova nad bajtovima.

Skladište koje ne nosi `.agents/AGENTS.md` (običan Obsidian vault) zadržava samo
kapiju 1 — tako MCP server ostaje upotrebljiv i van crne table.

**Kontekst zadatka u radnom stablu.** Pokazalo se da harnesi ne prosleđuju
okruženje MCP serveru isto: `dsh` i `agy` nasleđuju `OBSIDIAN_*`, a `codex exec`
prosleđuje samo svoju `env` tabelu. Zato kontrolni sloj pre svakog poziva upisuje
`.runtime/task-context.json` u radno stablo zadatka (gitignore — ne ulazi u
granu), a MCP server ga čita kao fallback: `env > fajl > podrazumevano`. Time
legitiman upis prolazi i kod harnesa koji ne nasleđuje okruženje, a
krivotvorenje tog fajla ne daje nove privilegije — upis i tako ide u radno
stablo agenta, a u `main` ulazi samo kroz kontrolni sloj koji proverava stvarno
stanje zadatka u kontrolnom korenu.

## Nezavisna verifikacija

Implementaciju je proveravao **drugi vendor** (OpenAI Codex), u odvojenoj
verifikacionoj niti, sa slepim ulazom (specifikacija + artefakt + falsifikabilne
tvrdnje, bez reasoninga izvršioca). U tri runde je oboreno **10 nalaza** —
od binarnog izvora koji se menjao bez prijave, preko simboličkog linka koji je
izvodio upis van zone, do konsolidatora koji je mogao da upiše u `wiki/` bez
zadatka i pečata. Svaki nalaz je ispravljen i pokriven regresionim testom koji
reprodukuje **verifikatorov** kontraprimer.

Detalji, komande i dokazi: [`VERIFIKACIJA.md`](VERIFIKACIJA.md).

## Registrovano u ovom okruženju

MCP server beleški je registrovan kod sva tri harnesa i proveren živim pozivom:

| Harnes | Gde je registracija | Dokaz |
|---|---|---|
| `agy` | `~/.gemini/config/mcp_config.json` (`agy mcp add obsidian …`) | `agy mcp list` → `obsidian stdio enabled` |
| `codex` | `~/.codex/config.toml` → `[mcp_servers.obsidian]` | `codex mcp list` → `obsidian enabled`; živi poziv `obsidian_vault_info` kroz `codex exec` |
| `dsh` | `~/.dsh/profiles/headless/cordis.patch.yml` | `dsh --profile headless --dump-config` → `obsidian-mcp`; živi poziv kroz `dsh headless` |

Konfiguracije nose **samo identitet** (`OBSIDIAN_AGENT`, `OBSIDIAN_ROLE`);
`OBSIDIAN_VAULT`, `OBSIDIAN_TASK` i `OBSIDIAN_TASK_ROOT` dolaze po pozivu, jer
statična `env` tabela pobjeđuje nasleđeno okruženje. Backup pre izmena:
`~/.dsh/config-backup-<datum>/`.

## Ograničenja koja treba znati

- **`mock` nije dokaz kvaliteta sadržaja.** On dokazuje tok, izolaciju i
  automat stanja; faktografsku ispravnost može proveriti samo pravi harnes.
- **`raw/` manifest je jedini izvor istine van Git-a.** Ako je izvor izmenjen
  pre nego što je prvi put registrovan, izmena se ne vidi; zato `agentctl init`
  i svaki `reflect` registruju nove fajlove.
- **Konflikt pri merge-u ne rešava se automatski** — zadatak ide u `blocked` sa
  spiskom konfliktnih fajlova, a radna stabla se zadržavaju za arbitražu.
- **Windows/CRLF nije testiran**; sistem koristi POSIX `fs.open(…, 'wx')` za
  fajl-lockove i `git worktree`.
