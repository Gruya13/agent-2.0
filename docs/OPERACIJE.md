# Operacije i rešavanje problema

[Dokumentacija](README.md) · [CLI](CLI.md)

## Redovni nadzor

```bash
node tools/orchestrator/cli.mjs status
node tools/orchestrator/cli.mjs list --status blocked
node tools/orchestrator/cli.mjs worktrees
node tools/orchestrator/cli.mjs lint
node tools/orchestrator/cli.mjs log --limit 20
```

Pregledaj telo zadatka, verification/challenge metapodatke i `tasks/events.jsonl`. Main treba da bude glavna radna grana.

## Tajmer (autonomni prolaz)

`agentctl tick` radi jedan deterministički prolaz: reclaim isteklih zakupa i
dovršavanje započetih faza. Namenjen je `systemd --user` tajmeru, ne daemonu —
stanje ostaje u Git-u i `tasks/`, pa je bezbedno pokrenuti ga i ručno.

```ini
# ~/.config/systemd/user/agent2-tick.service
[Unit]
Description=Agent 2.0 tick
[Service]
Type=oneshot
WorkingDirectory=/home/gru/Projects/Agent 2.0
ExecStart=/usr/bin/node tools/orchestrator/cli.mjs tick --strict
```

```ini
# ~/.config/systemd/user/agent2-tick.timer
[Timer]
OnBootSec=2min
OnUnitActiveSec=5min
[Install]
WantedBy=timers.target
```

`systemctl --user enable --now agent2-tick.timer` uključuje petlju; `--strict` daje
izlazni kod 1 kada akcija padne, pa `systemd` vidi neuspeh.

## Metrike

```bash
node tools/orchestrator/cli.mjs metrics --json
```

Agregira `agent.call` događaje (uloga, trajanje, ishod, prekid) iz
`tasks/events.jsonl`. Služi za nedeljni pregled i za odluke o modelima; eval
zlatni set je u `evals/` i pokreće se sa `node tools/evals/run.mjs`. Izbegavaj više istovremenih kontrolnih petlji nad istim skladištem: zaključavanje pojedinačnog zadatka ne čini ceo unos, raspodelu ID-eva i merge globalnom transakcijom.

## Istekao zakup

Ako je agent prestao da radi, proveri vlasnika i vreme isteka preko show/status, zatim:

```bash
node tools/orchestrator/cli.mjs reclaim
```

Reclaim opoziva samo istekle zakupe i uklanja worktree-e tih zadataka. To može ukloniti nezavršen lokalni rad; ako je potreban za dijagnostiku, prethodno napravi kopiju. Ne briši aktivne lock fajlove radi zaobilaženja živog procesa. Run takođe radi reclaim na početku prolaza.

## Blokiran zadatak

```bash
node tools/orchestrator/cli.mjs show TASK-103
```

Pregledaj blocked_reason, nalaze, grane i dokaze. Popravi uzrok, pa ga vrati u opticaj:

```bash
node tools/orchestrator/cli.mjs ready TASK-103 --reason 'Uzrok pregledan i otklonjen; dozvoljen novi pokušaj.'
```

Ready prihvata samo blocked. Ne briše istoriju i ne resetuje revizioni brojač izveden iz nje, pa nova runda može brzo ponovo blokirati. Ako je prethodni unos pogrešno postavljen, novi zadatak sa ispravnim zahtevom može biti prikladniji; izvore čuvaj pod novim imenima.

## Red-team intervencija

Ako je pregledom potvrđeno da je nalaz neprikladan, operator može eksplicitno preglasati:

```bash
node tools/orchestrator/cli.mjs override TASK-103   --reason 'Navesti konkretan pregledan dokaz i obrazloženje odluke.'
```

Komanda postavlja challenge verdict=clean i beleži ko, kada i zašto. Zadatak mora zasebno biti u dozvoljenom stanju i imati verifikaciju. Izvođenje ready nakon override ne znači da će svaki budući pokušaj zadržati isti pečat; proveri nove rezultate. Ne koristi override kao uobičajen korak svakog neuspešnog toka.

## Tabela problema

| Simptom / kod | Uzrok i postupak |
|---|---|
| raw.modified / raw.git-diff | poznati izvor promenjen; sačuvaj izmenjenu kopiju pod novim imenom i vrati originalne bajtove prema proverljivoj osnovi |
| raw.deleted | vrati izvor na registrovanu putanju; rename je takođe brisanje osnove |
| raw.symlink | simbolički link nije dozvoljen izvor; koristi stvarni fajl i proveri poreklo |
| raw.no-manifest | izgubljena hash osnova; prvo proveri Git/backup, pa svesno uspostavi ili vrati manifest |
| raw.bad-manifest | neispravan JSON; sačuvaj kopiju i vrati validnu verziju; index može prepisati nečitljivu osnovu |
| raw.legacy-unknown | v1 binarni hash nije uporediv; ručna re-osnova tek nakon pregleda porekla |
| note.frontmatter | dodaj/ispravi obavezna polja kroz odgovarajući zadatak |
| note.broken-link | nema beleške sa ciljanim imenom; popravi cilj ili unesi potrebno znanje |
| note.draft-in-production | draft u produkciji; istraži kako je dospeo tamo i vrati kontrolisani tok |
| fragment.schema / source-missing / source-mismatch | nedostaje ili ne odgovara poreklo fragmenta; ponovi ispravnu ekstrakciju |
| task.no-artifact / no-verdict | stanje zadatka ne odgovara artefaktima/pečatu; pregledaj prethodnu fazu |
| task.schema / history / wrong-phase | nevalidna polja ili raspored; popravljaj kroz kontrolni sloj uz očuvanje istorije |
| task.lease-expired | agent nije obnovio zakup; pregledaj proces, zatim reclaim |
| NOT_READY / NOT_REVIEW / AWAIT_EXTRACT | pogrešan redosled faza ili stanje |
| NO_CHALLENGE | konsolidacija nema clean red-team rezultat |
| nema artefakta / fragmenata / verdikta | proces možda jeste završio, ali ugovor faze nije ispunjen; pregledaj izlaz i worktree |
| MCP upis odbijen | proveri vault_info, role, task root, vlasnika, token, status i realnu putanju |
| beleška već postoji | konsolidacija ne prepisuje; koristi audit |
| merge van zone | agent menja zabranjene putanje; pregledaj diff, ne proširuj dozvolu samo da bi prošao |
| rebase/merge konflikt | pregledaj navedene fajlove; sistem abortira konfliktni pokušaj, ne bira sadržaj automatski |
| proposed bez napretka | zavisnosti nisu spremne ili nema automatske promocije proposed zadatka |
| doctor FAIL, kod 1 | doctor vraća 1 ako ijedna provera nije `ok`; ne proverava auth, kvotu ni punu MCP integraciju |
| run kod 0, neuspešni zadaci | pregledaj JSON akcije i završni status |

Za v1 binarni manifest re-osnova znači uklanjanje samo konkretnog zapisa iz files nakon pregleda i potom `index`. Time se uspostavlja nova osnova, ne dokazuje istorijska nepromenljivost. Sačuvaj obrazloženje intervencije.

## Dijagnostika

```bash
AGENTCTL_DEBUG=1 node tools/orchestrator/cli.mjs phase verify TASK-103
node tools/orchestrator/cli.mjs status --json
node tools/orchestrator/cli.mjs lint --json
git status --short
git worktree list
git log --graph --oneline -20
```

Debug poziv phase izvršava fazu; nije read-only pregled. Za prvi korak koristi show/status/lint. Ako harnes ne postoji ili istekne, proveri izvršni program, konfiguraciju, autentifikaciju kod vendora i vremenski limit. MCP statični role env može objasniti zašto jedna uloga radi, a druga istog vendora ne može da upiše.

## Rezervna kopija i oporavak

Za kompletnu kopiju zaustavi nove poslove i završi ili dokumentuj aktivne procese. Sačuvaj ceo koren projekta sa `.git`, izvorima, zadacima, manifestom, wiki beleškama, konfiguracijom i ugovorima. Git istorija ne obuhvata automatski nekomitovane fajlove ili ignorisane worktree/runtime podatke.

Sačuvaj `git status`, `git worktree list` i ID-eve aktivnih zadataka uz kopiju. Kopirani worktree-i mogu sadržati Git reference ka staroj apsolutnoj putanji. Za obnovljen vault obnovi glavnu radnu kopiju i istoriju, proveri manifest i lint, pa rekonstruši agentska stabla kroz kontrolni sloj umesto oslanjanja na stare runtime tokene.

Ne briši `.locks`, `.runtime` i `.worktrees` dok procesi rade. Indeks je izveden i može se regenerisati posle provere izvora; manifest predstavlja osnovu integriteta i nije zamenljiv proizvoljnom novom verzijom.
