# K3 — referentna lista ključnih tvrdnji (pripremljena PRE model poziva)

Izvor: `raw/flatpak.md` (Wikipedia, članak "Flatpak").
Ovu listu je pripremio čovek pre pokretanja toka; ona je mera tačnosti, a ne
tvrdnja da svaka rečenica mora dobiti zaseban test.

| # | Ključna tvrdnja iz izvora | Očekivano u belešci |
|---|---|---|
| 1 | Flatpak se do 2016. zvao xdg-app | mora postojati, sa godinom |
| 2 | Služi za distribuciju softvera i upravljanje paketima na Linuxu | mora postojati |
| 3 | Obezbeđuje sandbox u kome se aplikacije izvršavaju izolovano | mora postojati |
| 4 | Aplikacije traže dozvole za Bluetooth, zvuk (PipeWire), mrežu i fajlove | mora postojati, sa navedenim resursima |
| 5 | Dozvole postavlja održavalac paketa, a korisnik ih može menjati | mora postojati |
| 6 | Programeri mogu da isporučuju ažuriranja direktno, bez distribucija | mora postojati |
| 7 | Zbog sandboxa troši više prostora nego nativni paketi | mora postojati |
| 8 | OSTree uklanja duplikate, pa se prostor kasnije koristi efikasnije | mora postojati |
| 9 | Flathub (flathub.org) je de facto standard | mora postojati |
| 10 | Do 2023. Flathub je imao više od 700.000 preuzimanja dnevno | broj mora biti tačan |
| 11 | Može se hostovati i nezavisni Flatpak repozitorijum | mora postojati |
| 12 | Za instalaciju su potrebni Bubblewrap i OSTree | moraju biti navedeni |
| 13 | Može da radi i na ChromeOS-u | mora postojati |

Šta se NE sme pojaviti: izmišljene nosive činjenice (npr. broj zvezdaica,
verzije, cene), tvrdnje kojih nema u izvoru, i prećutno izostavljanje broja iz
tvrdnje 10.
