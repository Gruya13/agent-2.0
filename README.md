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
provere **arhitekturu**, a ne kvalitet sadržaja. Za prave modele dovoljna je
izmena [`tools/config/agents.yml`](tools/config/agents.yml):

```yaml
agents:
  researcher:   { adapter: harness, harness: agy }    # agy --print
  verifier:     { adapter: harness, harness: dsh }    # dsh --profile headless
  consolidator: { adapter: harness, harness: codex }  # codex exec
```

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

1. **`wiki/Index.md` je izveden artefakt i ne putuje kroz grane.** Specifikacija
   dodeljuje ažuriranje indeksa Codex-u. U praksi bi ga tada svaka grana menjala
   na svoj način, pa bi svaki paralelni merge padao na konfliktu (ili, gore, na
   konfliktu tipa „dodato na obe strane" kada `main` već ima indeks). Zato
   konsolidator uređuje belešku, a indeks regeneriše kontrolni sloj u `main`
   posle spajanja (`agentctl index`). Uloge i tok su isti; vlasništvo nad
   generisanim fajlom je eksplicitno.
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

1. **Zona uloge** — `researcher` → `wiki/drafts/`, `verifier` → `tasks/reviews/`,
   `consolidator` → `wiki/`, `readonly` → ništa; `raw/` nikad.
2. **Zadatak i zakup** — `OBSIDIAN_TASK` mora da postoji u kontrolnom korenu
   (`OBSIDIAN_TASK_ROOT`, podrazumevano `main`), zakup mora biti živ i vlasništvo
   tog agenta. Za upis u produkciju dodatno je obavezan `verification.verdict:
   pass` i poklapanje imena beleške sa artefaktom zadatka.
3. **Realna putanja** — zona se proverava kroz `realpath`, pa simbolički link
   (`wiki/drafts/link -> raw`) ne može da izvede upis van zone; izvedeni
   artefakti (`wiki/Index.md`, `.agents/raw-manifest.json`, `tasks/events.jsonl`)
   nisu upisivi.

Skladište koje ne nosi `.agents/AGENTS.md` (običan Obsidian vault) zadržava samo
kapiju 1 — tako MCP server ostaje upotrebljiv i van crne table.

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
