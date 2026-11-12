# Razvoj i testiranje

[Dokumentacija](README.md) · [Arhitektura](ARHITEKTURA.md)

## Razvojno okruženje

Projekat je Node ESM (`type: module`), bez build koraka i spoljnjih npm zavisnosti. Biblioteke su `.mjs`, CLI ulazi imaju Node shebang. `npm run lint` je linter vault ugovora, a ne JavaScript style linter. Paket je private i nema definisan javni release/publish proces.

```bash
npm test
node --test tests/pipeline.test.mjs
node --test tests/mcp.test.mjs
node scripts/demo.mjs
```

Testni helper `tests/helpers/vault.mjs` pravi privremeni Git vault sa kopiranim alatima i ugovorima, bez manifesta tuđeg izvora. Mock adapteri daju determinističke izlaze. Testovi za harness pokreću testne procese, a ne moraju koristiti stvarne plaćene modele.

## Testne oblasti

| Fajl u tests/ | Predmet provere |
|---|---|
| yaml.test.mjs | YAML/frontmatter parser i serializer |
| task-store.test.mjs | šema, automat, zakup i tok događaja |
| vault.test.mjs | beleške, slug, linkovi i indeks |
| lint.test.mjs | manifest, binarni izvori, metapodaci i linkovi |
| worktree.test.mjs | izolacija, merge, konflikt i politika zona |
| pipeline.test.mjs | kompletni tokovi, ponavljanje, opsezi i kapije |
| cli.test.mjs | komande, izlazi, kodovi i EPIPE |
| harness.test.mjs | komandni adapteri, izlazi i prekid procesa |
| mcp.test.mjs | JSON-RPC i pristupne kapije |
| scope.test.mjs | audit obrasci |
| reproduce.test.mjs | zamrznuti klonovi, reprodukcija, limiti i timeout; probna provera bwrap-a i fallback |
| coding.test.mjs, coding-robustness.test.mjs | coding tok, kapije, klasifikacija padova i zakup |
| crash-recovery.test.mjs | prekid procesa, oporavak i nastavak bez dupliranja |
| consolidate-paths.test.mjs, rebase-generated.test.mjs, wiki-integrity.test.mjs | promocija, rebase i integritet baze |
| config-roles.test.mjs | svaka uloga eksplicitno u `agents.yml`; reviewer je drugi vendor |
| exit.test.mjs, lease-heartbeat.test.mjs | pravilo `run --strict` i zajedničko obnavljanje zakupa |

Broj testova uzmi iz stvarnog rezultata trenutne revizije; raniji README navodi istorijske brojeve koji se mogu razlikovati. Testovi koji proveravaju vremenske prozore (R19, CR2) deterministički su vezani marker/release fajlovima, ne `sleep`-om: ako im treba prozor, čekaju hook, a ne sat. Testovi reprodukcije izvršavaju Bash/Python i pokušavaju bwrap ako je dostupan. Ograničeno okruženje može sprečiti kloniranje, podprocese ili sandbox; uzrok neuspeha dokumentuj odvojeno od sadržajne regresije.

## Interni API

```javascript
import { loadConfig } from './tools/orchestrator/lib/config.mjs';
import { createStore } from './tools/orchestrator/lib/store.mjs';
import { createPipeline } from './tools/orchestrator/lib/pipeline.mjs';

const config = await loadConfig('/apsolutna/putanja/do/pripremljenog-vault-a');
const store = createStore(config);
const pipeline = createPipeline(config, { store, logger: console.error });
const pregled = await pipeline.status();
console.log(pregled);
```

Primer pokreći iz korena projekta kao ESM datoteku; vault mora biti pripremljen. API nije deklarisan kao stabilna javna biblioteka.

Pipeline izlaže ingest, audit, runExtract, runResearch, runVerify, runChallenge, runAudit, runConsolidate, reflect, runOnce, run i status. Store izlaže čitanje i kontrolisane mutacije, transition, zakup i evidenciju. `createStore` prihvata testni clock i lockOptions; pipeline dozvoljava ubrizgavanje store/logger i nekih ograničenja za testiranje.

Adapter dobija role, task, cwd i prompt. Normalizovan rezultat nosi ok, output, exitCode, durationMs, harness, a po potrebi verdict i artefakte. Harness uspeh procesa nije konačni uspeh faze. `runAgent` materijalizuje kontekst; u trenutnom kodu ne obnavlja zakup automatski tokom poziva.

## Dodavanje adaptera

1. Dodaj komandu u HARNESS_COMMANDS i njeno upravljanje procesom.
2. Poveži izbor sa agents konfiguracijom i dispečerom.
3. Proveri env identitet, task root, token i MCP ulogu u izolovanom stablu.
4. Testiraj nepostojeći program, neuspešan izlaz, timeout, podprocese i stvarne artefakte.
5. Ažuriraj konfiguracionu i MCP dokumentaciju.

## Dodavanje uloge

Nova uloga zahteva promene ROLES, DEFAULT_CONFIG, oba YAML fajla, brief-a, prompt zone, adaptera/mock rezultata, pipeline selekcije i odgovarajućih kapija. Definiši ortogonalnu zonu upisa, stanje pre/posle faze, artefakt uspeha, vlasnika zakupa i merge politiku. `ROLE_ARTIFACT_ZONE` trenutno ne sadrži extractor/librarian, iako njihove posebne faze prosleđuju instrukcije; pri proširenju nemoj pretpostaviti da je ta mapa potpuna.

## Dodavanje MCP alata

Dodaj TOOLS šemu i HANDLERS funkciju. Koristi postojeće assertReadable/assertWritable kapije; ne dozvoli novi put upisa bez zadatka i zakupa. JSON Schema opis sam po sebi nije validacija. Dodaj protokolski test i test odbijanja za zabranjenu zonu, symlink i pogrešan zakup.

## Pravila provere promena

Za promene kontrolnog toka proveri uspešan tok i konkretan kontraprimer koji promena rešava. Za promene zona proveri direktno MCP odbijanje i završnu merge kapiju. Za manifest koristi binarne bajtove, ne samo UTF-8. Za konkurentnost proveri tokene dva procesa istog harnesa i stvarno trajanje zaključavanja.

Ne menjaj raw izvore radi prolaska testova. Ne pokreći `demo --in-place` kao rutinski test projekta. Dokumentaciju proveravaj po relativnim linkovima i komandama iz koda; ona nije domen beleške koja mora imati vault frontmatter.

## Održavanje dokumentacije

Ažuriraj CLI kada menjaš handler/parser, konfiguraciju kada menjaš defaults/YAML, MCP kada menjaš šemu/env, a model podataka kada menjaš šemu ili prelaze. Bezbednosne kapije i poznata ograničenja treba opisati prema izvršenom kodu. Istorijske rezultate realnih modela čuvaj u originalnim izveštajima; nova verifikacija treba imati datum, reviziju, komandu i stvarni rezultat.
