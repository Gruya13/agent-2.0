---
title: Flatpak
created: 2026-10-14T08:19:46.202Z
updated: 2026-10-14T10:27:20.000Z
authors:
  - researcher
status: draft
tags:
  - linux
  - paketi
  - sandbox
---

# Flatpak

## Sažetak

Flatpak (do 2016. godine poznat kao xdg-app) je uslužni program za distribuciju softvera i upravljanje paketima za Linux. Obezbeđuje okruženje peščanika (sandbox) unutar koga korisnici mogu da pokreću aplikativni softver u izolaciji od ostatka sistema. Aplikacije koje koriste Flatpak zahtevaju dozvole za pristup resursima poput Bluetooth-a, zvuka (uz PipeWire), mreže i datoteka, koje konfiguriše održavalac, a korisnici ih mogu naknadno menjati. Flatpak omogućava autorima aplikacija direktnu isporuku ažuriranja krajnjim korisnicima bez posredovanja Linux distribucija i bez zasebnog pakovanja i testiranja za svaku distribuciju. Iako zbog ABI-stabilnih biblioteka u peščaniku inicijalno koristi više prostora, tehnologija OSTree deduplikuje podudarne datoteke čineći skladištenje efikasnijim sa većim brojem paketa. Centralizovani repozitorijum Flathub predstavlja de facto standard za pribavljanje Flatpak aplikacija, uz podršku za postavljanje nezavisnih repozitorijuma.

## Ključne tvrdnje

1. **Namena i izolacija u peščaniku (sandbox)**:
   Flatpak (do 2016. poznat kao xdg-app) je uslužni program za distribuciju softvera i upravljanje paketima za Linux. Obezbeđuje okruženje peščanika unutar koga korisnici mogu da pokreću aplikativni softver („aplikacije”) u izolaciji od ostatka sistema.
   *(Izvor: `raw/flatpak.md`, red 7)*

2. **Sistem dozvola i pristup resursima**:
   Aplikacijama koje koriste Flatpak potrebne su dozvole za pristup resursima kao što su Bluetooth, zvuk (uz PipeWire), mreža i datoteke. Ove dozvole konfiguriše održavalac Flatpak-a, a korisnici ih mogu dodavati ili uklanjati na svom sistemu.
   *(Izvor: `raw/flatpak.md`, red 9)*

3. **Direktna isporuka ažuriranja i nezavisnost od distribucija**:
   Ključna mogućnost Flatpak-a omogućava autorima aplikacija da direktno isporučuju ažuriranja korisnicima, bez prolaska kroz Linux distribucije i bez potrebe za odvojenim pakovanjem i testiranjem aplikacije za svaku pojedinačnu distribuciju.
   *(Izvor: `raw/flatpak.md`, red 11)*

4. **Potrošnja prostora i deduplikacija (OSTree)**:
   Budući da Flatpak radi u peščaniku koji pruža zasebnu, ABI-stabilnu verziju zajedničkih sistemskih biblioteka i interfejsa operativnog sistema, on koristi više prostora na sistemu od uobičajenih nativnih paketa. Međutim, tehnologija OSTree koja leži u osnovi Flatpak-a vrši deduplikaciju podudarnih datoteka, pa se dodavanjem većeg broja paketa prostor na sistemu koristi efikasnije.
   *(Izvor: `raw/flatpak.md`, red 13)*

5. **Flathub kao centralizovani de facto standard**:
   Flathub, centralizovani repozitorijum (udaljeni izvor / *remote source* u Flatpak terminologiji) na adresi flathub.org, de facto je standard za pribavljanje aplikacija upakovanih Flatpak-om. Pakete prilažu administratori Flathub-a i programeri aplikacija, uz izraženu preferenciju za prijave direktno od autora aplikacija. Do 2023. godine Flathub je imao više od 700.000 preuzimanja dnevno.
   *(Izvor: `raw/flatpak.md`, red 15)*

6. **Podrška za nezavisne repozitorijume**:
   Iako je Flathub de facto izvor za aplikacije upakovane Flatpak-om, moguće je hostovati Flatpak repozitorijum koji je nezavisan od Flathub-a.
   *(Izvor: `raw/flatpak.md`, red 17)*

7. **Prenosivost i sistemski preduslovi (Bubblewrap, OSTree)**:
   Teoretski, Flatpak aplikacije se mogu instalirati na bilo kojoj postojećoj i budućoj Linux distribuciji, uključujući i one instalirane uz sloj kompatibilnosti Windows Subsystem for Linux (WSL), sve dok su dostupni Bubblewrap i OSTree. Takođe se može koristiti na sistemima zasnovanim na Linux kernelu kao što je ChromeOS.
   *(Izvor: `raw/flatpak.md`, red 19)*

## Entiteti

- **Flatpak (xdg-app)**: Uslužni program za distribuciju softvera i upravljanje paketima za Linux koji obezbeđuje okruženje peščanika za izolovan rad aplikacija.
- **Flathub (flathub.org)**: Centralizovani repozitorijum (udaljeni izvor) i de facto standard za nabavku Flatpak aplikacija.
- **OSTree**: Tehnologija u osnovi Flatpak-a koja deduplikuje podudarne datoteke.
- **Bubblewrap**: Sistemska komponenta koja uz OSTree predstavlja preduslov za pokretanje Flatpak-a na Linux sistemima.
- **PipeWire**: Podsistem za zvuk preko koga Flatpak aplikacije, uz definisane dozvole, ostvaruju pristup zvuku.
- **WSL (Windows Subsystem for Linux)**: Sloj kompatibilnosti na kome je teoretski moguće instalirati Flatpak aplikacije uz Bubblewrap i OSTree.
- **ChromeOS**: Operativni sistem zasnovan na Linux kernelu na kome se Flatpak može koristiti.

## Veze ka postojećim konceptima

- U trenutnom stanju skladišta (`wiki/`), ne postoje prethodno konsolidovane beleške o srodnim konceptima (kao što su Linux, upravljanje paketima, Bubblewrap, OSTree, PipeWire, Flathub ili WSL).
- U skladu sa ugovorom sistema (`.agents/AGENTS.md`) i pravilom da se ne kreiraju pretpostavljene semantičke veze ka nepostojećim člancima niti veštačke veze ka indeksu, u ovom nacrtu nema novih Vikilinkova.

## Otvorena pitanja

1. **Praktična ograničenja i podrška na WSL i ChromeOS okruženjima**:
   Izvor (`raw/flatpak.md`, red 19) konstatuje da se aplikacije „teoretski” mogu instalirati na bilo kojoj Linux distribuciji, uključujući WSL i ChromeOS uz Bubblewrap i OSTree. Izvor ne sadrži podatke o grafičkim performansama (GUI rendering), hardverskoj akceleraciji niti potencijalnim integracionim problemima u ovim okruženjima (`nepotvrđeno u izvoru`).

2. **Bezbednosni model i kontrola paketa na Flathub-u**:
   Izvor (`raw/flatpak.md`, red 15) navodi doprinose administratora i programera, ali ne navodi detalje o proceduri verifikacije izvornog koda, odobravanju osetljivih sistemskih dozvola niti mehanizmima zaštite od zlonamernog koda (`nepotvrđeno u izvoru`).

3. **Tehnički protokol za nezavisne repozitorijume**:
   Izvor (`raw/flatpak.md`, red 17) navodi da je moguće hostovati nezavisne repozitorijume, ali ne pruža tehničku specifikaciju protokola, strukturu metapodataka niti način potpisivanja i distribucije bezbednosnih ključeva (`nepotvrđeno u izvoru`).

4. **Metodologija statistike preuzimanja**:
   Izvor (`raw/flatpak.md`, red 15) beleži preko 700.000 preuzimanja dnevno do 2023. godine, ali u tekstu nije navedeno da li se ova cifra odnosi na kompletne instalacije novih aplikacija, inkrementalna ažuriranja deljenih paketa ili ukupan broj mrežnih zahteva ka repozitorijumu (`nepotvrđeno u izvoru`).
