---
title: OSTree i Flatpak
created: 2026-10-18T22:16:07.579Z
updated: 2026-10-18T22:26:01.325Z
authors:
  - researcher
  - verifier
  - consolidator
status: consolidated
tags:
  - linux
  - paketi
  - ostree
  - flatpak
---

# OSTree i Flatpak

## Sažetak

Izvor (`raw/ostree2.md`) opisuje OSTree kao tehnologiju za verzionisanje fajl sistema koja čuva sadržaj u vidu objekata, kao i upotrebu te tehnologije u okviru Flatpak-a radi deduplikacije datoteka. Pored toga, izvor navodi izvršavanje Flatpak aplikacija u sandbox-u, upravljanje dozvolama, Flathub (`flathub.org`) kao de facto standard za preuzimanje paketa i preduslove potrebne za instalaciju (`raw/ostree2.md`).

## Ključne tvrdnje

1. **Verzionisanje fajl sistema kroz objekte:** OSTree je tehnologija za verzionisanje fajl sistema koja čuva sadržaj kao objekte (`raw/ostree2.md`).
2. **Deduplikacija i prostorna efikasnost:** Flatpak koristi OSTree za deduplikaciju tako što se identične datoteke čuvaju samo jednom, čime se efikasnost iskorišćenja prostora povećava sa brojem instaliranih paketa (`raw/ostree2.md`).
3. **Izvršavanje u sandbox-u i dozvole:** Flatpak aplikacije se izvršavaju u sandbox-u i zahtevaju dozvole za pristup Bluetooth-u, zvuku (PipeWire), mreži i fajlovima (`raw/ostree2.md`).
4. **Konfiguracija i izmena dozvola:** Dozvole za Flatpak aplikacije konfiguriše održavalac, dok ih korisnik može naknadno menjati (`raw/ostree2.md`).
5. **Flathub i obim preuzimanja:** Flathub (na adresi `flathub.org`) predstavlja de facto standard za preuzimanje paketa i do 2023. godine beležio je više od 700.000 preuzimanja dnevno (`raw/ostree2.md`).
6. **Preduslovi za instalaciju:** Za instalaciju su potrebni Bubblewrap i OSTree (`raw/ostree2.md`).
7. **Nezavisni repozitorijumi:** Pored Flathub-a, moguće je hostovati i repozitorijum nezavisan od Flathub-a (`raw/ostree2.md`).

## Entiteti

- **OSTree** — tehnologija za verzionisanje fajl sistema koja čuva sadržaj kao objekte; Flatpak je koristi za deduplikaciju datoteka i potrebna je (uz Bubblewrap) za instalaciju (`raw/ostree2.md`).
- **Flatpak** — koristi OSTree za deduplikaciju identičnih datoteka; njegove aplikacije se izvršavaju u sandbox-u i zahtevaju dozvole za Bluetooth, zvuk (PipeWire), mrežu i fajlove (`raw/ostree2.md`).
- **Flathub** (`flathub.org`) — de facto standard za preuzimanje paketa koji je do 2023. godine beležio više od 700.000 preuzimanja dnevno (`raw/ostree2.md`).
- **PipeWire** — naveden u izvoru u kontekstu dozvola za zvuk (`zvuk (PipeWire)`) koje zahtevaju Flatpak aplikacije (`raw/ostree2.md`).
- **Bubblewrap** — naveden u izvoru kao komponenta koja je, uz OSTree, potrebna za instalaciju (`raw/ostree2.md`).

## Veze ka postojećim konceptima

U produkcionoj zoni `wiki/` trenutno ne postoje druge verifikovane beleške (osim izvedenog indeksa `wiki/Index.md`), pa nisu dodate semantičke veze ka drugim beleškama kako se ne bi uvodile reference na nepostojeće koncepte.

## Otvorena pitanja

- Izvor navodi da su za instalaciju potrebni Bubblewrap i OSTree, ali ne objašnjava šta je Bubblewrap niti koju funkciju obavlja (`raw/ostree2.md`).
- Izvor pominje PipeWire u zagradi uz dozvole za zvuk (`zvuk (PipeWire)`), ali ne daje njegovu definiciju niti dodatne detalje (`raw/ostree2.md`).
- Izvor navodi da je moguće hostovati repozitorijum nezavisan od Flathub-a, ali ne opisuje kako se takav repozitorijum postavlja ili održava (`raw/ostree2.md`).
- Izvor navodi podatak o više od 700.000 preuzimanja dnevno na Flathub-u do 2023. godine, ali ne sadrži podatke o broju preuzimanja nakon tog perioda (`raw/ostree2.md`).
