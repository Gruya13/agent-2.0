Pregledana revizija: **`9f61db88de259af10dc079a93f5a860e4320507a`**.

Tri tačna prethodna kontraprimera sada su zatvorena. **Zaštita kontrolnog korena ipak ima novi, dokaziv zaobilazak preko symlink-a.**

| Tvrdnja | Ishod | Dokaz |
|---|---|---|
| 1. Nedostajući/oštećen manifest ne registruje novu osnovu | **POTVRĐENO** | Obe probe prijavljuju grešku; manifest nije obnovljen, prethodni commit zadržava stari hash. |
| 2. Tuđ validan kontrolni koren ne odobrava upis | **OBORENO u opštem obliku** | Direktan raniji pokušaj odbijen; symlink putanja unutar drugog korena ponovo omogućava upis tuđim tokenom. Normalno radno stablo prolazi. |
| 3. `init` čuva tuđ `.agents` fajl, a prenosi ugovor | **POTVRĐENO** | Tuđ fajl ostaje untracked; ugovor i osam role fajlova prisutni u novom radnom stablu. |
| Ranija 1: tačan coding commit i očuvanje tuđeg wiki rada | **POTVRĐENO** | Ponovljeni coding, konsolidacija i `ready` scenariji. |
| Ranija 5: odbijanje ne proširuje artefakte i ne prepisuje znanje | **POTVRĐENO u probama** | `artifacts-same true`; postojeća beleška sačuvana; retry prolazi posle nove verifikacije. |
| Ranija 6: memorija ne proširuje opseg | **POTVRĐENO u probi** | Instrukcija iz beleške ne odobrava izmenu `package.json`; projektni `MEMORY.md` sačuvan. |
| Ranija 7: dokaz u klonu i oporavak | **POTVRĐENO** | Oba taga i commita dostupni u zasebnom klonu; `body-equal true`; oporavak posle greške taga prolazi. |
| Ranija 8: coding uspeh i wiki neuspeh razlikuju se | **POTVRĐENO** | `ok:false`, status `verified`, sačuvana greška; retry izvršava fazu `memory`. |

Programi i puni izlazi: [`.verification/`](/home/gru/.agent-worktrees/verify-session-08b4-codex/.verification).

### 1. Manifest

Komande:

```bash
TMPDIR="$PWD/.verification/tmp" node .verification/check.mjs manifest-missing
TMPDIR="$PWD/.verification/tmp" node .verification/check.mjs manifest-corrupt
```

Obe daju:

```text
ERROR undefined .agents/raw-manifest.json je oštećen ili nedostaje, a postojao je u istoriji — nova osnova se ne uspostavlja automatski
```

Naknadno očitavanje:

```text
manifest-missing manifest-after: ENOENT
HEAD-manifest: 7cd4db8c0ed737c0d1b481edc908ca962ca02ced97d41d0fe4ed1b989508ec82
manifest-corrupt manifest-after: {BROKEN
HEAD-manifest: 7cd4db8c0ed737c0d1b481edc908ca962ca02ced97d41d0fe4ed1b989508ec82
```

Izmenjeni izvor nije registrovan novim hash-om. Očekivano i dobijeno poklapaju se.

### 2. Kontrolni koren: raniji pokušaj odbijen, symlink prolazi

```bash
TMPDIR="$PWD/.verification/tmp" node .verification/access.mjs
```

Normalan upis iz stvarnog Git radnog stabla unutar svog kontrolnog korena:

```text
normal {"code":0,"stdout":"upisano wiki/drafts/normal.md (138 B) uloga=researcher",...}
```

Raniji direktan pokušaj sa drugim kontrolnim korenom:

```text
different-root {"code":1,...,"stderr":"obsidian-mcp: skladište .../agent2-vault-4Rh9Ba nije u kontrolnom korenu .../agent2-vault-OxF72c — upis je odbijen",...}
```

**Novi kontraprimer:** u drugom korenu napravljen je symlink:

```text
agent2-vault-OxF72c/linked-vault -> agent2-vault-4Rh9Ba
```

MCP dobija:

```text
OBSIDIAN_VAULT=<drugi-koren>/linked-vault
OBSIDIAN_TASK_ROOT=<drugi-koren>
OBSIDIAN_AGENT=other
OBSIDIAN_LEASE_TOKEN=other-secret
```

Stvarni izlaz:

```text
symlink-root {"code":0,"stdout":"upisano wiki/drafts/symlink-root.md (146 B) uloga=researcher",...,"originalOwner":"agy"}
```

Program je izračunao:

```text
vault:     .../agent2-vault-OxF72c/linked-vault
realVault: .../agent2-vault-4Rh9Ba
root:      .../agent2-vault-OxF72c
```

**Očekivano:** odbijanje, jer stvarni vault pripada prvom korenu, čiji zadatak drži `agy`.  
**Dobijeno:** fajl je upisan u prvi vault korišćenjem zadatka i tokena drugog.

Uzrok je tekstualno poređenje `VAULT === TASK_ROOT || VAULT.startsWith(...)`, bez realpath poređenja u [obsidian-mcp.mjs:220](/home/gru/.agent-worktrees/verify-session-08b4-codex/tools/mcp/obsidian-mcp.mjs:220).

Ovaj scenario zahteva mogućnost pravljenja symlink-a i zadavanja MCP okruženja; nije OS eskalacija.

### 3. Svež `init` i ugovor u radnom stablu

```bash
TMPDIR=/tmp node .verification/init.mjs
```

Svež fixture napravljen je izvan drugog Git repozitorijuma.

```text
init {"code":0,...}
status ?? .agents/FOREIGN.txt
?? tasks/
foreign KEEP_PRIVATE
```

U Git stablu postoje `.agents/AGENTS.md` i svih osam `.agents/roles/*.md`. Nakon stvarnog `git worktree add`:

```text
worktree-contract {"contract":true,"roles":["consolidator.md","extractor.md","librarian.md","programer.md","red-team.md","researcher.md","reviewer.md","verifier.md"],"foreign":false}
```

Tuđ fajl ostaje na disku prvobitnog vault-a, nije commit-ovan niti prenet u radno stablo.

### Kratke kontrole regresija

Izvršeno:

```bash
for mode in code-clean code-failure code-collision code-memory ready consolidate retry proof; do
  TMPDIR="$PWD/.verification/tmp" node .verification/check.mjs "$mode"
done
```

Relevantni stvarni izlazi:

```text
code-clean:
"status":"consolidated"
"memory_write":"wiki/Izmene/TASK-101.md"
```

Commit coding memorije sadrži samo `wiki/Izmene/TASK-101.md`; tuđe wiki beleške ostaju sačuvane i nekomitovane.

```text
code-memory:
implement {"phase":"code","task":"TASK-101","ok":false,"reason":"izmena van dozvoljenog opsega: package.json","attempts":1}
```

```text
retry:
artifacts-same true
consolidate {"phase":"consolidate","task":"TASK-101","ok":true,"merge":"d6bd17efaa14f76751f064dfdb2cbb20a0a21e0d"}
body-equal true
```

```text
proof:
proof-failure {"phase":"consolidate","task":"TASK-101","ok":false,"reason":"dokaz nije sačuvan"}
proof-state verified null
consolidate {"phase":"consolidate","task":"TASK-101","ok":true,"merge":"2090865208aafdc0d8cb550dc655f7bc233af79f"}
clone dokaz/TASK-101-verify commit
clone dokaz/TASK-101-challenge commit
clone 4d094c5bc552a27d14a2d44e07911c23e4df5a6f commit
clone 83b2bb69efa87d410768aeec1659dab0b32daa75 commit
body-equal true
```

```text
code-failure:
"status":"verified"
"memory_write":null
```

Greška wiki zapisa sačuvana je u `memory_write_error`; rezultat je `ok:false` uz identifikovan prihvaćeni merge. Nakon uklanjanja `index.lock`:

```text
retry {"phase":"code","task":"TASK-101","ok":true,"step":"memory"}
retry-status consolidated
```

### Testovi, ograničenja i stanje checkout-a

```bash
node --test tests/wiki-integrity.test.mjs tests/mcp.test.mjs
```

```text
ℹ tests 29
ℹ pass 29
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
```

Korišćeni su mock adapteri i privremeni fixture-ovi. Ceo skup testova nije ponavljan; nije proveravana sadržajna sposobnost stvarnih modela niti potpuna otpornost na konkurentne izmene. Pronađeni symlink zaobilazak nije pokriven prolazećim testovima iz ove komande.

```console
$ git diff --exit-code
$ git rev-parse HEAD
9f61db88de259af10dc079a93f5a860e4320507a
$ git status --porcelain
?? .verification/
```

`git diff --exit-code` završio je sa 0. Kandidat i glavni workspace nisu menjani.
