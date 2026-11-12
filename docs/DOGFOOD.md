# Dogfood — Agent 2.0 analizira sam sebe

Datum: 11. novembar 2026. · Polazna revizija: `57d41c9` · Završna revizija: `ab267c4`.

Cilj: primeniti sistem na njega samog — DSH orkestrator, `agy` kao istraživač i slepi
verifikator, `dsh-worker` kao izolovani izvršilac — i naći konkretne načine da se
Agent 2.0 unapredi. Uslov: svaki nalaz nosi dokaz, svaka popravka test, a verifikaciju
radi **drugi vendor** koji nije video reasoning izvršioca.
## Protokol

| faza | izvršilac | okruženje | trajanje | ulaz |
|---|---|---|---|---|
| 1. istraživanje | `agy` work nit | bwrap (safe) | 488 s, 140 poziva | repo + dokumentacija |
| 2. analiza koda | `dsh-worker` (deepseek-v4-pro) | Docker, izolovan | 564 s | repo klon, bez wiki |
| 3. slepa verifikacija | `agy` verify nit | bwrap (safe) | 294 s, 89 poziva | 13 tvrdnji, bez mojih zaključaka |
| 4. provera dokaza | DSH orkestrator | host | — | kod, komande, `npm test` |

Cilj je bio naći konkretne načine da sistem unapredi sebe — sa dokazom, ne tvrdnjom.

## Šta je popravljeno odmah (dogfood je našao bug u nama samima)

**P0 — bwrap sandbox nije imao `/bin`.** Agy je u analizi prijavio da `exec` pada sa
ENOENT (T1). Ispostavilo se da je to artefakt našeg novog sandboxa: bindujemo
`/usr` ali ne i usrmerge link `/bin -> usr/bin`, pa `/bin/sh` ne postoji, iako
`/usr/bin/sh` jeste. Popravljeno u `readOnlyCommand` i `sandboxCommand`; test
`SHELL_OK` u `verify.mjs`; 16/16 i 17/17 sa `--agy-e2e`. Commit Plugins `38bd61a`.

## Konsolidovani nalazi

| ID | nalaz | izvori | status | prioritet |
|---|---|---|---|---|
| P1 | Spawn greška repro komande (`ENOENT`) pretvara se u `exitCode: 1`, pa faza reprodukcije **lažno prihvati** da je bug dokazan | agy + verify + kod | potvrđeno | **visok** |
| P2 | Glob `?` se različito tumači: revizorska kapija (`scope.mjs`) ga podržava, merge kapija (`worktree.mjs`) i `mock.mjs` ne | worker + verify + komanda | potvrđeno | **visok** |
| P3 | `doctor` vraća exit 0 i sa FAIL; `run` vraća 0 i kad su akcije neuspešne (`phase` vraća 1) | worker + agy + kod | potvrđeno | srednji |
| P4 | Održavanje zakupa: dokumentni tok guta neuspeh obnove, coding tok ga propagira; default heartbeat 120 s vs 2 s | worker + verify + kod | potvrđeno | srednji |
| P5 | `programer`/`reviewer` postoje u kodu i briefovima, ali ih nema ni u `agents.yml` ni u `AGENTS.md` tabeli uloga | worker + agy + grep | potvrđeno | srednji |
| P6 | Testovi R19/CR2 zavise od zidnog sata (`sleep` hookovi, `setTimeout`, uslovna asercija) — moguće lažno zeleno | worker + kod | potvrđeno | srednji |
| P7 | Sandbox/portabilnost: `postoji('bwrap')` samo `which`; `reproduce.mjs` koristi `--ro-bind /bin` bez `-try`; testovi nisu hermetični | agy + verify (delom) | potvrđeno | nizak |
| — | T1 `exec` `/bin/sh` kao bug koda | agy | odbijeno — artefakt okruženja (popravljeno u sandboxu) | — |
| — | T4 padovi testova kao propust runnera | agy | odbijeno — artefakt kontejnera; na hostu 205/205 | — |
| — | T13 „nema bwrap u okruženju“ | DSH | odbijeno — binar postoji, ali ne kreira namespace; verify ispravio moju formulaciju | — |

## Detalji najvažnijih nalaza

### P1 — lažna reprodukcija na spawn grešci (`coding.mjs`)

- `pokreniTest` (`coding.mjs:86`): `exitCode: Number.isInteger(error.code) ? error.code : 1`.
  Za `spawn` ENOENT `error.code` je string `'ENOENT'`, pa ispadne `1`.
- Faza reprodukcije (`coding.mjs:408`) prihvata svaki `exitCode !== 0` kao dokaz da bug
  postoji. Nepostojeća komanda tako prolazi kao „bug reprodukovan“ — ruši invarijantu
  „dokaz, ne tvrdnja“.
- **Predlog:** `pokreniTest` vraća `{ spawnError: true, exitCode: null }` za greške
  pokretanja; faza odbija sa porukom „repro komanda se nije pokrenula“.

### P2 — dve kapije, dva glob jezika (`scope.mjs` vs `worktree.mjs`)

- `matchesScope('wiki/A.md', ['wiki/?.md'])` → `true`; inline regex u `worktree.mjs:178-181`
  (i `mock.mjs:371`) → `false`, jer eskejpuje `?` kao literal.
- Posledica: zadatak sa opsegom `wiki/?.md` prođe reviziju, pa trajno padne na merge
  kapiji sa „grana menja zone van dozvole“.
- **Predlog:** zameniti inline regexe pozivom na `matchesScope` (jedan izvor istine).

### P3 — izlazni kodovi lažu (`cli.mjs`)

- `doctor` tabelarno uvek `return 0`; `--json` vraća 1 samo ako padne provera čije ime
  počinje sa `git` (`cli.mjs:433`).
- `run` uvek `return 0` (`cli.mjs:351-367`), dok `phase` vraća 1 na neuspeh.
- **Predlog:** `doctor` exit≠0 za svaku `ok:false` proveru; `run --strict` (ili
  `--exit-on-failure`) da se ne menja postojeći ugovor za pozivaoce.

### P4 — zakup se održava na dva načina

- `pipeline.mjs:78-83`: neuspeh `store.renew` se samo loguje i posao nastavlja
  (komentar: faza će ionako pasti na otpuštanju zakupa).
- `coding.mjs:104-119`: isti uslov se pamti i faza se odbija.
- Default heartbeat: 120 s (`pipeline.mjs:77`) vs 2 s (`coding.mjs:106`).
- **Predlog:** zajednički `runWithLease` u `lease.mjs`, jedan fallback, i eksplicitna
  odluka za dokumentni tok (propagiraj `izgubljen` i odbij, ili dokumentuj izuzetak).

### P5 — uloge van ugovora

- `grep programer\|reviewer`: nema ih u `tools/config/agents.yml` ni u `.agents/AGENTS.md`,
  a postoje u `DEFAULT_CONFIG` (`config.mjs:51-54`), `ROLES` i `.agents/roles/*.md`.
- **Predlog:** dodati u oba dokumenta (zona u ciljnom repou + `.agent-review/`), ili ih
  ukloniti iz ožičenja ako nisu deo sistema — coding tok ih koristi.

### P6 — flaky testovi na zidnom satu

- R19 (`tests/coding-robustness.test.mjs:390-400`): hook `sleep 0.5` + `setTimeout 250`
  + uslovna asercija `if (tudji)` — kad claim ne uspe u prozoru, test ne tvrdi ništa.
- CR2: `pre-commit` hook `sleep 30` i `while` na zidnom satu.
- **Predlog:** deterministički hook (blokiraj na fajlu/pipe, pusti eksplicitno) i
  bezuslovna asercija.

### P7 — portabilnost i hermetičnost

- `reproduce.mjs:21-27`: `postoji('bwrap')` proverava samo `which`; binar postoji a
  user namespace blokiran → red-team „neizvršeno“ i blokada.
- `reproduce.mjs:91`: `--ro-bind /bin /bin` bez `-try` (dok `/lib64` koristi `-try`).
- Testovi zavise od host sposobnosti (`bwrap`, `python3`): u worker kontejneru 195/205.
- **Predlog:** probno izvršavanje bwrap-a + fallback; `--ro-bind-try` za `/bin`;
  eksplicitna kontrola sandbox dostupnosti u testovima (deterministički oba slučaja).

## Šta je eksperiment pokazao o samom procesu

1. **Nezavisni izvori se komplementarno dopunjuju.** Agy je našao P1, P3, P5; worker P2,
   P4, P5, P6. Preklapanja su bila jaka tamo gde su oba nezavisno potvrdila (P5, P3), a
   razlike tamo gde jedan vidi izvršavanje a drugi kod.
2. **Slepa verifikacija je zaradila svoje.** Odbila je 2 nalaza kao artefakte okruženja
   (T1, T4), ispravila jednu moju netačnu tvrdnju (T13: binar bwrap-a postoji, ali ne
   radi) i predložila propust koji nijedan izvor nije imao (`--ro-bind-try`).
3. **Izvršne tvrdnje zahtevaju verno okruženje.** Agy u bwrap-u ne može da izvršava
   `bwrap` (nested) i (pre popravke) nije imao `/bin`; njegove komande su zato davale
   artefakte. Kod-analiza u izolaciji je dobra za čitanje, ne za reprodukciju stanja hosta.
   Posle popravke `/bin` deo problema nestaje, ali princip ostaje: analitički run treba da
   zna šta mu okruženje ne može, pa da takve tvrdnje označi `neprovereno`.
4. **Worker je dobar za kod, ali ne za pun test suite** (kontejner bez bwrap/python) —
   izvršni dokaz testova ostaje na hostu, kod orkestratora.

## Predlog redosleda popravki

1. **P1** (lažna reprodukcija) — najviši rizik po dokazivost; mala izmena u `coding.mjs`.
2. **P2** (glob divergencija) — mali refaktor, uklanja teško dijagnostikovan zastoj.
3. **P3** (exit kodovi) — `doctor`/`run --strict`, bez promene postojećeg ugovora.
4. **P4** (lease drift), **P5** (ugovor), **P6** (flaky), **P7** (portabilnost) — po redu.

Sve tvrdnje u ovom izveštaju su proverene na hostu (kod, `grep`, `node`, `agentctl`),
osim gde je izričito označeno `neprovereno`.

---

## Popravke posle izveštaja (isti dan)

| nalaz | status | commit | dokaz |
|---|---|---|---|
| P1 — spawn greška kao lažna reprodukcija | **popravljeno** | `71de46c` + `93b4599` | `spawnError` u `pokreniTest`; faza reprodukcije, posle-popravke i integraciona provera odbijaju; R20 (maxBuffer) i R21 (shell 127) testovi |
| P2 — dva glob jezika | **popravljeno** | `71de46c` | `worktree.mjs` i `mock.mjs` koriste `matchesScope`; test `audit/?.md` propušta `A.md`, odbija `AB.md` |
| P3 — lažni exit kodovi | **popravljeno** | `71de46c` + `93b4599` | `doctor` vraća 1 za svaku neuspeslu proveru; `run --strict`; `strictExit` u `lib/exit.mjs` sa unit testom; lažno-zeleni CLI test preimenovan |
| P6 — flaky testovi na zidnom satu | **delimično** | `93b4599` | R16 stabilizovan (TTL 400→1500 ms) posle pada u punom prolazu; R19/CR2 determinizam ostaje |
| P4, P5, P7 | otvoreno | — | lease drift, uloge van ugovora, portabilnost bwrap provera |

**Verifikacija popravki (slepa, `agy` verify):** `P1/P2/P3: DRZI`, uz dokaz po fajlu i liniji.
Verifikacija je zatim **našla rupu u prvoj popravci** (shell 126/127 i dalje izgleda kao
izlazni kod → nepostojeća komanda bi prošla kao reprodukcija) i **lažno-zelen test** za
`run --strict`; oboje je popravljeno u `93b4599` i ponovo verifikovano (`V1/V2: DRZI`).

**Testovi:** `211/211` dva puna prolaza zaredom (pre popravki 205/205).

---

## Zatvaranje svih nalaza (isti dan, drugi krug)

| nalaz | status | commit | dokaz |
|---|---|---|---|
| P4 — lease drift | **popravljeno** | `d4b4af2` | zajednički `lib/lease-heartbeat.mjs` (jedan period, jedna semantika greške); `coding.saZakupom` i `pipeline.runAgentDrzeciZakup` ga koriste; faze prepoznaju `LEASE_LOST`; testovi `lease-heartbeat.test.mjs` |
| P5 — uloge van ugovora | **popravljeno** | `d4b4af2` | `programer`/`reviewer` u `agents.yml` i `.agents/AGENTS.md` tabeli; test `config-roles.test.mjs` + provera da je reviewer drugi vendor |
| P6 — determinizam testova | **popravljeno** | `d4b4af2` | R19 i CR2 koriste marker/release hookove, bezuslovne asercije; R16 stabilizovan; pun suite 2× uzastopno zelen |
| P7 — portabilnost bwrap provera | **popravljeno** | `d4b4af2`, `1a23824` | `bwrapRadi()` proba sa `--unshare-pid/--unshare-net/--proc/--dev/--tmpfs`; `--ro-bind-try /bin`; fallback kad sandbox ne radi |
| verifikaciona rupa 1 — proba bez namespace flagova | **popravljeno** | `1a23824` | proba sada koristi ista ograničenja kao pravi omotač |
| verifikaciona rupa 2 — harnes se ne prekida na gubitak zakupa | **popravljeno** | `1a23824`, `…` | `onError` → `AbortController` → `runProcess` prekida stablo (`aborted: true`); pokriveno harness i heartbeat testovima; posle verifikacije zatvorena i u coding toku |

**Verifikacione runde:** prva (P1–P3) — sve `DRZI`, uz pronađenu rupu 126/127 i lažno-zelen test;
druga (P4–P7) — sve `DRZI`, uz dve nove rupe; treća (rupa 1/2) — `V1: DRZI`, `V2: DRZI`, uz nalaz da coding tok
još ne abortira — i to je zatvoreno u `coding.saZakupom`. **Svi dogfood nalazi su zatvoreni.**

**Finalno stanje:** `220/220` testova, dva puna prolaza zaredom.

---

## Kako ponoviti samopregled

1. **Istraživanje (work nit).** `agy` u `mode: safe`, cwd = repo, dobija 5 oblasti
   (korektnost, testovi, arhitektura, ugovor/dokumentacija, ergonomija) i format nalaza
   sa dokazom i predlogom. Ne menja ništa.
2. **Analiza koda (izolovani worker).** `spawn_worker` sa istim oblastima, ali iz koda;
   izveštaj u `docs/` na sopstvenoj grani. Nedostatak alata u kontejneru **nije** nalaz.
3. **Slepa verifikacija (verify nit).** `agy` dobija spojene tvrdnje bez zaključaka
   orkestratora i ocenjuje `DRZI / NE_DRZI / NEPROVERENO`; traži rupe i lažno-zelene testove.
4. **Provera na hostu.** Orkestrator proverava ključne tvrdnje komandama (`grep`, `node`,
   `agentctl`) i odbacuje artefakte okruženja.

Kriterijumi: nalaz bez komande ili fajla:linije se odbacuje; predlog koji krši invarijantu
se odbacuje; popravka bez testa nije popravka; verifikacija popravke je obavezna i
radi je drugi vendor.
