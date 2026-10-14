# Dokazi — Korak 1: testno okruženje, uzroci padova i potvrđeni defekt

[Dokumentacija](README.md) · [Preporuke za dalji razvoj](../Agent-2.0-Preporuke-za-dalji-razvoj.md)

Datum: 14. oktobar 2026.
Revizija koda na početku koraka: `a0dc5c825710d839d2643216658ddb76621c1469` (`a0dc5c8`).
Cilj koraka: „razjasniti i ponovljivo izvršiti postojeći testni skup na poznatoj
reviziji, bez menjanja obima sistema“.

Ovaj zapis prati šablon iz odeljka 8 preporuka. Svaki nalaz nosi komandu i
stvarni rezultat; gde podatak ne postoji, piše „nije izmereno“.

## 1. Okruženje

| Stavka | Vrednost |
|---|---|
| OS | Linux 7.2.5-3-omarchy, x86_64 |
| Node | v26.8.2 |
| Git | 2.55.0 |
| CPU / RAM | 16 jezgara; 15,4 GiB RAM (8,6 GiB slobodno), 30 GiB swap |
| cgroup | `memory.max = max`, `pids.max = 18152` |
| `bwrap` | 0.12.0, `/usr/bin/bwrap`, bez setuid bita (radi preko unprivileged user namespace) |
| Sandbox DSH bash alata | `bwrap --ro-bind / / --dev /dev --unshare-pid --proc /proc --die-with-parent --tmpfs /tmp --bind <vault> <vault> -- bash -c …` |
| Seccomp u ljusci | `Seccomp: 0` (nema filtera); spoljni sandbox **nema** `--unshare-net` |
| Posledica sandboxa | `/tmp` je privatan `tmpfs` po pozivu — `os.tmpdir()` u testovima je izolovan i briše se |

## 2. Ogled: kompletan testni skup na reviziji a0dc5c8

- Revizija koda: `a0dc5c8` (bez izmena; radno stablo prljavo samo u `README.md`, `docs/` i dokumentu preporuka)
- Datum i okruženje: 14.10.2026, tabela iz odeljka 1
- Tvrdnja koju proveravamo: postojeći skup se u ovom okruženju izvršava ponovljivo
- Komanda:

```bash
npm test                                    # node --test tests/
node --test --test-concurrency=1 tests/     # serijski
node --test --test-isolation=none --test-reporter=spec tests/cli.test.mjs tests/reproduce.test.mjs
```

- Očekivani rezultat: skup prolazi bez padova
- Stvarni rezultat:

| Izvođenje | tests | pass | fail | trajanje |
|---|---|---|---|---|
| `npm test` #1 | 128 | 128 | 0 | 15,4 s |
| `npm test` #2 | 128 | 128 | 0 | 16,7 s |
| `--test-concurrency=1` | 128 | 128 | 0 | 29,2 s |
| `--test-isolation=none` (cli+reproduce) | 15 | 15 | 0 | 8,3 s |
| 4 sporne oblasti, 12 uzastopnih izvođenja | 58 × 12 | 58 × 12 | 0 | — |

- Zaključak: **potvrđeno** — skup prolazi ponovljivo u ovom okruženju, uključujući
  tačno onu diiagnostičku komandu koja je u `docs/PROVERA.md` prijavila 3 prolaza
  od 15.
- Kontradikcija u postojećim zapisima: `SPREMNOST.md` (14.10. u 01:43) beleži
  `128 prolazi, 0 padova`, a `docs/PROVERA.md` (14.10. u 07:50) na **istoj
  reviziji** beleži pad četiri testna fajla. Isti kod, različit ishod — padovi su
  zavisni od okruženja ili trenutka, ne od revizije.

## 3. Ogled: uzrok istorijskog pada `reproduce.test.mjs`

- Tvrdnja koju proveravamo: poruka
  `bwrap: loopback: Failed to create NETLINK_ROUTE socket: Operation not permitted`
  nastaje zato što je okruženje zabranilo `socket(AF_NETLINK, …)`, a ne zbog koda.
- Postupak (kontrolisani kontraprimer): mali `LD_PRELOAD` šim koji za
  `AF_NETLINK` vraća `EPERM`, pa bwrap sa **istim argumentima** koje gradi
  `omotaj()` u `tools/orchestrator/lib/reproduce.mjs`:

```c
int socket(int domain, int type, int protocol) {
  if (real_socket == NULL) real_socket = dlsym(RTLD_NEXT, "socket");
  if (domain == AF_NETLINK) { errno = EPERM; return -1; }
  return real_socket(domain, type, protocol);
}
```

- Stvarni rezultat:

| Uslov | Izlaz | Kod |
|---|---|---|
| bez šima | `INNER_OK` | 0 |
| `LD_PRELOAD` koji odbija `AF_NETLINK` | `bwrap: loopback: Failed to create NETLINK_ROUTE socket: Operation not permitted` | 1 |

- Dodatna provera: isključena je i hipoteza da je uzrok mrežni namespace.
  Ugnježdeni `bwrap` uspeva i kada je spoljni sandbox pokrenut i sa
  `--unshare-net` i bez njega (`INNER_OK`, kod 0 u oba slučaja).
- Zaključak: **potvrđeno** — uzrok je odbijanje sistemskog poziva
  `socket(AF_NETLINK)` u okruženju; bwrap se prekida **pre** nego što pokrene
  skript. U ovom okruženju `AF_NETLINK` radi, pa se pad ne reprodukuje i svi
  reprodukcioni testovi prolaze.
- Preostalo ograničenje: nije zabeleženo **koji** je tačno sloj te sesije
  zabranjivao `AF_NETLINK` (nijedan sačuvani log ne nosi taj izlaz).

## 4. Ogled: greška izvršavanja je otvarala kapiju (defekt D9)

- Tvrdnja koju proveravamo (iz preporuka, D9 i matrica): „neuspešna provera nije
  sadržajni pass“; ugovor, invarijanta 24: skript koji „nije izvršen daje verdikt
  `unexecuted` i blokira spajanje“.
- Postupak: u izolovanom testnom vault-u mock red-team (`AGENT_2_0_MOCK_CHALLENGE=fail`)
  proizvodi skript koji **stvarno obara** tvrdnju. Prvo sa ispravnim sandboxom
  (kontrola), pa sa istim `LD_PRELOAD` šimom iz ogleda 3 (AF_NETLINK zabranjen).
- Stvarni rezultat:

| Uslov | verdikt | reprodukovano | lažnih | `runConsolidate` |
|---|---|---|---|---|
| sandbox ispravan (kontrola) | `reproducible` | 1 | 0 | odbijen (`nije u stanju verified`) |
| `AF_NETLINK` zabranjen | **`clean`** | 0 | **1** | **prošao** |

- Zaključak: **potvrđeno (defekt)** — greška okruženja se brojala kao „lažni
  nalaz“, verdikt je postao `clean` i kapija se otvorila. Reproduktivan nalaz
  red-teama je tiho odbačen, a zadatak je otišao u `main`. To je kršenje
  invarijante 24 i klase D9.
- Uzrok u kodu: `runReproductionScripts` nije razlikovao „skript nije oborio
  tvrdnju“ od „skript nije ni pokrenut“; `pipeline.runChallenge` je svaki
  `reproduced === false` bez isteka brojao kao lažni nalaz.

## 5. Ogled: ponovljivost posle ispravke

- Komanda: `npm test` dva puta nad istom revizijom i istim izmenama
- Stvarni rezultat: **130 prolazi, 0 padova** u oba izvođenja (128 postojećih +
  2 nova regresiona testa)
- Kontraprovera da testovi zaista hvataju defekt: sa **staroḿ** verzijom
  `reproduce.mjs`/`pipeline.mjs` (HEAD) i novim testovima — **29 prolazi,
  2 padaju**, i to tačno dva nova testa. Sa ispravkom: 2/2 prolaze.
- Zaključak: **potvrđeno** — regresioni testovi su pravi kontraprimeri, a ne
  kopija implementacije.

## 6. Nalazi

| Oznaka | Nalaz | Vrsta po odeljku 9 | Odluka |
|---|---|---|---|
| N1 | Greška izvršavanja reprodukcije (pukao sandbox/interpreter/klon) broji se kao lažni nalaz, daje `clean` i otvara kapiju | dopušta neproveren sadržaj | **popravljeno** u ovom koraku |
| N2 | Pad `reproduce.test.mjs` na a0dc5c8: okruženje je odbilo `socket(AF_NETLINK)`; bwrap se prekida pre skripta | ograničenje okruženja | uzrok potvrđen; u ovom okruženju se ne reprodukuje |
| N3 | Padovi `cli.test.mjs`, `mcp.test.mjs`, `pipeline.test.mjs` sa praznim `stdout`/`stderr` na a0dc5c8 | nepotvrđena sumnja | uzrok **nije** rekonstruisan (vidi odeljak 8) |
| N4 | Isti kod daje `128/0` (SPREMNOST.md) i pad 4 fajla (PROVERA.md) | — | zabeleženo kao dokaz da je ishod zavisan od okruženja |

## 7. Izmene u ovom koraku

Svaka izmena sa obrazloženjem „menjamo zato što eksperiment X na reviziji Y daje Z“:

1. `tools/orchestrator/lib/reproduce.mjs` — rezultat po skriptu nosi polje
   `executed`; `false` je kada proces nije ni pokrenut (`spawn` greška), kada je
   izlazni kod `null`, ili kada je bwrap prijavio sopstvenu grešku (`bwrap: …`).
   *Zato što eksperiment D9 na a0dc5c8 pokazuje da pukao sandbox proizvodi
   `reproduced: false`, što se dalje tumačilo kao „nema nalaza“.*
2. `tools/orchestrator/lib/pipeline.mjs` — neizvršeni skripti ulaze u
   `unexecuted`, verdikt postaje `unexecuted` (blokira), ne `clean`; lažni
   nalazi se broje samo za skripte koji su stvarno izvršeni; u zapis zadatka
   dodato je `executionFailures` sa razlogom.
   *Zato što invarijanta 24 već obećava to ponašanje, a eksperiment pokazuje da
   ga kod ne sprovodi.*
3. `tests/reproduce.test.mjs`, `tests/pipeline.test.mjs` — dva regresiona testa
   koji obaraju N1 (padaju bez ispravke).
   *Zato što eksperiment pokazuje stvarni kontraprimer, a ne varijaciju
   postojećeg testa.*
4. `tests/helpers/vault.mjs` — `runCli` nikad ne vraća prazan `stderr`: ako je
   proces ubijen pre izlaza, u poruci stoji `error.message` i signal.
   *Zato što je istorijski pad prijavio prazne `stdout`/`stderr` bez ijednog
   traga o uzroku, pa se uzrok više nije mogao utvrditi.*

Obim sistema nije menjan: nema novih uloga, servisa, posrednika, baza ni API-ja.

## 8. Šta ostaje nedokazano

- **N3 ostaje otvoren.** Nijedan sačuvani artefakt ne nosi izlaz neuspešnog
  izvođenja iz `docs/PROVERA.md` (pretraženi su DSH transkripti sesija,
  `external-agents/runs`, `tasks/events.jsonl` i repozitorijum — nema zapisa).
  Zabeleženi simptom — prazni `stdout` **i** `stderr` uz neuspešan izlazni kod —
  odgovara procesu koji je prekinut pre nego što je nešto napisao; to je
  **hipoteza**, ne potvrđen uzrok. Oblast je pokrivena ponovljenim uspešnim
  izvođenjem (12/12 + 3 kompletna prolaza), ali tvrdnja „uzrok je poznat“ za ta
  tri fajla **nije** ispunjena. Ispravka 4 iz odeljka 7 garantuje da se takav pad
  više ne može prijaviti bez traga.
- Nije meren trošak modela (nije bilo plaćenih poziva u ovom koraku).
- Revizija je `a0dc5c8` + izmene iz ovog koraka; svaki budući dokaz treba vezati
  za novu reviziju, a prethodni prolaz ostaje istorijski dokaz prethodne revizije.
