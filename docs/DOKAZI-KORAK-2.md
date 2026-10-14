# Dokazi — Korak 2: zakup, identitet, zaključavanje i MCP uloge

[Dokumentacija](README.md) · [Preporuke za dalji razvoj](../Agent-2.0-Preporuke-za-dalji-razvoj.md) · [Korak 1](DOKAZI-KORAK-1.md)

Datum: 14. oktobar 2026.
Početna revizija koraka: `3563fcb` (posle Koraka 1).
Cilj koraka: „zakup, identitet i uloga rade u podržanom režimu; ograničenje na
jednu petlju jasno je zapisano“ — bez uvođenja distribuiranog locka.

## 1. Ogled L1: živ fajl-lock je bio preuziman

- Tvrdnja (preporuke, Korak 2): „živ lock ne bude preuzet“.
- Postupak A — direktno: P1 drži `withFileLock` 40 s, P2 pokušava isti lock 2 s
  kasnije (`staleMs` podrazumevani, 30 s).
- Stvarni rezultat A:

```text
{"ko":"P1","usao":5}          P1 ulazi u t=5 ms
{"ko":"P2","usao":30030}      P2 ulazi u t=30030 ms  <-- P1 je još unutra
{"ko":"P1","drzao":40000}     P1 izlazi u t=40005 ms
```

- Postupak B — stvarni adapter: dva procesa pozivaju `runHarness('agy')` sa
  lažnim `agy` binarnim fajlom koji spava 40 s (`PATH` zamena), pokrenuti 2 s
  razlike.
- Stvarni rezultat B:

```text
H1: AGY_START 1791963518773  AGY_END 1791963558776
H2: AGY_START 1791963548796  AGY_END 1791963588799
UKUPNO ZIDNO VREME: 70085 ms
```

H2 je startovao 30,0 s posle H1, dakle **~10 s pre** nego što je H1 završio:
dva `agy` poziva su se izvršavala uporedo. To obara zapisano pravilo iz
`HARNESS_COMMANDS.agy`: „nikad se ne poziva u paraleli“.
- Uzrok u kodu: `withFileLock` je lock proglašavao zastarelim po **starosti**
  (`age > staleMs`) ili po mrtvom PID-u — starost je bila dovoljna i kada je
  vlasnik živ. Dodatno, lock se pravio sa `fs.open(..., 'wx')` pa `write`, pa je
  drugi proces mogao da pročita prazan fajl i proglasi ga zastarelim.
- Zaključak: **potvrđeno (defekt)**.

## 2. Ogled L2: posle ispravke

- Ispravka u `tools/orchestrator/lib/fsx.mjs`: sadržaj locka se prvo piše u
  jedinstven temp fajl i `link`-uje na ime locka (atomski; lock nikad nije
  prazan), a zastareo je **samo** lock čiji vlasnik nije živ. `staleMs` ostaje
  kao jedini oslonac kada je zapis nečitljiv.
- Stvarni rezultat istog ogleda B:

```text
H1: AGY_START 1791963728110  AGY_END 1791963768115
H2: AGY_START 1791963768141  AGY_END 1791963808145
UKUPNO ZIDNO VREME: 80100 ms
```

H2 počinje 26 ms posle H1 — pozivi su serijalizovani, bez preklapanja.
- Regresioni testovi u `tests/task-store.test.mjs`:
  - `fajl-lock: živ vlasnik ne predaje lock, mrtav se preuzima` — dete drži lock
    1200 ms uz `staleMs: 150`; drugi proces sme da uđe tek posle izlaska vlasnika,
    a lock mrtvog procesa se preuzima odmah;
  - `fajl-lock: lock nikad nije prazan (nema trke sa čitanjem)` — 200 ciklusa
    preuzimanja uz čitač koji traži prazan fajl.
- Kontraprovera (stari `fsx.mjs` iz `3563fcb`): oba testa **padaju**.

## 3. Ogled Z1: zakup istekao usred poziva

- Konfiguracija probe: `lease.ttlMs = 2000`, `lease.heartbeatMs = 500`, istraživač
  na `harness` adapteru sa lažnim `agy` koji spava 6 s.
- Stvarni rezultat (pre ispravke):

```text
posle 3 s: {"owner":"agy","ziv":false,"preostaloMs":-1003}
PREUZETO OD DRUGOG PROCESA; novi token 24515e8a stari token fd31e89c
```

- Zaključak: **potvrđeno (defekt D3)** — zakup je istekao dok je poziv trajao, a
  drugi proces istog identiteta (nov token) preuzeo je zadatak usred rada.
- Uzrok: `lease.heartbeatMs` je postojao **samo u konfiguraciji**
  (`tools/config/agents.yml`, `DEFAULT_CONFIG`); nijedan izvršni modul ga nije
  koristio, pa se zakup nije obnavljao.

## 4. Ogled Z2: posle uvođenja obnove

- Ispravka u `tools/orchestrator/lib/pipeline.mjs`: `runAgentDrzeciZakup(id, owner,
  args)` obnavlja zakup iz istog procesa i sa istim tokenom dok traje poziv
  harnesa, na period `lease.heartbeatMs`. Obavija svih šest poziva harnesa.
- Stvarni rezultat iste probe:

```text
posle 3 s: {"owner":"agy","ziv":true,"preostaloMs":1537}
preuzimanje odbijeno: zadatak TASK-101 drži "agy" do ... (drugi proces istog identiteta)
```

- Regresioni test `E2E: zakup se obnavlja tokom poziva dužeg od TTL-a`
  (TTL 300 ms, heartbeat 100 ms, poziv 1 s): zakup je živ posle 600 ms, a
  preuzimanje je odbijeno. Kontraprovera: na `3563fcb` test **pada**.

## 5. Ogled M1: MCP matrica šest uloga

- Postupak: za svaku ulogu je pripremljen zadatak koji drži njen vendor sa
  važećim tokenom, pa je pozvan **stvarni MCP server** u CLI režimu
  (`node tools/mcp/obsidian-mcp.mjs write <putanja> --content-file <fajl>`) — dva
  pokušaja: u sopstvenoj zoni i u tuđoj.
- Stvarni rezultat:

| Uloga | Vendor | Sopstvena zona | Tuđa zona |
|---|---|---|---|
| extractor | agy | DOZVOLJENO | ODBIJENO — „ne sme da piše u zonu draft“ |
| researcher | agy | DOZVOLJENO | ODBIJENO — „ne sme da piše u zonu review“ |
| verifier | dsh | DOZVOLJENO | ODBIJENO — „ne sme da piše u zonu draft“ |
| red-team | dsh | DOZVOLJENO | ODBIJENO — „ne sme da piše u zonu draft“ |
| librarian | codex | DOZVOLJENO | ODBIJENO — „ne ulazi u opseg revizije“ |
| consolidator | codex | DOZVOLJENO | ODBIJENO — „ne sme da piše u zonu review“ |

- Zaključak: **potvrđeno** — zone su ortogonalne i svaka uloga dobija tačnu MCP
  zonu kada joj kontrolni sloj pošalje svoju ulogu.

## 6. Ogled M2: šabloni MCP registracije fiksiraju samo prvu ulogu vendora

- Tvrdnja (preporuke): „MCP šabloni fiksiraju početne tri uloge, a isti vendor
  sada ima dve različite odgovornosti“.
- Mehanizam (potvrđen u instaliranom klijentu,
  `dsh-mcp-client/lib/index.js`): `buildChildEnv(extra) = { ...scrubbedParentEnv(),
  ...extra }` — statična `env` tabela iz konfiguracije **pobeđuje** nasleđeno
  okruženje koje šalje kontrolni sloj.
- Šabloni su pre ispravke fiksirali `agy → researcher`, `dsh → verifier`,
  `codex → consolidator`, pa druga uloga istog vendora nije mogla da piše.
- Stvarni rezultat simulacije istog spajanja okruženja, kroz MCP server:

```text
extractor  wiki/drafts/fragments/Fragment.md  stari sablon: ODBIJENO | posle ispravke: DOZVOLJENO
red-team   tasks/challenges/Nalaz.md          stari sablon: ODBIJENO | posle ispravke: DOZVOLJENO
librarian  tasks/audits/Izvestaj.md           stari sablon: ODBIJENO | posle ispravke: DOZVOLJENO
```

- Ispravka: `tools/config/mcp/agy.json`, `codex.toml`, `dsh.patch.yml` i
  `register.sh --agy` fiksiraju **samo** `OBSIDIAN_AGENT`; `OBSIDIAN_ROLE` dolazi
  po pozivu od kontrolnog sloja. Ako uloga nije prosleđena, server ostaje
  `readonly` (fail-closed).
- Zaključak: **potvrđeno (defekt D4)** i popravljeno.

## 7. Nalazi

| Oznaka | Nalaz | Vrsta po odeljku 9 | Odluka |
|---|---|---|---|
| N8 | Živ fajl-lock se preuzimao posle 30 s, pa su se dva `agy` poziva izvršavala uporedo | sprečava dogovoreni scenario / gubi međusobno isključivanje | **popravljeno** |
| N9 | Lock se pravio ne-atomski (`open('wx')` pa `write`), pa je drugi proces mogao da pročita prazan lock | gubitak integriteta | **popravljeno** |
| N10 | Zakup nije obnavljan tokom poziva dužeg od TTL-a; drugi proces je preuzimao zadatak usred rada | sprečava dogovoreni scenario | **popravljeno** (heartbeat) |
| N11 | Šabloni MCP registracije fiksiraju prvu ulogu vendora, pa druga uloga ne može da piše | sprečava dogovoreni scenario | **popravljeno** (konfiguracija) |
| N12 | Preuzimanje locka mrtvog vlasnika nije bilo atomsko: dva živa procesa mogla su istovremeno da drže kritičnu sekciju | gubitak međusobnog isključivanja | **popravljeno** |

## 8. Ograničenje na jednu kontrolnu petlju (zapisano)

- `withFileLock` je **lokalni** međuprocesni mutex nad fajlom; ne tvrdi ništa o
  drugim mašinama. Podržani režim je jedan vault i jedna kontrolna petlja na
  jednoj mašini (odeljak 4 preporuka: „jedan lokalni Linux vault, jedna kontrolna
  petlja“).
- Zakup je vezan za proces preko `lock_token`; obnova ide iz istog procesa.
  Distribuirani lock nije uveden i ne planira se.

## 9. Preostala ograničenja

- **Zakup se ne proverava pri svakoj mutaciji zadatka.** `store.setFields`,
  `updateBody` i `attachArtifacts` proveravaju samo fajl-lock, ne i
  `holdsLease`; token proveravaju `release`, `renew` i MCP. Posledica: proces
  čiji je zakup istekao (i kome ga je drugi preuzeo) može još da upiše polja
  zadatka. Sa ispravkama N8 i N10 to se dešava samo ako proces stvarno stane ili
  umre. Nije popravljano u ovom koraku da se obim ne širi; evidentirano kao
  otvoren nalaz.
- **MCP šabloni nisu provereni stvarnim pozivom harnesa** (agy/dsh/codex), jer to
  zahteva izmenu korisničkih registracija i plaćene pozive. Dokaz je simulacija
  spajanja okruženja identična onoj u klijentu + čitanje njegovog koda.
- **Jedan nekontrolisan poziv pravog `agy`-ja.** U prvom pokušaju probe zakupa
  `AGENT_2_0_BIN` nije stigao do adaptera (adapter ga čita iz env objekta, ne iz
  `process.env`), pa je pokrenut pravi `agy`; proba je prekinuta na isteku
  vremena. Vault je bio privremen, u repozitorijumu nema traga, a potrošnja nije
  izmerena. Proba je zatim ponovljena sa lažnim `agy` na `PATH`-u i ti rezultati
  su ti koji su u ovom zapisu.

## 10. Izmene u ovom koraku

1. `tools/orchestrator/lib/fsx.mjs` — atomsko kreiranje locka (`link`) i
   zastarevanje samo po mrtvom vlasniku. *Zato što eksperiment L1 na `3563fcb`
   pokazuje da su se dva `agy` poziva preklopila posle 30 s.*
2. `tools/orchestrator/lib/pipeline.mjs` — `runAgentDrzeciZakup`. *Zato što
   eksperiment Z1 pokazuje da zakup istekne usred poziva i da ga drugi proces
   preuzme.*
3. `tools/config/mcp/{agy.json,codex.toml,dsh.patch.yml}`, `register.sh` —
   fiksira se samo `OBSIDIAN_AGENT`. *Zato što eksperiment M2 pokazuje da
   statična uloga odbija tri od šest uloga.*
4. `tests/task-store.test.mjs`, `tests/pipeline.test.mjs` — tri regresiona testa.
   *Zato što svaki obara po jedan stvarni kontraprimer.*
5. `docs/KONFIGURACIJA.md`, `README.md` — uloga se ne fiksira u konfiguraciji.

Obim sistema nije menjan: nema novih uloga, servisa, posrednika, baza ni API-ja.


## 11. Nezavisna verifikacija Koraka 2 (codex, `verify` nit)

Nezavisni verifikator je nad revizijom `ad46d0d` potvrdio K1–K5:

| Tvrdnja | Ishod | Dokaz |
|---|---|---|
| K1 skup prolazi (137/137) | **POTVRĐENO** | `npm test` → `tests 137 / pass 137 / fail 0` |
| K2 dva lock testa padaju na `3563fcb` | **POTVRĐENO** | `pass 0 / fail 2`; poruke: „lock je preuzet dok je vlasnik živ“, „lock fajl je bio prazan … 200 !== 0“ |
| K3 heartbeat test pada na `3563fcb` | **POTVRĐENO** | `fail 1` → „zakup je morao biti obnovljen tokom poziva“ |
| K4 dva `agy` poziva se ne preklapaju | **POTVRĐENO** | na `ad46d0d` razmak 18 ms bez preklapanja; na `3563fcb` preklapanje 9998 ms |
| K5 šabloni MCP uloge | **POTVRĐENO** | kroz stvarni MCP CLI: na `3563fcb` sa `{...parentEnv, ...config.env}` efektivna uloga je bila `researcher`/`verifier`/`consolidator` i upis je odbijen (kod 1); na `ad46d0d` efektivna uloga je `extractor`/`red-team`/`librarian` i upis prolazi |

**Ali verifikator je našao i nov kontraprimer (klasa A):** trka pri preuzimanju
locka mrtvog vlasnika. Sa 12 procesa nad lockom mrtvog PID-a, dva procesa su
istovremeno držala kritičnu sekciju:

```text
{"pid":596000,"kind":"start","at":1791964341916}
{"pid":596040,"kind":"start","at":1791964341916}
{"pid":596000,"kind":"end","at":1791964342036}
{"pid":596040,"kind":"end","at":1791964342037}
```

## 12. Ispravka trke pri preuzimanju (po verifikaciji)

- Mehanizam je izmeren, ne pretpostavljen: izabrani preuzimač je posle uklanjanja
  mrtvog locka **ponovo čitao** lock fajl; ako je u tom trenutku fajl bio odsutan
  (jer ga je drugi proces već preuzeo), čitanje je bacilo grešku, stanje je
  tretirano kao „nema vlasnika“ i **tuđi svež lock je brisan**.
- Ispravka u `tools/orchestrator/lib/fsx.mjs`:
  1. preuzimanje zastarelog locka radi **samo jedan** čekalac, izabran atomski
     preko `link`-a na marker `<lock>.reclaim`;
  2. ako je lock u međuvremenu **nestao**, ne uklanja se ništa;
  3. nečitljiv zapis se uklanja samo ako je fajl stariji od `staleMs`.
- Merenje (isti scenario, 12 procesa, startna barijera, `staleMs = 1`, 8 scenarija):

| Kod | Preklapanja po scenariju |
|---|---|
| `ad46d0d` (posle prve ispravke) | 0, 2, 0, 0, 0, 5, 2, 3 |
| posle ispravke | 0, 0, 0, 0, 0, 0, 0, 0 |

- Regresioni test `fajl-lock: trka pri preuzimanju mrtvog locka ne pušta dva
  vlasnika` (3 scenarija, 10 procesa, startna barijera, `staleMs: 1`):
  **pada** sa `fsx.mjs` iz `ad46d0d`, a prolazi sa ispravkom (4 uzastopna
  izvođenja bez flaka).
- Skup posle ispravke: **138 prolazi, 0 padova**, dva uzastopna izvođenja.

## 13. Druga runda nezavisne verifikacije (nad `f1f9c05`)

| Tvrdnja | Ishod | Dokaz |
|---|---|---|
| M1 novi test trke prolazi na `f1f9c05`, pada na `ad46d0d` | **POTVRĐENO** | `pass 1 / fail 0`; na `ad46d0d` `fail 1` sa ispisom dva intervala koja se preklapaju |
| M2 scenario sa 12 procesa i barijerom | **POTVRĐENO** | na `f1f9c05` preklapanja `[0,0,0,0,0,0,0,0]`; na `ad46d0d` `[0,2,1,0,7,0,11,1]` |
| M3 bez regresije | **POTVRĐENO** | `npm test` 138/138; lock, heartbeat i dva `agy` poziva (razmak 20 ms, bez preklapanja) |

**Nov kontraprimer (M4): „pauziran preuzimač“.** Verifikator je instrumentirao
proces tako da se zaustavi (SIGSTOP) posle čitanja mrtvog vlasnika, sačekao da
drugi proces evakuiše marker po starosti, pa pustio prvi da nastavi — i izmerio
**250 ms preklapanja**. Uzrok: marker se evakuisao posle 5 s **bez provere
živosti** svog vlasnika, a preuzimač je brisao lock na osnovu čitanja koje je u
međuvremenu postalo zastarelo.

## 14. Ispravke po drugoj rundi

1. Marker se evakuiše **samo ako mu je vlasnik mrtav**; starost je oslonac samo za
   nečitljiv/zaglavljen marker. Živ (i samo pauziran) preuzimač zadržava marker.
2. Neposredno pre uklanjanja locka radi se **završna provera** trenutnog sadržaja:
   ako je vlasnik živ, ne uklanja se ništa.
3. Uočeno sopstvenim testom i popravljeno: grana za zastareli lock vraćala se u
   petlju **bez provere roka**, pa je `withFileLock` mogao da visi zauvek umesto
   da prijavi istek. Rok se sada proverava na ulazu u svaku iteraciju.

Merenje scenarija „pauziran preuzimač“ na fiksiranom kodu:

```text
novi {"A":[1791965155671,179196515921],"B":[1791965155922,1791965156176],"preklapanjeMs":0}
```

Regresioni test `fajl-lock: marker živog preuzimaoca se ne evakuiše po starosti`
(temelji se na istom pravilu, bez SIGSTOP instrumentacije): **pada** sa
`fsx.mjs` iz `f1f9c05`, prolazi sa ispravkom. Skup posle ispravke: **139
prolazi, 0 padova**, dva uzastopna izvođenja.

## 15. Preostalo ograničenje mehanizma

- Uklanjanje locka nije atomski uslovljeno sadržajem (fajl-sistem ne daje
  compare-and-swap). Ostaje teoretski prozor između završne provere i `rm`;
  da bi se iskoristio, proces mora biti zaustavljen tačno u tom mikrosekundnom
  intervalu. Potpuno zatvaranje bi zahtevalo OS-level primitiv (`flock` ili unix
  socket koji jezgro sam otpušta), što je nova mehanika i van je obima ove faze.
- Zato je međusobno isključivanje u podržanom režimu (jedna mašina, jedan vault,
  realni hici bez veštačkog zaustavljanja procesa) dokazano trima nezavisnim
  scenarijima: živ vlasnik, mrtav vlasnik pod trkom i pauziran preuzimač.

