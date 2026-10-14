# Izveštaj provere dokumentacije i projekta

[Dokumentacija](README.md)

Datum: 14. oktobar 2026. Dokumentacija je zasnovana na reviziji `a0dc5c8`, verziji paketa `1.0.0`. Okruženje provere: Node `v26.8.2`, Git `2.55.0`.

## Obuhvat

Pregledani su package skripte, svi orchestrator moduli, oba YAML konfiguraciona fajla, MCP implementacija i šabloni, demo, testovi i postojeći izveštaji. Dodata je povezana dokumentacija u docs i link u glavnom README-ju. Izvršni kod, konfiguracija, izvori i postojeći zadaci nisu menjani ovom dokumentacionom izmenom.

## Izvršene provere

| Provera | Rezultat |
|---|---|
| `git diff --check` | prošla, bez whitespace grešaka |
| Relativni Markdown linkovi docs dokumentacije | provereni prema stvarnim fajlovima |
| Markdown code fence parovi | provereni |
| `node tools/orchestrator/cli.mjs lint --json` | ok=true, 0 grešaka, 0 upozorenja |
| `node tools/orchestrator/cli.mjs status --json` | main; TASK-101 consolidated, TASK-102 ready |
| `node scripts/demo.mjs` | uspešan mock tok, consolidated, 0 preostalih agentskih stabala, lint čist |
| `npm test` | neuspešan u trenutnom okruženju; 7 testnih fajlova prošlo, 4 nisu |

Uspešan demo izvršen je u privremenom vault-u, koji je obrisan. Nisu pokretani stvarni plaćeni harnesi niti menjane korisničke MCP registracije.

## Neuspešni postojeći testovi

Standardni test runner prijavio je neuspeh fajlova cli.test.mjs, mcp.test.mjs, pipeline.test.mjs i reproduce.test.mjs. Izlaz je prikazao zbir na nivou 11 testnih fajlova, ne potpun broj pojedinačnih provera; taj zbir nije tvrdnja da projekat ima samo 11 testova.

Ciljani dijagnostički poziv:

```bash
node --test --test-isolation=none --test-reporter=spec tests/cli.test.mjs tests/reproduce.test.mjs
```

Prikazao je 15 pojedinačnih provera: 3 uspešne i 12 neuspešnih. CLI provere više puta dobijaju prazne stdout/stderr vrednosti ili prazan JSON. Direktno pokrenuti status/lint i demo vraćaju sadržaj. Ta razlika je zabeležena; tačan uzrok ponašanja podprocesa nije potvrđen.

U reprodukcionom testu potvrđena je poruka okruženja:

```text
bwrap: loopback: Failed to create NETLINK_ROUTE socket: Operation not permitted
```

Zato uspeh cele testne zbirke nije potvrđen. Testovi i izvršni kod nisu prepravljani da bi dokumentaciona izmena prikrila neuspešne provere.

## Ograničenja opisana prema kodu

Dokumenti posebno beleže odsustvo automatskog heartbeat-a i promocije proposed zadataka, semantiku brojača review istorije, statične MCP uloge, vremensko zastarevanje file-lock-a, granice bwrap izolacije, razlike audit glob provera i ponašanje pri isključenom izvršavanju reprodukcije. To su zapažanja iz pregledanog koda, a ne ispravke implementacije.
