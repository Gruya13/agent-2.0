---
title: OSTree i Flatpak
created: 2026-10-18T15:24:00.000Z
updated: 2026-10-18T15:25:00.000Z
authors:
  - researcher
status: draft
tags:
  - ostree
  - flatpak
  - flathub
  - bubblewrap
  - pipewire
  - sandbox
---

# OSTree i Flatpak

## Sažetak

OSTree je tehnologija namenjena verzionisanju fajl sistema koja sadržaj skladišti u vidu objekata (`raw/ostree2.md`). Flatpak koristi OSTree za deduplikaciju podataka i oslanja se na izvršavanje aplikacija u izolovanom okruženju (sandbox-u) sa sistemom dozvola, dok za instalaciju zahteva Bubblewrap i OSTree (`raw/ostree2.md`). Centralno čvorište za distribuciju paketa je Flathub (`flathub.org`), iako je podržano i samostalno hostovanje nezavisnih repozitorijuma (`raw/ostree2.md`).

## Ključne tvrdnje

1. **Verzionisanje fajl sistema pomoću objekata:** OSTree je tehnologija za verzionisanje fajl sistema koja čuva sadržaj kao objekte (izvor: `raw/ostree2.md`).
2. **Deduplikacija u Flatpak-u:** Flatpak koristi OSTree za deduplikaciju tako što se identične datoteke čuvaju samo jednom, čime se efikasnost iskorišćenja prostora povećava sa porastom broja instaliranih paketa (izvor: `raw/ostree2.md`).
3. **Izolacija (sandbox) i dozvole:** Flatpak aplikacije se izvršavaju u sandbox-u i zahtevaju dozvole za pristup Bluetooth-u, zvuku (PipeWire), mreži i fajlovima (izvor: `raw/ostree2.md`).
4. **Upravljanje dozvolama:** Početne dozvole za Flatpak aplikacije konfiguriše održavalac paketa, a korisnik ih može naknadno menjati (izvor: `raw/ostree2.md`).
5. **Flathub kao de facto standard:** Flathub (na adresi `flathub.org`) predstavlja de facto standard za preuzimanje Flatpak paketa i do 2023. godine beležio je više od 700.000 preuzimanja dnevno (izvor: `raw/ostree2.md`).
6. **Zavisnosti za instalaciju:** Za instalaciju su neophodni Bubblewrap i OSTree (izvor: `raw/ostree2.md`).
7. **Nezavisni repozitorijumi:** Pored korišćenja Flathub-a, moguće je hostovati i sopstveni repozitorijum nezavisan od Flathub-a (izvor: `raw/ostree2.md`).

## Entiteti

- **OSTree** — tehnologija za verzionisanje fajl sistema zasnovana na čuvanju sadržaja u vidu objekata; koristi se u Flatpak-u za deduplikaciju i neophodna je za instalaciju (`raw/ostree2.md`).
- **Flatpak** — sistem za pakovanje i pokretanje aplikacija u sandbox-u koji koristi OSTree za deduplikaciju fajlova i zahteva Bubblewrap i OSTree za instalaciju (`raw/ostree2.md`).
- **Flathub (`flathub.org`)** — de facto standardni repozitorijum za preuzimanje Flatpak paketa, sa više od 700.000 dnevnih preuzimanja do 2023. godine (`raw/ostree2.md`).
- **Bubblewrap** — komponenta neophodna (uz OSTree) za instalaciju (`raw/ostree2.md`).
- **PipeWire** — zvučni podsistem naveden u kontekstu dozvola za zvuk koje zahtevaju Flatpak aplikacije u sandbox-u (`raw/ostree2.md`).

## Veze ka postojećim konceptima

U produkcionom direktorijumu `wiki/` trenutno ne postoje druge tematske beleške (osim izvedenog indeksa), pa u skladu sa pravilom o zabrani izmišljanja veza ka nepostojećim beleškama nisu dodati spoljni Vikilinkovi.

## Otvorena pitanja

Izvorni dokument (`raw/ostree2.md`) je kratak pregled i ostavlja sledeća pitanja nepotvrđenim (`nepotvrđeno` u izvoru):

1. Koji kriptografski algoritam heširanja i tačnu strukturu objekata koristi OSTree prilikom verzionisanja fajl sistema (`nepotvrđeno`)?
2. Kako tačno Bubblewrap učestvuje u kreiranju sandbox okruženja pri izvršavanju u odnosu na sam proces instalacije (`nepotvrđeno`)?
3. Kojim konkretnim alatima ili komandama korisnik naknadno menja dozvole koje je definisao održavalac (`nepotvrđeno`)?
4. Koji je primarni izvor za podatak o više od 700.000 preuzimanja dnevno na Flathub-u do 2023. godine (`nepotvrđeno`)?

## Izvori

- `raw/ostree2.md`
