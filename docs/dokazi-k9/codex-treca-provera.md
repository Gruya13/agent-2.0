Pregledana revizija: **`87b20c54784a565ccfca7bab67b46c6a40677c58`**. Sve tri ciljane korekcije potvrđene su sopstvenim scenarijima.

| Tvrdnja | Ishod | Dokaz |
|---|---|---|
| 1. Gubitak zakupa tokom upisa taga sprečava prihvatanje i promenu main-a | **POTVRĐENO** | Drugi proces preuzeo zakup; stari poziv završio sa `NOT_OWNER`; main ostao nepromenjen. |
| 2. Timeout 124 ima prednost nad assertion porukom; čist assertion ostaje dokaz | **POTVRĐENO** | Timeout odbijen kao `timeout`; pozitivna kontrola sa čistim assertion padom prošla do prihvatanja. |
| 3. `test[\`skip\`]` se odbija | **POTVRĐENO** | Izrada odbijena zbog preskakanja, pre prihvatanja. |
| Kontrola: trka kandidatske grane | **POTVRĐENO** | Izmena tokom integracione provere odbijena, pregled poništen. |
| Kontrola: promenjena osnovica | **POTVRĐENO** | Stari pregled poništen; zatražen novi. |
| Kontrola: neuspešan upis dokaznog taga | **POTVRĐENO** | `.lock` izazvao odbijanje; main nepromenjen. |

Sopstveni program i puni izlazi sačuvani su u [probe.mjs](/home/gru/.agent-worktrees/verify-session-08b4-codex/.verification/probe.mjs) i [`.verification/`](/home/gru/.agent-worktrees/verify-session-08b4-codex/.verification).

**1. Gubitak zakupa tokom taga**

```bash
TMPDIR="$PWD/.verification/tmp" node .verification/probe.mjs lease
```

Fixture koristi TTL 500 ms i Git `reference-transaction` hook koji usporava upis taga za 1,5 s. Drugi proces nakon 800 ms traži zakup drugim tokenom.

Stvarni izlaz:

```text
peer CLAIMED
accept {"error":"zakup nad TASK-101 drži drugi proces istog identiteta","code":"NOT_OWNER"}
```

Main pre i posle poziva:

```text
e28561a6f0850428131d26afe8015bb1fc10f9d3
```

Očekivano i dobijeno: nema prihvatanja ni promene main-a. Zadatak ostaje `in_progress` nakon preuzimanja zakupa; odbijanje se ovde ispoljava izuzetkom `NOT_OWNER`, a ne rezultatom `ok:false`.

**2. Timeout i pozitivna assertion kontrola**

```bash
TMPDIR="$PWD/.verification/tmp" node .verification.probe.mjs timeout
```

Ispravna putanja izvršene komande je:

```bash
TMPDIR="$PWD/.verification/tmp" node .verification/probe.mjs timeout
```

Baseline podproces ispisuje assertion grešku, ostaje aktivan, a GNU `timeout 0.2` ga prekida kodom 124.

Stvarni izlaz:

```text
implement {"phase":"code","task":"TASK-101","ok":false,"reason":"pad na osnovi nije tvrdnja o ponašanju (vrsta: timeout)","attempts":1}
```

Sačuvana evidencija:

```text
"baseline":{"exitCode":124,"failure_kind":"timeout","assertion":true}
```

Status je `ready`, main nepromenjen.

Pozitivna kontrola:

```bash
TMPDIR="$PWD/.verification/tmp" node .verification/probe.mjs success
```

```text
accept {"phase":"code","task":"TASK-101","ok":true,"step":"accept","merge":"cd341bcbb3ca3161a6c97fb97189c65c51fd4e40"}
```

Baseline evidencija ima `exitCode:1`, `failure_kind:"assertion"`. Završno stanje je `consolidated`; prihvaćeno i integraciono provereno Git stablo imaju isti hash:

```text
ce2029e19992743e475072131cf19da2634a1f69
```

**3. Backtick preskakanje**

```bash
TMPDIR="$PWD/.verification/tmp" node .verification/probe.mjs skip
```

Novi test sadrži:

```js
test[`skip`]('s', () => {});
```

Stvarni izlaz:

```text
implement {"phase":"code","task":"TASK-101","ok":false,"reason":"regresioni test sadrži preskakanje: tests/parse.zero.test.js","attempts":1}
```

Status je `ready`, main nepromenjen.

**Kratke kontrole regresija**

```bash
TMPDIR="$PWD/.verification/tmp" node .verification/probe.mjs race
TMPDIR="$PWD/.verification/tmp" node .verification/probe.mjs base
TMPDIR="$PWD/.verification/tmp" node .verification/probe.mjs tag
```

Stvarni izlazi prve dve probe:

```text
accept {"phase":"code","task":"TASK-101","ok":false,"reason":"grana ili osnovica se promenila tokom integracione provere; potreban nov pregled","attempts":1}
accept {"phase":"code","task":"TASK-101","ok":false,"reason":"osnovica ciljnog repoa se promenila posle pregleda; potreban nov pregled","attempts":1}
```

U obe je `review:null`. Trka nije promenila main; proba osnovice ostavila je main na commitu koji je sam scenario dodao.

Proba zaostalog taga `.lock` dala je:

```text
accept {"phase":"code","task":"TASK-101","ok":false,"reason":"dokazni tag nije nastao: fatal: cannot lock ref 'refs/tags/dokaz/TASK-101-accept': Unable to create '/home/gru/.agent-worktrees/verify-session-08b4-codex/.verification/tmp/agent2-cilj-xtnLMw/.git/refs/tags/dokaz/TASK-101-accept.lock': File exists.","attempts":1}
```

Main je ostao nepromenjen.

**Testovi i ograničenja**

```bash
node --test tests/coding.test.mjs tests/coding-robustness.test.mjs
```

```text
ℹ tests 25
ℹ pass 25
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 27736.114745
```

Nisam našao preostali kontraprimer za tri precizno zadate tvrdnje. Korišćeni su mock adapteri, privremeni projekti i fixture Git hook; plaćeni agenti nisu pozivani. Ceo skup testova i interni desetominutni timeout nisu proveravani u ovoj rundi. Ovo nije potvrda celog sistema.

Kandidat i glavni workspace nisu menjani:

```console
$ git diff --exit-code
$ git rev-parse HEAD
87b20c54784a565ccfca7bab67b46c6a40677c58
$ git status --porcelain
?? .verification/
```

`git diff --exit-code` završio je sa 0, bez izlaza.
