# Dokazi — Korak 1: testno okruženje, uzroci padova i potvrđeni defekt

[Dokumentacija](README.md) · [Preporuke za dalji razvoj](../Agent-2.0-Preporuke-za-dalji-razvoj.md)

Datum: 14. oktobar 2026.
Revizije: početna `a0dc5c8` → prva ispravka `b02b3d0` → revizija ovog zapisa
(`git log -1 -- docs/DOKAZI-KORAK-1.md`).
Cilj koraka: „razjasniti i ponovljivo izvršiti postojeći testni skup na poznatoj
reviziji, bez menjanja obima sistema“.

Zapis prati šablon iz odeljka 8 preporuka. Svaki nalaz nosi komandu i stvarni
rezultat; gde podatak ne postoji, piše „nije izmereno“.

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

## 2. Ogled: kompletan testni skup

- Revizije: `a0dc5c8` (bez izmena) i revizija sa ispravkama iz ovog koraka
- Datum i okruženje: 14.10.2026, tabela iz odeljka 1
- Tvrdnja: postojeći skup se u ovom okruženju izvršava ponovljivo
- Komande:

```bash
npm test                                    # node --test tests/
node --test --test-concurrency=1 tests/     # serijski
node --test --test-isolation=none --test-reporter=spec tests/cli.test.mjs tests/reproduce.test.mjs
```

- Stvarni rezultat:

| Izvođenje | tests | pass | fail | trajanje |
|---|---|---|---|---|
| `a0dc5c8`: `npm test` #1 | 128 | 128 | 0 | 15,4 s |
| `a0dc5c8`: `npm test` #2 | 128 | 128 | 0 | 16,7 s |
| `a0dc5c8`: `--test-concurrency=1` | 128 | 128 | 0 | 29,2 s |
| `a0dc5c8`: `--test-isolation=none` (cli+reproduce) | 15 | 15 | 0 | 8,3 s |
| `a0dc5c8`: 4 sporne oblasti, 12 uzastopnih izvođenja | 58 × 12 | 58 × 12 | 0 | — |
| posle ispravki: `npm test` #1 i #2 | 131 | 131 | 0 | — |

- Zaključak: **potvrđeno** — skup prolazi ponovljivo, uključujući tačno onu
  diiagnostičku komandu koja je u `docs/PROVERA.md` prijavila 3 prolaza od 15.
- Kontradikcija u postojećim zapisima: `SPREMNOST.md` (14.10. u 01:43) beleži
  `128 prolazi, 0 padova`, a `docs/PROVERA.md` (14.10. u 07:50) na **istoj
  reviziji** beleži pad četiri testna fajla. Isti kod, različit ishod — padovi su
  zavisni od okruženja ili trenutka, ne od revizije.

## 3. Ogled: uzrok istorijskog pada `reproduce.test.mjs`

- Tvrdnja: poruka
  `bwrap: loopback: Failed to create NETLINK_ROUTE socket: Operation not permitted`
  nastaje zato što je okruženje zabranilo `socket(AF_NETLINK, …)`, a ne zbog koda.
- Postupak: mali `LD_PRELOAD` šim koji za `AF_NETLINK` vraća `EPERM`, pa bwrap
  sa **istim argumentima** koje gradi `omotaj()`:

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

- Isključena je i hipoteza o mrežnom namespace-u: ugnježdeni `bwrap` uspeva i kada
  je spoljni sandbox pokrenut sa `--unshare-net` i bez njega (`INNER_OK`, kod 0).
- Zaključak: **potvrđeno** — uzrok je odbijanje sistemskog poziva
  `socket(AF_NETLINK)`; bwrap se prekida **pre** nego što pokrene skript. U ovom
  okruženju `AF_NETLINK` radi, pa se pad ne reprodukuje.
- Preostalo ograničenje: nije zabeleženo **koji** je tačno sloj te sesije
  zabranjivao `AF_NETLINK` (nijedan sačuvani log ne nosi taj izlaz).

## 4. Ogled: greška izvršavanja je otvarala kapiju (defekt D9)

- Tvrdnja: invarijanta 24 ugovora — „skript koji … nije izvršen daje verdikt
  `unexecuted` i blokira spajanje“; preporuke, D9 i matrica — „neuspešna provera
  nije sadržajni pass“.
- Postupak: mock red-team (`AGENT_2_0_MOCK_CHALLENGE=fail`) proizvodi skript koji
  **stvarno obara** tvrdnju; prvo sa ispravnim sandboxom (kontrola), pa sa
  `LD_PRELOAD` šimom iz ogleda 3.
- Stvarni rezultat (na a0dc5c8):

| Uslov | verdikt | reprodukovano | lažnih | `runConsolidate` |
|---|---|---|---|---|
| sandbox ispravan (kontrola) | `reproducible` | 1 | 0 | odbijen |
| `AF_NETLINK` zabranjen | **`clean`** | 0 | **1** | **prošao** |

- Zaključak: **potvrđeno (defekt)** — greška okruženja se brojala kao „lažni
  nalaz“, verdikt je postao `clean`, kapija se otvorila i reproduktivan nalaz je
  tiho odbačen. Kršenje invarijante 24 i klasa D9.

## 5. Ogled: nezavisna verifikacija (codex, `verify` nit)

Verifikaciju je radio drugi vendor u sopstvenom worktree-u
(`~/.agent-worktrees/verify-session-08b4-codex`, `mode: full`), sa slepim ulazom:
specifikacija + `git show b02b3d0` + tvrdnje, bez reasoninga izvršioca.
Zadatak je tražio da svaka tvrdnja bude potvrđena ili oborena konkretnim ulazom.

| Tvrdnja | Ishod | Dokaz |
|---|---|---|
| T1 skup prolazi (130/130) | **POTVRĐENO** | `npm test` → `tests 130 / pass 130 / fail 0` |
| T2 pre ispravke `clean` + merge prolazi, posle `unexecuted` + blokada | **POTVRĐENO** | sa modulima iz a0dc5c8: `{"verdict":"clean","falsePositives":1}`, `consolidate {"ok":true}`; na b02b3d0: `{"verdict":"unexecuted"}`, `nije prošao red-team fazu` |
| T3 dva nova testa padaju bez ispravke | **POTVRĐENO** | sa modulima iz a0dc5c8: `pass 0 / fail 2`; na b02b3d0: `pass 2 / fail 0` |
| T4 `executed=false` tačno u tri navedena slučaja | **OBORENO** | stvarno izvršen skript koji sam ispiše `bwrap: poruka samog skripta` i izađe sa 1 dobio je `executed:false` |

- Verifikator je sam našao ograničenje T3 dokaza: na roditeljskoj reviziji
  reprodukcioni test pada već na kontrolnoj proveri polja `executed` (koje tamo ne
  postoji), pa E2E test i zasebna proba nose glavni dokaz defekta. To je zabeleženo
  kao oslabljen dokaz, ne kao potvrda.
- Zaključak: nalaz N1 i ispravka su **nezavisno potvrđeni**, a jedna tvrdnja o
  implementaciji je **oborena** i ispravljena u odeljku 6.

## 6. Ogled: ispravka klasifikacije po nalazu verifikacije

- Uzrok oborene T4: klasifikacija se oslanjala na **tekst izlaza**
  (`/^\s*bwrap: /`), pa je sopstvena poruka skripta ličila na grešku sandboxa.
- Ispravka: odluku nosi **marker koji ispiše sam interpreter** pre pokretanja
  skripta (`__AGENT2_INTERPRETER_POKRENUT__`); ako markera nema, interpreter nije
  ni startovao. Tekst izlaza više ne učestvuje u odluci.
- Kontraprovera da novi test hvata oboreni slučaj:

| Kod | Test „skript koji sam ispiše bwrap:“ |
|---|---|
| verzija iz `b02b3d0` (tekst izlaza) | **pada** (1/1 fail) |
| verzija sa markerom | prolazi |

- Kompletan skup posle ove ispravke: **131 prolazi, 0 padova**, dva uzastopna
  izvođenja.

## 7. Nalazi

| Oznaka | Nalaz | Vrsta po odeljku 9 | Odluka |
|---|---|---|---|
| N1 | Greška izvršavanja reprodukcije (pukao sandbox/interpreter/klon) broji se kao lažni nalaz, daje `clean` i otvara kapiju | dopušta neproveren sadržaj | **popravljeno**, nezavisno potvrđeno |
| N2 | Pad `reproduce.test.mjs` na a0dc5c8: okruženje je odbilo `socket(AF_NETLINK)`; bwrap se prekida pre skripta | ograničenje okruženja | uzrok potvrđen; u ovom okruženju se ne reprodukuje |
| N3 | Padovi `cli.test.mjs`, `mcp.test.mjs`, `pipeline.test.mjs` sa praznim `stdout`/`stderr` na a0dc5c8 | nepotvrđena sumnja | uzrok **nije** rekonstruisan (odeljak 9) |
| N4 | Isti kod daje `128/0` (SPREMNOST.md) i pad 4 fajla (PROVERA.md) | — | dokaz da ishod zavisi od okruženja |
| N5 | Klasifikacija „izvršeno/neizvršeno“ zavisila od teksta izlaza | pogrešna klasifikacija | **popravljeno** po nezavisnoj verifikaciji |

## 8. Izmene u ovom koraku

Svaka izmena sa obrazloženjem „menjamo zato što eksperiment X na reviziji Y daje Z“:

1. `tools/orchestrator/lib/reproduce.mjs` — rezultat po skriptu nosi polje
   `executed`; odluka se donosi po markeru interpreterа, ne po tekstu izlaza.
   *Zato što eksperiment D9 na a0dc5c8 pokazuje da pukao sandbox proizvodi
   `reproduced: false`, što se dalje tumačilo kao „nema nalaza“, a nezavisna
   verifikacija pokazuje da je pogodba po tekstu pogrešna za skript koji sam
   ispiše `bwrap: …`.*
2. `tools/orchestrator/lib/pipeline.mjs` — neizvršeni skripti ulaze u
   `unexecuted`, verdikt postaje `unexecuted` (blokira), ne `clean`; lažni
   nalazi se broje samo za skripte koji su stvarno izvršeni; u zapis zadatka
   dodato je `executionFailures` sa razlogom.
   *Zato što invarijanta 24 već obećava to ponašanje, a eksperiment pokazuje da ga
   kod ne sprovodi.*
3. `tests/reproduce.test.mjs`, `tests/pipeline.test.mjs` — tri regresiona testa
   (pukao sandbox; greška izvršavanja na kapiji; skript koji sam ispiše `bwrap:`).
   *Zato što eksperimenti pokazuju stvarne kontraprimere, uključujući onaj koji je
   našao verifikator.*
4. `tests/helpers/vault.mjs` — `runCli` nikad ne vraća prazan `stderr`; ako je
   proces ubijen pre izlaza, u poruci stoji `error.message` i signal.
   *Zato što je istorijski pad prijavio prazne `stdout`/`stderr` bez traga o
   uzroku, pa se uzrok više nije mogao utvrditi.*

Obim sistema nije menjan: nema novih uloga, servisa, posrednika, baza ni API-ja.

## 9. Šta ostaje nedokazano

- **N3 ostaje otvoren.** Nijedan sačuvani artefakt ne nosi izlaz neuspešnog
  izvođenja iz `docs/PROVERA.md` (pretraženi su DSH transkripti sesija,
  `external-agents/runs`, `tasks/events.jsonl` i repozitorijum — nema zapisa).
  Simptom — prazni `stdout` **i** `stderr` uz neuspešan izlazni kod — odgovara
  procesu prekinutom pre nego što je nešto napisao; to je **hipoteza**, ne
  potvrđen uzrok. Oblast je pokrivena ponovljenim uspešnim izvođenjem, ali tvrdnja
  „uzrok je poznat“ za ta tri fajla **nije** ispunjena. Ispravka 4 iz odeljka 8
  garantuje da se takav pad više ne može prijaviti bez traga.
- Nezavisna verifikacija nije ponovljena nad ispravkom iz odeljka 6 u trenutku
  pisanja ovog zapisa; njen ishod se dopisuje kad bude izvršena.
- Nije meren trošak modela (nije bilo plaćenih poziva nad sadržajem).
- Svaki budući dokaz treba vezati za novu reviziju; prethodni prolaz ostaje
  istorijski dokaz prethodne revizije.
