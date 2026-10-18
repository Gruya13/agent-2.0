Pregledao sam `8e2d9307f34f52bf97a19ed23693c28bbd481516` u svom worktree-u. **Pet CR pokretanja i dva puna skupa prolaze, ali ne potvrđujem da je flaky CR2 konačno otklonjen.** Test i dalje može da prekine proces nakon što je merge vidljiv, a pre upisa `accept`.

| Tvrdnja | Ishod | Dokaz |
|---|---|---|
| 1. Popravka rešava uzrok bez prikrivanja problema | **OBORENO kao potpuna popravka testa** | Novi test ubija celu procesnu grupu i ne briše `index.lock`, ali nije uklonio trku između uslova na [linijama 121–131](/home/gru/.agent-worktrees/verify-session-08b4-codex/tests/crash-recovery.test.mjs:121) i provere `accept` na [liniji 147](/home/gru/.agent-worktrees/verify-session-08b4-codex/tests/crash-recovery.test.mjs:147). Produkcija upisuje `accept` tek posle merge-a i dva Git poziva, na [liniji 821](/home/gru/.agent-worktrees/verify-session-08b4-codex/tools/orchestrator/lib/coding.mjs:821). Kontrolni scenario ispod dostiže taj prozor. Nisam dokazao produkcioni kvar oporavka. |
| 2. Izmena je samo u testu | **POTVRĐENO** | `git diff --name-only 0149bf5 8e2d930` → `tests/crash-recovery.test.mjs`. `git diff --exit-code 0149bf5 8e2d930 -- tools` → izlaz prazan, kod 0. |
| 3. Tražena ponavljanja prolaze | **POTVRĐENO za izvršena pokretanja** | Komanda `node --test tests/crash-recovery.test.mjs`, pet puta: `CR run=1…5 rc=0`, svaki put `ℹ tests 3`, `ℹ pass 3`, `ℹ fail 0`. Komanda `npm test`, dva puta: `NPM run=1 rc=0 ℹ tests 203 ℹ pass 203 ℹ fail 0`; `NPM run=2 rc=0 ℹ tests 203 ℹ pass 203 ℹ fail 0`. |
| 4. Preostali prekid zarobljava zadatak ili duplira merge | **NEPROVERENO kao opšta tvrdnja** | U dve sopstvene varijante nisam dobio ni zarobljen zadatak ni dupli merge. Prekid samo Node procesa, dok Git dete radi u `pre-commit` hook-u, dozvolio je opoziv zakupa i nastavak: `status:"consolidated"`, `mergeCount:1`. Kontrolisani prekid u prozoru posle merge-a takođe se oporavio: `recovered:true`, `mergeCount:1`. Ove probe ne isključuju sve rasporede prekida. |
| 5. Poslednja korekcija je nezavisno potvrđena | **OBORENO kao konačno zatvaranje flaky CR2** | Redovna pokretanja prolaze, ali uslov testa ostaje vremenski nedovoljan. |

Moj ključni kontraprimer je `node .verification/window-check.mjs`, sa `post-merge` hook-om koji spava 10 s. Hook zadržava Git poziv **pošto je merge već vidljiv**. Stvarni izlaz:

```text
at-cr2-trigger {"merged":true,"postMergeHookRunning":true,"accept":false}
after-reclaim {"reclaimed":["TASK-101"],"status":"ready","accept":false}
after-retry {"ok":true,"recovered":true,"status":"consolidated","accept":true,"memoryWrite":true,"mergeCount":1}
```

Dakle, na istom uslovu na kojem CR2 šalje `SIGKILL`, njegova tvrdnja „prihvaćena promena je zabeležena” može biti netačna. Produkcioni oporavak je u toj probi radio; nalaz je **preostala nestabilnost testa**, ne dokaz duplog merge-a ili trajno zarobljenog zadatka.

Za navodni `index.lock` uzrok ponovio sam i prekid samo roditeljskog Node procesa komandom `node .verification/orphan-check.mjs`, uz `pre-commit` hook od 12 s. Dobio sam `hookStarted:true`, ali `indexLock:false`; opoziv zakupa je prošao, a nastavak dok je hook još radio dao je `status:"consolidated"` i `mergeCount:1`. Taj jedan raspored ne potvrđuje objašnjenje sa zaostalim `index.lock`, niti dokazuje da ono nikad nije moguće. Novi test čeka nestanak lock-a najviše dve sekunde, ali ne proverava da je zaista nestao.

Ograničenje: izvršio sam pet izolovanih i dva puna skupa, ne statistički dokaz odsustva flaky ponašanja. Fixture-i su nekomitovani samo u mom worktree-u; kandidat i glavni workspace nisu menjani. `git status --porcelain` daje `?? .verification/`.
