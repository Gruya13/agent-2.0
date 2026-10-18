# Referentna lista za novi dokumentni prolaz (K14)

Zapisana PRE prolaza, 18. oktobar 2026. Služi za ocenu objavljenog teksta.
Izvor: raw/ostree2.md (ista sačuvana kopija kao u ogledu K12).

Tvrdnje koje izvor nosi:

1. OSTree je tehnologija za verzionisanje fajl sistema; čuva sadržaj kao objekte.
2. Flatpak koristi OSTree za deduplikaciju: identične datoteke se čuvaju jednom.
3. Flatpak aplikacije se izvršavaju u sandbox-u.
4. Dozvole: Bluetooth, zvuk (PipeWire), mreža, fajlovi.
5. Dozvole konfiguriše održavalac; korisnik ih može naknadno menjati.
6. Flathub (flathub.org) je de facto standard; do 2023. više od 700.000 preuzimanja dnevno.
7. Za instalaciju su potrebni Bubblewrap i OSTree.
8. Moguće je hostovati repozitorijum nezavisan od Flathub-a.

Šta izvor NE nosi (mora ostati izostavljeno ili jasno označeno kao nepotvrđeno):

- definicija Flatpak-a kao "sistema za pakovanje";
- "puna podrška" za nezavisne repozitorijume;
- obavezno šifrovanje, AES-256, verzija 2.0;
- tvrdnja da je Bubblewrap potreban za rad (izvor: za instalaciju);
- bilo koji broj osim 700.000.
