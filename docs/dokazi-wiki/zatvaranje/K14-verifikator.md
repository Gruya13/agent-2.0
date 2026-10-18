---
title: Revizija TASK-101 — OSTree i Flatpak
created: 2026-10-18T15:27:16.788Z
updated: 2026-10-18T15:27:16.788Z
authors:
  - verifier
status: review
tags:
  - revizija
  - TASK-101
task: TASK-101
source: raw/ostree2.md
draft: wiki/drafts/OSTree-i-Flatpak.md
draft_commit: 6276514a40d9aa0bc4ef1c6699d193fa3d4583ba
verdict: fail
reasons: 3
---

# Revizija TASK-101 — OSTree i Flatpak

- **Nacrt:** `wiki/drafts/OSTree-i-Flatpak.md` (commit `6276514`)
- **Izvor:** `raw/ostree2.md` (SHA-256 `3d0ec5d71c12bab1e4ce47660e9d2e61e55f942657f03e72cd3e557961910e8e`, poklapa se sa `.agents/raw-manifest.json`)
- **Verdikt:** `fail`
- **Broj blokirajućih nalaza:** 3

## Metod

Nacrt je pročitan u celini i upoređen sa izvorom `raw/ostree2.md` (11 linija)
i sa produkcionim delom `wiki/` (jedina produkciona beleška je `wiki/Index.md`,
koji je izvedeni indeks). Provereni su frontmatter, Vikilinkovi, semantičke
kontradikcije, redundansa, brojevi, kategorije dozvola, integritet izvora i
odsustvo matematičkih/kod formulacija. Svaki nalaz nosi citat iz izvora i tačnu
liniju nacrta; predlozi izmena su tekstualni i nacrt nije menjan.

## Nalazi

### N1 — Flatpak je definisan kao „sistem za pakovanje“ (kriterijum 3)

**Tvrdnja nacrta (`wiki/drafts/OSTree-i-Flatpak.md:36`):**

> **Flatpak** — sistem za pakovanje i pokretanje aplikacija u sandbox-u koji
> koristi OSTree za deduplikaciju fajlova i zahteva Bubblewrap i OSTree za
> instalaciju (`raw/ostree2.md`).

**Šta izvor nosi (`raw/ostree2.md:3-11`):**

> OSTree je tehnologija za verzionisanje fajl sistema koja čuva sadržaj kao objekte.
> Flatpak je koristi za deduplikaciju: identične datoteke se čuvaju jednom, pa se
> efikasnost prostora povećava sa brojem instaliranih paketa. Flatpak aplikacije se
> izvršavaju u sandbox-u i zahtevaju dozvole za Bluetooth, zvuk (PipeWire), mrežu i
> fajlove. Dozvole konfiguriše održavalac, a korisnik ih može naknadno menjati.
> Flathub, na adresi flathub.org, je de facto standard za preuzimanje paketa i do
> 2023. godine beležio je više od 700.000 preuzimanja dnevno. Za instalaciju su
> potrebni Bubblewrap i OSTree. Moguće je hostovati i repozitorijum nezavisan od
> Flathub-a.

**Zašto je nalaz:** Izvor Flatpak opisuje kroz četiri uloge: korišćenje OSTree-a
za deduplikaciju (`:3-5`), izvršavanje aplikacija u sandbox-u i dozvole
(`:5-7`), zavisnosti za instalaciju (`:9-10`) i mogućnost nezavisnog
hostovanja (`:10-11`). Nijedna od njih nije **pakovanje** (gradnja/izrada
paketa). Reči „paket“ u izvoru postoje samo kao objekat preuzimanja
(„preuzimanje paketa“, `:8`) i instalacije („instaliranih paketa“, `:5`), ali
izvor ne kaže da Flatpak pakuje ili gradi aplikacije/pakete. Zato je „sistem za
pakovanje“ dodata definicija/uloga entiteta, a nije označena kao nepotvrđena —
pada kriterijum 3.

**Dokaz:** uporedi citat nacrta sa celinom izvora `raw/ostree2.md:1-11`; u
izvoru nema glagola „pakovati“ ni imenice „pakovanje“:

```text
$ for p in 'pakuj' 'pakovanj'; do printf '%-12s -> ' "$p"; grep -Fqi "$p" raw/ostree2.md && echo POGODAK || echo nema; done
pakuj        -> nema
pakovanj     -> nema
```

Odsustvo reči samo po sebi nije dokaz (kriterijum 5), pa je odlučujući dokaz
značenje celog izvora: opisane uloge Flatpak-a ne uključuju pakovanje. Ista
konstrukcija je u projektnom semantičkom fixture-u označena kao očekivani
`fail`:

```text
tools/fixtures/semantika.mjs:45-48
ime: 'P6 definicija uloge koju izvor ne daje'
ocekivano: 'fail'
izvor: 'Flatpak aplikacije se pokreću u sandbox okruženju. Za instalaciju su potrebni Bubblewrap i OSTree.'
nacrt: 'Flatpak je sistem za pakovanje i pokretanje aplikacija. Aplikacije se pokreću u sandbox okruženju; za instalaciju su potrebni Bubblewrap i OSTree.'
```

**Predlog izmene (tekst, ne fajl):** „**Flatpak** — okruženje za izvršavanje
aplikacija u sandbox-u koje koristi OSTree za deduplikaciju fajlova; za
instalaciju su potrebni OSTree i Bubblewrap (`raw/ostree2.md`).“

### N2 — Otvoreno pitanje 1 pretpostavlja kriptografsko heširanje (kriterijum 4)

**Tvrdnja nacrta (`wiki/drafts/OSTree-i-Flatpak.md:49`):**

> Koji kriptografski algoritam heširanja i tačnu strukturu objekata koristi
> OSTree prilikom verzionisanja fajl sistema (`nepotvrđeno`)?

**Šta izvor nosi (`raw/ostree2.md:3`):**

> OSTree je tehnologija za verzionisanje fajl sistema koja čuva sadržaj kao
> objekte.

**Zašto je nalaz:** Pitanje je formulisanje kao „**koji** kriptografski
algoritam heširanja ... koristi“, čime u sebi nosi tvrdnju da OSTree koristi
kriptografski algoritam heširanja. Izvor kaže samo da se sadržaj čuva kao
objekti; ne pominje heširanje, heš algoritam ni kriptografsko adresiranje.
Oznaka `nepotvrđeno` odnosi se na odgovor (koji algoritam), ne na premisu da
algoritam postoji — pa pitanje pada kriterijum 4.

**Dokaz:** citat `:49` + `raw/ostree2.md:3`; u izvoru nema pojmova heširanja ni
adresiranja:

```text
$ for p in 'kriptograf' 'heš' 'hash' 'adresira'; do printf '%-12s -> ' "$p"; grep -Fqi "$p" raw/ostree2.md && echo POGODAK || echo nema; done
kriptograf   -> nema
heš          -> nema
hash         -> nema
adresira     -> nema
```

**Predlog izmene (tekst, ne fajl):** „Da li OSTree objekte identifikuje
heširanjem i, ako da, koji algoritam koristi i kakva je struktura objekata
(`nepotvrđeno` u `raw/ostree2.md`)?“

### N3 — Otvoreno pitanje 2 pretpostavlja ulogu Bubblewrap-a u izvršavanju (kriterijum 4)

**Tvrdnja nacrta (`wiki/drafts/OSTree-i-Flatpak.md:50`):**

> Kako tačno Bubblewrap učestvuje u kreiranju sandbox okruženja pri izvršavanju
> u odnosu na sam proces instalacije (`nepotvrđeno`)?

**Šta izvor nosi (`raw/ostree2.md:9-10`):**

> Za instalaciju su potrebni Bubblewrap i OSTree.

**Zašto je nalaz:** Formulacija „kako tačno Bubblewrap **učestvuje u kreiranju
sandbox okruženja pri izvršavanju**“ pretpostavlja da Bubblewrap ima ulogu u
izvršavanju i kreiranju sandbox-a. Izvor Bubblewrap vezuje isključivo za uslov
instalacije (`:9-10`); sandbox pominje samo kao mesto gde se Flatpak aplikacije
izvršavaju (`:5-6`), bez povezivanja sa Bubblewrap-om. Pitanje bi bilo neutralno
tek ako pita **da li** takva uloga postoji; ovako nosi nedokazanu premisu
(kriterijum 4).

**Dokaz:** citat `:50` + `raw/ostree2.md:9-10`; jedini pogodak za Bubblewrap u
izvoru je linija 10, a linije 5-6 ne pominju Bubblewrap:

```text
$ grep -ni 'bubblewrap' raw/ostree2.md
10:potrebni Bubblewrap i OSTree. Moguće je hostovati i repozitorijum nezavisan od

$ sed -n '5,6p' raw/ostree2.md
efikasnost prostora povećava sa brojem instaliranih paketa. Flatpak aplikacije se
izvršavaju u sandbox-u i zahtevaju dozvole za Bluetooth, zvuk (PipeWire), mrežu i
```

**Predlog izmene (tekst, ne fajl):** „Da li Bubblewrap ima ulogu u kreiranju
sandbox okruženja pri izvršavanju i, ako ima, kakva je; izvor potvrđuje samo da
je potreban za instalaciju (`nepotvrđeno` u `raw/ostree2.md`)?“

## Zapažanja (ne blokiraju)

1. **„Centralno čvorište za distribuciju paketa“ (`:21`).** Izvor kaže „de
   facto standard za preuzimanje paketa“ (`raw/ostree2.md:8-9`) i da je moguće
   hostovati repozitorijum nezavisan od Flathub-a (`:10-11`). „Centralno
   čvorište“ je razumljiva parafraza „de facto standarda“, a „iako“ u istoj
   rečenici ne poriče nezavisno hostovanje. Po kriterijumu 2 nije nalaz;
   preciznije bi bilo „Flathub je de facto standardni repozitorijum za
   preuzimanje paketa“.
2. **„PipeWire — zvučni podsistem“ (`:39`).** Izvor kaže „zvuk (PipeWire)“
   (`raw/ostree2.md:6`); razrešenje zagrade u „zvučni podsistem“ je prihvatljiv
   gloss, ne nova činjenica (kriterijum 2).
3. **„Početne dozvole“ i „održavalac paketa“ (`:28`).** Izvor kaže „Dozvole
   konfiguriše održavalac, a korisnik ih može naknadno menjati“
   (`raw/ostree2.md:7`). „Početne“ je logična posledica naknadne izmene, a
   „paketa“ kontekstualno razrešenje; nije nalaz.
4. **„Sopstveni repozitorijum“ (`:31`).** Izvor kaže da je moguće hostovati
   repozitorijum nezavisan od Flathub-a (`raw/ostree2.md:10-11`); „sopstveni“ je
   razumljiva implikacija, ne jača tvrdnja.
5. **Otvoreno pitanje 3 — „kojim konkretnim alatima ili komandama“ (`:51`).**
   Izvor potvrđuje da korisnik može naknadno menjati dozvole
   (`raw/ostree2.md:7`), pa je pitanje o mehanizmu osnovano. Formulacija sužava
   mehanizam na alate/komande (isključuje npr. GUI), ali ne tvrdi konkretnu
   činjenicu o Flatpak-u; neutralnije bi bilo „na koji način“. Zbog toga je
   zapažanje, ne blokirajući nalaz.
6. **Oznaka „`nepotvrđeno` u izvoru“ (`:47`).** Izvor ne sadrži doslovnu oznaku
   `nepotvrđeno`; fraza je konvencija koja znači „nepotvrđeno u izvoru“. Ne
   menja značenje, ali bi preciznija formulacija bila „nije potvrđeno izvorom“.
7. **Strukturna ponavljanja Sažetka, Ključnih tvrdnji i Entiteta.** Iste
   činjenice se ponavljaju u propisanoj strukturi nacrta; u produkciji nema
   drugih belešaka sa kojima bi postojala semantička redundansa
   (`wiki/Index.md:14-18` prikazuje `Beleške (0)`). Nije nalaz.

## Provereno bez nalaza

- **Frontmatter:** sva obavezna polja su prisutna (`title`, `created`,
  `updated`, `authors`, `status`, `tags`); `status: draft`;
  `authors: [researcher]`. `node tools/orchestrator/cli.mjs lint` vraća
  `grešaka: 0, upozorenja: 0`.
- **Vikilinkovi:** u nacrtu nema nijednog Vikilinka (`grep -nE '\[\[[^]]+\]\]'`
  nema pogodaka), pa nema nevalidnih linkova. Tvrdnja da u produkciji nema
  drugih tematskih belešaka je tačna: `find wiki -type f -name '*.md'` daje samo
  `wiki/Index.md` i nacrt.
- **Semantičke kontradikcije:** nema drugih produkcionih belešaka sa kojima bi
  nacrt bio u kontradikciji; `wiki/Index.md` je izvedeni indeks.
- **Brojevi i kategorije dozvola:** „više od 700.000 preuzimanja dnevno“ i „do
  2023. godine“ poklapaju se sa `raw/ostree2.md:8-9`; četiri kategorije —
  Bluetooth, zvuk (PipeWire), mreža, fajlovi (`:5-7`) — poklapaju se sa
  nacrtom (`:27`).
- **Izvorni integritet:** `sha256sum raw/ostree2.md` =
  `3d0ec5d71c12bab1e4ce47660e9d2e61e55f942657f03e72cd3e557961910e8e`, što se
  poklapa sa `.agents/raw-manifest.json`.
- **Matematika/kod:** nema matematičkih formula ni kod-blokova koje bi trebalo
  proveravati.
- **Nacrt nije menjan:** revizija je upisana samo u `tasks/reviews/`.

## Dokazi (komande i izlaz)

```text
$ node tools/orchestrator/cli.mjs lint
OK — nema nalaza; invarijante ugovora su zadovoljene.

grešaka: 0, upozorenja: 0

$ sha256sum raw/ostree2.md
3d0ec5d71c12bab1e4ce47660e9d2e61e55f942657f03e72cd3e557961910e8e  raw/ostree2.md

$ find wiki -type f -name '*.md' | sort
wiki/drafts/OSTree-i-Flatpak.md
wiki/Index.md

$ grep -nE '\[\[[^]]+\]\]' wiki/drafts/OSTree-i-Flatpak.md
(nema pogodaka)

$ for p in 'pakuj' 'pakovanj' 'kriptograf' 'heš' 'hash' 'adresira'; do printf '%-12s -> ' "$p"; grep -Fqi "$p" raw/ostree2.md && echo POGODAK || echo nema; done
pakuj        -> nema
pakovanj     -> nema
kriptograf   -> nema
heš          -> nema
hash         -> nema
adresira     -> nema

$ grep -ni 'bubblewrap' raw/ostree2.md
10:potrebni Bubblewrap i OSTree. Moguće je hostovati i repozitorijum nezavisan od

$ git rev-parse HEAD
6276514a40d9aa0bc4ef1c6699d193fa3d4583ba
```

## Zaključak

Nacrt verno prenosi većinu izvora (deduplikacija, sandbox, dozvole, Flathub,
brojevi, instalacione zavisnosti, nezavisni repozitorijumi), ali sadrži tri
blokirajuća nalaza: dodatu definiciju Flatpak-a kao „sistema za pakovanje“ (N1)
i dva otvorena pitanja koja u premisi nose tvrdnje kojih izvor nema — o
kriptografskom heširanju (N2) i o ulozi Bubblewrap-a u izvršavanju (N3). Zato je
verdikt `fail`; predlozi izmena su tekstualni i nacrt nije menjan.

REASONS: 3
VERDICT: fail
