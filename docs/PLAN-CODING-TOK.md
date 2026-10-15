# Plan — prvi coding tok (Agent 2.0 kao coding agent)

Polazna revizija: `480db23` (HEAD u trenutku pisanja plana).
Datum: 15. oktobar 2026.

## 1. Razlika između cilja i implementacije (pregled)

**Šta je neposredno iskoristivo za coding zadatke:**

| Mehanizam | Gde | Zašto je iskoristiv |
|---|---|---|
| Crna tabla i atom automata | `lib/task.mjs` (statusi, `TRANSITIONS`, validacija, atomski upis) | Zadaci, dodela i istorija ne zavise od toga šta je sadržaj zadatka |
| Zakup (lease) i `claim` | `lib/store.mjs`, `lib/fsx.mjs` | Jedan pisac po zadatku; otpustiv zakup; `failPhase` već otpušta |
| Git izolacija | `lib/worktree.mjs` (`createWorktree`, `commitWorktree`, `mergeIntoMain`) | Worktree po ulozi, komit pod imenom agenta, merge kapija |
| Adapteri harnesa | `lib/agents/harness.mjs` (`dsh`, `codex`, `agy`) | Sva tri harnesa umeju da pišu u `cwd`; identitet = vendor |
| Prompt kao ugovor | `lib/agents/prompts.mjs` (`buildPrompt`, brief iz `.agents/roles/`) | Nova uloga = jedan brief, bez novog koda |
| Evidencija | `tasks/events.jsonl`, telo zadatka, `tasks/reviews/` | Dokaz ide uz zadatak, ne u novu bazu |
| Reprodukcioni skriptovi | `lib/reproduce.mjs` | Već postoji mehanika "izvrši i meri izlaz" |

**Šta trenutno pretpostavlja dokument:**

1. `zonePolicyFor` i `ROLE_ARTIFACT_ZONE` poznaju samo `wiki/**`, `tasks/**`, `raw/**`.
2. Faze `research`/challenge/consolidate traže nacrt beleške i objavljuju u `wiki/`.
3. `mergeIntoMain` radi isključivo nad `config.root` (kontrolni repo) i njegovom
   `main` granom.
4. Zadatak nema pojam ciljnog repozitorijuma, početne revizije, opsega nad kodom
   ni komande koja proverava rezultat.
5. `artifact`-orijentisane kapije gledaju `wiki/` putanje.

**Kapije za `tools/` i `tests/` — konkretan nalaz (traženo u zadatku):**

- Kapija **ne pominje** `tools/` ni `tests/` imenom. U `mergeIntoMain` postoji
  **allow-lista** `['wiki/drafts/', 'tasks/reviews/', 'tasks/audits/', 'tasks/challenges/']`
  plus `production` (artefakti zadatka), izvedeni artefakti i `scope`.
- Posledica: kapija **ne razlikuje** kod orkestratora od koda ciljnog projekta —
  ona razlikuje samo *putanje u kontrolnom repou*. `tools/` i `tests/` su
  zaštićeni **slučajno**, jer nisu na allow-listi.
- Zato je za coding tok potrebna **nova, pozitivna kapija nad ciljnim repoom**
  (eksplicitni `scope` globovi), a allow-lista kontrolnog repoa ostaje netaknuta.
  Time agent dobija pravo da menja `src/` i `tests/` **ciljnog** repoa, ali ne i
  `tools/`/`tests/` kontrolnog.

## 2. Minimalan coding tok

```
zahtev → reprodukcija → izmena koda → testiranje → nezavisan pregled → prihvaćena promena
```

Zadatak dobija `kind: code` i polja:

| Polje | Značenje |
|---|---|
| `code_target` | putanja ciljnog repozitorijuma (mora biti različita od kontrolnog korena) |
| `code_base` | početna revizija (commit) |
| `code_scope` | dozvoljene putanje ciljnog repoa (globovi, npr. `src/**`, `test/**`) |
| `code_test` | komanda koja proverava rezultat |
| `code_evidence` | dokazi po koracima: reprodukcija, izmena, pad testa na osnovi, pregled |

Faze toka (sve nad **ciljnim** repom, u odvojenom worktree-u):

1. **reproduce** — worktree na `code_base`; pokreni `code_test`; **mora pasti**.
   Ako prolazi, nema buga → zadatak `blocked`.
2. **implement** — uloga `programer` (jedan brief, postojeći adapter) piše
   popravku **i regresioni test** u worktree-u; izmene se proveravaju prema
   `code_scope`; commit u granu `agent/code/<id>` ciljnog repoa.
3. **check** — kontrolni sloj izvršava `code_test` u worktree-u (mora proći) i
   **sam dokazuje dokaz 1**: uzme regresioni test iz diff-a, primeni ga na
   `code_base` u čistom worktree-u i pokaže da tamo **pada**.
4. **review** — drugi vendor (Codex) u **svom** checkout-u pregleda diff, pravi
   sopstveni granični slučaj i izveštava; proverava i da test nije oslabljen.
5. **accept** — merge grane u `main` ciljnog repoa + dokazni tag
   `dokaz/<id>-accept`; status `consolidated`. Bez `push`.

Negativna kapija (traženo u zadatku): izmena van `code_scope` → odbijanje **pre**
testiranja; neuspešan `code_test` posle popravke → zadatak se vraća programeru,
bez merge-a; neuspešan kontrolni test na osnovi (test ne reprodukuje bug) → bez
prihvatanja.

## 3. Šta se menja (minimalno)

| Fajl | Izmena |
|---|---|
| `tools/orchestrator/lib/coding.mjs` | **novo**: coding tok (5 koraka) nad ciljnim repom, koristi postojeći store/zakup/adaptere |
| `tools/orchestrator/lib/task.mjs` | `kind: code` polja u šemi i redu polja |
| `tools/orchestrator/lib/agents/mock.mjs` | knob `AGENT_2_0_MOCK_CODE_CMD` (deterministička izmena za testove) |
| `tools/orchestrator/lib/pipeline.mjs` | `runOnce` prosleđuje `kind: code` zadatke coding toku |
| `tools/orchestrator/cli.mjs` | komanda `code` (pravi zadatak) i poziv toka |
| `.agents/roles/programer.md` | brief uloge (ugovor: scope, komanda, bez menjanja kontrolnog repoa) |
| `tests/coding.test.mjs` | testovi: uspešan tok, neuspešan test, izmena van opsega |
| `fixtures/code-target/` | mali lokalni repo sa bugom za prvi ogled |

**Ne dodaje se:** novi servis, baza, katalog uloga, univerzalna apstrakcija.

## 4. Fixture (prvi ogled)

Mali Node projekat sa poznatim bugom u graničnom slučaju (falsy vrednost se
tretira kao odsustvo), sa postojećim testovima koji prolaze i kratkom komandom
reprodukcije. Zahtev i očekivano ponašanje zamrzavaju se **pre** izvršavanja, bez
gotovog rešenja u zahtevu.

## 5. Dokazi koje ogled mora da isporuči

1. regresioni test pada na početnoj reviziji (dokaz iz koraka `check`, izveden
   nezavisno od agentove tvrdnje);
2. posle popravke taj test prolazi;
3. postojeće provere prolaze;
4. nezavisan pregled sa sopstvenim graničnim slučajem;
5. diff ograničen na `code_scope`;
6. commit u ciljnom repou koji se iz čistog checkout-a može pregledati i
   ponovo testirati;
7. negativni scenario: neuspešan test ili izmena van opsega **sprečava**
   prihvatanje.

Bez `push`-a i bez override-a.
