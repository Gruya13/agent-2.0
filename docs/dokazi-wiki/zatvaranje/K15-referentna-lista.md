# Referentna lista za novi dokumentni prolaz (K15)

Zapisana PRE početka izvršavanja, 19. oktobar 2026.
Izvor: raw/ostree2.md (ista sačuvana kopija kao u K12/K14).

Tvrdnje koje izvor nosi:

1. OSTree je tehnologija za verzionisanje fajl sistema; čuva sadržaj kao objekte.
2. Flatpak koristi OSTree za deduplikaciju: identične datoteke se čuvaju jednom.
3. Flatpak aplikacije se izvršavaju u sandbox-u.
4. Dozvole: Bluetooth, zvuk (PipeWire), mreža, fajlovi.
5. Dozvole konfiguriše održavalac; korisnik ih može naknadno menjati.
6. Flathub (flathub.org) je de facto standard; do 2023. više od 700.000 preuzimanja dnevno.
7. Za instalaciju su potrebni Bubblewrap i OSTree.
8. Moguće je hostovati repozitorijum nezavisan od Flathub-a.

Šta izvor NE nosi (mora ostati izostavljeno ili jasno odvojeno kao nepotvrđeno):

- definicija Flatpak-a kao "sistema za pakovanje";
- uloga Bubblewrap-a u izvršavanju (izvor: za instalaciju);
- heširanje / kriptografski algoritam;
- "puna podrška" za nezavisne repozitorijume;
- bilo koji broj osim 700.000.

Kriterijum za ocenu objavljenog teksta: tvrdnje odgovaraju celom izvoru;
parafraza ne menja značenje; definicije i uslovi nisu dodati bez osnova;
otvorena pitanja ne kriju nove činjenice; datumi/artefakti/granice/dokazni
tagovi su ispravni.
