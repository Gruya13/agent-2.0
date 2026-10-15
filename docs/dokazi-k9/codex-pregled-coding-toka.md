Pregledana revizija: **`a65dfbc482d58c0f398ae33cab2c6963e3db59ca`**, u odvojenom checkout-u. Kandidat nije menjan. Sopstvene probe koristile su privremene Git projekte, fixture vault-ove i mock agente.

**Oborene su tvrdnje 2, 3, 5, 6 i 9.** Tvrdnje 1, 4, 7 i 8 potvrđene su u izvedenim kontrolnim scenarijima.

| Tvrdnja | Ishod | Dokaz |
|---|---|---|
| 1. Obavezan eksplicitni `pass` | **POTVRĐENO** | Izveštaj sa exit 0 bez verdikta odbijen; direktno ubačena nepotpuna evidencija takođe odbijena. |
| 2. Zakup tokom celog posla; nema prihvatanja posle gubitka | **OBORENO** | Baseline test nije obuhvaćen obnavljanjem. Dodatno, zakup izgubljen tokom upisa taga nije sprečio prihvatanje. |
| 3. Prihvata se tačno pregledana revizija | **OBORENO** | Promena grane tokom izolovane integracione provere ušla je u main bez pregleda. Promenjena osnovica nije poništila stari pass kada je integracioni test prošao. |
| 4. Drugi vendor za reviewer-a | **POTVRĐENO** | Jednak identitet autora i reviewer-a odbijen pre pokretanja harness-a. |
| 5. Baseline pad mora biti assertion | **OBORENO** | `TypeError` je klasifikovan kao `assertion`; tok je prihvaćen. |
| 6. Zaštita postojećih testova i zabrana preskakanja | **OBORENO** | Izmena postojećeg testa odbijena, ali novi `test['skip'](...)` prihvaćen. |
| 7. Poređenje target-a preko realpath-a | **POTVRĐENO** | Symlink na kontrolni repo odbijen sa `TARGET_IS_CONTROL`. |
| 8. Postojeći `MEMORY.md` ostaje sačuvan | **POTVRĐENO** | Sentinel sadržaj ostao nepromenjen; izvoz napravljen u `.agent-context/MEMORY.md`. |
| 9. Neuspeh upisa dokaznog taga sprečava prihvatanje | **OBORENO** | Prvi upis jeste zaštićen; greška završnog pomeranja taga ignorisana je posle promene main-a. |

Probe i puni izlazi sačuvani su u [`.verification/`](/home/gru/.agent-worktrees/verify-session-08b4-codex/.verification). Kontrolni program je [controls.mjs](/home/gru/.agent-worktrees/verify-session-08b4-codex/.verification/controls.mjs).

### 1. Prihvatanje posle gubitka zakupa

Zahtev: posle gubitka zakupa nema nastavka i prihvatanja pod starim pravom.

Mesta: [coding.mjs:456](/home/gru/.agent-worktrees/verify-session-08b4-codex/tools/orchestrator/lib/coding.mjs:456), [coding.mjs:660](/home/gru/.agent-worktrees/verify-session-08b4-codex/tools/orchestrator/lib/coding.mjs:660), [coding.mjs:681](/home/gru/.agent-worktrees/verify-session-08b4-codex/tools/orchestrator/lib/coding.mjs:681).

Komande:

```bash
TMPDIR="$PWD/.verification/tmp" node .verification/controls.mjs lease
TMPDIR="$PWD/.verification/tmp" node .verification/controls.mjs accept-lease-loss
```

Prva proba koristi TTL 400 ms i baseline test duži od TTL-a. Drugi proces uspešno preuzima zakup:

```text
peer {"remainingMs":-444,"stdout":"{\"claimed\":true,\"status\":\"in_progress\"}","stderr":""}
implement {"error":"zakup nad TASK-101 drži drugi proces istog identiteta","code":"NOT_OWNER"}
```

Stari proces pre greške ipak završava baseline proveru i upisuje evidenciju.

Jača proba koristi TTL 500 ms i Git `reference-transaction` hook koji odlaže upis taga. Posle isteka drugi proces uzima zakup drugim tokenom:

```text
peer {"remainingMs":-287,"stdout":"{\"claimed\":true}"}
accept {"phase":"code","task":"TASK-101","ok":true,"step":"accept","merge":"f4273c1ff388cf2a14b5ff09a2a421618c3b0f37"}
```

Stvarno stanje: `consolidated`, main promenjen. Očekivano: odbijanje pre merge-a.

Pozitivna kontrola dugog mock poziva i duge provere ispravljenog koda jeste prošla:

```bash
TMPDIR="$PWD/.verification/tmp" node .verification/lease-positive.mjs
```

```text
{"phase":"agent","live":true,"peer":{"claimed":false,"code":"LEASE_HELD"}}
{"phase":"check","live":true,"peer":{"claimed":false,"code":"LEASE_HELD"}}
result {"phase":"code","task":"TASK-101","ok":true,"step":"implement","commit":"f66c3658ea9a6c92af17fe931a8a9870c093d3d3"}
```

### 2. Nepregledana izmena ulazi u main

Mesto: [coding.mjs:665](/home/gru/.agent-worktrees/verify-session-08b4-codex/tools/orchestrator/lib/coding.mjs:665). Završni merge koristi ime grane, nakon ranije provere njenog SHA.

```bash
TMPDIR="$PWD/.verification/tmp" node .verification/controls.mjs race
```

Ulaz: integracioni test čeka na barijeri. Drugi worktree tada dodaje i commit-uje `src/not-reviewed.js` na kandidatsku granu. Test se zatim nastavlja.

Stvarni izlaz:

```text
accept {"phase":"code","task":"TASK-101","ok":true,"step":"accept","merge":"db22d53a264c00536f736c288280486b19f50b6a"}
```

Zabeleženi rezultat:

```text
"status":"consolidated"
"unreviewedPresent":true
"integration":{"ok":true}
```

Očekivano: odbijanje promenjene grane ili merge zaključanog, pregledanog SHA. Dobijeno: nepregledani fajl u main-u.

Odvojena proba pomera main nakon pregleda:

```bash
TMPDIR="$PWD/.verification/tmp" node .verification/controls.mjs changed-base
```

```text
accept {"phase":"code","task":"TASK-101","ok":true,"step":"accept","merge":"4364f27449c7e8f1a2c73a2ae7b6dc4076c4da6d"}
```

Evidencija ima `base_stale:true`, ali zadržava stari `review.verdict:pass`. Poništavanje pregleda na [coding.mjs:655](/home/gru/.agent-worktrees/verify-session-08b4-codex/tools/orchestrator/lib/coding.mjs:655) izvršava se samo kada integraciona provera padne.

Negativne kontrole rade:

```bash
TMPDIR="$PWD/.verification/tmp" node .verification/controls.mjs changed-branch
TMPDIR="$PWD/.verification/tmp" node .verification/controls.mjs integration-fail
```

```text
accept {"phase":"code","task":"TASK-101","ok":false,"reason":"grana je promenjena posle pregleda (0be7c8f8 != 9d57036d)","attempts":1}
accept {"phase":"code","task":"TASK-101","ok":false,"reason":"integraciona provera nije prošla: zajednički rezultat ne prolazi proveru (exit 7)","attempts":1}
```

U obe kontrole main je ostao nepromenjen.

### 3. `TypeError` postaje dokaz buga

Mesto: [coding.mjs:165](/home/gru/.agent-worktrees/verify-session-08b4-codex/tools/orchestrator/lib/coding.mjs:165). Klasifikator prihvata i generički znak neuspelog testa `✖`.

```bash
TMPDIR="$PWD/.verification/tmp" node .verification/controls.mjs runtime
```

Novi test:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import * as m from '../src/parse.js';
test('API regression', () => assert.equal(m.addedApi(), 0));
```

Popravka dodaje `addedApi`. Na osnovici poziv pada pre izvršenja assertion-a:

```text
TypeError: m.addedApi is not a function
```

Ipak, evidencija beleži:

```text
"failure_kind":"assertion"
```

a tok završava:

```text
accept {"phase":"code","task":"TASK-101","ok":true,"step":"accept","merge":"39131024eaffd68fcc49c41afd85e268031f68a1"}
```

Očekivano: odbijanje greške izvršavanja kao dokaza početnog buga. Dobijeno: `consolidated`.

### 4. Preskakanje novog testa prolazi

Mesto: [coding.mjs:409](/home/gru/.agent-worktrees/verify-session-08b4-codex/tools/orchestrator/lib/coding.mjs:409).

```bash
TMPDIR="$PWD/.verification/tmp" node .verification/controls.mjs skip
```

Uz pravi regresioni test dodat je:

```js
test['skip']('preskocen', () => {});
```

Stvarni izlazi:

```text
ℹ skipped 1
accept {"phase":"code","task":"TASK-101","ok":true,"step":"accept","merge":"1745f415c4dbf4048667ac830e8381f10140e1c3"}
```

Očekivano: odbijanje preskakanja. Dobijeno: `consolidated`.

Kontrola postojeće zaštite:

```bash
TMPDIR="$PWD/.verification/tmp" node .verification/controls.mjs existing-test
```

```text
implement {"phase":"code","task":"TASK-101","ok":false,"reason":"postojeći testovi su menjani: tests/parse.test.js","attempts":1}
```

### 5. Završni neuspeh taga ignorisan

Mesto: [coding.mjs:672](/home/gru/.agent-worktrees/verify-session-08b4-codex/tools/orchestrator/lib/coding.mjs:672).

```bash
TMPDIR="$PWD/.verification/tmp" node .verification/controls.mjs tag-final-failure
```

Ulaz: fixture `post-merge` hook samo pri stvarnom merge-u u ciljnom main-u pravi `TASK-101-accept.lock`. Prvi upis taga uspeva; završno pomeranje na merge commit pada.

```text
accept {"phase":"code","task":"TASK-101","ok":true,"step":"accept","merge":"54c6e7586af2bac5dc3985754419b29167082c82"}
```

Stvarna provera reference:

```text
"tag":"2fccd6b3a6d9833138f5b6e6a38ee6eec54680ed"
"merge":"54c6e7586af2bac5dc3985754419b29167082c82"
"equal":false
"retryCode":128
```

Git greška:

```text
fatal: cannot lock ref 'refs/tags/dokaz/TASK-101-accept': Unable to create '/home/gru/.agent-worktrees/verify-session-08b4-codex/.verification/tmp/agent2-cilj-63zayM/.git/refs/tags/dokaz/TASK-101-accept.lock': File exists.
```

Tag ostaje na kandidatskom commitu, a zadatak prijavljuje prihvaćen merge.

Kontrola sa lock-om prisutnim pre prvog upisa radi:

```bash
TMPDIR="$PWD/.verification/tmp" node .verification/controls.mjs tag-lock
```

Rezultat je `ok:false`, razlog počinje sa `dokazni tag nije nastao`, status je `ready`, main nepromenjen.

### Ostale pozitivne kontrole

Komande:

```bash
TMPDIR="$PWD/.verification/tmp" node .verification/controls.mjs no-pass-direct
TMPDIR="$PWD/.verification/tmp" node .verification/controls.mjs no-verdict
TMPDIR="$PWD/.verification/tmp" node .verification/controls.mjs same-vendor
TMPDIR="$PWD/.verification/tmp" node .verification/controls.mjs symlink
TMPDIR="$PWD/.verification/tmp" node .verification/controls.mjs memory
```

Relevantni stvarni izlazi:

```text
accept {"phase":"code","task":"TASK-101","ok":false,"reason":"nepotpuna evidencija: nema izričitog nezavisnog pass-a","attempts":1}
review {"phase":"code","task":"TASK-101","ok":false,"reason":"nezavisan pregled nije dao izričit pass (verdikt: nema)","attempts":1}
review {"phase":"code","task":"TASK-101","ok":false,"reason":"reviewer i autor popravke su isti vendor (mock-programer)","attempts":1}
```

Symlink je odbijen kodom `TARGET_IS_CONTROL`. Posle uspešnog memory scenarija:

```text
"memory":"# Projektna memorija\nSENTINEL_NE_DIRAJ"
"exported":{"notes":["wiki/Kontekst.md"],"file":".agent-context/MEMORY.md","bytes":225}
```

Prošao je i sopstveni tok kroz stvarni CLI i pipeline, u tri poziva `run --only code --json`:

```bash
TMPDIR="$PWD/.verification/tmp" node .verification/cli-flow.mjs
```

```text
result {"status":"consolidated","accepted":"8d68461aa9c84442fb2371af4e545fb8d1abcd7a","main":"8d68461aa9c84442fb2371af4e545fb8d1abcd7a"}
```

### Testovi i ograničenja

```bash
node --test tests/coding.test.mjs tests/coding-robustness.test.mjs
```

```text
ℹ tests 16
ℹ pass 16
ℹ fail 0
ℹ skipped 0
```

```bash
npm test
```

```text
ℹ tests 165
ℹ pass 165
ℹ fail 0
ℹ skipped 0
```

Ograničenja pregleda:

- Korišćeni su mock adapteri; nije proveravana sadržajna sposobnost stvarnih programera i reviewer-a.
- Probe su izvedene na malim privremenim projektima, bez plaćenih poziva.
- Raspored trke kontrolisan je barijerom u test komandi. Greške taga i kašnjenje upisa izazvani su fixture Git hookovima; nisu menjani kandidat ni sistemski binarni fajlovi.
- Prolazak skupa testova ne pokriva pronađene kontraprimere i ne potvrđuje bezbednost celog sistema.

Završne komande:

```bash
git diff --exit-code
git rev-parse HEAD
git status --porcelain
```

Stvarni izlaz (`git diff` je bez izlaza, exit 0):

```text
a65dfbc482d58c0f398ae33cab2c6963e3db59ca
?? .verification/
```
