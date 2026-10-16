# Dsh — zatvoriti četiri preostale stavke postojeće wiki faze

Datum: 16. oktobar 2026.  
Polazni HEAD: `67765e6`; poslednji prijavljeni izvršni kod: `6081944`.  
Od: Codex, po zahtevu korisnika.

## Cilj i ograničenja

Ne prelaziti na nove funkcije ili novi korisnički coding projekat pre zatvaranja precizno navedenih dokaza. Postojeća wiki memorija, coding tok, dokumentni tok i audit ostaju. Nema novih uloga, servisa, baza, automatskog semantičkog sudije ili dodatnih slojeva.

Prethodna faza je zatvorila stvarne propuste, ali „završena runda rada” nije isto što i dokaz da svi postojeći tokovi uspešno završavaju. Zadrži prethodne rezultate i dopuni ih, bez prepravljanja istorije.

Korisnik je ukinuo fiksni budžet ciklusa/poziva/ukupnog trajanja. Nastavi do završetka obima; ako neki agent ostane bez tokena ili kvote, sačuvaj stanje i stani, bez tihog menjanja vendora radi nastavka. Ne nastavljaj nakon stvarnog završetka radi trošenja tokena. Zaštitni procesni timeout-i, dozvole i retry kapije ostaju; ne povećavaj ih da bi neuspeh izgledao kao prolaz. Obavezne prepreke okruženja prijavi precizno i završi sve što ne zavisi od njih.

## 1. Semantika verifikacije i red-team nalaza

### Šta dsh radi

Pregledaj sporni NALAZ-1 ogleda B: odsustvo reči „Flatpak” u jednoj rečenici ne dokazuje da razrešenje subjekta iz naslova i okolnog teksta menja značenje. Istovremeno, definicija Flathub-a dodata izvan sadržaja konkretnog izvora može biti opravdan nalaz. Ne preglasi sve prethodne nalaze kao lažne i ne proglasi ceo blokirani dokument ispravnim.

Pre sledećeg poziva definiši kratak, primenjiv kriterijum u postojećim brief-ovima/provernom zahtevu:
- proverava se značenje tvrdnje u kontekstu celog izvora, ne identičnost reči;
- razumna parafraza i razrešenje subjekta nisu sami po sebi greška;
- nove činjenice, jači uslovi i neosnovane definicije moraju biti potkrepljeni ili jasno odvojeni;
- otvoreno pitanje ne sme u svojoj formulaciji pretpostaviti nedokazanu činjenicu;
- skript mora dokazivati prekršenu tvrdnju, ne samo tekstualnu razliku.

Pripremi nekoliko malih parova izvor/nacrt: dozvoljena parafraza, prihvatljivo pitanje, promenjen broj, neosnovana definicija i jača tvrdnja od izvora. Koristi ih da pokažeš i prihvatanje dobrog i odbijanje lošeg. Samo promena prompta nije dokaz boljeg ponašanja.

Potom izvrši novi dokumentni ogled u čistom vault-u do objave. Automatsko odbijanje/korekcija je dozvoljeno; nema override-a, ručnog prepisivanja pečata ili naknadne promene kriterijuma. Sačuvaj otvoren neuspeh ako postoji. Ne dodaj univerzalnog novog modelskog arbitra; Codex pregled ovde je nezavisni razvojni dokaz.

### Šta Codex verifikuje

U zasebnom kontekstu pročitaj ceo izvor, nacrt i svaki blokirajući nalaz. Za svaki navedi tačne rečenice, semantičku razliku i razlog da nalaz blokira ili ne blokira. Ponovi skript, ali njegov exit 0 ne prihvataj kao zamenu za sadržajni zaključak. Ne prihvataj ni dsh tvrdnju o ispravnosti bez dokaza.

Nezavisno oceni pozitivne i negativne parove; potvrdi da pravilo ne propušta dodatnu činjenicu samo zato što je skrivena u pitanju. Posle realnog ogleda proveri sačuvani tekst, istoriju, granice upisa i dokazne reference. Ako kriterijum i dalje neopravdano blokira, ostavi nalaz otvorenim umesto „kapija radi pa je sve završeno”.

## 2. PDF tok mora doći do dozvoljene objave

### Šta dsh radi

Sačuvaj dokaz da je prethodna ekstrakcija bila tačna i da je kapija opravdano odbila pogrešnu metu. Utvrdi zašto consolidator bira `wiki/tabela.md` umesto deklarisanog artefakta. Minimalno ispravi postojeći prompt/prenos putanje ili kontrolnu logiku, prema reprodukciji.

Ne proširuj artifacts/opseg samo da bi pogrešno ime prošlo. Ne preimenuj rezultat ručno posle neuspeha. Dodaj smislen kontrolni test za dosledno ime kroz extract, research, verify, challenge i consolidate, uz negativan slučaj druge produkcione mete.

Ponovi mali PDF ogled: tačan hash i lokacija izvora, vrednosti i redovi/kolone fragmenta, sadržajno veran nacrt, važeća provera i objava samo deklarisane beleške. Izvorna tabela neka bude dovoljno mala da se svaka važna ćelija može proveriti.

### Šta Codex verifikuje

Samostalno pregledaj prenose putanja i konkretan diff korekcije. Izvedi kontraprimer sa pogrešnim produkcionim imenom i pozitivnu kontrolu sa pravim. Potvrdi da korekcija nije otvorila tuđu produkcionu metu ili prepisivanje postojeće beleške.

Pregledaj stvarni PDF i fragment, ne samo listu ključnih reči iz izveštaja. Uporedi važne ćelije/brojeve, source_sha256, nacrt i konačnu belešku. U sopstvenom svežem klonu proveri da dokazi odgovaraju toj verziji, a zadatak i indeks odgovaraju stvarno objavljenoj putanji.

## 3. MCP preko stvarnih harnes klijenata

### Šta dsh radi

Trenutni stdio/env testovi nisu dokaz da stvarni agy/dsh/codex klijent prenosi pravi kontekst. U izolovanim fixture vault-ima proveri svaku postojeću ulogu koja koristi MCP, kroz stvarnog klijenta vendora, ne neposrednim node pozivom servera.

Za svaku relevantnu ulogu sačuvaj efektivni vault, ulogu, identitet i task root, bez javnog izlaganja sirovih tokena. Izvedi jedan dozvoljen upis i odbijanje relevantnog nedozvoljenog upisa. Token istog zadatka/procesa ne sme omogućiti tuđoj ulozi drugu zonu. Upis bez važećeg zakupa/tokena mora biti odbijen.

Ne izmišljaj MCP ulogu za programer/reviewer ako ga taj coding tok ne koristi: u matrici navedi „nije putanja MCP upisa” i zasebno proveri stvarni mehanizam koji koriste. Bez novih uloga radi pokrivanja tabele.

Ako registracija zahteva izmenu deljenog korisničkog fajla, preferiraj postojeću task-scoped/privremenu konfiguraciju koju klijent podržava. Ne prepisuj tuđe registracije. Neophodnu trajnu promenu jasno odvoji i poštuj dozvole; ne tvrdi da je živi ogled izvršen ako je prepreka ostala.

### Šta Codex verifikuje

Proveri da log zaista sadrži harnes → MCP tools/call, a ne samo direktni CLI servera ili simulaciju env merge-a. Poveži odgovore sa tačnim worktree-om, kontrolnim korenom, zadatkom i ulogom. Ne zaključuj uspeh iz `mcp list` ili `vault_info` bez upisnog pozitivnog i negativnog slučaja.

Izvedi sopstvenu reprezentativnu proveru putem stvarnog klijenta kad je dostupan, uz očuvanje izolacije. Razlikuj potvrdu svih uloga iz artefakata od uloga koje si lično ponovio. Ako neki klijent ne prenosi kontekst, minimalno popravi postojeću konfiguraciju i potvrdi baš taj poziv.

## 4. Nagli prekid i oporavak

### Šta dsh radi

W6 sada simulira uredan povrat greške harnesa (`exit 3`), pa testni finally ima priliku da očisti stanje. To ne dokazuje oporavak kada kontrolni proces bude naglo ubijen.

Bez plaćenih modela pokreni zaseban kontrolni proces i pomoćni fixture proces u privremenom vault-u. Kontrolisano prekini:
1. kontrolni proces tokom izrade sa aktivnim zakupom;
2. proces posle prihvatanja coding promene u ciljnom repou, a pre dovršetka wiki zapisa/evidencije.

Koristi barijere ili markere u testnom helperu da znaš gde je prekid nastao; ne zasnivaj ogled samo na nasumičnom sleep-u. Testna instrumentacija nije novi produkcioni sloj. Ne ubijaj stvarne korisničke procese.

Pokreni nov kontrolni proces, dozvoli istek/reclaim po postojećim pravilima i dokaži oporavak: stari token ne može upisivati, nema trajno zarobljenog zadatka, nema drugog prihvatanja istog rezultata ili gubitka izvora, a prihvaćena promena i wiki zapis ne tvrde različite ishode. Identifikuj i bezbedno završi zaostali fixture podproces.

Ako prihvatanje već postoji u Git-u, nastavak mora prepoznati stvarno stanje umesto da slepo ponavlja merge/model pozive. Minimalno popravi postojeće vođenje evidencije ako se kontraprimer potvrdi; ne uvodi novu transakcionu bazu.

### Šta Codex verifikuje

Nezavisno ponovi bar jednu stvarnu kill/restart probu i proveri tačan trenutak prekida. Pregledaj Git istoriju, task, evente, zakup, worktree-e i wiki zapis pre/posle novog procesa. Potvrdi da nema tihog delimičnog uspeha i da ista prihvaćena promena nije duplirana. Zasebno označi šta ostaje nepokriveno; ovo nije dokaz otpornosti na svaki nestanak napajanja ili filesystem kvar.

## 5. Redosled i zatvaranje

1. Zamrzni polaznu reviziju i napravi tabelu četiri preostale tvrdnje.
2. Lokalno reprodukuj praznine; dsh radi minimalne korekcije i regresione testove.
3. Codex proverava diff sopstvenim kontraprimerima; dsh zatvara potvrđene nalaze, a Codex proverava poslednju relevantnu korekciju.
4. Na završnoj izvršnoj reviziji pokreni kompletan skup i ponovi jednom ako prođe. Nezavisni reviewer treba da navede da li je izvršio ceo skup ili samo ciljane provere.
5. Izvrši sadržajne i klijentske oglede na istom završnom kodu; sačuvaj izvor, konfiguraciju, referencu, SHA, pozive, istoriju i pune logove. Ako naknadna promena utiče na već odrađen ogled, ponovi zahvaćeni dokaz na novoj reviziji.
6. Codex pravi sopstveni svež klon i proverava završne artefakte, sadržaj, granice i dosežnost dokaza. Autorov „prošlo” nije dovoljan.
7. Ažuriraj postojeću matricu: potvrđeno / oboreno / neprovereno, uz tačne granice. Ne označavaj fazu bezuslovno završenom ako je PDF i dalje neobjavljen, živi MCP nedokazan ili nagli restart nije izveden.

Za Codex koristi postojeći DSH external_agent/verify mehanizam. Daj mu ovaj dokument, tačan kandidat SHA, diff i konkretne dostupne artefakte. Ne traži da popravlja glavni workspace tokom nezavisne provere. Dsh je autor korekcija; Codex reviewer. Ako se autorstvo zameni, označiti stvarnog autora i obezbediti nezavisan pregled.

## 6. Završni kriterijumi i isporuka

Završetak ovog zadatka znači:
- semantičko pravilo pokazuje da razlikuje vernu parafrazu od nedokazane tvrdnje, uz stvarni pregled rezultata;
- PDF primer završava kontrolisanom objavom pravog artefakta;
- stvarni MCP klijenti imaju dokazane relevantne dozvoljene i odbijene operacije;
- restart posle naglog prekida ima proverljiv, neduplikovan završetak;
- relevantni testovi i kompletan skup prolaze na zabeleženoj završnoj reviziji;
- nezavisna provera potvrđuje tačno navedene tvrdnje, uz očuvana ograničenja.

Isporuči jedan dopunski izveštaj u docs i ažuriraj postojeću matricu. Ne prepisuj prethodne neuspehe niti menjaj kriterijume usred ogleda. Ako neka stavka ostane otvorena, navedi razlog i prvu tačnu akciju nastavka. Ne obećavati potpunu sigurnost, potpunu prompt-injection otpornost ili zatvorenost dokumentovanih konkurentnih prozora bez novog dokaza.

Posle zatvaranja ovog obima možemo birati mali stvarni coding zadatak. Sada ne dodavati funkcije da bi se odložila provera postojećih.
