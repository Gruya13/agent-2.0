# Bezbednost i ograničenja

[Dokumentacija](README.md) · [Operacije](OPERACIJE.md)

## Granica poverenja

Kontrolni sloj je autoritet za stanje, zakup i ulazak sadržaja u main. Agentov tekst ili izlazni kod ne predstavlja dovoljan dokaz da je znanje ispravno. Faze proveravaju nastale artefakte, linter proverava ugovore, verifikator proverava sadržaj, a red-team pokušava reprodukciju kontraprimera.

## Kapije upisa i merge-a

1. MCP proverava realnu putanju i da upis ostaje u vault-u.
2. Uloga ima posebnu zonu; researcher i extractor ne dele iste fragmente.
3. U kontrolisanom vault-u mora postojati zadatak sa odgovarajućim statusom i živim zakupom vlasnika.
4. Ako zadatak nosi lock_token, MCP traži isti token procesa.
5. Produkcija za ingest zahteva verifikacioni pass i ime deklarisanog artefakta. Postojeća beleška ne prepisuje se tim putem.
6. Librarian mora imati audit zadatak i opseg; consolidator koristi ingest tok.
7. Merge proverava promenjene putanje grane i politiku zadatka, uključujući obe strane rename-a.
8. Konsolidacija zahteva clean challenge kada je kapija uključena, proverava linter i obrađuje konflikt bez automatskog biranja jedne strane.

Indeks i manifest poravnavaju se pre rebase-a i zatim regenerišu. Promene tools, tests, raw i ugovora ne smeju biti unesene iz agentske grane kroz standardnu politiku zadatka.

## Izvršavanje red-team koda

Red-team skripte imaju naziv `NALAZ-*.sh` ili `NALAZ-*.py`. Kontrolni sloj ih kopira u svež privremeni klon zamrznute revizije i pokreće preko Bash-a ili Python-a. Podrazumevano izvršava najviše tri skripte, po najviše 60 sekundi.

Nalaz se smatra reprodukovanim kada skript završi kodom 0, nije istekao i stdout sadrži `OBORENO`. To je izvršni format dokaza; sam marker ne dokazuje da je skript dobro projektovan. Operater i dalje može pregledati skript i tvrdnju koju testira.

| Ishod | Tumačenje |
|---|---|
| kod 0 + OBORENO | reproduced=true; blokira objavljivanje |
| bez markera ili drugi kod | nije reprodukovan; obično false positive |
| istek vremena | vodi u unexecuted verdikt ako nema jačeg nalaza |
| skripte preko limita | preostale ulaze u unexecuted |
| nijedan blokirajući rezultat | clean po trenutnoj logici |

Ako je `bwrap` dostupan, kod **prvo probno izvrši** sandbox sa istim namespace ograničenjima koja koristi i pravi omotač (`--unshare-pid`, `--unshare-net`, `--proc`, `--dev`, `--tmpfs`). Dostupnost programa nije dokaz da je sandbox uspešno uspostavljen: ako proba padne (npr. kontejner zabranjuje user namespace), skripte se izvršavaju kao obični korisnički procesi — to je svesni fallback da nalaz ne bi bio lažno „neizvršen“, ali gubi izolaciju. Bez njega skripte rade kao obični korisnički procesi; privremeni klon i promenjeni HOME ne sprečavaju pristup ostalim datotekama ili mreži. Procesi nasleđuju korisničko okruženje, koje može sadržati tajne. Ovo je realna granica implementacije.

**Docker sandbox za reprodukcije (preporučeno).** Produkciona konfiguracija
(`tools/config/agents.real.yml`) postavlja `pipeline.challengeSandbox: docker`: red-team
skripte se tada izvršavaju u kontejneru sa read-only rootfs-om, bez mreže
(`--network none`), bez host HOME-a i sa `--cap-drop ALL`, `--pids-limit` i
`--memory`; jedini upisivi put je privremeni klon mountovan kao `/work` (i tmpfs
`/tmp`). Ako Docker ili slika nisu dostupni, kod pada na bwrap, pa na host.
Slika se gradi iz repozitorijuma: `tools/sandbox/build.sh` (Dockerfile je u `tools/sandbox/`).

Greška kloniranja/interpretera/sandbox-a može biti zabeležena kao unreproduced, pa njen operativni uzrok ne treba pomešati sa dokazom da tvrdnja nije oboriva. `challengeExecute: false` trenutno može proizvesti clean bez izvršavanja skripti koje su unutar limita. U dnevniku uvek proveri executed, timedOut, unexecuted i pojedinačne rezultate.

## Izolovane DSH kopije (worker)

Worker je jednokratna kopija DSH-a u Docker kontejneru, namenjena izvršavanju
zadataka pod tvrdom granicom. Orkestrator ga diže alatom `spawn_worker` ili
skriptom `~/.dsh/docker/spawn-worker.mjs`; worker piše samo svoju granu i ne
vidi pravi repozitorijum.

| Sloj | Šta je | Šta dobija |
|---|---|---|
| fajl sistem | `--read-only` rootfs + dva montirana direktorijuma | `/work` (svež git klon) i `/brief` (read-only) |
| identitet | uid 1000, `--cap-drop=ALL`, `no-new-privileges` | nema roota, nema sposobnosti |
| mreža | `internal` Docker mreža | samo sidecar proxy `172.20.0.10:8765`; nema interneta, nema DNS-a |
| tajne | proxy kontejner drži DeepSeek ključ | worker dobija samo lažni `DEEPSEEK_API_KEY=worker-proxy` |
| git | bare single-branch mirror po runu | worker vidi jednu granu i ništa drugo; izlaz je `git push` u mirror |
| resursi | `--pids-limit`, `--memory`, `--cpus`, `--init` | nema fork bomb, nema preuzimanja hosta |

`NARB_DISABLE_NATIVE_CACHE=1` je deo granice: native binding se učitava iz
read-only slike, a ne kopira u izvršivi tmpfs. Ovaj uslov je otkriven
proverom (`verify.mjs`), ne pretpostavkom.

**Granica:** Docker deli kernel. Worker štiti od slučajne štete i od
nepoverljivih instrukcija, ali ne od protivnika sa kernel exploitom — za to su
potrebni rootless Docker ili gVisor. Worker ne dobija MCP servere ni korisničke
pluginove; ako zadatak traži MCP, to je nova odluka o sandboxu, ne tiho
proširenje.

Provera celog lanca, uključujući jedan model poziv:

```bash
node ~/.dsh/docker/verify.mjs          # 15 provera: slika, proxy, izolacija, e2e
node ~/.dsh/docker/verify.mjs --no-e2e # bez model poziva
```

Detalji: `docs/IZOLACIJA-KOPIJA.md` i `~/.dsh/docker/README.md`.
## Granice zaštite

- Git worktree nije OS sandbox i proces istog korisnika može pristupiti drugim putanjama.
- `agy` adapter u kodu koristi zastavicu `--dangerously-skip-permissions` (naziv
  harnesa je `agy`). U `safe` modu proces se ipak izvršava kroz `bwrap`: `HOME` je
  prazan tmpfs, izvršno okruženje se ne nasleđuje, radni direktorijum je
  read-only, a od HOME-a se binduju samo CLI-jev `~/.gemini`,
  `~/.config/antigravity` i mise runtime — `~/.dsh`, `~/.ssh`, `~/.gnupg` i drugi
  projekti nisu vidljivi. Mreža i keyring ostaju dostupni (agy-jev sopstveni
  auth), pa to nije kontejnerska izolacija; za tvrdu granicu koristi se
  `dsh-worker`.
- MCP štiti operacije koje idu kroz njega. Direktan fajl-sistemski upis u agentskom stablu proverava se ponovo na merge-u; time se ne sprečava svaki neželjeni upis van stabla.
- Brisanje `.agents/AGENTS.md` uklanja marker po kome MCP prepoznaje kontrolisani vault. Marker i glavni kontrolni koren moraju ostati pod nadzorom operatera.
- Verifier i red-team podrazumevano dele dsh vendora; `correlationRisk` je evidencija, ne dodatna nezavisna provera.
- Konfigurisan heartbeat nije implementiran; podrazumevani zakup traje 10 minuta, a poziv agenta može trajati 15 minuta. MCP upis posle isteka biće odbijen bez obnove ili prilagođenog TTL-a.
- File-lock ima vreme zastarelosti od 30 sekundi, što ograničava pouzdanost dužih paralelnih sesija.
- Manifest i JSONL nisu neizmenjivi zapisi na OS nivou; korisnik sa pravom pisanja može ih promeniti.
- Putanje i globs nisu u svim slojevima generalizovani na isti način; zadrži standardnu topologiju i koristi precizan audit opseg.
- Uspešan tehnički tok ne dokazuje kvalitet sadržaja mock adaptera niti nepogrešivost stvarnih modela.

## Ručno preglasavanje

`override TASK-ID --reason TEKST` beleži svesnu odluku da challenge postane clean. Ne resetuje status blocked, ne zamenjuje verifikacioni pass i ne potvrđuje da je reprodukcija uspela. `ready` i override su odvojene intervencije. Koristi ih nakon pregleda dokaza; primeri oporavka su u operativnom vodiču.

Ovaj dokument opisuje lokalni kod. Ne predstavlja novu reviziju bezbednosti spoljnih harnesa ili njihovih aktuelnih proizvoda.
