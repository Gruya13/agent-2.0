# Konsultacija o novim ulogama (0–2 po vendoru)

Postojeće uloge su **zaključane** (agy=`researcher`, dsh=`verifier`,
codex=`consolidator`). Pitanje je bilo: koje 0–2 **nove** uloge bi koji vendor
dodatno preuzeo. Svakom je dat isti dosije: katalog kandidata (arbitrator,
librarian, extractor, toolsmith, red-team, prompt-engineer), mereni dokazi iz
ovog projekta i obavezan format odgovora. Pitanje je postavljeno bez preferencije
izvršioca, a odgovori su prikupljeni neizmenjeni.

## Odgovori (verbatim)

### dsh

```text
NOVE: red-team
ZASTO: U prvom verifikacionom izvršenju oborio sam nacrt sa 3 nalaza, svaki sa komandom i dokazom (`git ls-tree`, `git show`, `sha256`, brojevi linija), a u drugom vratio `pass` uz proveru da su prethodni otklonjeni — to je red-team posao koji se danas radi samo honorarno. Red-team je falsifikacijski režim nad tuđim artefaktom, a moja zona `tasks/reviews/` je već zona nalaza, pa nema nove zone ni pisanja u `wiki/`. Za razliku od `codex`-a (10 nalaza, ali je istovremeno `consolidator` i watchdog integriteta testova), ja ne pišem sadržaj koji onda branim, pa je razdvajanje čisto.
POTREBNO: nova faza „red-team" posle verifikacije, vezana za zamrznutu reviziju (`commit sha`); budžet ≤1 runda po ciklusu (5-10 min); svaki nalaz nosi tačnu komandu, reviziju i minimalni reprodukcioni skript, inače se odbacuje; nalazi se verzioniraju kao artefakti; red-team ne popravlja ono što napada; nalaz blokira merge samo ako je reproduktibilan na svežem checkout-u; meri se stopa lažnih nalaza.
RIZIK: Podbacio bih u izmišljanju novih vektora — dobar sam u obaranju predočenih tvrdnji, slab u otkrivanju napada koje niko nije ponudio, i spor (~10 min po izvršenju), uz rizik lažnih nalaza koji blokiraju merge. Ako ulogu uzme `codex`: dokazano najviše nalaza, ali bi isti vendor konsolidovao sadržaj, čuvao testove i napadao sistem — samoreferentno i serijalizovano. Ako uzme `agy`: brz je, ali prvi nacrt mu je imao 2 netačne tvrdnje i ispravlja se tek posle nalaza, pa bi bio izvor grešaka koje treba da nađe.
DRUGI: agy=extractor, dsh=red-team, codex=librarian
``````

### agy

```text
NOVE: extractor
ZASTO: Kao model sa nativnim multimodalnim i OCR sposobnostima, idealan sam za pretvaranje neobrađenih PDF-ova, slika i tabela iz `raw/` u strukturisane fragmente pre pisanja nacrta. U projektu sam dokazao brzinu (~1 min) i strukturnu pedantnost (26 linija izvora u 74 linije nacrta sa 0 linter grešaka), a rad u `wiki/drafts/` ne zahteva promenu zonske izolacije niti upis u `wiki/`. Izdvajanjem ekstrakcije u posebnu ulogu rasterećuje se istraživanje i smanjuje prostor za greške u sintezi.
POTREBNO: nova faza `extract` pre istraživanja sa radom isključivo u `wiki/drafts/fragments/`; obavezna šema fragmenta sa `source_sha256`, stranicom/koordinatama i izvornim sadržajem; zabrana slobodne interpretacije i sažimanja kroz linter; provera heša od strane kontrolnog sloja; budžet ≤2 min po dokumentu.
RIZIK: Podbacio bih kod gustih numeričkih tabela i nejasnih skenova gde postoji rizik OCR permutacija cifara ili netačnog očitavanja (slično riziku od 2 netačne tvrdnje u mom prvom nacrtu). Ako ulogu uzme `dsh`, postupak je prespor (~10 min) i limitiran nedostatkom multimodalnog pogona; ako uzme `codex`, opterećuje se konsolidator zadacima van difova i koda.
DRUGI: agy=extractor, dsh=red-team, codex=librarian
``````

### codex

```text
NOVE: red-team
ZASTO: Zadržavam zaključanu ulogu consolidator i biram jednu novu: red-team. Najjači dokaz su četiri runde provere sistema sa 10 oborenih tvrdnji, svaka potkrepljena reprodukcionim skriptom, za 4–5 minuta po rundi. Nalazi obuhvataju granice zona, simboličke linkove, skrivene izvore, zakup i upis bez potrebnog ovlašćenja. To direktno potkrepljuje ovu ulogu; precizna konsolidacija sama po sebi ne dokazuje sposobnost arbitraže ili održavanja cele baze.
POTREBNO: Posebna faza za adversarijalne provere, izolovana kopija sa sintetičkim podacima i ograničenim vremenom izvršavanja; zadatak, zakup i pečat vezani za tačan commit; namenski prostor za reprodukcione skripte i nalazi u tasks/reviews/. Nalaz mora sadržati prekršenu invarijantu, komandu, očekivani i stvarni rezultat. Kontrolni sloj mora sprečiti da proveravam sopstvenu konsolidaciju kao nezavisni ocenjivač i zahtevati nezavisnu potvrdu nalaza.
RIZIK: Mogao bih da precenim sintetički propust, propustim konkurentne uslove ili previše vremena potrošim na varijante već poznatog problema; dosadašnjih 10 nalaza nije dokaz potpune pokrivenosti. Ako ulogu dobije drugi, rizik je prijavljivanje sumnji bez pouzdane reprodukcije: agy-jeve početne netačne tvrdnje opravdavaju strogu proveru dokaza, dok dsh ima snažan dokaz verifikacione discipline, ali ovde nema izmeren dokaz sistematskog pronalaženja novih napada.
DRUGI: agy=extractor, dsh=librarian uz probni period i nezavisnu proveru strukturnih izmena, codex=red-team
``````


## Analiza

| Kandidat | agy | dsh | codex | Ishod |
|---|---|---|---|---|
| `extractor` | **traži** | predlaže agy | predlaže agy | **jednoglasno: agy** |
| `red-team` | ne | **traži** | **traži** | **sporno: dsh ili codex** |
| `librarian` | ne | predlaže codex | predlaže dsh (probni period) | **nikome ne treba** |
| `toolsmith`, `arbitrator`, `prompt-engineer` | ne | ne | ne | niko |

Obrazloženja koja su se poklopila kod svih:

- `arbitrator` i `librarian` traže upis u `wiki/`; dsh je izričito rekao da bi
  time **verifikator postao autor onoga što posle proverava**, čime se gasi jedina
  nezavisna strana u sistemu.
- `toolsmith` bi verifikatora učinio autorom testova koje po ugovoru ne sme da
  menja; `prompt-engineer` (uređivanje `.agents/`) ostaje čoveku kod svih.
- `extractor` ne traži novu zonu: fragmenti idu u `wiki/drafts/fragments/`, tj.
  unutar agy-jeve postojeće zone.

## Predlog raspodele (dokazi, ne glasovi)

1. **agy → `extractor`** (jednoglasno). Nova faza `extract` **pre** `research`:
   PDF/tabele/skene iz `raw/` u `wiki/drafts/fragments/` sa obaveznim
   `source_path` + `source_sha256` + lokacijom (strana/koordinate) i **zabranom
   interpretacije** — samo verna transkripcija. Kontrolni sloj proverava da se
   `source_sha256` poklapa sa izvorom pre nego što istraživač krene.
2. **`red-team` → rešiti izvršavanjem, ne dogovorom.** Oba kandidata imaju dokaz:
   codex 10 nalaza sa reprodukcionim skriptama (4–5 min/rundi), dsh 3 nalaza sa
   `git show`/`sha256` dokazima u samoj verifikaciji. Po pravilu projekta
   („neslaganje se rešava izvršavanjem, ne glasanjem") predlog je **probna runda
   nad istom zamrznutom revizijom, isti budžet**, a pobeda se meri
   reproduktivnošću nalaza i stopom lažnih nalaza. Ograničenje koje treba imati u
   vidu: codex je i `consolidator` i watchdog integriteta testova, pa bi napadao
   ono što sam gradi (na to je sam ukazao).
3. **`librarian` → uslovno codex, samo semantički deo.** Mehanički deo
   (duplikati, siročići, pokvarene veze) već pokrivaju linter i verifikator.
   Ono što niko ne radi je semantički pregled (kontradikcije među člancima,
   normalizacija oznaka) — a to zahteva upis u `wiki/`, što dsh ne sme da dobije.
   Uslov: obavezna nezavisna provera strukturnih izmena i jedan pisac po belešci.

## Odbačeno

- `toolsmith` (samoizmena sistema) — nijedan vendor je nije tražio, a verifikator
  bi njome postao autor koda i testova koje proverava.
- `prompt-engineer` — uređivanje ugovora ostaje čoveku kod sva tri odgovora.
- `arbitrator` — danas nema izmerenog konflikta u praksi (nijedan stvarni merge
  nije pao); uvođenje uloge bez dokaza da je potrebna nije opravdano.
