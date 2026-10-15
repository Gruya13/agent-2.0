# Provera coding toka i završni coding ogled

[Dokumentacija](README.md) · [Prvi coding prolaz](CODING-PROLaz-1.md) · [Wiki memorija](CODING-MEMORIJA-PROLaz.md) · [Uputstvo](../docs/PORUKA-ZA-DSH-PROVERA-CODING-TOKA.md) · [Dokazi](dokazi-k10/)

Datum: 15. oktobar 2026.

## 1. Pregledana revizija i obim

| | |
|---|---|
| Polazna revizija (uputstvo) | `014b9c6` |
| Prve ispravke (autorove) | `a65dfbc` |
| Zatvoreni nalazi 1. nezavisne provere | `f1aa57b` |
| Zatvorena tri preostala nalaza | `87b20c5` |
| Završna označena revizija ogleda | `242b4d0` |
| Skup testova | **174/174** |

## 2. Potvrđeni problemi (dokazani pre popravke)

Tri statička zapažanja iz uputstva **potvrđena su kontrolnim testovima koji su
padali pre ispravke** (`tests/coding-robustness.test.mjs`, R1–R3):

| # | Problem | Dokaz da je postojao |
|---|---|---|
| 1 | Pregled sa izveštajem i exit 0, ali **bez verdikta**, prolazio je dalje | R1 je pao: „pregled bez verdikta mora biti odbijen“ |
| 2 | **Zakup je isticao** tokom dugog poziva (coding tok nije imao heartbeat) | R2 je pao: `zakup je istekao tokom rada` |
| 3 | **Izmena grane posle pregleda** je bila prihvaćena | R3 je pao: „izmena posle pregleda ne sme biti prihvaćena“ |

Nezavisna provera (Codex) je posle prvih ispravki **oborila još pet tvrdnji**, a
zatim još tri — svaka je potvrđena sopstvenim testom i popravljena (R11–R19).

## 3. Minimalne ispravke

Sve u `tools/orchestrator/lib/coding.mjs` (+ `agents/mock.mjs` za testni knob),
bez novih uloga, servisa, baze ili sloja:

- **prihvatanje traži izričit `pass`** i potpunu evidenciju (reprodukcija,
  provera, pad na osnovi kao **tvrdnja**, pregledan SHA, integraciona proba);
- **`saZakupom`**: zakup se obnavlja tokom poziva agenta, tokom test komandi i
  tokom baseline provere; gubitak zakupa prekida posao; zakup se proverava
  neposredno pre taga **i posle upisa taga**, pre merge-a;
- **spaja se tačno pregledani SHA** (`ev.review.sha`), a ne ime grane; grana i
  osnovica se proveravaju posle integracione provere i pre merge-a;
- **promenjena osnovica poništava pregled** i traži nov (bez automatskog rebase-a);
- **dokazni tag pre merge-a**, neuspeh upisa prekida fazu (nema drugog, nekontrolisanog upisa);
- **reviewer mora biti drugi vendor** od autora popravke;
- **postojeći testovi se ne smeju menjati**, a nova preskakanja se odbijaju
  (`test.skip`, `test['skip']`, `test[\`skip\`]`, `skip: true`);
- **klasifikacija pada na osnovi**: assertion jeste dokaz; `TypeError`,
  `ReferenceError`, `SyntaxError`, import greška i **timeout (uključujući exit 124)**
  nisu;
- **`code_target` se poredi preko `realpath`-a** (simbolički link na kontrolni
  repo se odbija);
- **memorija ide u `.agent-context/MEMORY.md`**, nikad u projektni `MEMORY.md`.

## 4. Autorove provere

- `tests/coding-robustness.test.mjs`: **19 kontrolnih testova** (R1–R19), svaki
  vezan za konkretan nalaz; svi su padali pre odgovarajuće ispravke.
- `tests/coding.test.mjs` (6 testova) i ostatak skupa: **174/174**.

## 5. Nezavisne provere (Codex, nit `verify`, `mode: full`)

| Runda | Kandidat | Log | Ishod |
|---|---|---|---|
| 1 | `a65dfbc` | `codex-mv9x2c1p-17cc4d23.log` | oboreno 5 tvrdnji (zakup, race grane, osnovica, klasifikacija, skip) |
| 2 | `f1aa57b` | `codex-mv9xf0rv-6f2ed39a.log` | potvrđeno 3, oboreno 3 (zakup tokom taga, timeout, backtick skip) |
| 3 | `87b20c5` | `codex-mv9xjsch-b7d46867.log` | **sve ciljane korekcije potvrđene** + kontrole (trka, osnovica, tag) |

Puni odgovori: [codex-pregled-coding-toka.md](dokazi-k9/codex-pregled-coding-toka.md),
[codex-potvrda-popravki.md](dokazi-k9/codex-potvrda-popravki.md),
[codex-treca-provera.md](dokazi-k9/codex-treca-provera.md).
Codex je u jednom trenutku bio bez kvote; tada je zabeleženo, a poslednje tri
runde (uključujući ogled) izvršene su Codex-om kao **drugim vendorom** od autora
popravke (`dsh`).

## 6. Završni coding ogled (revizija `242b4d0`)

Kontrolni vault `/home/gru/k10-vault`, ciljni repo `/home/gru/k10-target`
(osnova `2a53c54d…`, sa **postojećim projektnim `MEMORY.md`**).
**2 model poziva, 2 min 34 s** (21:28:24 → 21:30:58). Bez ijedne ručne intervencije.

| # | Kriterijum | Ishod | Dokaz |
|---|---|---|---|
| 1 | bug pada na osnovi i prolazi posle | **DA** | `reproduce.exitCode = 1`, `check = {exit 0, repro 0}`, `baseline = {exit 1, kind assertion}` |
| 2 | postojeći testovi ostaju validni | **DA** | `tests/range.test.js` nije menjan (0 izmena) i prolazi |
| 3 | drugi vendor pravi i izvršava sopstveni scenario | **DA** | `codex`, `VERDICT: pass`; scenario `control.mjs` + logovi u [reviewer-scenario](dokazi-k10/reviewer-scenario/) |
| 4 | samo dozvoljeni kod i testovi ulaze u repo | **DA** | `git diff --name-only 2a53c54..HEAD` → `src/range.js`, `tests/granice.test.js` |
| 5 | `MEMORY.md` ne ulazi u istoriju i ne uništava projektni | **DA** | jedini commit koji ga dira je početni (`2a53c54`); nema diff-a; sadržaj nepromenjen; izvoz je u `.agent-context/MEMORY.md` |
| 6 | prihvaćen je tačno pregledan i testiran rezultat | **DA** | `review.sha = accept.reviewed = c9a3ed8c…` = vrh grane; `tree = integration_tree = 9b07ad56…`; `integration.ok = true` |
| 7 | dokaz ponovljiv iz čistog checkout-a | **DA** | klon `--no-local`: `npm test` prolazi, repro prolazi, tag `dokaz/TASK-101-accept`, reviewer scenario prolazi |
| 8 | zapis iskustva vraćen u wiki | **DA** | `wiki/Izmene/TASK-101.md` (autori `agentctl, dsh, codex`), komitovan |

## 7. Ograničenja

1. **Ovo je dokaz fixture-a, ne spremnosti za proizvoljan stvarni repozitorijum.**
   Dokazano je: tok, kapije, zakup, nezavisnost vendora, ponovljivost na malom
   Node projektu bez zavisnosti. Nije dokazano: veliki diff, mrežne zavisnosti,
   dugi testovi, višejezični projekti, konkurentni rad drugih ljudi na istom repou.
2. **Preostali race prozor:** između poslednje provere grane/osnovice/zakupa i
   samog `git merge` postoji kratak interval. Zatvoren je za spore upise
   (dokazano), ali nije atomski; potpuno zatvaranje bi tražilo zaključavanje
   reference na strani Gita.
3. **`code_scope` je lista globova koju zadaje operater** — preširok opseg ne bi
   bio odbijen; nema provere „diff pripada zadatku“ po sadržaju.
4. **Memorija je jednosmerna po autorstvu:** agent je čita, zapis piše kontrolni
   sloj. Tok kojim memorija sama nastaje iz iskustva nije predmet ovog dokaza.
5. Nezavisan pregled je radio Codex nad **jednim** fixture-om; to nije
   sertifikat sistema i nije zamena za pregled na stvarnom projektu.
