# Korisnički vodič

[Dokumentacija](README.md) · [CLI](CLI.md) · [Operacije](OPERACIJE.md)

Sve komande u primerima pokreću se iz korena projekta. Putanje sa razmacima obavezno stavi pod navodnike. U primerima sa `TASK-103` koristi ID svog zadatka.

## Unos znanja

1. Sačuvaj novi izvor kao pravi fajl u `raw/`.
2. Otvori zadatak komandom `ingest`.
3. Izvrši kontrolnu petlju ili pojedinačne faze.
4. Proveri stanje, nalaze i objavljenu belešku.

```bash
node tools/orchestrator/cli.mjs ingest raw/novi-izvor.md   --title 'Nova tema' --tag 'istrazivanje,tema'   --request 'Izdvoji činjenice i jasno navedi ograničenja izvora.'
node tools/orchestrator/cli.mjs run --rounds 10
node tools/orchestrator/cli.mjs show TASK-103
node tools/orchestrator/cli.mjs status --json
```

Izvor mora već postojati ispod konfigurisanog direktorijuma izvora. `ingest` ne preuzima URL, ne kopira fajl sa druge lokacije i ne radi OCR. Registrovane izvore ne menjaj, ne preimenuj i ne briši; nova verzija dokumenta je novi fajl i novi zadatak.

## Tekst i multimodalni izvori

Ekstenzije `.md`, `.markdown` i `.txt` podrazumevano preskaču ekstrakciju. Sve druge ekstenzije zahtevaju `extract`, uključujući PDF, slike i tabele. To je pravilo po ekstenziji, a ne automatsko prepoznavanje sadržaja.

```bash
node tools/orchestrator/cli.mjs ingest raw/izvestaj.pdf --title 'Izveštaj' --extract
node tools/orchestrator/cli.mjs phase extract TASK-103
node tools/orchestrator/cli.mjs phase research TASK-103
```

Ekstraktor piše u `wiki/drafts/fragments/`, uz `source_path` i `source_sha256`. Kontrolni sloj proverava poreklo fragmenta prema bajtovima izvora. Research radi nad ekstraktorovom granom. `--no-extract` eksplicitno isključuje ekstrakciju; koristi ga samo kada adapter može smisleno obraditi izvor bez fragmenata. Mock proverava ugovor toka, ne kvalitet OCR-a ili razumevanje PDF-a.

## Pojedinačne faze

Za običan tekstualni unos standardni redosled je:

```bash
node tools/orchestrator/cli.mjs phase research TASK-103
node tools/orchestrator/cli.mjs phase verify TASK-103
node tools/orchestrator/cli.mjs phase challenge TASK-103
node tools/orchestrator/cli.mjs phase consolidate TASK-103
node tools/orchestrator/cli.mjs index
```

Verify mora dati `pass`; challenge mora biti `clean` kada je kapija uključena. Ako faza ne uspe, sledeću pokreni tek nakon pregleda rezultata i odgovarajućeg stanja. Kontrolni sloj sam uzima i obnavlja zakup, priprema radno stablo i komituje artefakte.

Odbijena verifikacija vraća zadatak u `ready`, pa se ponavlja istraživanje ili revizija. Reprodukovan ili neizvršen red-team nalaz vraća zadatak u `review`; prema trenutnom kodu sledeća automatska faza je verifikacija. To nije direktan povratak u research. Ako rezultat ostane problematičan ili zadatak završi u `blocked`, potrebna je intervencija operatera.

## Kontrolna petlja

`run` radi konačan broj krugova i zaustavlja se ranije kada nema prepoznatog napretka. Nije servis koji stalno čeka nove zadatke. Redosled razmatranja faza je consolidate → verify → challenge → audit → extract → research. Zadatke bira iz snimka stanja na početku kruga, a pre akcije ponovo čita konkretan zadatak. Zato je često potrebno više krugova.

```bash
node tools/orchestrator/cli.mjs run --rounds 10 --json
node tools/orchestrator/cli.mjs run --only verify --json
```

`--only` izvršava jedan prolaz izabrane faze; broj `--rounds` tada se ne primenjuje. U tom režimu nema automatskog reflect koraka. Pregledaj `ok`, `reason`, `error`, `blocked` i `conflict` u rezultatima.

## Održavanje postojećeg znanja

Za postojeće beleške koristi revizorski zadatak, umesto novog unosa koji bi prepisao isto ime.

```bash
node tools/orchestrator/cli.mjs audit   --scope 'wiki/Operativni_vodic_asinhronog_sistema.md'   --title 'Provera terminologije'   --request 'Uskladi termine i proveri veze; svaku izmenu obrazloži dokazom.'
node tools/orchestrator/cli.mjs run --rounds 10
```

Librarian menja postojeće beleške u eksplicitnom opsegu i piše `tasks/audits/TASK-NNN.md`. Izmene prolaze verify i challenge. U završnoj fazi kontrolni sloj spaja proverenu granu; ne poziva consolidator da ponovo napiše beleške.

Opseg može biti jedna putanja ili lista obrazaca razdvojena zarezima, na primer `'wiki/*.md'`. Indeks ostaje izveden artefakt čak i ako ga obrazac obuhvata. Za pouzdanu kontrolu koristi konkretne putanje: provera glob opsega pre faze i pri merge-u nije ista implementacija za sve složene obrasce.

## Zavisnosti

```bash
node tools/orchestrator/cli.mjs ingest raw/druga-tema.md   --title 'Druga tema' --depends 'TASK-101,TASK-103'
```

Sve zavisnosti moraju biti `consolidated`. Ako nisu, unos ostaje `proposed`. Trenutna petlja ne promoviše automatski te zadatke iz `proposed` nakon završetka zavisnosti; takve tokove planiraj unapred ili koristi interni `store.transition` kroz kontrolisanu integraciju. CLI `ready` prihvata samo `blocked` zadatak.

## Stvarni modeli

```bash
node tools/orchestrator/cli.mjs doctor --config tools/config/agents.real.yml
node tools/orchestrator/cli.mjs ingest raw/novi-izvor.md   --title 'Nova tema' --config tools/config/agents.real.yml
node tools/orchestrator/cli.mjs run --rounds 10   --config tools/config/agents.real.yml
```

Alternativna konfiguracija bira se za svaki poziv. Nije trajno zapamćena u zadatku. Realni YAML uključuje svih šest harnes adaptera i troši njihove kvote. CLI programi moraju biti instalirani, prijavljeni i imati odgovarajuću MCP konfiguraciju. Pročitaj [MCP](MCP.md) i [bezbednosna ograničenja](BEZBEDNOST.md), posebno statične uloge u MCP šablonima i red-team izvršavanje.

## Pregled u Obsidian-u

Otvori koren projekta kao vault. `wiki/Index.md` prikazuje beleške, statuse, oznake i broj veza. Koristi `[[Naziv_beleške]]`, opciono `[[Naziv_beleške#Odeljak|Prikaz]]`. Poželjna su jedinstvena imena belešaka. Indeks regeneriše kontrolni sloj; ne uređuj ga ručno.
