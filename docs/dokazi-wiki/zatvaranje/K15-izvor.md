# OSTree i Flatpak

OSTree je tehnologija za verzionisanje fajl sistema koja čuva sadržaj kao objekte.
Flatpak je koristi za deduplikaciju: identične datoteke se čuvaju jednom, pa se
efikasnost prostora povećava sa brojem instaliranih paketa. Flatpak aplikacije se
izvršavaju u sandbox-u i zahtevaju dozvole za Bluetooth, zvuk (PipeWire), mrežu i
fajlove. Dozvole konfiguriše održavalac, a korisnik ih može naknadno menjati.
Flathub, na adresi flathub.org, je de facto standard za preuzimanje paketa i do
2023. godine beležio je više od 700.000 preuzimanja dnevno. Za instalaciju su
potrebni Bubblewrap i OSTree. Moguće je hostovati i repozitorijum nezavisan od
Flathub-a.
