# Model podataka

[Dokumentacija](README.md) · [Arhitektura](ARHITEKTURA.md)

## Zadatak

Zadatak je Markdown datoteka `TASK-NNN.md` sa YAML frontmatter-om. ID odgovara `TASK-` i najmanje tri cifre. U praznom skladištu kreće od 101; sledeći ID je najveći pronađeni broj u četiri fascikle plus jedan.

| Polje | Značenje |
|---|---|
| id, title, status | obavezni identitet, naslov i stanje |
| created, updated | obavezni UTC ISO-8601 datumi |
| kind | ingest ili audit; odsustvo se u tokovima često tumači kao ingest |
| source | relativna putanja izvora; null kod audit-a |
| audit_scope | neprazna lista opsega kod audit-a |
| extract_required, extracted | potreba i rezultat ekstrakcije |
| priority | inicijalno normal; nema posebnog prioritetnog schedulera |
| tags, depends_on | oznake i ID-evi zavisnosti |
| authors, assignee | doprinosi i dodela |
| lock_owner, locked_at, lease_expires_at, lock_token | zakup i identitet procesa |
| artifacts | relativne putanje nastalih artefakata |
| verification | verdict, harness, at, commit, summary |
| challenge | verdikt, revizija, skripte, reprodukcije i evidencija |
| blocked_reason | obavezan razlog kod blocked |
| history | vremenski zapisi stanja, aktera i opcionih napomena |

Obavezna polja šeme su `id`, `title`, `status`, `created`, `updated`. `in_progress` zahteva vlasnika i datume zakupa; kontrolni tok dodatno koristi token. Nisu sva opciona polja potpuno tipizirana validatorom.

Primer metapodataka početnog spremnog zadatka:

```yaml
---
id: TASK-103
title: Nova tema
status: ready
created: 2026-10-14T10:00:00.000Z
updated: 2026-10-14T10:00:00.000Z
kind: ingest
source: raw/novi-izvor.md
extract_required: false
extracted: true
tags: [tema]
depends_on: []
authors: [researcher]
lock_owner: null
locked_at: null
lease_expires_at: null
artifacts: []
verification: null
challenge: null
blocked_reason: null
---
```

Ovo je skraćen prikaz formata; zadatke pravi CLI, koji dodaje istoriju i druga polja. Telo standardno ima zahtev, nalaze i dopisane izveštaje faza. Ne menjaj ručno status, zakup ili pečate.

## Automat stanja

| Stanje | Dozvoljeni naredni statusi | Fascikla |
|---|---|---|
| proposed | ready, blocked | inbox |
| ready | in_progress, blocked | inbox |
| in_progress | review, ready, verified, consolidated, blocked | active |
| review | in_progress, verified, ready, blocked | review |
| verified | in_progress, consolidated, review, ready, blocked | review |
| consolidated | nema daljih prelaza | completed |
| blocked | ready | inbox |

Prelaz u isto stanje je dozvoljen. Zato `history` sadrži i ponovljene statuse: promene tela i drugih podataka mogu dodati zapis bez promene stanja. `phase` u CLI prikazu označava fizičku fasciklu, a ne research/verify fazu.

Pipeline pri odbačenoj verifikaciji/challenge-u broji sve zapise istorije sa `status: review` i blokira kada broj pređe `maxRevisions`. Pošto i drugi upisi u tom statusu dodaju istoriju, taj broj ne treba čitati kao tačan broj različitih odbačenih nacrta. `ready` ne resetuje istoriju.

## Beleška

Obavezna polja su `title`, `created`, `updated`, `authors`, `status`, `tags`. Authors i tags su liste. Dozvoljeni statusi su draft, review, verified i consolidated. Datumi belešaka nemaju istu strogu proveru kao datumi zadataka.

```markdown
---
title: Nova tema
created: 2026-10-14T10:00:00.000Z
updated: 2026-10-14T10:10:00.000Z
authors: [agy, dsh, codex]
status: consolidated
tags: [tema]
---

# Nova tema

Proverljive tvrdnje sa poreklom iz izvora.
```

`noteSlug` pretvara razmake u `_` i uklanja problematične znake iz imena. Konsolidacija normalizuje status i spaja autorstvo sa evidencijom zadatka. Postojeća produkciona beleška istog imena ne prepisuje se kroz MCP konsolidaciju; koristi audit.

## Fragment

Fragment ima standardni frontmatter i dodatna `source_path` i `source_sha256` polja. SHA-256 mora odgovarati bajtovima navedenog izvora. Hash dokazuje da se referencira konkretan fajl, a ne da je transkripcija sadržajno tačna. Fragmenti ne ulaze u centralni indeks.

## Vikilinkovi i indeks

Podržana ekstrakcija linkova prepoznaje `[[Beleška]]`, `[[Beleška#Odeljak]]` i `[[Beleška|Prikaz]]`. Za poređenje se mala/velika slova normalizuju, a razmaci i donje crte ujednačavaju; dijakritika ostaje. Linter prvenstveno razrešava ime beleške, ne proverava postojanje svakog naslova odeljka i nema punu Obsidian semantiku putanja.

Nedostajući link u nacrtu je warning; u produkciji je error. Duplikati imena mogu dati dvosmislen graf. `wiki/Index.md` se regeneriše iz `wiki/`, uključuje nacrte koji su fizički prisutni, preskače sebe i fragmente, i prikazuje status, oznake i broj jedinstvenih veza.

## Manifest izvora

`.agents/raw-manifest.json` sadrži verziju 2, vreme ažuriranja i mapu `files`, sa putanjama relativnim prema `raw/`:

```json
{
  "version": 2,
  "files": {
    "novi-izvor.md": {
      "sha256": "<SHA-256 bajtova fajla>",
      "bytes": true,
      "size": 123,
      "registeredAt": "2026-10-14T10:00:00.000Z"
    }
  }
}
```

Primer nije stvarni hash. Novi fajl dobija novu osnovu; postojeći poznati hash se ne menja radi prikrivanja izmene. Stari tekstualni zapis može se nadograditi ako je UTF-8 povratno uporediv. Binarna v1 osnova može izazvati `raw.legacy-unknown`.

Upis manifesta nije ista atomska transakcija kao promena zadatka. Ako je manifest neispravan, updater u trenutnom kodu može napraviti novi manifest; prvo sačuvaj i istraži problem, umesto automatskog regenerisanja izgubljene osnove.

## Dnevnik događaja

`tasks/events.jsonl` čuva po jedan JSON objekat po liniji:

```json
{"ts":"2026-10-14T10:00:00.000Z","kind":"task.ingested","task":"TASK-103","source":"raw/novi-izvor.md","actor":"operator"}
```

Vrste uključuju task.ingested, task.audit, task.write, lease.reclaimed, phase.start, phase.done, phase.failed, phase.rejected, phase.error i challenge.overridden. Payload zavisi od događaja. Dnevnik se dopisuje; nije kriptografski zaštićen ili nezavisna transakciona baza.

## Lokalni runtime

`.runtime/task-context.json` nosi task, taskRoot, role, agent, leaseToken, leaseExpiresAt, status i writtenAt. To je lokalni kontekst poziva, ne novi autoritativni zapis zadatka. `.runtime/`, `.locks/` i `.worktrees/` ne komituju se. Token tretiraj kao podatak aktivnog zakupa i ne dodaj ga u javnu dokumentaciju ili logove namenjene deljenju.
