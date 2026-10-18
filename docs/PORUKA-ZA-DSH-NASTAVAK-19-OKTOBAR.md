# DSH — nastavak posle pregleda 19. oktobra 2026.

Od: Codex, po zahtevu korisnika. Zatečeni HEAD: `2a5e52c` (poslednja izmena testova `4406d72`, produkcionog YAML koda `9a66fa6`). Pročitaj [izveštaj prethodne runde](PREOSTALI-DOKAZI-IZVESTAJ.md), ali ocene iz njega dopuni nalazima ispod. Primarni cilj je **coding agent**; wiki je njegova kontrolisana memorija. Ne uvodi nove uloge, servise ni slojeve. Popravljaj postojeće mehanizme i dokazuj ih.

Korisnik nije zadao fiksni broj iteracija ili poziva. Radi dok je obim stvarno završen. Ako neki agent ostane bez tokena/kvote, sačuvaj stanje i stani; ne menjaj tiho vendor da bi zaobišao taj uslov. Procesni timeout-i i sigurnosne kapije ostaju.

## 1. Prvo zatvori nov nalaz u coding/test toku

Na mojoj proveri sa Node `v26.8.2`:

- `node --test --test-isolation=none tests/yaml.test.mjs` → **19/19**.
- `node --test --test-isolation=none --test-name-pattern='^CR1' tests/crash-recovery.test.mjs` → **pad**: nastavak coding zadatka vraća `pad na osnovi nije tvrdnja o ponašanju (vrsta: unknown)`.
- `node --test --test-isolation=none --test-name-pattern='^CR2' tests/crash-recovery.test.mjs` → **pad**: za 30 s nije uhvaćen prozor `accept` bez `memory_write`. Ista proba sa privremeno produženim rokom od 45 s takođe nije uhvatila prozor. Privremena dijagnostička kopija je uklonjena; glavni radni prostor nije izmenjen.
- Jednostavan padajući assertion test pod podrazumevanim Node 26 `node --test` ispisuje generički `test failed`, bez `AssertionError`; sa `--test-isolation=none` ispisuje `AssertionError`. `klasifikujPad` u `coding.mjs` klasifikuje tekstualni izlaz i zato daje `unknown`. Paket deklarira Node `>=20`.

Najpre reprodukuj i sačuvaj **stvarni baseline stdout/stderr i code_evidence** za CR1/CR2 na ovom runtime-u. CR2 trenutno poziva `coding.runCodeTask` za izradu i pregled bez provere `ok`, pa neuspešna priprema može objasniti čekanje na `accept`; ne proglašavaj CR2 zasebnim produkcionim kvarom dok to ne proveriš. U testu dodaj jasne asercije za ishode pripremnih koraka, da sledeći pad pokaže uzrok odmah.

Minimalno popravi podržani coding tok tako da za izvršen regresioni test pouzdano razlikuje assertion od greške importa/sintakse i timeout-a na podržanom Node-u. Ne prihvataj svaki nenulti exit code kao dokaz buga. Dodaj kontrolne slučajeve za očekivani assertion, `TypeError`/grešku importa i timeout. Zatim ponovi CR1–CR3 i ceo skup na **tačnom završnom SHA**. Ako je dostupno više Node verzija, navedi rezultate po verziji; ne prepisuj ranijih 203/203 kao današnju potvrdu na Node 26.

Codex-u kroz postojeći `external_agent/verify` predaj završni SHA, diff, izlaze prvobitnih padova i nove dokaze. Neka sam napravi kontraprimer za klasifikaciju i proveri da CR2 test zaista zahvata fazu posle `accept`, bez duplog merge-a pri nastavku. Ako se pokaže drugačiji uzrok, dokumentuj ga i prilagodi minimalnu korekciju.

## 2. Završi sadržajni dokaz wiki kapije

K14 je **blokiran**, što je opravdan i bezbedan rezultat: četiri nacrta ponavljaju dodatu definiciju Flatpak-a i pretpostavke o heširanju i ulozi Bubblewrap-a pri izvršavanju. Verifikator ih je odbio; produkcijska beleška nije nastala. To dokazuje odbijanje tih loših tvrdnji, ali ne i uspešno sastavljanje dobrog sadržaja na konačnom pravilu.

Ispitaj zašto `researcher` vraća iste premise posle obrazloženih odbijanja. Ako je dovoljno, preciziraj **postojeći** brief/povratnu poruku: definicija entiteta mora biti izvedena iz izvora; otvoreno pitanje ne sme da pretpostavi mehanizam ili ulogu koju izvor nije dao; odbijene premise treba ukloniti, ne samo označiti `nepotvrđeno`. Ne pravi novog arbitra i ne povećavaj retry limit da bi se dobio zelen ishod.

Zatim uradi jedan **nov, čist dokumentni prolaz** sa istim sačuvanim izvorom i referentnom listom zaista zapisanom pre početka izvršavanja. Bez ručnog override-a, pečata ili prepravljanja nacrta. Ako prođe, Codex treba nezavisno da pročita ceo izvor, konačnu belešku, verify/challenge artefakte i dokazne tagove. Ako ponovo ostane blokiran, zabeleži tačne rečenice i prihvati ograničenje umesto lažne objave. Ovo je provera postojećeg wiki sloja; ne odlaži neograničeno mali coding ogled zbog pokušaja da model uvek napiše dobru belešku.

## 3. Uredi dokaze i završi ocenu

Šest MCP uloga imaju sačuvane dozvoljene/odbijene upise. Sačuvani istorijski `agy` logovi ne prikazuju sami `tools/call`; Codex je sam potvrdio protokolski trag za `agy/extractor`, a za `researcher` navedi tačno šta je potvrđeno iz klijentskog rezultata i stanja fajla. Ne piši „svaki istorijski poziv nezavisno protokolski potvrđen“.

U komitovanim MCP logovima red `priprema` sadrži **sirov token zakupa**. Tokene iz aktuelnih dokaza ukloni/rediguj i promeni probnu skriptu da ih ubuduće ne upisuje u log. Proveri da su ti privremeni zakupi istekli ili opozvani. Ne radi destruktivno prepisivanje Git istorije bez posebnog dogovora; naznači da prethodni komiti i dalje sadrže stare, kratkotrajne vrednosti.

Ažuriraj [matricu](WIKI-ZASTITA-I-POKRIVENOST.md) i [izveštaj](PREOSTALI-DOKAZI-IZVESTAJ.md) sa tačnim SHA, Node verzijom, autorom svake provere i ishodom: *potvrđeno, odbijeno ili nedokazano*. U postojećem izveštaju odeljak „Prva akcija nastavka“ još traži Codex potvrdu `4406d72`, iako je ona kasnije zabeležena; uskladi to. Ostavi istorijski PDF ogled vezan za njegovu reviziju. TOCTOU prozore i odsustvo OS izolacije nemoj nazivati zatvorenim.

Pošto coding testovi prođu na deklarisanom runtime-u i Codex potvrdi završnu korekciju, sledeći dokaz primarnog cilja neka bude **mali coding zadatak u zasebnom stvarnom projektu**, sa unapred zadatim zahtevom, granicama izmena i testom. DSH piše popravku i regresioni test; Codex nezavisno proverava diff, sopstveni kontraprimer, bazni pad, završni prolaz, pregledani SHA, merge i wiki zapis. Prijavi i uspeh i granice bez novih arhitektonskih slojeva.
