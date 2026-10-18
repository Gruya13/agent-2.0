# Dsh — završiti preostale dokaze, bez širenja obima

Datum: 17. oktobar 2026.  
Zatečeni HEAD: `958d3a6`; poslednja izvršna izmena: `8e55194`.  
Od: Codex, po zahtevu korisnika.

## Cilj

Prethodna runda donela je uspešan PDF tok, stvarne SIGKILL probe, šest sadržajnih parova i žive MCP provere za dve uloge. Sačuvaj te rezultate. Sada zatvori precizno preostale dokaze; ne proglašavaj sve uloge ili poslednju reviziju potvrđenim na osnovu delimičnog istorijskog rezultata.

Nema novih uloga, servisa, univerzalnih sudija ili novih arhitektonskih slojeva. Kod menjati minimalno, samo ako konkretna provera potvrdi problem. Wiki ostaje zaštićena memorija coding agenta.

Korisnik nije postavio fiksni budžet iteracija, poziva ili ukupnog rada. Nastavi do završetka obima. Ako neki agent ostane bez tokena/kvote, sačuvaj stanje i stani bez tihog zaobilaženja tog uslova drugim vendorom. Procesni timeout-i i zaštitne kapije ostaju. Kada je zadatak gotov, završi; ne troši dodatne pozive bez razloga. Stvarne prepreke dozvola/okruženja prijavi i završi nezavisne korake koje možeš.

## 1. Nezavisna potvrda poslednje YAML korekcije

### Dsh

Prvo daj Codex-u tačan kandidat SHA koji uključuje `8e55194`, njegov diff i postojeće YAML testove. Ne predstavljaj raniji pregled revizije `62f7e3b` kao potvrdu kasnije korekcije.

### Codex

U odvojenom checkout-u, bez menjanja glavnog workspace-a:
- ponovi sopstveni kontraprimer sa tabom u indentaciji blok skalara; očekuje se jasno odbijanje, ne tiho skraćen tekst;
- izvedi negativnu kontrolu na roditeljskoj neispravnoj reviziji;
- proveri da dozvoljen tab unutar pravilno uvučenog sadržaja ostaje sadržaj;
- proveri frontmatter parse/serialize/parse za stvarne višelinijske izveštaje, uključujući prazne redove i završne prelome;
- navedi šta je ispravljeno, a koji raniji opšti clip/keep/folded rubovi ostaju.

Ne traži punu usaglašenost sa celim YAML standardom. Ali nemoj bez provere ponoviti tvrdnju da poznati rubovi „ne utiču na projekat”: pronađi stvarne korisnike parsera i ustanovi mogu li učitati takav blok u konfiguraciji ili frontmatter-u. Ako mogu, minimalno ispravi problem ili jasno odbij nepodržani ulaz umesto tihog menjanja sadržaja. Ako nisu dosežni u podržanom putu, obrazloži ograničenje konkretnim pozivima i probom.

Ako ova provera traži korekciju, označi novi završni SHA i nezavisno proveri baš tu korekciju pre konačnih ogleda.

## 2. Stvarni MCP klijenti za preostale relevantne uloge

### Dsh

Postoje dokazi za Codex/consolidator i dsh/verifier. Dopuni matricu za:
- agy/researcher;
- agy/extractor;
- dsh/red-team;
- Codex/librarian.

Za svaku napravi izolovan vault, odgovarajuću vrstu zadatka, ispravan status i živ zakup. Pozovi MCP kroz stvarni harnes klijent. Sačuvaj jedan dozvoljen upis u sopstvenu zonu i jedan odbijen upis u tuđu/nedozvoljenu putanju. Za librarian proveri postojeću belešku u tačnom audit opsegu i odbijanje van opsega; extractor mora koristiti fragment zonu.

U odsustvu kvote za neki vendor važi korisnikov uslov za zaustavljanje. Ako poziv zaglavi ili vrati grešku integracije, dijagnostikuj uzrok bez prikrivanja neuspeha kao „nije potrebno”. Ne menjaj deljene korisničke registracije naslepo; koristi podržanu privremenu konfiguraciju gde je moguće.

Ne uvodi MCP role za programer/reviewer ako njihov postojeći tok ne koristi MCP. Njih označi kao drugi mehanizam, već proveravan coding ogledom.

### Codex

Proveri da su to harnes → MCP tools/call pozivi, ne direktni `node ... write` ili env simulacija. Poveži efektivnu ulogu, identitet, task root, vault i odgovor sa stvarnim pokušajem. Sirove tokene ne objavljuj.

Samostalno ponovi reprezentativan slučaj druge uloge istog vendora, jer je statično fiksiranje prve uloge ranije bilo greška. Razlikuj lično ponovljene provere od pregleda sačuvanih logova svih uloga. `mcp list` i `vault_info` sami nisu upisni dokaz.

## 3. Jedan novi dokumentni prolaz sa konačnim semantičkim pravilom

### Dsh

Ogled k12f završio je objavom, ali nezavisni pregled našao je nepotkrepljenu definiciju „sistem za pakovanje”. Par P6 je posle toga uveden i prolazi, ali to nije nov sadržajno prihvaćen realni rezultat.

Na završnom kodu i brief-ovima napravi novi čist vault sa istim sačuvanim izvorom i unapred zapisanom referentnom listom. Izvrši postojeći dokumentni tok do objave. Dozvoljene su automatske korekcije, ne override ili ručno menjanje pečata/sadržaja/statusa. Nemoj popravljati staru belešku i predstavljati to kao nov automatski prolaz.

Kriterijum: tvrdnje odgovaraju celom izvoru, parafraza ne menja značenje, definicije i uslovi nisu dodati bez osnova, otvorena pitanja ne kriju nove činjenice, datumi/artefakti/granice/dokazni tagovi su ispravni. Novi neuspeh sačuvaj i dijagnostikuj; ne povećavaj retry limite radi zelenog ishoda.

### Codex

U sopstvenom svežem klonu pregledaj konačnu belešku prema celom izvoru, ne samo prema listi ključnih reči. Posebno proveri uvodne definicije, uloge entiteta, pojačane uslove i pretpostavke u otvorenim pitanjima. Pročitaj opravdanost blokirajućih nalaza; grep razlike nije dokaz promene značenja.

Potvrdi da verifikovani i challenge artefakt odgovaraju objavljenom sadržaju, uz samo opravdane promene metapodataka, da su tagovi dostupni i da nema tuđih upisa ili živog zakupa.

Ako sadržaj ostane sporan, ne označavaj ga potpuno prihvaćenim i ne dodaj novog automatskog arbitra. Precizno navedi rečenicu, izvor i neusaglašenost.

## 4. Konsolidovati dokaze na završnoj reviziji

Dsh: postojeći PDF i SIGKILL dokazi ostaju važni; ne ponavljati plaćene oglede samo radi ponavljanja. Utvrdi da li nove izmene utiču na njih. Ako utiču, ponovi zahvaćene scenarije na konačnom SHA. U suprotnom navedi staru proverenu reviziju i razlog zbog kojeg promena ne utiče na dokaz; nemoj ih prepisati kao oglede nove revizije.

Na završnom izvršnom kodu pokreni ceo skup i, nakon uspeha, još jednom. Za neuspeh sačuvaj uzrok umesto preskakanja testa. Codex treba jasno da navede da li je sam izvršio ceo skup ili samo ciljane provere.

Ne otvaraj novu široku TOCTOU kampanju i ne nazivaj postojeće prozore zatvorenim. Ako usput nađeš konkretan propust koji obara podržani lokalni režim, minimalno ga zatvori i proveri. Isto tako, nemoj neispravan input normalizovati tako da prećutno izgubi korisnički sadržaj.

## 5. Kako organizovati nezavisne pozive

Koristi postojeći DSH external_agent/verify mehanizam. Daj Codex-u ovaj dokument, tačan SHA, diff i stvarne putanje dokaza. Dsh ostaje autor korekcija; Codex pravi sopstvene probe i ocenjuje artefakte. Ne traži samo „odobri”.

Možeš objediniti YAML pregled i lokalne provere u jedan početni poziv, a završne sadržajne i klijentske dokaze u ciljanu završnu proveru. Dodatne runde rade se prema nalazima, bez fiksnog broja, ali bez besciljnog ponavljanja. Poslednja relevantna korekcija mora imati status nezavisne provere.

## 6. Završni izveštaj — precizna ocena

Ažuriraj postojeću matricu i dopunski izveštaj. Za svaku od četiri ranije stavke navedi potvrđene podslučajeve, revizije, ko je izvršio proveru i preostale granice. „MCP zatvoren za dva vendora” nije „sve relevantne uloge proverene”. „Pravilo hvata P6” nije „novi objavljeni tekst je sadržajno prihvaćen”.

Za ovu rundu završetak znači:
1. poslednja YAML korekcija nezavisno potvrđena, uz pošteno ograničen parser;
2. šest postojećih MCP uloga imaju žive dozvoljene i odbijene probe ili su nedokazane uloge izričito ostale otvorene (što je delimičan završetak);
3. novi dokumentni rezultat na konačnom pravilu nezavisno sadržajno prihvaćen;
4. završni testni skup i relevantni raniji PDF/restart dokazi povezani sa tačnim revizijama;
5. nema poznatog otvorenog problema koji dopušta tihu neovlašćenu objavu u dogovorenom režimu.

Ako nešto nije završeno, ne napiši „nema blokirajućih nalaza, sve zatvoreno” samo zato što su ograničenja navedena. Navedi šta je spremno i šta tačno još nije dokazano. Posle ovog zaokruživanja sledeći korak može biti mali stvarni coding zadatak u zasebnom projektu; sada ostajemo u postojećem obimu.
