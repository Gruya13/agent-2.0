# Konfiguracija

[Dokumentacija](README.md) · [MCP](MCP.md)

## Učitavanje

`loadConfig(vaultRoot, { configFile })` spaja ugrađene vrednosti sa YAML konfiguracijom. Podrazumevani fajl je `<vaultRoot>/tools/config/agents.yml`. Nepostojeći fajl ne izaziva sam po sebi grešku: koriste se ugrađene vrednosti. Zato proveri da alternativna putanja stvarno postoji; `doctor` nije dovoljna provera sadržaja.

Mape se spajaju rekurzivno, a liste zamenjuju. YAML mora biti mapiranje. Svih osam uloga mora imati adapter `mock` ili `harness`. Opšta stroga validacija svih polja i vremenskih parametara nije implementirana. Parser je projektni podskup YAML-a; ne računaj na sve mogućnosti standardnih YAML biblioteka.

`agents.yml` koristi mock za sve uloge, dok `agents.real.yml` koristi harness za sve. `model: null` ostavlja izbor modela spoljnjem harnesu; samo deklarisanje druge vrednosti ne garantuje da je CLI dobio odgovarajuću opciju.

## Putanje

| Parametar | Vrednost u isporučenim YAML fajlovima |
|---|---|
| `vault.sources` | raw |
| `vault.drafts` | wiki/drafts |
| `vault.production` | wiki |
| `vault.index` | wiki/Index.md |
| `vault.tasks` | tasks |
| `vault.reviews` | tasks/reviews |
| `vault.events` | tasks/events.jsonl |
| `vault.contracts` | .agents |
| `worktree.dir` | .worktrees |
| `worktree.branchPrefix` | agent |

Putanje se razrešavaju prema korenu vault-a. `.locks` i `.runtime` formiraju se u tom korenu. Iako konfiguracija izlaže putanje i prefix grana, delovi pipeline-a, MCP-a, lintera i merge provera koriste literalne `wiki/`, `raw/`, `tasks/` i `agent/...` vrednosti. Za podržan tok zadrži isporučenu topologiju; promena tih polja zahteva dodatnu integracionu proveru.

## Zakup i pipeline

| Parametar | Vrednost | Dejstvo |
|---|---|---|
| `pipeline.challengeSandbox` | `auto` | gde se izvršavaju reprodukcione skripte: `auto` (bwrap ako radi, inače host), `docker` (kontejner, preporučeno u produkciji), `none` |
| `lease.ttlMs` | 600000 | deset minuta zakupa |
| `lease.heartbeatMs` | 120000 | interval obnavljanja zakupa; zajednički za dokumentni i coding tok (`lease-heartbeat.mjs`), minimum 50 ms |
| `pipeline.challenge` | true | clean challenge potreban za konsolidaciju |
| `pipeline.challengeExecute` | true | pokretanje reprodukcionih skripti |
| `pipeline.challengeTimeoutMs` | 60000 | najviše vreme jednog skripta |
| `pipeline.challengeMaxScripts` | 3 | najviše izvršenih skripti u fazi |
| `pipeline.maxRounds` | 10 | gornja granica petlje |
| `pipeline.intervalMs` | 0 | pauza između krugova |
| `pipeline.agentTimeoutMs` | 900000 | rezervni limit poziva agenta |
| `pipeline.maxRevisions` | 3 | granica revizionih pokušaja prema istoriji |

`maxRevisions` je u isporučenom YAML-u; pipeline koristi rezervnu vrednost 3 ako ga nema. Brojač je izveden iz zapisa istorije sa statusom `review`, a nije zaseban pouzdan brojač odbijenih rundi. Detalji su u modelu podataka.

`challengeExecute: false` i `challenge: false` su različite promene. Prva isključuje izvršavanje skripti, druga zahtev za čistim challenge-om u završnoj kapiji. Trenutna petlja i dalje može razmatrati challenge, a trenutna logika pri isključenom izvršavanju ne označava sve neizvršene skripte kao blokirajuće. Nemoj takav režim tumačiti kao potvrdu da je reprodukcija prošla.

## Konfiguracija uloga

```yaml
agents:
  researcher:
    adapter: mock
    harness: agy
    model: null
    timeoutMs: 900000
```

Za svaku ulogu ista polja biraju adapter, program i vremenski limit. Isporučeni YAML daje extractor-u 300000 ms, a ostalim ulogama 900000 ms. Harness komande su u kodu, u `HARNESS_COMMANDS`:

| Harnes | Poziv iz adaptera |
|---|---|
| dsh | `dsh --profile headless <prompt>` |
| agy | `agy --dangerously-skip-permissions --add-dir <worktree> --print=<prompt>` |

Ovo opisuje lokalni adapter, a ne obećanje kompatibilnosti sa svakom budućom verzijom spoljnih programa.

## Okruženje

| Promenljiva | Namena |
|---|---|
| `AGENTCTL_DEBUG` | stack trace CLI greške kada je postavljena |
| `AGENT_2_0_BIN` | zamena izvršnog programa u harness adapteru, korisno za testove |
| `AGENT_2_0_ROLE`, `AGENT_2_0_HARNESS`, `AGENT_2_0_TASK` | kontekst procesa agenta |
| `OBSIDIAN_VAULT` | koren radnog stabla; MCP default je cwd |
| `OBSIDIAN_AGENT` | identitet vlasnika; default anonymous |
| `OBSIDIAN_ROLE` | MCP uloga; default readonly |
| `OBSIDIAN_TASK` | ID zadatka za upis |
| `OBSIDIAN_TASK_ROOT` | glavni kontrolni koren za zakup i stanje |
| `OBSIDIAN_LEASE_TOKEN` | token procesa koji drži zakup |
| `WIKI_ROOT`, `WIKI_AGENT` | kompatibilne rezervne vrednosti za vault i identitet |

Kontrolni sloj materijalizuje `.runtime/task-context.json`. MCP iz njega rezervno čita task, taskRoot i leaseToken; ne koristi ga kao univerzalni fallback za sva polja. `OBSIDIAN_ROLE` i `OBSIDIAN_AGENT` dolaze iz okruženja koje šalje kontrolni sloj (`agentEnv`), a ne iz statične MCP konfiguracije: statična `env` tabela pobeđuje nasleđeno okruženje (`buildChildEnv = {...parentEnv, ...config.env}`), pa bi fiksirana uloga onemogućila drugu ulogu istog vendora — `agy` bi uvek bio `researcher` (ekstraktor ne bi pisao fragmente), `dsh` uvek `verifier` (red-team ne bi pisao nalaze, a programer ne bi pisao popravke). Zato šabloni u `tools/config/mcp/` fiksiraju samo `OBSIDIAN_AGENT`; ako `OBSIDIAN_ROLE` nije prosleđen, server ostaje `readonly`.
