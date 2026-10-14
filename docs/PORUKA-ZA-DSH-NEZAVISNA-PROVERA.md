# Poruka za dsh — nezavisnost provere i podela odgovornosti

Datum: 14. oktobar 2026.  
Od: Codex, po zahtevu korisnika.  
Za: dsh koji razvija i proverava Agent 2.0.  
Zatečeni HEAD pri ostavljanju poruke: `6735b6c`.

## Problem koji korisnik želi da adresiramo

Dsh trenutno vodi razvoj, menja kontrolni kod, piše regresione testove i sastavlja izveštaje. U izvršnom sistemu isti vendor obavlja verifier i red-team uloge. Korisnik je opravdano zabrinut što jedna strana istovremeno oblikuje mehanizam, njegove provere i tumačenje rezultata.

Izvršni orkestrator jeste deterministički Node program agentctl, a ne model koji slobodno odlučuje o svakoj fazi. Ipak, razvoj tog programa i njegovih testova trenutno vodi dsh. Zato tvrdnju o nezavisnosti ne možemo zasnivati samo na odvojenim nazivima uloga, sesijama ili zonama upisa.

Odvojeni dsh verifier i red-team pozivi jesu dva pregleda, ali dele vendor i mogu deliti slepe tačke. Obrnuto, mogu i međusobno pooštravati kriterijume do blokade bez dovoljnog sadržajnog razloga. Pokretanje red-team skripta dokazuje njegov izvršni rezultat; ne potvrđuje automatski da predikat skripta predstavlja stvarno kršenje zahteva.

Primer: grep koji dokazuje prisustvo reči koje nema doslovno u izvoru nije sam po sebi dokaz netačne parafraze. Razlikovati semantički dodatak koji menja značenje, razumnu parafrazu i nepreciznost revizorskog izveštaja. Ne tretirati ih automatski kao jednako ozbiljnu grešku produkcionog sadržaja.

## Šta već imamo kao dobru osnovu

Codex je u prethodnim nezavisnim rundama pisao sopstvene kontraprimere i obarao dsh-ove popravke. To je stvaran dokaz korisnosti odvojenog pregleda. Nastavimo taj obrazac, bez novog agenta u konfiguraciji i bez još jedne automatske kapije.

Prolaz postojećeg testnog skupa ostaje potreban, ali autorovi testovi sami ne potvrđuju da je autor ispravno definisao problem. Ni različit vendor ne garantuje tačnost: važni su nezavisno izveden dokaz, jasni kriterijumi i vidljiva ograničenja.

## Predlog sanacije bez novih slojeva

### 1. Razdvojiti izvršioca i konačnu proveru

- Dsh ostaje izvršilac: dijagnostikuje, menja kod i piše regresione testove za konkretne nalaze.
- Codex proverava završnu relevantnu promenu u zasebnom kontekstu i na označenoj reviziji. Dobija zahtev, diff, reprodukcioni postupak i falsifikabilne tvrdnje, bez obaveze da prihvati autorovo obrazloženje.
- Nezavisna provera treba da uključi sopstveni kontraprimer ili kontrolni scenario, ne samo ponovno izvršavanje testova koje je napisao dsh.
- Autor ne zatvara nalaz oznakom „nezavisno potvrđeno” na osnovu svog ponovljenog testa. Jasno navesti ko je šta proverio.

Ovo je dogovor razvoja i pregleda, ne nova runtime uloga. Nije potrebno menjati raspodelu šest postojećih uloga pre nego što dokažemo osnovni tok.

### 2. Zamrznuti kriterijume pre sledećeg ogleda

Za konkretan ogled unapred zapisati: koju tvrdnju proveravamo, šta je neuspeh, šta je dozvoljena parafraza, koji artefakt je predmet pregleda i koja revizija nosi dokaz. Razdvojiti grešku nacrta, grešku kontrolne evidencije i grešku samog postupka provere.

Nalaz kontrolnog sloja ne vraćati istraživaču kao da može da popravi stanje koje proizvodi orkestrator. Evidentirati uzrok i minimalno korigovati odgovarajući postojeći modul. Ne ublažavati kriterijum naknadno samo da bi započet ogled prošao.

### 3. Ograničiti autoritet red-team nalaza na ono što dokazuju

Za svaki blokirajući nalaz navesti:

1. zahtev ili invarijantu koju krši;
2. tačan artefakt i reviziju;
3. očekivani i stvarni rezultat;
4. zašto skript proverava baš tu tvrdnju;
5. negativnu kontrolu kada je primenljiva.

Ako je sporno samo semantičko tumačenje, tražiti nezavisan sadržajni pregled konkretnog nalaza. Skriptov exit 0 i OBORENO ne rešavaju spor o ispravnosti njegovog kriterijuma. Do odluke spor ostaje vidljiv i nerešen; ne pretvarati ga tiho u clean i ne koristiti rutinski override da se dobije prolaz.

Za sintaksu, hash, putanju, zakup i Git dosežnost izvršni dokaz može biti direktan. Za značenje parafraze neophodno je pročitati izvor i tvrdnju. Bez novog univerzalnog „sudije” ili dodatnog evaluacionog servisa.

### 4. Izveštavati sa jasnim poreklom dokaza

U postojećem Markdown izveštaju odvojiti:

| Kategorija | Šta upisati |
|---|---|
| Autorova provera | dsh komanda, revizija i rezultat |
| Nezavisna provera | ko je proverio, sopstveni ogled i zaključak |
| Sadržajni pregled | koje tvrdnje su poređene sa izvorom i po kom kriterijumu |
| Preostalo | neizvršeno, nepotvrđeno ili sporno |

Ako nezavisna provera nije izvršena, napisati upravo to. Razlikovati broj prolaznih testova, prolaz realnog toka i kvalitet sadržaja. Ne predstavljati nekoliko dsh sesija kao više nezavisnih vendora.

## Primena na posao koji je sada u toku

Pri ostavljanju ove poruke zatečen je komit `6735b6c` o usklađenom zapisu zadatka u challenge reviziji i lokalni K7 fajlovi. Njihov konačan rezultat ovom porukom nije pregledan ni potvrđen.

Za tu promenu prvo pripremiti lokalni dokaz da red-team dobija odgovarajući nacrt i proverljivu evidenciju iste verzije, uz očuvanu vezu sa verifikacionim pečatom. Nezavisni reviewer treba da proveri i da sinhronizacija nije samo prikrila zastareli dokaz ili promenila verifikovani sadržaj.

Ako je plaćeni ogled već aktivan, ne prekidati ga samo zbog ove poruke i ne menjati mu kriterijume usred rada. Sačuvati ishod i reviziju, pa primeniti dogovor pre narednog pokušaja. Ne pokretati dodatne serije samo radi dobijanja zelenog rezultata.

## Kriterijum da smo problem ublažili

Problem smatramo praktično ublaženim kada relevantnu završnu korekciju pregleda strana koja je nije napisala, kada blokirajući red-team nalaz ima opravdan kriterijum, a izveštaj jasno razlikuje autorove i nezavisne dokaze. To ne znači da smo dokazali potpunu nezavisnost modela ili uklonili sve rizike.

Traženi naredni izlaz dsh-a: kratak odgovor u postojećem izveštaju — šta prihvataš iz ove poruke, koja revizija ide na nezavisan pregled, šta je već provereno i šta ostaje otvoreno. Bez novih uloga, servisa i arhitektonskih slojeva.


## Dopuna po instrukciji korisnika: pozovi Codex kroz DSH Harness

Korisnik je izričito potvrdio da možeš koristiti postojeću mogućnost DSH Harness-a da pozove Codex i prosledi mu zadatak. Za aktuelnu korekciju to preporučujem. Koristi postojeći mehanizam poziva spoljnog agenta, bez nove integracije i bez nagađanja CLI sintakse.

Pripremi jednu nezavisnu proveru završne relevantne revizije. Trenutni kandidat je `6735b6c`; ako si u međuvremenu korigovao kod, prosledi tačan novi SHA i navedi polaznu reviziju. Za početni pregled dovoljan je jedan Codex poziv. Ako dobiješ dokaziv nalaz, ispravi konkretan problem i zatraži ciljanu ponovnu proveru. Ne organizuj neograničenu seriju rundi radi formalnog pass-a.

### Zahtev za prosleđivanje Codex-u

```text
Radiš nezavisan pregled korekcije Agent 2.0 sistema. Nisi autor promene.

Repozitorijum: /home/gru/Projects/Agent 2.0
Polazna revizija: b345b47
Kandidat: <DSH upisuje tačan završni SHA; početni kandidat 6735b6c>

Problem:
Tri stvarna tekstualna prolaza završila su u blocked. Deo red-team nalaza
odnosio se na zastarelu evidenciju zadatka u zamrznutoj grani verifikatora,
a ne na nacrt koji istraživač može da popravi. Korekcija treba da obezbedi
usklađen i proverljiv snimak za challenge bez gubitka nezavisnosti provere.

Ulaz:
- diff polazne i kandidatske revizije;
- docs/DOKAZI-PONOVLJIVOST.md kao zapis prethodnog ponašanja;
- relevantni moduli pipeline, store, worktree i Git pomoćne funkcije;
- relevantni postojeći testovi;
- putanje stvarnih K7 dokaza, ako su već nastali, bez autorovog zaključka.
DSH treba da navede stvarne putanje i dostupnost svih artefakata.

Tvrdnje koje treba nezavisno proveriti:
1. Zamrznuta challenge revizija sadrži tačan nacrt koji je dobio poslednji
   važeći verifikacioni pass; proveri bajtove/blobove, ne samo imena fajlova.
2. Podaci koji se predstavljaju kao aktuelna verifikacija odnose se na taj
   artefakt. Stari nalazi mogu ostati istorija, ali se ne predstavljaju kao
   trenutno stanje. Vremenski snimak nije obavezan da sadrži sopstveni budući
   challenge rezultat ili samoreferencijalni commit hash.
3. Reference koje se navode kao reproduktivni dokaz dostupne su u svežem
   klonu ili u eksplicitno sačuvanom dokaznom paketu koji provera stvarno
   dobija. Ne oslanjaju se prećutno na dangling objekte deljenog object store-a.
4. Sinhronizacija ne menja verifikovani sadržaj, ne izmišlja pass i ne
   zaobilazi zakup, dozvoljene zone ili obaveznu challenge kapiju.
5. Posle prethodnog fail-a/challenge nalaza nova verifikacija i nova
   challenge revizija ne zamenjuju identitet artefakta zastarelim dokazom.

Metod:
- Radi u odvojenom checkout-u/worktree-u i privremenim fixture vault-ima.
- Ne menjaj glavni workspace, korisničke registracije, izvore ili zadatke.
- Ne popravljaj kandidat tokom pregleda.
- Izvedi bar jedan sopstveni kontrolni scenario/kontraprimer za promenu;
  ponovno izvršavanje autorovih testova nije jedini dokaz.
- Ne pozivaj plaćene sadržajne harnese i ne dodaj novu infrastrukturu.
- Ako okruženje spreči proveru, navedi tačnu prepreku i ostavi je neproverenom.

Odvojeno pregledaj jedan ili dva reprezentativna semantički sporna nalaza
iz prethodnih prolaza, ako su izvor, nacrt i skript dostupni. Utvrdi da li
skript dokazuje promenu značenja ili samo odsustvo identične reči u izvoru.
Ne prihvataj automatski ni tvrdnju red-teama ni tvrdnju autora da je parafraza
ispravna. Za svaki zaključak citiraj konkretne rečenice i objasni razliku.
Ako je pristup tim artefaktima nedostupan, to nije prepreka pregledu koda;
navedi ograničenje sadržajne provere.

Izlaz:
- pregledana revizija i okruženje;
- tabela tvrdnja / potvrđeno, oboreno ili neprovereno / dokaz;
- za nalaz: zahtev, fajl/linija, komanda, očekivano i stvarno;
- sopstveni scenario i rezultat, uz negativnu kontrolu gde je primenljiva;
- odvojeni zaključak o sadržajno spornim nalazima;
- ograničenja i jasna preporuka da li je opravdan jedan sledeći realni ogled.

Ovo nije zahtev za sertifikovanje celog sistema. Ne proglašavaj potpunu
bezbednost ili ponovljivost na osnovu ovog ograničenog pregleda.
```

### Šta uraditi sa odgovorom

Sačuvaj izvorni Codex odgovor ili tačnu putanju njegovog loga uz postojeći izveštaj, sa revizijom i komandama. U svom sažetku odvoji šta je Codex stvarno potvrdio od sopstvenih dodatnih tumačenja. Ako dobiješ dokaziv nalaz, minimalno ga popravi u postojećem modulu. Ako ostane spor o značenju sadržaja, zabeleži ga bez prećutnog preglasavanja i predstavi korisniku konkretne dokaze.

Ne treba da čekaš da autor ove poruke lično izvrši svaku proveru: upravo postojeći DSH → Codex poziv treba da obezbedi nezavisan pregled. Ova dopuna daje konkretan zadatak za taj poziv; sama po sebi ne znači da je poziv već izvršen ili da je kandidat prošao.


## Dopuna: razuman budžet iteracija razvoja i nezavisne provere

Korisnik je ukazao da se rad ponekad prekida posle približno pet iteracija i tražio predlog povećanja koje ima smisla.

**Preporuka: za jedan jasno ograničen razvojni problem dati do osam ciklusa ispravka → nezavisna provera, uz rezervu za najviše dva dodatna ciklusa kada postoji dokaz napretka. Ukupan maksimum je deset, ne obavezna kvota koju treba potrošiti.** Ovo je početna radna preporuka, ne broj koji je projekat eksperimentalno optimizovao.

U postojećim dokazima Koraka 1 budžet od četiri Codex poziva završen je pre nezavisne provere poslednje popravke. To opravdava više prostora za zatvaranje konkretnog problema, ali ne dokazuje da je svaka duža serija korisna. Pet nije univerzalni limit aplikacije: isporučeni YAML ima maxRounds=10 i maxRevisions=3, a to su druge vrste granica.

### Šta tačno brojimo

- Jedan razvojni ciklus znači: konkretan nalaz, minimalna korekcija, lokalni regresioni dokaz i jedan nezavisni pregled označene revizije.
- Unutrašnji pozivi alata tokom jednog Codex zadatka nisu zasebne razvojne iteracije. Reviewer treba da dobije dovoljno prostora da izvrši sopstveni ogled; ne prekidati ga posle pet shell komandi.
- Pipeline maxRounds broji prolaze raspoređivača, a maxRevisions trenutno zavisi od review istorije. Njih ne povećavati automatski zbog ove preporuke.

### Kako koristiti osam plus dva

1. Prvi Codex pregled obuhvata relevantnu promenu i sopstveni kontraprimer.
2. Sledeći pregledi ciljaju potvrđene nalaze i njihove posledice; ne zahtevaju svaki put novu reviziju celog sistema.
3. Sačuvati prostor za nezavisni pregled poslednje popravke. Ako je budžet pri kraju, ne predstavljati autorov prolaz testa kao zamenu za taj pregled.
4. Dodatna dva ciklusa koristiti kada je preostala konkretna mala ispravka, prethodni nalaz zatvoren i završna potvrda deluje dostižno. Ako završni pregled otkrije novi problem, upisati ga kao otvoren, ne forsirati pass.
5. Zaustaviti ranije čim su dogovorene tvrdnje potvrđene, relevantne regresije prošle i nema otvorenog blokirajućeg nalaza. Ne tražiti nove probleme samo radi trošenja kvote.

### Kada stati i pre limita

Ako dva uzastopna ciklusa ne daju novi dokaz ili ne smanjuju preostali problem, napraviti presek umesto automatskog nastavka. Ako se isti uzrok vraća kroz više varijanti, preispitati postojeću implementaciju i kriterijum. Ako nalaz pripada drugom problemu, zapisati ga odvojeno osim ako direktno obara ciljnu tvrdnju. Dokumentovano nepodržan režim ne pretvarati neprimetno u novi obim.

Broj ciklusa pratiti zajedno sa stvarnim trajanjem i potrošnjom. Pre serije odrediti vremenski/troškovni plafon prema konkretnom zadatku i raspoloživom budžetu; proširenje sa pet na osam nije dozvola za neograničene pozive. Na plafonu sačuvati nalaze i tačno napisati šta nedostaje.

Ova dopuna zamenjuje raniju usku preporuku „jedan početni poziv” samo u pogledu dozvoljenog nastavka kada su potrebne dokazive korekcije. Jedan poziv i dalje je dovoljan ako uspešno završi pregled.

### Posebno za stvarne sadržajne prolaze

Ne povećavati sada maxRevisions samo da tri blocked vault-a konačno završe. Zastarela evidencija i pogrešno adresirana korekcija ne rešavaju se dodatnim istraživačkim pokušajima. Posle ispravke uzroka prvo pokrenuti jedan realni ogled, pa proceniti da li granica sadržajnih revizija stvarno sprečava napredak. Svaka buduća promena te granice mora imati sopstveno obrazloženje i jasno definisan brojač.

Ovde je ostavljen predlog budžeta saradnje; konfiguracije projekta i korisničkih harnesa nisu menjane.
