# Spremnost sistema za realan zadatak

Procena sa dokazima, ne sa osećajem. Datum: posle ugradnje red-team faze i
zatvaranja nalaza iz dva prava red-team prolaza.

## Kratak odgovor

**Spreman je, uz tri uslova.** Mašinerija je izvršena od početka do kraja sa
pravim modelima, uključujući novu red-team fazu — i u jednom trenutku je
**odbila da objavi** sadržaj koji nije prošao kapiju. To je najbolji znak
spremnosti koji ovaj sistem može da proizvede.

Uslovi:

1. **Izvor treba da bude spoljni predmet**, ne opis samog sistema. Kada je izvor
   dokument *o sistemu*, svaka njegova tvrdnja je proverljiva tvrdnja o kodu, pa
   kapije (ispravno) nalaze neslaganja pri svakoj izmeni koda.
2. **Budžet:** realan prolaz traje desetine minuta i troši 6–15 poziva modela.
   Jedna faza `dsh` (verifikacija ili red-team) traje 4–15 minuta.
3. **Čovek na vezi za `blocked`:** posle dozvoljenog broja sporenja zadatak se
   blokira; `agentctl show`, pa `agentctl ready --reason "…"` ili ispravka.

## Dokazi

### 1. Automatski testovi

```
node --test tests/     → 128 prolazi, 0 padova
agentctl lint          → 0 grešaka, 0 upozorenja
agentctl doctor        → 6 uloga, sva tri harnesa nađena
scripts/demo.mjs       → ceo šestofazni tok, lint 0
```

Pokriveno testovima: automat stanja, zakup (uključujući token po procesu),
izolacija worktree-a, konflikt i rebase, izvedeni artefakti, zone po ulozi,
opseg revizije, kapija zona na merge-u, knjigovodstvo, reprodukcija skripti
(izvršavanje, lažni nalaz, istek, limit), MCP protokol i pristupne kontrole.

### 2. Pravi prolaz sa šest uloga (TASK-102)

Izvor od 27 redova (`raw/sest-uloga-i-dve-kapije.md`), pravi harnesi:

| Faza | Harnes | Ishod |
|---|---|---|
| research | agy | nacrt napisan i dva puta prerađivan po nalazima |
| verify | dsh | `pass`, pa `fail` (pokušaj 3), pa `pass` |
| challenge | dsh | **`reproducible` — 3 nalaza u prvom prolazu, 3 u drugom** |
| consolidate | codex | **nije izvršen: kapija zatvorena** |

Ishod: `TASK-102` je **blokiran**: *„red-team je reprodukovao nalaz 3 put(a)
(dozvoljeno 3); potrebna ljudska intervencija"*. Ništa iz tog zadatka nije ušlo u
`main`. Sistem je odradio tačno ono zbog čega kapija postoji.

Cena tog prolaza, izmerena: ~2 h zidnog vremena i ~10 poziva modela za jedan
mali dokument. Realan zadatak sa mirnim izvorom je jeftiniji (jedan `agy` + jedan
`dsh` + jedan `codex`), ali svaki spor troši po jedan prolaz.

### 3. Nalazi koje je red-team našao — i dokaz da su zatvoreni

Red-team je napisao **8 reprodukcionih skripti** u dva prolaza. Kontrolni sloj ih
je izvršio u svežem klonu zamrznute revizije; posle popravki **nijedna se više ne
reprodukuje**:

```
prvi prolaz:  NALAZ-1..5   → 0/5 se reprodukuje
drugi prolaz: NALAZ-1..3   → 0/3 se reprodukuje
```

Šta su nalazi bili i šta je popravljeno:

| Nalaz | Rupa | Popravka |
|---|---|---|
| 1.1 | `git mv tools/x wiki/x` zaobilazi kapiju zona | `--no-renames` na obe strane rename-a |
| 1.2 | `researcher` i `extractor` dele zonu `draft` | zone `fragment` i `draft` razdvojene |
| 1.3 | ugovor zabranjuje isti harnes u uzastopnim fazama, a sistem ga koristi | ugovor preciziran; korelacioni rizik se **beleži** u zadatku |
| 1.4 | pad red-team harnesa se vodi kao `clean` | pad → verdikt `error`, kapija ostaje zatvorena |
| 1.5 | `challengeMaxScripts` tiho odbacuje nalaz | neizvršeni skripti → `unexecuted`, blokira |
| 2.1 | `librarian` i `consolidator` pišu istu produkcionu putanju | razdvojeni po vrsti zadatka + konsolidacija ne prepisuje postojeće |
| 2.2 | kapija zona je grubi prefiks: `researcher` ulazi u produkciju | politika po zadatku: produkcija samo za deklarisani artefakt |
| 2.3 | knjigovodstvo komituje tuđi upis u `main` bez merge-a i kapije | zatvoren spisak fajlova + prijava `bookkeeping.foreign-change` |

Uz to su popravljene i tri sumnje: `OBORENO` je obavezan dokaz (ne samo izlazni
kod), istekao skript je nezaključiv i blokira, a kapija se preglasava samo
svesno (`agentctl override --reason`, zapisano u zadatku i toku događaja).

### 4. Izvršavanje tuđeg koda (rizik koji ostaje)

Red-team piše skripte, a kontrolni sloj ih izvršava — to je ono što nalaz čini
dokazom umesto mišljenjem. Mere:

- izvršava se u **svežem privremenom klonu** zamrznute revizije, ne u glavnom stablu;
- `bwrap` izolacija (na ovoj mašini je dostupna: bubblewrap 0.12.0) — bez mreže,
  samo klon upisiv; bez nje skript dobija privremeni `HOME`;
- ograničeno vreme (`challengeTimeoutMs`) i broj skripti (`challengeMaxScripts`);
- može se isključiti (`challengeExecute: false`) — tada nalaz ne blokira.

To **nije** tvrd sandbox protiv zlonamernog modela; to je izolacija protiv
slučajne štete. Odluka je svesna i zapisana.

## Poznati rizici i otvorene stavke

| Rizik | Status |
|---|---|
| Korelisane slepe tačke: `verifikator` i `red-team` su isti vendor (`dsh`) | **priznato i mereno** — `challenge.correlationRisk: true` u zadatku; Codex je za tu klasu zadatka blokiran od svog provajdera ([KONSULTACIJA-ULOGA.md](KONSULTACIJA-ULOGA.md)) |
| Skript red-teama može trivijalno da blokira merge (`echo OBORENO; exit 0`) | ostaje; ublaženo time što blokada ide čoveku posle `maxRevisions`, i `agentctl override --reason` |
| Trka u `reclaimExpired` (provera nad snapshot-om) | **nepotvrđena** — red-team je nije reprodukovao; nije popravljana naslepo |
| Kapija se gasi konfiguracijom | dokumentovano (invarijanta 25); tada nema `challenge` zapisa, pa je odsustvo kapije vidljivo |
| Windows/CRLF | nije testirano |
| Trošak i vreme realnih prolaza | izmereno; planiraj 30–90 min po zadatku |

## Kako pustiti realan zadatak

```bash
# 1. Izvor u raw/ (nepromenljiv) i zadatak koji ga prati.
node tools/orchestrator/cli.mjs ingest raw/<dokument>.md --title "Naslov" \
  --config tools/config/agents.real.yml

# 2. Kontrolna petlja (pravi harnesi; može trajati desetinama minuta).
node tools/orchestrator/cli.mjs run --rounds 8 --config tools/config/agents.real.yml

# 3. Nadzor
node tools/orchestrator/cli.mjs status
node tools/orchestrator/cli.mjs show TASK-<id>

# 4. Ako se zadatak blokira: pogledaj nalaze, pa ili ispravi ili vrati u opticaj.
node tools/orchestrator/cli.mjs ready TASK-<id> --reason "…"
# Ako je red-team nalaz pogrešan (retko, ali moguće):
node tools/orchestrator/cli.mjs override TASK-<id> --reason "…"
```

Preporuka za prvi realan zadatak: **jedan spoljni dokument od 1–3 strane**, jedna
tema, bez opisa samog sistema. Tako se kapije bave sadržajem, a ne kodom.
