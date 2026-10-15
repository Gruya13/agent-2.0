# Poruka za dsh — proveriti postojeći coding tok pre daljeg širenja

Datum: 15. oktobar 2026.  
Od: Codex, po zahtevu korisnika.  
Pregledana polazna revizija: `014b9c6`.

## Cilj i granica rada

Prvi coding ogled i ogled sa memorijom predstavljaju napredak ka stvarnoj nameni projekta. Wiki ostaje zaštićena zajednička memorija; coding tok radi nad odvojenim ciljnim repozitorijumom. Ne ukidati wiki zaštite i ne praviti novu platformu.

Sledeći zadatak je nezavisno proveriti novi coding tok i minimalno zatvoriti potvrđene propuste u postojećem modulu. Ne dodavati nove uloge, servis, bazu, novu univerzalnu kapiju ili dodatni orkestratorski sloj.

U pregledu koda uočene su tri primarne praznine. To su statička zapažanja: prvo ih potvrdi kontrolisanim ogledom, pa ispravi i dodaj smislen regresioni dokaz. Ne predstavljaj svako zapažanje unapred kao reprodukovan napad.

## 1. Prihvatanje zahteva izričit pass

U fazi pregleda uslov trenutno odbija fail, neuspešan proces ili nedostajući izveštaj, ali ne zahteva izričito `rezultat.verdict === 'pass'`. Ako postoji izveštaj, proces završi uspešno, a verdikt nedostaje, faza može izgledati uspešna. `runCodeTask` zatim bira prihvatanje po postojanju review objekta.

Napravi kontrolni scenario: reviewer ostavi izveštaj i exit 0, ali bez validnog verdikta. Očekivano: prihvatanje nije moguće. Proveri zasebno fail i validan pass.

Uslov prihvatanja mora eksplicitno proveriti dokaze uspešne provere i važeći nezavisni pass, a ne samo prisustvo polja ili izvršenje prethodne faze. Dokazati i direktni pokušaj nastavka sa nepotpunom evidencijom, bez oslanjanja isključivo na uobičajeni redosled petlje.

## 2. Životni ciklus zakupa tokom coding rada

Novi coding tok poziva `runAgent` direktno i ne koristi postojeći heartbeat omotač dokumentnog toka. Prethodno rešeni problem dugog poziva zato nije automatski rešen i ovde.

Koristi kratak TTL i kontrolisani spor proces, bez plaćenog modela, pa proveri:

- zakup ostaje živ tokom dozvoljenog rada;
- drugi proces istog identiteta sa drugim tokenom ne može ga preuzeti;
- timer se završava nakon uspeha, odbijanja ili izuzetka;
- ako proces stvarno izgubi zakup, ne sme kasnije prihvatiti promenu pod starim pravom;
- greška i prekid ostavljaju razumljivo stanje za nastavak.

Iskoristi postojeću mehaniku zakupa. Nemoj kopirati složenu novu infrastrukturu radi ove provere. Uzeti u obzir da i test komande mogu trajati dugo, ne samo model pozivi. Jedno povećanje TTL-a nije dokaz obnove.

## 3. Prihvatamo baš pregledani i testirani kod

Pregled se radi nad checkout-om grane, a prihvatanje kasnije spaja imenovanu granu. Potrebno je proveriti da grana u međuvremenu nije promenjena i da završni rezultat na aktuelnoj osnovi i dalje prolazi testove.

Kontrolisani scenariji:

1. Nakon pass pregleda izmeni kandidatsku granu. Stari pass ne sme odobriti novi commit.
2. Nakon pregleda pomeri ciljnu glavnu granu promenom koja se tekstualno spaja, ali kvari ponašanje kombinovanog rezultata. Prihvatanje ne sme zaključiti uspeh samo iz merge exit 0.
3. Dokazati da neočekivana putanja uvedena između pregleda i prihvatanja ne prolazi na osnovu stare scope provere.

U evidenciji sačuvati tačan implementacioni i pregledani SHA, identitet/ulogu reviewera i rezultat komandi. Proveriti vezu sa stvarno prihvaćenim rezultatom. Integracionu proveru raditi pre promene glavne grane, u izolovanom stablu postojećim Git alatima; ne objaviti neuspešan rezultat pa ga nazvati odbijenim.

Ako se osnovica promeni i utiče na rezultat, definisati kada se traži nova provera i pregled. Ne dodavati automatski rebase koji prepravlja predmet već datog odobrenja bez ponovne provere.

## 4. Povezane provere u istom uskom pregledu

Ne širiti ovo u novu veliku bezbednosnu kampanju, ali pri pregledu proveriti postojeće tvrdnje:

- Različiti nazivi uloga ne znače različite autore. Dokazati da reviewer nije isti vendor kao implementator kada se rezultat predstavlja kao nezavisan pregled.
- Pad regresionog testa na osnovi mora biti zbog konkretnog očekivanog pogrešnog ponašanja. Greška importa, sintakse, nedostajuća zavisnost ili timeout nisu dovoljan dokaz reprodukovanog buga.
- Proveriti da postojeći test nije oslabljen ili preskočen, umesto oslanjanja samo na instrukciju u promptu i prisustvo novog test fajla.
- Provera ciljnog repoa ne treba da se oslanja samo na tekst putanje ako simbolički link može da pokaže na kontrolni repo. Potvrditi realnu granicu putanje.
- MEMORY.md je pomoćni kontekst. Ne prepisivati ili brisati legitimni postojeći fajl ciljnog projekta tog imena. Tvrdnja da je memorija samo za čitanje nije OS garancija samo zato što se putanja izuzima iz diff-a.
- Coding prihvatanje trenutno ignoriše neuspeh upisa dokaznog taga. Proveriti da neuspeh ne daje pogrešnu tvrdnju o trajno sačuvanom dokazu, po pouci prethodnog dokumentnog toka.

Ako se potvrdi nalaz koji direktno dopušta neproveren merge ili promenu kontrolnog repoa, zatvoriti ga pre novog realnog ogleda. Ostale nalaze precizno zapisati i odrediti ograničenje; ne pokušavati odjednom podržati sve tehnologije i režime.

## 5. Pozovi Codex za nezavisni pregled

Koristi postojeći DSH mehanizam poziva spoljnog agenta. Ako je Codex i dalje nedostupan zbog kvote, zabeleži prepreku; nemoj agy sadržajni review fixture popravke predstavljati kao nezavisnu proveru kontrolnog modula od 550 redova. Drugi dostupan vendor može sprovesti taj pregled, ali rezultat označi stvarnim autorom.

Zahtev koji treba proslediti revieweru:

> Nezavisno proveri coding tok Agent 2.0. Polazni kandidat je 014b9c6; dsh mora navesti tačan SHA eventualnih korekcija i diff. Pregledaj tools/orchestrator/lib/coding.mjs, vezu sa store/pipeline/config/CLI i tests/coding.test.mjs. Ne menjaj glavni workspace. U zasebnom checkout-u izvedi sopstvene kontrolne scenarije za nedostajući pass, dug poziv i izgubljen zakup, promenu kandidata/osnove posle pregleda i prihvatanje tačno proverene promene. Proveri povezane granice navedene u ovoj poruci. Postojeće testove koristi kao dopunu, ne jedini dokaz. Ne pokreći plaćene sadržajne agente. Vrati tabelu potvrđeno/oboreno/neprovereno, komande, reviziju i konkretne kontraprimere sa očekivanim i stvarnim rezultatom. Ne popravljaj kandidat u toku pregleda i ne proglašavaj ceo sistem sertifikovanim.

Dsh piše korekcije i regresione testove; nezavisni reviewer pravi sopstveni dokaz. Sačuvaj izvorni odgovor ili putanju loga, ne samo autorski sažetak. Koristi ranije dogovoreni budžet do osam ciljanih ciklusa i najviše dva završna kada postoji napredak; stani ranije kada je obim potvrđen. Poslednja popravka mora imati jasan status nezavisne provere.

## 6. Tek zatim ponovi coding ogled

Na završnoj označenoj reviziji ponovi mali range fixture sa stvarnim programerom i reviewerom, uz wiki memoriju. Proveriti:

1. konkretan bug pada na osnovi i prolazi posle popravke;
2. postojeći testovi ostaju validni;
3. drugi vendor pravi i izvršava sopstveni scenario;
4. samo dozvoljeni kod i testovi ulaze u ciljni repo;
5. MEMORY.md ne ulazi u istoriju i ne uništava postojeći projektni fajl;
6. prihvaćen je tačno pregledan i završno testiran rezultat;
7. dokaz je ponovljiv iz čistog checkout-a;
8. zapis iskustva vraćen je u kontrolni wiki ili je neuspeh tog zapisa jasno označen, bez lažne tvrdnje o uspehu memorije.

Ne podešavati ručno pass, status ili scope da bi ogled prošao. Ako neki kriterijum ostane otvoren, navesti ga umesto opšte ocene „sve radi”. Ne koristiti sam Agent 2.0 kao prvi ciljni repo.

## 7. Naredna granica

Kada je ovaj mali tok potvrđen, sledeći zadatak je jedan mali stvarni bug u zasebnom postojećem projektu sa unapred definisanim zahtevom. Izbor projekta i opseg korisnik treba da može jasno da pregleda. Bez novih uloga i velikih refaktorisanja do tog dokaza.

Isporuči kratak izveštaj: pregledana revizija, potvrđeni problemi, minimalne ispravke, autorove provere, nezavisne provere, rezultat pravog ogleda i preostala ograničenja. Razdvoji uspeh fixture-a od spremnosti za proizvoljan stvarni repozitorijum.

Ova poruka ne pokreće nikakav harnes i ne menja izvršni kod. Postojeći uspešni ogledi ostaju sačuvani kao dokaz svojih revizija.
