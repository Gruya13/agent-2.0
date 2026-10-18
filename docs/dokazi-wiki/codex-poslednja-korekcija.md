Pregledao sam `4406d72e975531b741e3b9a640843a4516db6ae1` u svom čistom worktree-u. **Poslednje dve ciljane korekcije su potvrđene za proverene scenarije.**

| Tvrdnja | Ishod | Dokaz |
|---|---|---|
| 1. Novi CR2 uslov uklanja raniju trku | **POTVRĐENO** | `node /tmp/agent2-4406-window.mjs success` ponavlja moj raniji `post-merge` kontraprimer. Izlaz: `old-trigger {"merge":true,"hook":true,"accept":false,"memoryWrite":false}`; novi uslov još ne prekida proces. Zatim: `new-trigger {"window":true,"elapsedMs":4978}`. Posle prekida: `recovery {"preStatus":"ready","preAccept":true,"retryOk":true,"retryStep":"memory","postStatus":"consolidated","memoryWrite":true,"mergeCount":1}`. |
| 2. `accept` se nikad ne pojavi | **POTVRĐENO za ovu vrstu neuspeha** | U fixture-u `pre-merge-commit` odbija merge. `node /tmp/agent2-4406-window.mjs timeout` završava kodom **1** posle `new-trigger {"window":false,"elapsedMs":30025}` i ispisuje `AssertionError [ERR_ASSERTION]: nije uhvaćen prozor: prihvatanje zabeleženo, zapis nije`. Nema beskonačnog čekanja dok se `store.get` normalno vraća. |
| 3. Ograničenje konkurentnosti zadržava obuhvat skupa | **POTVRĐENO** | `git ls-tree -r --name-only 8e2d930 tests \| rg '\.test\.mjs$' \| wc -l` → `17`; ista komanda za `4406d72` → `17`. Moje prethodno izvršavanje na `8e2d930` imalo je 203 testa; tri nova `npm test` izvršavanja dala su redom `203 pass / 0 fail`, `203 pass / 0 fail`, `203 pass / 0 fail`, bez preskočenih testova. `--test-concurrency=4` menja raspored izvršavanja, ne izbor testova; zasebno je promenjen CR2 uslov i dodata njegova asercija. |
| 4. Produkcioni kod nije izmenjen | **POTVRĐENO** | `git diff --name-only 0149bf5 4406d72` → `package.json` i `tests/crash-recovery.test.mjs`. `git diff --exit-code 0149bf5 4406d72 -- tools` → prazan izlaz, kod 0. |
| 5. Poslednja relevantna korekcija | **POTVRĐENO u ciljnom obimu** | Raniji prozor više ne dovodi do preuranjenog `SIGKILL`; odsustvo `accept` daje jasan pad; tri puna skupa prolaze. |

Puna izvršavanja pokrenuo sam komandom `npm test` tri puta. Stvarni sažeci su:

```text
run=1 rc=0 ℹ tests 203 ℹ pass 203 ℹ fail 0
run=2 rc=0 ℹ tests 203 ℹ pass 203 ℹ fail 0
run=3 rc=0 ℹ tests 203 ℹ pass 203 ℹ fail 0
```

Ograničenje: tri uspešna izvršavanja ne dokazuju da se resursni pad nikad neće ponoviti. Rok od 30 sekundi ograničava petlju kada se `store.get` vraća; sam poziv `store.get` nema zaseban timeout. Nisam menjao kandidata ni glavni workspace. `git status --porcelain` je prazan.
