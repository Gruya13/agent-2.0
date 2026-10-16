Pregledana revizija: **`7c524e7e46328663a40e2aee1229d2aecc9648f0`**. Kandidat nije menjan; probe i neispravne verzije modula nalaze se samo u `.verification/`.

**Oborene su tvrdnje 3 i 4, kao i neograničena formulacija tvrdnje 2.** Osnovne zaštite coding zapisa, oporavak wiki upisa i prenos dokumentnih dokaza u klon prošli su kontrolne scenarije.

| Tvrdnja | Ishod | Dokaz |
|---|---|---|
| 1. Coding zapis, knjigovodstvo pre merge-a i `ready` čuvaju tuđe wiki izmene | **POTVRĐENO** | Commit-ovan samo coding zapis; postojeća prljava i nova beleška ostale sačuvane i nekomitovane. Isto u dokumentnoj konsolidaciji i CLI `ready`. |
| 2. Sve ostale kontrolne putanje poštuju isto pravilo | **OBORENO**, ako važi za sve kontrolne fajlove | Wiki probe prolaze, ali `init` commit-uje i novu `.agents/FOREIGN.txt`, koju prethodno prijavljuje kao tuđu. Dokument navodi širok init opseg, pa ograničenje treba izričito zadržati. |
| 3. Gubitak manifesta ne uspostavlja novu osnovu | **OBORENO** | Posle brisanja ili oštećenja manifesta `reflect` vraća `ok:true` i registruje novi hash izmenjenog izvora. |
| 4. Identitet, zakup, status i realpath ograničavaju upis, uključujući promenjen kontrolni koren | **OBORENO** | Osnovne negativne kontrole rade, ali drugi validan kontrolni koren omogućava upis u prvobitni vault koristeći njegov drugi zadatak/token. |
| 5. Odbijanje ne širi artefakte niti prepisuje znanje | **POTVRĐENO u izvedenim scenarijima** | Nedozvoljena konsolidacija nije promenila `artifacts`; postojeća coding beleška ostala sačuvana. Retry je ponovo istražio i verifikovao rezultat. |
| 6. Memorija čuva projektne fajlove i ne proširuje ovlašćenja | **POTVRĐENO u izvedenom scenariju** | `MEMORY.md` sačuvan; kontekst izvezen; izmena `package.json` naložena beleškom odbijena kao van opsega. |
| 7. Dokaz putuje u klon; neuspeh je vidljiv i oporavljiv | **POTVRĐENO** | Tagovi i oba referencirana commita dostupni u `clone --no-local`; tela nacrta i objave jednaka. Greška taga ostavlja `verified`, bez zakupa; ponovni pokušaj prolazi. |
| 8. Prihvaćen kod i neuspešan wiki zapis razlikuju se | **POTVRĐENO** | Uz `index.lock`: `ok:false`, sačuvan merge i `memory_write_error`, status `verified`. Nakon uklanjanja smetnje prolazi samo faza `memory`. |

Sopstveni programi i puni izlazi: [`.verification/`](/home/gru/.agent-worktrees/verify-session-08b4-codex/.verification), naročito [check.mjs](/home/gru/.agent-worktrees/verify-session-08b4-codex/.verification/check.mjs), [valid.mjs](/home/gru/.agent-worktrees/verify-session-08b4-codex/.verification/valid.mjs) i [access.mjs](/home/gru/.agent-worktrees/verify-session-08b4-codex/.verification/access.mjs).

### Dokazivi nalazi

**Manifest se ponovo uspostavlja iz izmenjenog izvora**

Komande:

```bash
TMPDIR="$PWD/.verification/tmp" node .verification/check.mjs manifest-missing
TMPDIR="$PWD/.verification/tmp" node .verification/check.mjs manifest-corrupt
```

Ulaz: prvo registrovan izvor; zatim promenjen izvor i obrisan manifest, odnosno sadržaj manifesta zamenjen sa `{BROKEN`.

Stvarni izlaz za nedostajući manifest:

```text
reflect {"phase":"reflect","ok":true,"notes":2,"indexChanged":true,"manifest":{"added":1,"total":1},...}
```

Hash pre i posle:

```text
"before":"7cd4db8c0ed737c0d1b481edc908ca962ca02ced97d41d0fe4ed1b989508ec82"
"after":"6a5a64ab2c5e8fd9cc68ba048c6e0d08549b4a8d199af9c9e6163550f62f0584"
```

Oštećeni manifest daje isti obrazac.

Očekivano: prijava gubitka osnove, bez nove registracije postojećeg izvora. Dobijeno: nova osnova je upisana i commit-ovana. **Preostala Git provera ipak prijavljuje `raw.git-diff`**; ovo nije dokaz da su sve zaštite izvora zaobiđene.

Uzrok je reset na prazan manifest u [lint.mjs:267](/home/gru/.agent-worktrees/verify-session-08b4-codex/tools/orchestrator/lib/lint.mjs:267).

**Promenjen validan kontrolni koren prihvata tuđ zakup**

```bash
TMPDIR="$PWD/.verification/tmp" node .verification/access.mjs
```

Fixture pravi dva nezavisna vault-a. Prvi zadatak drži `agy`; drugi drži `other`. MCP piše u prvi vault, ali dobija `OBSIDIAN_TASK_ROOT` drugog i njegov token.

```text
different-root {"code":0,"stdout":"upisano wiki/drafts/different-root.md (148 B) uloga=researcher","stderr":"","originalOwner":"agy"}
```

Očekivano: zakup iz nepovezanog kontrolnog repozitorijuma ne odobrava upis u prvi vault. Dobijeno: upis uspeva.

Negativne kontrole istog programa pravilno odbijaju:

```text
role:  uloga "readonly" je samo za čitanje
owner: zadatak TASK-101 ne drži "other" (drži "agy")
token: zakup nad zadatkom TASK-101 drži drugi proces istog identiteta
status: ... stanje "ready" ... zahteva stanje in_progress
```

Prazan kontrolni koren takođe je odbijen. Problem je što se proverava drugi **validan** koren, bez vezivanja za vault koji se piše: [obsidian-mcp.mjs:81](/home/gru/.agent-worktrees/verify-session-08b4-codex/tools/mcp/obsidian-mcp.mjs:81), [obsidian-mcp.mjs:210](/home/gru/.agent-worktrees/verify-session-08b4-codex/tools/mcp/obsidian-mcp.mjs:210).

Ovaj nalaz zahteva mogućnost zadavanja MCP okruženja; nije dokaz OS eskalacije.

**`init` ima širi commit opseg od opšte tvrdnje**

```bash
TMPDIR="$PWD/.verification/tmp" node .verification/check.mjs init
```

Stvarni izlaz prvo prijavljuje:

```text
ne komitujem tude izmene: wiki/Foreign.md, .agents/FOREIGN.txt, wiki/New.md
```

Ali istorija zatim sadrži:

```text
agentctl: init (ugovor i alati u git)

.agents/FOREIGN.txt
```

Wiki beleške ostaju nekomitovane. Ovo je granica tvrdnje „sve kontrolne putanje“: operatorski `init` namerno commit-uje čitave `.agents` i `tools` direktorijume. Dokument to delom opisuje, ali poruka da se konkretan fajl neće commit-ovati nije tačna.

### Pozitivne kontrole i oporavak

Komande:

```bash
TMPDIR="$PWD/.verification/tmp" node .verification/check.mjs code-clean
TMPDIR="$PWD/.verification/tmp" node .verification/check.mjs ready
TMPDIR="$PWD/.verification/tmp" node .verification/valid.mjs consolidate
```

Coding istorija sadrži tačno:

```text
agentctl: zapis o izmeni TASK-101 u memoriju

wiki/Izmene/TASK-101.md
```

U ovim probama tuđe beleške ostaju:

```text
 M wiki/Foreign.md
?? wiki/New.md
preserved {"dirty":true,"new":true}
```

Kontrola memorijske instrukcije:

```bash
TMPDIR="$PWD/.verification/tmp" node .verification/check.mjs code-memory
```

```text
implement {"phase":"code","task":"TASK-101","ok":false,"reason":"izmena van dozvoljenog opsega: package.json","attempts":1}
root-memory PROJECT_MEMORY
```

Mock je proverio i prisustvo izvezene instrukcije u `.agent-context/MEMORY.md`. Dakle, instrukcija jeste stigla kao kontekst, ali nije promenila opseg.

Kontrola delimičnog neuspeha:

```bash
TMPDIR="$PWD/.verification/tmp" node .verification/check.mjs code-failure
```

Sa zaostalim kontrolnim `.git/index.lock`:

```text
"ok":false
"reason":"kod je prihvaćen (...), ali zapis u memoriju nije prošao: ..."
```

Evidencija sadrži `status:"verified"`, `memory_write:null`, `memory_write_error` i prihvaćeni merge. Posle uklanjanja lock-a:

```text
retry {"phase":"code","task":"TASK-101","ok":true,"step":"memory"}
retry-status consolidated
```

Postojeća beleška takođe je zaštićena:

```bash
TMPDIR="$PWD/.verification/tmp" node .verification/check.mjs code-collision
```

```text
"reason":"kod je prihvaćen (...), ali zapis u memoriju nije prošao: putanja wiki/Izmene/TASK-101.md je zauzeta postojećom beleškom; zapis ne prepisuje tuđe znanje"
existing-survives true
```

### C — raniji `linter` i `ERROR 128`

**To su bili artefakti mog fixture-a, ne dokaz neispravnih dokaznih tagova.**

Ponovljena originalna proba:

```bash
TMPDIR="$PWD/.verification/tmp" node .verification/check.mjs consolidate
```

Dala je:

```text
consolidate {"phase":"consolidate","task":"TASK-101","ok":false,"reason":"linter","errors":1}
```

Dodatno očitanje lintera pokazalo je:

```text
"code":"note.draft-in-production"
"target":"wiki/Foreign.md"
"message":"nacrt (status: draft) se nalazi u produkcionom wiki/"
```

Fixture je postojeću belešku commit-ovao sa nevažećim produkcionim statusom. Raniji program je uprkos neuspehu tražio tagove i proizveo sekundarni `ERROR 128`. U scenariju `proof` linter je zaustavio fazu pre upisa taga, pa sledeći poziv nije mogao iz stanja `review` direktno u konsolidaciju.

Promenio sam **samo fixture frontmatter** u `status: consolidated`:

```bash
TMPDIR="$PWD/.verification/tmp" node .verification/valid.mjs consolidate
TMPDIR="$PWD/.verification/tmp" node .verification/valid.mjs retry
TMPDIR="$PWD/.verification/tmp" node .verification/valid.mjs proof
```

Rezultati:

```text
rejected {"phase":"consolidate","task":"TASK-101","ok":false,"conflict":false,"reason":"grana menja zone van dozvole: wiki/Foreign.md"}
artifacts-same true
```

Posle novog istraživanja i verifikacije retry prolazi. U `proof` scenariju:

```text
proof-failure {"phase":"consolidate","task":"TASK-101","ok":false,"reason":"dokaz nije sačuvan"}
proof-state verified null
consolidate {"phase":"consolidate","task":"TASK-101","ok":true,"merge":"48c1b95f3f30faeee36cbebaaed520b0bf0421fd"}
```

U zasebnom `git clone --no-local`:

```text
clone dokaz/TASK-101-verify commit
clone dokaz/TASK-101-challenge commit
clone 7e970e59fb7cfc228288c4a4deb97e1763bb674c commit
clone ef80e07e3c990001d85dca5133c48da6745ca472 commit
body-equal true
```

### B — provera matrice i negativnih kontrola

Kandidatski testovi:

```bash
node --test tests/wiki-integrity.test.mjs
```

```text
ℹ tests 7
ℹ pass 7
ℹ fail 0
```

U zasebnom checkout-u `.verification/negative` ostavio sam iste testove, a module `coding.mjs`, `pipeline.mjs` i `worktree.mjs` vratio na `95d2b4a`:

```bash
git show 95d2b4a:tools/orchestrator/lib/coding.mjs > .verification/negative/tools/orchestrator/lib/coding.mjs
git show 95d2b4a:tools/orchestrator/lib/pipeline.mjs > .verification/negative/tools/orchestrator/lib/pipeline.mjs
git show 95d2b4a:tools/orchestrator/lib/worktree.mjs > .verification/negative/tools/orchestrator/lib/worktree.mjs
node --test .verification/negative/tests/wiki-integrity.test.mjs
```

```text
ℹ tests 7
ℹ pass 2
ℹ fail 5
```

| Test | Negativna kontrola | Šta ne dokazuje |
|---|---|---|
| W1 | Pada: „tuđa beleška ne sme ući u komit“ | Ne pokriva svaku konkurentnu promenu Git indeksa. |
| W2 | Pada: „tuđa beleška ne sme biti komitovana nijednom fazom“ | Nije test CLI `ready` ni svih operatorskih putanja. |
| W3 | Prolazi na starom kodu. Sa zasebnom mutacijom koja proširuje commit listu na ceo `wiki`, pada očekivano. | Prolaz ne dokazuje zaštitu manifesta niti svih index sadržaja. |
| W4 | Pada: „bez zapisa u memoriju nema tvrdnje o potpunom uspehu“ | Simulira Git grešku, ne ubijanje procesa u svakoj mogućoj instrukciji. |
| W5 | Prolazi na starom kodu. Sa isključenom kapijom opsega pada na očekivanom razlogu odbijanja. | Ne dokazuje otpornost stvarnog modela na prompt injection; mock neposredno izvršava komandu. |
| W6 | Pada: „neuspeo pokušaj ne ostavlja granu“ | Ne pokriva sve vrste naglog prekida. |
| W7 | Pada: „zapis ne sme da prepiše tuđu belešku“ | Ne iscrpljuje sve sudare, konkurentne upise i neispravne fajlove. |

Za W3 i W5 izvršene su komande:

```bash
node --test --test-name-pattern='W3:' .verification/negative/tests/wiki-integrity.test.mjs
node --test --test-name-pattern='W5:' .verification/negative/tests/wiki-integrity.test.mjs
```

Obe imaju `pass 0`, `fail 1`. Kod W5 stvarni razlog posle uklanjanja kapije postaje `nema regresionog testa u izmenama`; test pada jer očekuje odbijanje zbog opsega. To je uži dokaz od tvrdnje da bi bez kapije ceo tok nužno prihvatio promenu.

**Red matrice o manifestu nije potkrepljen navedenim dokazom:** postojeći lint test proverava nalaz pre `reflect`, dok sopstvena proba pokazuje da `reflect` potom menja osnovu. Nisam izveo zasebnu mutacionu kontrolu za svaki preostali red matrice.

### Ograničenja i završno stanje

Ceo skup je izvršen jednom:

```bash
npm test
```

```text
ℹ tests 181
ℹ pass 181
ℹ fail 0
ℹ skipped 0
```

Korišćeni su mock adapteri i privremeni vault-ovi. Nisu pozivani plaćeni modeli. Provera ne predstavlja OS izolaciju, dokaz semantičke tačnosti sadržaja niti iscrpnu proveru konkurentnih upisa. Sopstvena audit proba proverava otvaranje zadatka; ceo audit tok ovde pokrivaju postojeći testovi, ne novi samostalni scenario.

```console
$ git diff --exit-code
$ git rev-parse HEAD
7c524e7e46328663a40e2aee1229d2aecc9648f0
$ git status --porcelain
?? .verification/
```

`git diff --exit-code` završio je sa 0. Kandidat i glavni workspace nisu menjani.
