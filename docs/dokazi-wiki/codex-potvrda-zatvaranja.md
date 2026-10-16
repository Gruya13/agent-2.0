Pregledana revizija: **`dfc77abdab842c7f8736cb8624a7fc799b1df778`**.

**Oporavak je popravljen u ponovljenim scenarijima. Semantička proba prolazi. YAML vodeće prazne linije jesu popravljene, ali širi round-trip i folded `>` ostaju neispravni.**

| Tvrdnja | Ishod | Dokaz |
|---|---|---|
| 1. Oporavak čuva `accept` i `memory_write`, bez duplog merge-a | **POTVRĐENO** | Ponovljen SIGKILL pre evidencije prihvatanja; sledeći poziv vraća `done`; jedan merge. |
| 1a. Delimičan wiki upis može da se dovrši | **POTVRĐENO** | Fajl nastao, commit blokiran; greška evidentirana; posle uklanjanja smetnje retry prolazi. |
| 2. Vodeće prazne linije za `|-` | **POTVRĐENO** | Vodeće i unutrašnje prazne linije ostaju. |
| 2a. Očuvanje završnih praznih linija i `|+` round-trip | **OBORENO** | Parser čita `|+`, ali serializer ga pretvara u `|-` i gubi završne nove redove. |
| 2b. Folded `>` | **OBORENO** | Granice pasusa pretvara u razmake. |
| 2c. Prazan string | **POTVRĐENO** | `""` ostaje `""`; string sastavljen samo od novih redova nije očuvan. |
| 3. P6 opravdano očekuje `fail` | **POTVRĐENO** | „Pakovanje“ dodaje funkciju koju izvor ne uspostavlja. |
| 3a. Novi par sa nedokazanom ulogom entiteta | **POTVRĐENO u probi** | Stvarni dsh dao `fail` sa odgovarajućim sadržajnim razlogom. |

Programi i puni izlazi su u [`.verification/`](/home/gru/.agent-worktrees/verify-session-08b4-codex/.verification).

### 1. SIGKILL i delimičan zapis

```bash
node .verification/crash.mjs
node .verification/crash.mjs partial
```

Prva proba ponavlja prethodni prozor: ciljni merge već postoji, `post-merge` hook čeka, a kontrolni proces dobija `SIGKILL` pre upisa `accept`. Posle isteka i opoziva zakupa:

```text
before {"status":"in_progress","accept":null}
resume {"phase":"code","task":"TASK-101","ok":true,"step":"memory","recovered":true}
after {"status":"consolidated","accept":true,"memory_write":"wiki/Izmene/TASK-101.md","error":false,"note":true}
again {"phase":"code","task":"TASK-101","ok":true,"step":"done","merge":"99d2f204d6b19610df41c6b0d60aeddbcba649ac"}
merge-count 1
```

Očekivano i dobijeno se poklapaju: potpuna evidencija, ponovljiv poziv i bez duplog merge-a.

U drugoj probi pre oporavka postavljen je kontrolni `.git/index.lock`. Wiki fajl nastaje, ali commit pada:

```text
after {"status":"verified","accept":true,"memory_write":null,"error":true,"note":true}
```

Rezultat je `ok:false`, uz poruku da prihvatanje postoji u Gitu, ali zapis nije prošao. Posle uklanjanja lock-a:

```text
retry {"phase":"code","task":"TASK-101","ok":true,"step":"memory"}
retry-state {"status":"consolidated","memory_write":"wiki/Izmene/TASK-101.md","error":null}
again {"phase":"code","task":"TASK-101","ok":true,"step":"done","merge":"dd55919ceb4768f82368617ecfd130e5ed765f05"}
merge-count 1
```

Nisam reprodukovao prethodni `NOT_READY`.

### 2. YAML: preostali kontraprimeri

```bash
node .verification/yaml.mjs
```

Za nezavisnu kontrolu očekivanog YAML parsiranja korišćen je lokalni **PyYAML 6.0.3**.

**Vodeće i unutrašnje prazne linije sada rade:**

```text
{"input":"\n\nfirst\n\nlast","roundtrip":"\n\nfirst\n\nlast"}
```

**Završne prazne linije nestaju:**

```text
{"input":"\n\nfirst\n\nlast\n\n","roundtrip":"\n\nfirst\n\nlast"}
```

Za `|+`:

```text
{"name":"keep","expected":"\n\nfirst\n\nlast\n\n\n","actual":"\n\nfirst\n\nlast\n\n\n","parseEqual":true,"roundtrip":"\n\nfirst\n\nlast","roundtripEqual":false}
```

Očekivano: parse–serialize–parse čuva vrednost stringa. Dobijeno: završni novi redovi nestaju jer serializer za svaki višelinijski string bira `|-`: [yaml.mjs:410](/home/gru/.agent-worktrees/verify-session-08b4-codex/tools/orchestrator/lib/yaml.mjs:410).

**Folded `>` pogrešno obrađuje pasuse.** Ulaz:

```yaml
summary: >

  first
  second

  last

next: x
```

Stvarni rezultat:

```text
expected: "\nfirst second\nlast\n"
actual:   " first second  last \n"
```

Uzrok je `collected.join(' ')`, koji i prazne redove pretvara u razmake: [yaml.mjs:195](/home/gru/.agent-worktrees/verify-session-08b4-codex/tools/orchestrator/lib/yaml.mjs:195).

**Prazan string prolazi, samo-prazne-linije ne prolaze:**

```text
{"input":"","roundtrip":""}
{"input":"\n\n","roundtrip":""}
```

Kod `|-` uklanjanje završnih novih redova pri parsiranju jeste očekivana semantika. Problem je što serializer koristi tu formu i kada time menja postojeću vrednost stringa.

### 3. P6 i novi stvarni dsh ogled

P6 izvor navodi sandbox izvršavanje i zavisnosti za instalaciju. Nacrt dodaje:

> Flatpak je sistem za **pakovanje** i pokretanje aplikacija.

Očekivani `fail` je opravdan. Izvršavanje i instalacija ne uspostavljaju funkciju pravljenja/pakovanja aplikacija. To je dodatna uloga, a ne sinonim.

Novi par koji nije u fixture-u:

**Ceo izvor:**

> Aplikacije zahtevaju dozvolu za pristup zvuku (PipeWire). Korisnik može naknadno menjati dozvole.

**Ceo nacrt:**

> Aplikacije zahtevaju dozvolu za pristup zvuku (PipeWire), a korisnik može naknadno menjati dozvole. PipeWire je upravljač dozvolama koji odlučuje da li aplikacija sme pristupiti zvuku.

Moje očekivanje: **fail**. Izvor ne pripisuje odlučivanje o dozvolama PipeWire-u.

```bash
node .verification/semantic.mjs
```

Program koristi `agents.real.yml` i stvarni `pipeline.runVerify` sa dsh harnesom. Stvarni izlaz:

```text
| par | očekivano | dobijeno | ishod |
| Q2 nova uloga entiteta | fail | fail | OK |
SVI PAROVI USKLAĐENI (1/1)
```

Dsh izveštaj identifikuje upravo dodatnu ulogu:

> Izvor ne tvrdi da je PipeWire „upravljač dozvolama“, niti da on „odlučuje da li aplikacija sme pristupiti zvuku“.

Puni izveštaj: [semantic-review.md](/home/gru/.agent-worktrees/verify-session-08b4-codex/.verification/semantic-review.md).

### Testovi i ograničenja

```bash
node --test tests/crash-recovery.test.mjs tests/yaml.test.mjs
```

```text
ℹ tests 16
ℹ pass 16
ℹ fail 0
ℹ skipped 0
```

- Izvršen je jedan novi stvarni dsh poziv, kako je traženo; nisam ponavljao svih šest plaćenih parova.
- SIGKILL probe koriste mock programera i fixture Git hook.
- Ceo skup testova i svi mogući prozori prekida nisu proveravani.
- Prolazak Y3 ne pokriva navedene završne nove redove i folded pasuse.
- Kandidat nije popravljan; glavni workspace nije menjan.

```console
$ git diff --exit-code
$ git rev-parse HEAD
dfc77abdab842c7f8736cb8624a7fc799b1df778
$ git status --porcelain
?? .verification/
```

`git diff --exit-code` završio je sa 0. Ovaj pregled ne predstavlja potvrdu potpune sigurnosti sistema.
