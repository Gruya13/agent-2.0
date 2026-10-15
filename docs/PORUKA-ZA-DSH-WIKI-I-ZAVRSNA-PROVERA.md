# Uputstvo za dsh — zaštita wiki memorije i zaokruživanje postojećih slojeva

Datum: 15. oktobar 2026.  
Zatečena revizija: `95d2b4a`.  
Po zahtevu korisnika: sledeći prioritet su sigurnost wiki-ja i zaokruživanje/testiranje svih postojećih slojeva, bez dodavanja novih.

## 1. Cilj i granica

Wiki je zajednička memorija coding sistema. Želimo proverljiv integritet izvora, kontrolisanu objavu znanja i ispravno korišćenje memorije. Coding tok, dokumentni tok i održavanje baze treba proveriti kao povezane postojeće funkcije, ne kao tri nove platforme.

U ovoj fazi nema novih uloga, servisa, baza, panela, vektorske pretrage ili opšteg framework-a za bezbednost. Minimalne korekcije postojećih funkcija i regresioni testovi za konkretne nalaze jesu u obimu. Testni fixture i izveštaj nisu novi produkcioni slojevi.

Ne obećavati apsolutnu sigurnost: procesi istog OS korisnika mogu imati direktan pristup fajlovima. Precizno razdvojiti šta zaista ograničava MCP/kontrolni sloj, šta ograničava harnes sandbox i šta ostaje poverenje u lokalnog korisnika. Prompt zabrana nije OS izolacija.

## 2. Prvi konkretan ogled: strani wiki upis kroz coding evidenciju

U `coding.mjs`, funkcija `upisiZapisUMemoriju` piše `wiki/Izmene/<TASK-ID>.md`, a zatim poziva `commitPaths(config.root, ['wiki'], ...)`. To može obuhvatiti više od upravo generisane beleške. Ovo je statički uočena sumnja, ne već izvršen kontraprimer.

U privremenom kontrolnom vault-u ostavi tuđu novu ili izmenjenu wiki belešku. Završi coding zadatak i proveri da li komit njegovog ishoda povuče tu promenu bez odgovarajućeg pregleda. Ako se potvrdi, ograniči upis/komit na tačno opravdan artefakt, uz očuvanje tuđeg radnog stanja. Dodaj regresioni dokaz.

Isti princip proveri u init, reflect/index, audit, consolidate i ručnom ready/retry knjigovodstvu. Ne ponavljati opštu grešku „kontrolni sloj sme sve pa komituje ceo direktorijum”.

## 3. Zapiši postojeće granice i putanje upisa

Kratko popiši sve puteve koji menjaju raw, wiki, zadatke, manifest i dokazne reference: MCP write/patch, direktne kontrolne funkcije, radne grane i prihvatanje kodne promene. Za svaki navedi dozvoljenog pisca, potreban zadatak/zakup, tačne putanje i postojeću proveru.

Posebno razlikovati:
- wiki sadržaj koji je model sastavio i mora proći odgovarajući pregled;
- izvedeni indeks;
- manifest kao osnovu integriteta;
- kontrolno generisan zapis o prihvaćenom coding ishodu.

Zapis coding ishoda nije automatski odobrenje svake rečenice modelskog izlaza. Njegov status i sadržaj treba da znače ono što je zaista dokazano. Ne prepisivati postojeći zapis ili domensko znanje bez jasne namere i traga.

## 4. Minimalna matrica zaštite wiki-ja

Za svaku relevantnu operaciju imati pozitivnu kontrolu i negativan slučaj. Postojeće testove prvo mapirati; nove dodavati za nedostajući stvarni rizik, ne radi broja.

| Oblast | Potreban dokaz |
|---|---|
| zone i identitet | dozvoljeni pisac prolazi; tuđa uloga/vlasnik/token odbijeni |
| zakup | istekao ili preuzet zakup ne dozvoljava upis/objavu; obnova radi u podržanom toku |
| putanje | ../, symlink i realna putanja ne zaobilaze granicu kontrolnog ili ciljnog repoa |
| izvor | promena teksta, binarnih bajtova, brisanje i link ne prolaze neprimećeno |
| manifest | nedostajući ili oštećen manifest ne pretvara se tiho u novu pouzdanu osnovu |
| publikacija | nacrt bez važeće provere ne ulazi u produkciju; postojeća beleška ne postaje dozvoljena meta retry-jem |
| audit | samo postojeće beleške u preciznom opsegu; odbijanje se vraća pravom autoru |
| knjigovodstvo | strani prljavi fajl ne ulazi u automatski komit, ne briše se i ne prikriva |
| izvedeni indeks | odgovara dogovorenom sadržaju i može se regenerisati bez gubitka tuđeg rada |
| dokaz | reference ostaju proverljive u svežem klonu; neuspeh čuvanja dokaza nije uspeh |
| memorija ka kodu | tačno izabrane beleške se izvoze; projektni fajlovi ostaju netaknuti; kontekst se ne objavljuje u ciljnom repou |
| kod ka memoriji | samo prihvaćen rezultat daje zapis uspeha; delimičan neuspeh ne daje lažan potpun uspeh |
| sadržaj memorije | pitanje/hipoteza nije činjenica; ubačene instrukcije u izvoru/memoriji ne dobijaju ovlašćenje da menjaju pravila |

Za test poslednje stavke koristi bezopasan fixture sa instrukcijom da se izmeni zabranjeni probni fajl. Ne izlagati stvarne tajne niti izvoditi nekontrolisane napade. Razlikovati dokaz odbijenog pokušaja od tvrdnje da je svaki prompt injection rešen.

## 5. Zaokružiti sve postojeće slojeve

Napravi jednu tabelu pokrivenosti: sloj, konkretna tvrdnja, postojeći test/ogled, rezultat, revizija i preostalo ograničenje. Obuhvati:

1. YAML i konfiguraciju, obavezna polja, zadatke i prelaze.
2. Fajl operacije, realne putanje, lokalni lock, store, tokene i heartbeat.
3. Git worktree, opseg, rebase/merge i čuvanje dokaza.
4. Adaptere procesa: uspeh, grešku, timeout i prekid; nedostupan vendor ne daje pass.
5. MCP protokol, čitanje i upise po postojećim ulogama.
6. Dokumentni tok, extractor fragmente, verifikaciju, challenge i konsolidaciju.
7. Librarian audit i semantiku opsega kroz ceo tok.
8. Coding tok: reprodukciju, baseline assertion, očuvanje testova, nezavisan pass, pregledani SHA i integracioni rezultat.
9. Wiki memoriju u oba smera, sadržajne granice i indeks.
10. CLI, init, status, lint i oporavak posle prekinute faze.

„Pokriveno” ne znači samo da postoji fajl testa. Navedi šta je stvarno izvršeno i šta taj dokaz ne pokriva. Posebno proveriti slučajeve gde se isti koncept drugačije proverava u dokumentnom i coding toku; ne uvoditi automatski novu zajedničku apstrakciju pre dokaza problema.

## 6. Redosled izvršavanja i nezavisnost

A. Zamrzni početni SHA i sačuvaj postojeće stanje. Svi kvarljivi ogledi rade u privremenim vault-ima i ciljnim fixture repozitorijumima.

B. Prvo proveri i zatvori upise koji mogu promeniti/publikovati tuđe znanje ili izgubiti dokaz. Zatim pozitivne tokove i oporavak. Ne koristiti override radi prolaza.

C. Dsh piše minimalne korekcije i regresione testove. Codex kroz postojeći DSH poziv nezavisno proverava završni relevantni diff i pravi sopstvene kontraprimere. Nije potrebna nova runtime uloga. Poseban fokus nezavisnog pregleda: strani wiki komit, oštećen manifest, direktni upis kontrolnog sloja i veza coding prihvatanja sa memorijom.

D. Na završnoj izvršnoj reviziji pokreni kompletan postojeći skup. Ako prođe, ponovi jednom radi provere stabilnosti. Ako padne, razjasni uzrok umesto preskakanja. Sačuvaj broj testova, komandu, Node/Git verzije i puna ograničenja okruženja.

E. Na istom završnom kodu izvrši minimalan skup povezanih scenarija:
- coding popravka koja koristi wiki i vraća proverljiv zapis;
- dokumentni unos do wiki objave;
- ekstrakcija malog PDF-a/tabele sa referentnim vrednostima;
- audit nekoliko belešaka u preciznom opsegu;
- kontrolisani prekid i nastavak bez neovlašćene objave i bez trajno zarobljenog zakupa.

Fixture procesi i mock su dovoljni za mehaniku negativnih slučajeva. Za tvrdnje o stvarnoj obradi i prenosu harnes identiteta potrebni su stvarni pozivi. Korisnik je ukinuo unapred zadat budžet ukupnih iteracija, poziva i trajanja rada. Nastavi potrebne oglede do završetka obima; ne troši pozive bez dokaznog razloga. Ako neki agent ostane bez tokena ili kvote, sačuvaj stanje i zaustavi rad prema dopuni ispod.

Ne mora svaki negativni slučaj ponovo zvati model. Nezavisne runde rade se ciljano, bez brojčanog limita ciklusa. Poslednju relevantnu popravku mora pratiti pregled ili eksplicitna oznaka da nezavisna potvrda nedostaje. Raniji limit osam plus dva ne važi za ovaj zadatak.

## 7. Kriterijum završetka ove faze

Završetak znači: sve popisane putanje upisa imaju jasnu odgovornost i dokaz u podržanom lokalnom režimu; nema poznatog otvorenog nalaza koji dopušta tihu neovlašćenu objavu/promenu memorije u tom režimu; završni testni skup prolazi; navedeni postojeći tokovi imaju rezultate ili poimenično iskazane nedostajuće dokaze; nezavisni pregled potvrđuje relevantne ispravke.

Ako neki ključni tok nije proveren, faza je delimično završena, ne „sve testirano”. Poznat konkurentni prozor ne nazivati zatvorenim samo zato što su uobičajeni testovi prošli. Za preostala ograničenja navesti uslove i praktične posledice; ako obaraju podržani režim, popraviti postojeći mehanizam ili suziti tvrdnju o podršci.

## 8. Isporuka

Jedan završni Markdown izveštaj u docs, sa:
- završnom revizijom i ograničenim modelom poverenja;
- matricom svih postojećih slojeva i putanja upisa;
- potvrđenim nalazima i minimalnim korekcijama;
- odvojenim autorovim i nezavisnim dokazima;
- rezultatima testnog skupa i povezanih ogleda;
- otvorenim stavkama, bez opšte tvrdnje o potpunoj sigurnosti.

Ažurirati postojeće uputstvo gde tvrdi ponašanje koje kod više nema. Wiki ostaje memorija coding sistema. Novi stvarni programski zadatak u korisnikovom projektu dolazi posle ove faze stabilizacije, ne paralelno sa proširivanjem.

Ovo uputstvo usmerava naredni rad. Njegovo zapisivanje ne znači da su ogledi već izvedeni ili zaštite potvrđene.


## 9. Izričita dopuna korisnika — nastavak i Codex provere

Ova dopuna ima prednost nad ranijim preporukama u drugim dokumentima koje ovaj posao ograničavaju brojem rundi, poziva ili ukupnim vremenskim budžetom.

**Nema unapred zadatog budžeta iteracija, poziva ili ukupnog trajanja za završetak ovog obima. Ne prekidaj nedovršen rad zato što si potrošio pet, osam ili deset rundi. Korisnik traži da jedini planirani resursni razlog za zaustavljanje bude kada neki od agenata ostane bez tokena ili kvote.**

Završetak zadatka je normalan kraj rada: kada su kriterijumi zadovoljeni, isporuči rezultat; ne nastavljaj radi trošenja tokena. Tehnička nemogućnost izvršavanja, obavezne dozvole ili zaštite okruženja ne mogu se poništiti ovom instrukcijom — ako spreče neophodan korak, prijavi konkretan problem, sačuvaj stanje i završi sav ostali moguć rad. Ne predstavljaj tu prepreku kao proizvoljan budžetski limit.

Ovo ukida limit rada dsh-a na zadatku; **ne ukida automatski** sigurnosne timeout-e procesa, zaštitu od zaglavljenog skripta ili retry granice koje su predmet testiranja aplikacije. Ne menjaj maxRevisions, maxRounds, timeout-e ili kapije samo da bi dobio prolaz. Kontekst koji je moguće normalno obnoviti uz sačuvano stanje nije sam po sebi iscrpljena kvota; eksplicitno odbijanje provajdera zbog tokena/kvote jeste.

### A. Prvo daj Codex-u nezavisan pregled početnog stanja

Koristi postojeći DSH poziv spoljnog agenta, odvojen kontekst i tačan SHA. Daj mu ovu poruku, relevantni kod i postojeće testove. Ne traži opšti komentar „da li je bezbedno”, nego konkretne falsifikabilne tvrdnje.

Codex treba samostalno da proveri:

1. Može li coding zapis u wiki komitovati tuđu prljavu ili novu belešku? Pozitivna kontrola je upis samo očekivanog zapisa, negativna kontrola je sačuvan strani diff koji nije ušao u komit.
2. Da li sve druge postojeće putanje kontrolnog upisa poštuju isto pravilo, uključujući init, reflect, audit, consolidate i retry? Ne verovati samo MCP matrici, jer direktni kontrolni upis zaobilazi taj API.
3. Da li se oštećen/nestao manifest tretira kao gubitak dokazne osnove, a ne kao dozvola za tihu novu osnovu?
4. Da li role, vlasnik, token, status i realpath zaista ograničavaju upis u kontrolisanom vault-u? Proveriti pokušaje preko symlink-a i promenjenog kontrolnog korena.
5. Može li odbačeni pokušaj proširiti dozvoljene artefakte, prepisati postojeće znanje ili ostaviti zastareli pass koji odobrava novu verziju?
6. Da li coding memorija čuva projektne fajlove i ostaje kontekst bez ovlašćenja da menja pravila? Izvorna instrukcija u belešci nije operatorsko odobrenje.
7. Da li dokaz posle objave stvarno putuje u zaseban klon i odgovara proveravanom sadržaju, a neuspeh upisa dokaza ostaje vidljiv i oporavljiv?
8. Da li se uspeh coding promene, neuspeh wiki zapisa i status zadatka razlikuju tako da korisnik ne dobija lažan potpun uspeh? Proveriti prekid između tih koraka.

Traži sopstvene fixture-e i kontrolne slučajeve, tačne komande i rezultate. Bez menjanja glavnog workspace-a, stvarnih izvora i korisničkih registracija tokom pregleda. Sačuvati pune odgovore, ne samo sažetak.

### B. Dsh ispravlja, Codex proverava korekciju

Dsh reprodukuje nalaz i minimalno popravlja postojeći modul. Codex zatim dobija novi SHA i zadatak da ponovi svoj prvobitni kontraprimer, proveri negativnu kontrolu i povezane granice koje je promena mogla da otvori.

Ne spajati ulogu autora i konačnog nezavisnog reviewera. Ako Codex piše dijagnostičku skriptu ili test, to je dokaz pregleda. Ako predloži ili napiše produkcionu korekciju, dsh je mora samostalno pregledati i jasno označiti autorstvo; ne predstavljati kasniji Codex pregled sopstvene korekcije kao nezavisan.

Nastavi cikluse dok se potvrđeni problemi koji obaraju dogovoreni obim ne zatvore i poslednja relevantna korekcija ne dobije proveru. Nema brojčanog limita rundi. Ako dva pokušaja ne napreduju, promeni eksperiment ili preispitaj pretpostavku; to je signal za dijagnostiku, ne automatski kraj i ne razlog za novi sloj.

### C. Codex proverava matricu svih postojećih slojeva

Nakon korekcija prosledi mu tabelu iz odeljka 5. Za svaki red traži:
- tačnu tvrdnju i granicu poverenja;
- dokaz na završnoj reviziji, pozitivan i negativan slučaj gde je primenljivo;
- proveru da test pada iz očekivanog razloga na neispravnom kodu;
- šta test ne dokazuje;
- rezultat potvrđeno / oboreno / neprovereno.

Codex treba da proveri i nedostajuće veze između slojeva: zakup tokom testiranja, izolaciju grana, audit opseg pri merge-u, tok greške do retry-ja, dokazne reference posle čišćenja grana, coding prihvatanje i naknadni wiki zapis. Naziv testa ili broj prolaza nije dovoljan dokaz pokrivenosti.

Za semantičke nalaze mora pročitati izvor i tvrdnju; grep različite reči ne dokazuje netačnost. Nezavisni pregled treba da proveri opravdanost blokirajućeg kriterijuma, a ne samo da skript ispisuje OBORENO.

### D. Zaokruži realne oglede, pa nezavisno pregledaj artefakte

Redosled: lokalne negativne probe i korekcije, završni testni skup, zatim postojeći povezani ogledi iz odeljka 6. Ne pokretati skupe modele za slučaj koji može jednako dokazati kontrolisani proces.

Za svaki realni ogled Codex treba da pregleda sačuvane artefakte u svom zasebnom checkout-u/klonu: izvor ili zahtev, diff, testne logove, review SHA, rezultat merge-a, wiki sadržaj, aktivne zakupe i dokazne reference. Dsh-ov opis „prošlo” nije zamena za proveru tih artefakata.

Ako završni pregled zahteva novu korekciju izvršnog koda, ponoviti relevantne testove i zahvaćene oglede na novom SHA. Ne prepisivati istorijske dokaze kao da su nastali na poslednjoj reviziji.

### E. Ako bilo koji agent ostane bez tokena ili kvote

Zaustavi pokretanje daljih agentskih poziva, sačuvaj aktuelni rezultat i jasno prijavi koji agent, koji zadatak i koja poruka provajdera su uzrok. Ne menjaj tiho reviewera drugim vendorom da bi nastavio uprkos ovom korisnikovom uslovu i ne petljaj beskrajno nad odbijenim pozivom.

Bez novih plaćenih poziva uradi bezbedno završno beleženje: SHA, nekomitovane izmene, status zadataka/zakupa, otvorene nalaze, završene dokaze, putanje logova i tačnu prvu akciju za nastavak. Ne prihvataj nepotvrđenu promenu i ne ostavljaj pozadinske procese bez opisa njihovog stanja. Rad označi kao nedovršen zbog resursa, ne kao prolaz.

### F. Završna isporuka

Dsh dostavlja završni izveštaj sa matricom, dokazima, nezavisnim zaključcima i otvorenim ograničenjima. Codex posebno zaključuje da li su dogovorene granice wiki-ja i svi postojeći tokovi u podržanom režimu provereni. Niko ne proglašava potpunu sigurnost ili opštu spremnost samo zato što je skup testova zelen.

Korisnikov prioritet ostaje: zaštititi wiki memoriju, završiti i proveriti postojeće slojeve, bez dodavanja novih.
