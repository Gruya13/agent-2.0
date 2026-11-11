# Agent 2.0 — preporuke za nastavak projekta

**Datum:** 14. oktobar 2026.  
**Projekat:** `/home/gru/Projects/Agent 2.0`  
**Osnova procene:** pregled implementacije na reviziji `a0dc5c8`, sačuvani istorijski izveštaji i poslednje provere tokom izrade dokumentacije.  
**Status ovog dokumenta:** savet za naredni rad; opisani eksperimenti i ispravke tek treba da budu izvršeni.

## 1. Preporuka: zamrznuti obim i dokazati postojeći sistem

Preporučujem da Agent 2.0 sada pređe iz proširivanja arhitekture u fazu dokazivanja. Prestanimo da dodajemo nove uloge, kapije, servise i posrednike dok ne pokažemo da postojeći sistem ponovljivo pretvara stvarni izvor u tačnu belešku, odbija loš rezultat i može da se oporavi od prekida.

Već postoje šest uloga, kontrolna petlja, zakup, Git worktree izolacija, verifikacija, red-team reprodukcija, MCP, manifest izvora, audit i testovi. Sledeća vrednost treba da dođe iz njihove pouzdanosti, a ne iz povećanja broja komponenti.

Radni cilj za ovu fazu glasi:

> Na jednoj jasno označenoj reviziji i u poznatom okruženju dokazati osnovni unos, ekstrakciju i održavanje baze postojećim alatima, uz proveru sadržaja, ponašanja pri odbijanju i oporavka posle prekida.

To nije tvrdnja da je sistem već zadovoljio cilj. Poslednji mock demo i lint jesu prošli, ali kompletan testni skup nije. Postoji sačuvan realni uspeh osnovnog toka i uspešna blokada problematičnog zadatka, ali nema dovoljno dokaza za sve uloge i operativne uslove.

## 2. Zašto nam sada treba dokazivanje

Dosadašnji razvoj je pokazao da se najkorisnije korekcije pojavljuju kada stvarno pokrenemo sistem. Realni tok je otkrio neversionisan izvor i zastareli worktree. Nezavisna verifikacija je otkrila propuste u hashiranju i pristupu. Red-team je otkrio zaobilaženje merge politike i preklapanje zona.

Istovremeno, veći broj zaštita povećao je broj međuzavisnosti. Konfiguracija zakupa ne znači da obnova zaista radi. Šest deklarisanih uloga ne znači da svaka dobija ispravnu MCP ulogu. Clean challenge ne znači nužno da je reprodukcioni proces uspešno izvršen. Broj ranije prolaznih testova ne rešava današnje neuspešno izvođenje.

Zbog toga je naredni korak provera konkretnih tvrdnji, uz minimalnu korekciju tamo gde dokaz pokaže problem. Ako svaku neizvesnost rešavamo novim slojem, odlažemo odgovor na pitanje da li postojeći sistem obavlja svoj posao.

## 3. Šta zamrzavamo

Tokom ove faze ne preporučujem dodavanje novih uloga, novog schedulera, trajnog daemon-a, web panela, HTTP API-ja, SQL baze, vektorske pretrage, distribuiranog zaključavanja, dodatnog evaluacionog modela ili automatske samoizmene koda i ugovora.

Ne preporučujem ni širenje podrške na druge operativne sisteme, proizvoljne topologije vault-a i velike paralelne serije dok osnovni slučajevi nisu potvrđeni. To nisu zabranjeni budući pravci; sada nisu predmet rada.

| Dozvoljen rad | Uslov |
|---|---|
| dijagnostika postojećih testova | utvrđuje konkretan uzrok i čuva puni rezultat |
| korekcija postojećeg modula | popravlja reprodukovano ponašanje ili jasno kršenje postojećeg ugovora |
| mali dodatak potrebnog ponašanja | zatvara već obećanu funkciju, npr. obnovu zakupa, u postojećem sloju |
| regresioni test | proverava stvarni kontraprimer, a ne samo kopira implementaciju |
| korekcija konfiguracije ili prompta | nužna je za postojeću ulogu i proverava se stvarnim pozivom |
| uklanjanje ili ograničavanje mogućnosti | smanjuje nejasnoće i jasno sužava podržani obim |
| dopuna dokumentacije | beleži izvršene dokaze, odluke i preostala ograničenja |

Svaku promenu opravdaj jednom rečenicom: „Ovo menjamo zato što eksperiment X na reviziji Y pokazuje rezultat Z.” Ako takvo obrazloženje nemamo, promena ide na listu za kasnije.

## 4. Prvo definišemo šta tvrdimo da podržavamo

Za početak neka podržani obim bude uzak: jedan lokalni Linux vault, standardni direktorijumi, jedna kontrolna petlja, postojeća tri harnesa i pojedinačni mali zadaci. To omogućava da rezultat stvarno proverimo.

Početna tvrdnja ne treba da bude „asinhroni sistem bezbedno radi u svim uslovima”. Treba da bude: „U definisanom lokalnom okruženju ovaj skup scenarija daje ove rezultate i čuva ove granice.”

Predlažem sledeće tvrdnje za dokazivanje:

| Oznaka | Tvrdnja | Potreban dokaz |
|---|---|---|
| D1 | stvarni tekstualni izvor može završiti kao upotrebljiva beleška | realni tok, izvor i pregled sadržaja |
| D2 | pogrešan ili neproveren rezultat ne ulazi u produkciju | kontrolisano odbijanje i pregled main grane |
| D3 | zakup pripada procesu i ostaje validan tokom dozvoljenog rada | token probe i poziv duži od početnog TTL-a |
| D4 | svaka korišćena uloga dobija tačnu MCP zonu i identitet | stvarni harnes/MCP poziv za svih šest uloga |
| D5 | postojeći izvor se ne menja neprimećeno | binarni/tekstualni kontraprimer i očuvana manifest osnova |
| D6 | ekstrakcija ostavlja proverljiv i tačan materijal | mali PDF/tabela sa referentnim sadržajem |
| D7 | audit menja samo dozvoljeno postojeće znanje | diff preciznog opsega i nezavisna provera |
| D8 | prekid ne ostavlja zadatak trajno zarobljen | kontrolisani prekid, istekao zakup i ponovljen završetak |
| D9 | neizvršena provera ne predstavlja se kao uspešan sadržajni dokaz | probe timeout-a, sandbox greške i isključenog izvršavanja |

Oznake su identifikatori u dokumentaciji, ne predlog novog modula ili sistema.

## 5. Redosled rada

### Korak 1 — uspostaviti pouzdanu osnovu testiranja

Prvo razjasniti postojeće padove testova. Sačuvati tačnu reviziju, Node/Git verzije, komandu, izlaz i dozvole okruženja. Pokrenuti kompletan skup, pa ciljano istražiti neuspešne oblasti.

Poslednja provera prijavila je neuspeh CLI, MCP, pipeline i reprodukcionih testnih fajlova. U ciljanim probama viđeni su prazni izlazi podprocesa, a kod bwrap-a potvrđena zabrana NETLINK_ROUTE socket-a. Nije potvrđeno da svi padovi imaju isti uzrok.

Ne treba nasumično menjati kontrolni kod dok ne razdvojimo grešku aplikacije od greške testnog procesa ili ograničenja okruženja. Ne treba uklanjati test, preskakati ga ili čistiti promenljive okruženja bez objašnjenja zašto to predstavlja legitimno ciljno okruženje.

**Uslov završetka:** svaki pad ima potvrđen uzrok; kompletan skup u dogovorenom ciljnom okruženju prolazi ili je njegova nepokrivenost eksplicitno navedena. Oblast koju nismo izvršili ostaje nedokazana.

Posle prolaznog izvođenja ponoviti ceo skup još jednom na istoj reviziji kao kratku proveru ponovljivosti. Ako drugo izvođenje pada, preći na ciljanu dijagnostiku. Nema potrebe stalno ponavljati iste provere kada se stanje nije promenilo i nema nove sumnje.

### Korak 2 — proveriti životni ciklus procesa i zakupa

Pre plaćenih dugih prolaza proveriti ono što može da pokvari svaki zadatak: vlasnika, token, trajanje zakupa, zaključavanje i ispravan prenos uloge.

Konfiguracija trenutno predviđa deset minuta zakupa i često petnaest minuta za agenta. Automatski heartbeat nije pronađen u izvršnom kodu. File-lock stariji od 30 sekundi može biti proglašen zastarelim i kada je proces živ. MCP šabloni fiksiraju početne tri uloge, a isti vendor sada ima dve različite odgovornosti.

Koristiti postojeće adaptere i male kontrolisane testne procese da se proveri da drugi proces istog identiteta ne može koristiti tuđ token, da živ lock ne bude preuzet i da legitimni upis ne izgubi zakup tokom dozvoljenog poziva. Duži poziv najpre testirati bez trošenja model kvote.

Ako je obnova deo obećanog ponašanja, implementirati je u postojećem kontrolnom sloju i testirati sa skraćenim vremenima, pa potvrditi preko stvarne granice trajanja. Privremeno povećan TTL može omogućiti pojedinačni ogled, ali ne dokazuje automatsku obnovu.

**Uslov završetka:** zakup, identitet i uloga rade u podržanom režimu; ograničenje na jednu petlju jasno je zapisano. Ne uvodimo distribuirani lock da bismo popravili lokalni lock.

### Korak 3 — dokazati jedan pravi tekstualni tok

Izabrati kratak spoljni dokument od jedne do tri strane, sa proverljivim činjenicama. Izvor ne treba da opisuje Agent 2.0. Zamrznuti izvor, zahtev, konfiguraciju i početnu reviziju pre pokretanja.

Pre model poziva čovek priprema malu referentnu listu ključnih tvrdnji i očekivanih zaključaka. Time izbegavamo da jedini ocenjivač bude isti sistem koji je napisao rezultat.

Pokrenuti postojeći ingest → research → verify → challenge → consolidate → reflect tok sa stvarnim adapterima. Pregledati produkcioni tekst i Git trag. Ne menjati prompt usred pokušaja bez evidentiranja da je započet novi pokušaj sa drugačijim ulazom.

**Uslov završetka:** beleška je tačna prema izvoru, ima upotrebljive veze i metapodatke, task je consolidated, indeks odgovara sadržaju, nema neobjašnjenih upisa ili zaostalih aktivnih zakupa. Za prolaz bez blokirajućih nalaza ne koristi se override.

### Korak 4 — dokazati odbijanje i povratak na korekciju

U izolovanom testnom vault-u pripremiti poznato pogrešan artefakt ili kontrolisano narušavanje postojeće granice. Ne menjati registrovani izvor glavnog projekta radi ovog ogleda.

Proveriti da verifikacija odbija dokazivu grešku, da neispravan rezultat ne uđe u main, da red-team reprodukcija čuva svoju reviziju i da zadatak može doći do nove korekcije. Posebno razjasniti trenutno vraćanje challenge nalaza u review i brojač izveden iz review istorije.

Kontrolisani kontraprimer dokazuje blokadu i oporavak. Ne dokazuje da će model sam pronaći svaku novu grešku. Te dve tvrdnje treba odvojeno evidentirati.

**Uslov završetka:** poznata greška zaustavlja objavljivanje, nalaz ostaje vidljiv, pokušaji se broje po jasno definisanom pravilu, a ispravljen artefakt može proći bez prikrivanja istorije. Ako nastane blocked, operator ima razumljiv i proverljiv put nastavka.

### Korak 5 — potvrditi extractor i librarian

Ove uloge već postoje i zato pripadaju proveri postojećeg obima.

Za extractor koristiti mali digitalni PDF sa nekoliko pasusa i jednom tabelom čije je ćelije moguće ručno proveriti. Pregledati source_path, source_sha256 i sadržaj fragmenta. Važne cifre ne smeju biti zamenjene, redovi ili kolone permutovani, a nečitljiv podatak mora biti označen kao neizvestan. Hash potvrđuje poreklo fajla, ne tačnost transkripcije.

Za librarian koristiti kopiju baze sa nekoliko postojećih belešaka i konkretnim problemom: nedosledan termin ili pokvaren link. Opseg odrediti tačnim putanjama. Pregledati diff, audit izveštaj, verifikaciju i završni merge.

**Uslov završetka:** po jedan sadržajno pregledan stvarni tok za ekstrakciju i audit. Time ne dokazujemo univerzalni OCR, sve PDF formate ili sve glob obrasce. Dodatne probe biramo prema stvarnim zahtevima korisnika.

### Korak 6 — proveriti prekid, nastavak i ponovljivost

Prekinuti kontrolisani testni proces tokom rada, sačuvati dijagnostičke artefakte, sačekati ili u fixture-u modelovati istek i izvršiti postojeći reclaim. Proveriti da drugi proces ne upisuje pod prethodnim živim tokenom i da nastavak ne objavljuje duplikat.

Jedan uspešan tekstualni scenario ponoviti u tri odvojena čista vault-a sa istim izvorom, zahtevom i konfiguracijom. Porediti sadržajne kriterijume i završno stanje, a ne očekivati identične rečenice modela. Tri prolaza su praktičan početni signal ponovljivosti, ne statistički dokaz opšte pouzdanosti.

**Uslov završetka:** nema trajno zarobljenog zadatka, tihog gubitka izvora ili neobjašnjene duple publikacije; svaki pokušaj ostavlja pregledan trag. Ako postoji povremeni pad, tvrdnja o ponovljivosti ostaje otvorena.

## 6. Mala matrica dokaza

Ova matrica treba da ostane obična tabela u postojećoj dokumentaciji. Nije potreban novi servis za njeno vođenje.

| Scenario | Režim | Glavni kriterijum |
|---|---|---|
| kompletan postojeći testni skup | lokalni testovi | ponovljiv rezultat u poznatom okruženju |
| živi zakup i drugi token | kontrolisani procesi | drugi token odbijen, vlasnik nastavlja |
| rad preko početnog trajanja zakupa | kontrolisani proces | obnova potvrđena ili eksplicitno ograničen režim |
| MCP matrica šest uloga | stvarni harnesi / izolovane probe | tačan identitet i dozvoljeni/odbijeni upisi |
| tekstualni dokument | pravi modeli | tačna objavljena beleška |
| poznato pogrešan nacrt | testni vault | objavljivanje odbijeno i korekcija moguća |
| promena izvora ili gubitak manifesta | testni vault | nema tihe nove osnove integriteta |
| skript timeout / greška izvršavanja | testni vault | neuspešna provera nije sadržajni pass |
| ekstrakcija PDF tabele | pravi extractor tok | očuvane činjenice, ćelije i poreklo |
| audit tačnog opsega | pravi librarian tok | menja se samo dozvoljeno postojeće znanje |
| prekid i reclaim | kontrolisani proces | nastavak bez izgubljenog prava vlasništva ili duplikata |
| isti tekstualni ulaz, tri pokušaja | odvojeni vault-i | sadržajni kriterijumi zadovoljeni u svakom |

Ako konkretan scenario otkrije grešku, dodati samo potreban regresioni dokaz. Matrica nije poziv da odmah napišemo desetine novih testnih slojeva.

## 7. Šta znači da je izlaz upotrebljiv

Tehnički consolidated status je potreban, ali nije dovoljan. U ovoj fazi čovek pregleda konačni tekst prema unapred pripremljenoj referenci.

| Oblast | Predloženi kriterijum |
|---|---|
| činjenice | sve ključne tvrdnje odgovaraju izvoru; nema izmišljenih nosivih činjenica |
| potpunost | pokriveni su svi unapred izabrani ključni podaci |
| neizvesnost | nedokazan zaključak jasno je odvojen od činjenice |
| poreklo | reference i hash vode do stvarnog sačuvanog izvora |
| brojevi i tabele | sve unapred označene važne vrednosti su tačne |
| veze | produkcioni linkovi vode ka postojećim beleškama |
| čitljivost | beleška može da se koristi bez čitanja agentove sesije |
| tehničko stanje | lint čist, task završen, indeks usklađen, promene opravdane |

Referentna lista treba da bude mala i pažljivo odabrana, npr. pet do deset ključnih tvrdnji za kratak tekst. To je praktična kontrola, ne tvrdnja da svaka sporedna rečenica mora dobiti zaseban test.

## 8. Kako beležimo dokaze bez nove infrastrukture

Koristiti postojeći Git, zadatke, events.jsonl i Markdown izveštaj. Za svaki ogled dovoljan je zapis sa sledećim podacima:

```markdown
## Ogled: <kratak naziv>

- Revizija koda:
- Datum i okruženje:
- Izvor i njegov SHA-256:
- Konfiguracija i korišćene uloge:
- Tvrdnja koju proveravamo:
- Komanda / postupak:
- Očekivani rezultat:
- Stvarni rezultat:
- Artefakti i Git revizije:
- Pregled sadržaja:
- Trajanje i broj poziva modela:
- Trošak, ako je stvarno dostupan:
- Ručne intervencije:
- Zaključak: potvrđeno / oboreno / neprovereno:
- Preostalo ograničenje:
```

Budžet ili procenu troška ne predstavljati kao izmerenu potrošnju. Ako podatak ne postoji, napisati „nije izmereno”. Ako je upotrebljen override, zapisati ga i jasno ograničiti zaključak: tok uz ručno preglasavanje nije dokaz da je kapija sama propustila ispravan sadržaj.

Dokaze vezati za stvarnu reviziju. Ako popravimo kod, prethodni uspeh ostaje istorijski dokaz prethodne revizije; za novu ponoviti relevantni scenario i, na završnoj reviziji, kompletan potreban skup.

## 9. Pravilo za nove nalaze

Svaki nalaz razvrstati po tome da li može da izazove pogrešnu publikaciju, gubitak integriteta, blokadu podržanog toka ili samo ograničava budući obim.

| Vrsta nalaza | Odluka u ovoj fazi |
|---|---|
| dopušta neproveren sadržaj ili menja izvor bez prijave | popraviti pre prihvatanja sistema |
| sprečava da dogovoreni osnovni scenario završi | minimalno popraviti ili eksplicitno suziti podržanu tvrdnju |
| izaziva povremeni pad / gubitak zakupa | reprodukovati i otkloniti pre tvrdnje o ponovljivosti |
| vezan je za nepodržanu paralelnost ili topologiju | dokumentovati ograničenje; ne širiti arhitekturu |
| nepotvrđena sumnja | napraviti ograničen eksperiment; bez automatske nove kapije |
| predlog nove funkcije | sačuvati za kasnije |

Za isti problem najpre proveriti može li ga postojeći modul rešiti jednostavnije. Ako su dve provere iste odgovornosti neusaglašene, prednost ima zajednička postojeća provera ili uklanjanje dupliranja. Ne dodajemo trećeg posrednika da pomiri prva dva.

Kad ogled zahteva dodatni sloj da bi uopšte prošao, zastati i preispitati obećani obim. Moguće je da treba privremeno ograničiti funkciju ili pojednostaviti tok, umesto proširiti sistem.

## 10. Budžet i način rada

Ne preporučujem pokretanje velike serije stvarnih poziva pre lokalnih provera. Raditi jedan ogled u jednom trenutku, sa unapred zapisanim ulazom, kriterijumom i granicom pokušaja.

Za svaki plaćeni ogled unapred odrediti prihvatljivo zidno vreme i broj poziva prema raspoloživom budžetu. Ne pretvarati ranije procene 30–90 minuta u obećanje: dokumentovani TASK-102 trajao je približno dva sata. Trošak raste kada isti spor prolazi kroz više model faza.

Ako ogled pređe dogovorenu granicu, sačuvati rezultat i dijagnostikovati uzrok. Ne povećavati broj rundi samo da bismo na kraju dobili zelen rezultat. Ne raditi sadržajne korekcije ručno bez evidencije pa ih predstaviti kao automatski uspeh.

Za ponovljivost pravih modela potrebno je prihvatiti varijacije u tekstu. Merilo su tačnost, integritet i završno stanje, uz trajanje i ručne intervencije. Identitet vendor programa sam po sebi ne garantuje istu verziju modela; zapisati dostupne identifikatore, a nedostajuće podatke priznati.

## 11. Kada ovu fazu smatramo završenom

Predlažem da završna odluka bude zasnovana na kratkom izveštaju o jednoj završnoj reviziji, uz sledeće uslove:

1. Testno okruženje je opisano, padovi razjašnjeni i potreban postojeći skup prolazi.
2. Podržani režim zakupa, zaključavanja i MCP uloga je dokazan.
3. Osnovni tekstualni tok je sadržajno ispravan i ponovljen u tri čista vault-a.
4. Poznata greška zaustavlja objavljivanje, a korekcija ima razumljiv završetak.
5. Extractor i librarian imaju po jedan pregledan stvarni scenario ili su eksplicitno izostavljeni iz tvrdnje o spremnosti.
6. Prekid i nastavak ne ostavljaju gubitak izvora, nedozvoljen upis ili neobjašnjenu duplu publikaciju.
7. Neizvršavanje provere ne predstavlja se kao potvrđen sadržajni uspeh.
8. Preostala ograničenja su navedena i ne obaraju dogovoreni obim.

Ako su potvrđeni samo tekstualni tokovi, završna tvrdnja treba da glasi da je potvrđen tekstualni unos u ograničenom lokalnom režimu. Ne treba zbog nepotvrđenog extractor-a dodavati još jednu ekstrakcionu ulogu; tu oblast ostavljamo jasno otvorenom.

Za proširenje posle ove faze mora postojati konkretna potreba iz korišćenja koju trenutni dokazano funkcionalan sistem ne rešava. Broj novih ideja nije kriterijum napretka.

## 12. Konkretna preporuka za prvi naredni radni zadatak

Prvi zadatak neka bude: **razjasniti i ponovljivo izvršiti postojeći testni skup na poznatoj reviziji, bez menjanja obima sistema**.

Isporučeni rezultat tog zadatka treba da sadrži tačne uzroke četiri neuspešne oblasti, minimalne potrebne ispravke ako se potvrdi greška aplikacije i ponovljenu proveru. Ako je ograničenje u okruženju, treba obezbediti odgovarajuće ciljno okruženje ili ostaviti oblast neproverenu. „Verovatno je sandbox” nije dovoljan zaključak.

Nakon toga raditi zakup i MCP prenos uloga, pa jedan pravi spoljni dokument. Tako sledeći plaćeni poziv proverava smislen sadržaj, umesto da ponovo troši vreme na već poznatu operativnu neizvesnost.

## 13. Povezani dokumenti i granice ove preporuke

[Kompletan opis sistema, istorije i otvorenog rada](Agent-2.0-Kompletan-opis-sistema.md) sadrži tehničku osnovu ovog predloga. [Poslednji izveštaj provere](<Projects/Agent 2.0/docs/PROVERA.md>) beleži rezultate poslednjeg izvršavanja tokom dokumentovanja.

Ovaj dokument predlaže fokus i kriterijume. Ne potvrđuje da su navedene korekcije ili eksperimenti već izvedeni i ne menja izvršni kod ili projektna pravila. Njegova namena je da sledeći rad usmeri ka dokazima o postojećem sistemu, uz što manje promena obima.
