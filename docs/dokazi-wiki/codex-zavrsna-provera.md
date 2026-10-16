Pregledana revizija: **`60819440a35149dd7727f6675361000e3ad522ff`**.

**Symlink korekcija potvrđena je u testiranim varijantama.** Artefakti potvrđuju uspešan coding ogled A, blokirane oglede B/C i konsolidovan audit D. Kod B razlikujem ispravno sprovedenu blokadu od sadržajne opravdanosti svakog nalaza.

| Tvrdnja | Ishod | Dokaz |
|---|---|---|
| Tuđ kontrolni koren odbija upis | **POTVRĐENO** | MCP exit 1. |
| Symlink unutar tuđeg korena ne zaobilazi granicu | **POTVRĐENO** | MCP exit 1. |
| Sopstveno radno stablo i dalje radi | **POTVRĐENO** | MCP exit 0. |
| Relativna putanja, promenjen cwd i symlink korena ne daju isprobani zaobilazak | **POTVRĐENO u probama** | Tuđe varijante odbijene; alias sopstvenog korena prolazi. |
| A: objavljena je tačno pregledana coding promena | **POTVRĐENO** | Dva dozvoljena fajla; jednak review SHA, tag i prihvaćeni SHA; jednaka Git stabla; testovi 7/7. |
| B: blokada nije tihi uspeh | **POTVRĐENO** | `blocked`, poslednja verifikacija `fail`, četiri odbijanja, nema produkcione beleške ni zakupa. |
| B: svaki reprodukovani nalaz dokazuje semantičku grešku | **OBORENO** | Provereni NALAZ-1 dokazuje odsustvo reči u jednoj rečenici, ne nužno promenu značenja. |
| C: fragment čuva referentne vrednosti, objavu je zaustavila zona | **POTVRĐENO** | PDF i transkript se poklapaju; dodatna produkciona meta `wiki/tabela.md` odbijena. |
| D: izmena je u audit opsegu i spojena revizorskim kanalom | **POTVRĐENO** | Librarian menja samo postojeću `wiki/Flatpak.md`; audit izveštaj, verifikacija, dokazni tagovi i revizorski merge postoje. |

Programi i izlazi sačuvani su u [`.verification/`](/home/gru/.agent-worktrees/verify-session-08b4-codex/.verification).

### Deo 1 — granica kontrolnog korena

Sopstveni fixture pravi dva nezavisna vault-a, njihove zadatke i različite tokene, stvarni Git worktree i symlink alias-e.

```bash
TMPDIR=/tmp node .verification/access.mjs
```

Stvarni izlazi, sa skraćenim putanjama:

```text
normal: code 0
upisano wiki/drafts/normal.md (138 B) uloga=researcher

foreign: code 1
obsidian-mcp: skladište /tmp/agent2-vault-7JS4GJ nije u kontrolnom korenu /tmp/agent2-vault-7WEWCN — upis je odbijen

linked-vault: code 1
obsidian-mcp: skladište /tmp/agent2-vault-7WEWCN/linked nije u kontrolnom korenu /tmp/agent2-vault-7WEWCN — upis je odbijen

relative: code 1
obsidian-mcp: skladište /tmp/agent2-vault-7JS4GJ nije u kontrolnom korenu /tmp/agent2-vault-7WEWCN — upis je odbijen

foreign-root-link: code 1
obsidian-mcp: skladište /tmp/agent2-vault-7JS4GJ nije u kontrolnom korenu /tmp/codex-realpath-yC8Xit/b-root — upis je odbijen

own-root-link: code 0
upisano wiki/drafts/own-root-link.md (145 B) uloga=researcher
```

Relativna proba pokrenuta je iz tuđeg korena sa `OBSIDIAN_TASK_ROOT=.`. Symlink samog tuđeg korena takođe je odbijen. Alias sopstvenog korena pravilno prolazi.

Nisam našao nov zaobilazak u ovim varijantama. To ne isključuje konkurentnu zamenu putanja između provere i upisa.

```bash
node --test tests/mcp.test.mjs
```

```text
ℹ tests 22
ℹ pass 22
ℹ fail 0
ℹ skipped 0
```

### Deo 2 — poreklo i dostupnost artefakata

Napravio sam zasebne klonove:

```bash
for name in k11-vault k11-target k11b-vault k11c-vault k11d-vault; do
  git clone -q --no-local "/home/gru/$name" ".verification/$name"
done
node .verification/artifacts.mjs
```

Sačuvani zadaci A, B i D, kao i D audit izveštaj, **bajt-identični su odgovarajućim fajlovima u klonovima**:

```text
A-TASK-101.md byte-equal True
B-TASK-101.md byte-equal True
D-TASK-101.md byte-equal True
D-audit-izvestaj.md byte-equal True
```

Sva četiri zadatka imaju:

```text
lock_owner: null
lease_expires_at: null
```

Živi vault-ovi imaju nekomitovanu izmenu samo u `tasks/events.jsonl`; ciljni repo A je čist. Te nekomitovane događaje klonovi ne prenose.

### A — coding

Zahtev traži očuvanje nule u `parseRange`, uključujući `0-3` i `0`, uz očuvanje postojećih testova.

```bash
git -C .verification/k11-target diff --name-status 58522ff 3c7cf7c
```

```text
M	src/range.js
A	tests/range-zero.test.js
```

Drugih objavljenih promena nema. `MEMORY.md` ima isti blob na osnovici i posle merge-a:

```bash
git -C .verification/k11-target rev-parse \
  'HEAD:MEMORY.md' '58522ff:MEMORY.md'
```

```text
6a665a1d4b3a3e47def3dfc54600b959c64207cc
6a665a1d4b3a3e47def3dfc54600b959c64207cc
```

Evidencija zadatka i stvarni target:

```text
review.sha:       428a7ec600c8d82311d233f5e2f0827dd7651d84
accept.reviewed:  428a7ec600c8d82311d233f5e2f0827dd7651d84
dokaz/TASK-101-accept:
                  428a7ec600c8d82311d233f5e2f0827dd7651d84
merge:            3c7cf7cdd52da9367ef97cbee77013d5f5bfb546
```

```bash
git -C .verification/k11-target rev-parse \
  '428a7ec^{tree}' '3c7cf7c^{tree}'
```

```text
9d0b6ba6e73cd9727a7692d7c0f1b762badde9df
9d0b6ba6e73cd9727a7692d7c0f1b762badde9df
```

To je i `integration.tree` iz zadatka, uz zabeleženi `npm test`, exit 0. Nezavisno ponovno izvršavanje:

```bash
npm --prefix .verification/k11-target test
```

```text
ℹ tests 7
ℹ pass 7
ℹ fail 0
ℹ skipped 0
```

Wiki sadrži `wiki/Izmene/TASK-101.md`; zadatak je `consolidated`, bez greške memorijskog zapisa.

### B — dokumentni ogled

Zadatak je stvarno blokiran:

```text
status: blocked
verification.verdict: fail
blocked_reason:
nacrt je odbijen 4 puta (dozvoljeno 3); potrebna ljudska intervencija
```

Istorija pokazuje prvi povratak posle challenge nalaza, zatim odbijanja označena pokušajima 2 i 3, pa konačnu blokadu posle četvrtog odbijanja. Produkcioni `wiki/` u main-u sadrži samo `Index.md`.

Reference su dostupne i u zasebnom klonu:

```text
fbcaf6f6f8f03ed45da82167e05bad9e206c1f98 commit
098d9463d022c1c0840329c4ce8faef8c3d9a4ba commit
```

**Sadržajna rezerva:** reprodukovao sam NALAZ-1 na zamrznutoj challenge reviziji. Skript izlazi sa 0 i ispisuje `OBORENO`, jer rečenica izvora kaže:

> Aplikacije se pokreću u sandbox-u…

a nacrt to pripisuje Flatpak-u. Skript proverava da reč „Flatpak“ ne postoji u toj pojedinačnoj rečenici. To samo po sebi ne dokazuje semantičku grešku: naslov i prethodne rečenice već govore o Flatpak-u, pa je takvo razrešenje subjekta moguće.

Nasuprot tome, završni nacrt naziva Flathub „servisom za distribuciju“, dok kratki izvor daje samo statistiku preuzimanja. To jeste dodatna definicija koju sam izvor ne obrazlaže. Dakle:

- blokada i broj odbijanja operativno su potvrđeni;
- postoji osnov za primedbu o dodatim definicijama;
- ne prihvatam svaki leksički nalaz kao dokaz promene značenja.

### C — PDF

```bash
sha256sum .verification/k11c-vault/raw/tabela.pdf
pdftotext -layout .verification/k11c-vault/raw/tabela.pdf -
git -C .verification/k11c-vault show \
  origin/agent/extractor/TASK-101:wiki/drafts/fragments/tabela.md
```

Hash PDF-a:

```text
e52b02387398d28087e36be2fea9f2f524a2d62db93e236f47eab5093cde4042
```

Isti hash nosi fragment. PDF i fragment sadrže:

```text
Resurs: Bluetooth
Resurs: zvuk PipeWire
Resurs: mreza
Resurs: fajlovi
Preuzimanja Flathub do 2023: 700000 dnevno
Preduslov: Bubblewrap i OSTree
ChromeOS: podrzano
```

Referentne vrednosti i vremenski kontekst sačuvani su.

Konsolidatorska grana pokušala je i:

```text
wiki/drafts/fragments/tabela.md -> wiki/tabela.md
```

Zadatak beleži:

```text
status: blocked
blocked_reason:
merge u main nije prošao: grana menja zone van dozvole: wiki/tabela.md
```

Main sadrži samo `wiki/Index.md`. Dakle, sadržaj nije tiho objavljen.

Dokazni tagovi u klonu pokazuju:

```text
dokaz/TASK-101-verify:
e0ecf5eb549bb317ec3b609236d7b144d63eaf49

dokaz/TASK-101-challenge:
b9fc28d1e7b3c8ad0c5cc089c1a5604fe60744b9
```

Challenge je `clean`, ali bez reprodukcionih skripti; to nije dokaz nezavisnosti vendora — evidencija izričito beleži korelacioni rizik.

### D — audit

Zahtev je `audit_scope: [wiki/*.md]`. Stvarna librarian izmena:

```bash
git -C .verification/k11d-vault diff --name-status 6968584^ 6968584
```

```text
A	tasks/audits/TASK-101.md
M	wiki/Flatpak.md
```

U postojećoj belešci uklonjen je pokvaren Wikilink, dodat `[[PipeWire]]` i promenjen `updated`. Novi članak nije napravljen.

Merge:

```text
416aa59f2bce3f910f989613e90f0c40d0906355
agentctl(TASK-101): revizija baze (librarian+verifier)
```

Merge uvodi audit izveštaj, verifikatorski izveštaj i izmenu `wiki/Flatpak.md`. Blob te beleške jednak je na verifikaciji, challenge reviziji i main-u:

```text
b325b737dd6deac1d9c9130aac050ce79a7e44bd
b325b737dd6deac1d9c9130aac050ce79a7e44bd
b325b737dd6deac1d9c9130aac050ce79a7e44bd
```

Dokazni tagovi dostupni su u zasebnom klonu:

```text
verify:    ef050e92ae1e02a31d78ea90ad62f387c7689e59
challenge: 5386da69bb668e106f792d673fe1820c3ab71dd3
```

Status je `consolidated`, bez aktivnog zakupa.

### Ograničenja

- `docs/dokazi-wiki/ogledi/` ne postoji na zamrznutom `6081944`; sačuvane priloge pročitao sam iz navedenog glavnog workspace-a i kopirao za pregled. Nisu menjani.
- Nisam ponavljao plaćene model pozive. Istorijski integracioni rezultat potvrđujem evidencijom, identitetom Git stabla i ponovnim testiranjem, ne nezavisnim snimkom tadašnjeg procesa.
- Proverene su navedene realpath varijante, ne svi mogući konkurentni rasporedi.
- Nisam potvrdio sadržajnu opravdanost svakog pojedinačnog odbijanja u B.
- Ovo nije potvrda potpune sigurnosti sistema.

Završno stanje:

```console
$ git diff --exit-code
$ git rev-parse HEAD
60819440a35149dd7727f6675361000e3ad522ff
$ git status --porcelain
?? .verification/
```

`git diff --exit-code` završio je sa 0. Kandidat i živi primeri nisu menjani.
