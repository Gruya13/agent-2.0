# Dokazi — ponovljivost tekstualnog toka u tri čista vault-a

[Dokumentacija](README.md) · [Predlog posle koraka 4](../Agent-2.0-Predlog-za-dsh-posle-koraka-4.md) · [K1](DOKAZI-KORAK-1.md) · [K2](DOKAZI-KORAK-2.md) · [K3](DOKAZI-KORAK-3.md) · [K4](DOKAZI-KORAK-4.md)

Datum: 14. oktobar 2026.
Zamrznuta revizija: `b4d7fbe609b2aa7b420dfe8b4db86eefd91db142` (posle ispravke
artefakata i ispravke `init`-a).
Izvor: `raw/flatpak.md`, sha256 `e75f3f1ac30c2bdaa785b5be06006cf11b47e8c9085416ec461fca03f095be6d`
(isti kao u Koraku 3). Referentna lista: [K3-REFERENCA.md](K3-REFERENCA.md).
Konfiguracija: `tools/config/agents.real.yml` (agy / dsh / codex).

**Kriterijum uspeha (iz predloga):** tri sadržajno prihvatljiva `consolidated`
rezultata na istoj reviziji, u odvojenim vault-ima, bez ručnog podešavanja
stanja, sa ispravnim artefaktima i očuvanim granicama upisa.

**Ishod: kriterijum NIJE ispunjen.** Nijedan od tri prolaza nije stigao do
`consolidated`; sva tri su završila u `blocked` posle trećeg reproduktivnog
nalaza red-teama. Uzrok je dijagnostikovan i naveden ispod.

## 1. Ispravka potvrđene greške artefakata

Potvrđeno je šire dejstvo greške N14 iz Koraka 3:

- `detectArtifacts` je za ulogu `consolidator` vraćao **sve** beleške u `wiki/`;
  `normalizeConsolidatedNote` je zato prepisivao i tuđe beleške, a
  `setArtifacts` (pre merge-a) ih je upisivao u `artifacts` zadatka.
- Kapija čita `artifacts` kao **dozvoljene produkcione mete**
  (`zonePolicyFor`). Zato je u ponovljenom pokušaju `TASK-103` tuđa beleška
  postala deklarisan artefakt i njena izmena je **ušla u `main`**
  (`git show --stat 3f3cca0` → `wiki/Operativni_vodic_asinhronog_sistema.md | 2 +-`;
  polje `updated` i lista autora).

Popravke (revizija `35d60b2`):

1. snimak `before` pre poziva harnesa u fazama `research`, `extract` i
   `consolidate`, pa `detectArtifacts` vraća samo ono što je **taj** zadatak
   proizveo;
2. `setArtifacts` se upisuje tek **posle uspešnog** merge-a;
3. odbijen pokušaj ostavlja predložene putanje u **istoriji zadatka** (telo), ne u
   `artifacts`;
4. regresioni scenario `E2E: odbijena konsolidacija ne upisuje tuđu putanju u
   artifacts (retry je ne prihvata)` — pada bez ispravke, prolazi sa njom;
5. neovlašćena izmena tuđe beleške u `main` vraćena je kontrolisanom odlukom
   (dokaz ostaje u git istoriji i u ovom dokumentu).

Dodatna greška nađena pri pripremi čistih vault-ova (revizija `b4d7fbe`):
`agentctl init` nije komitovao `.gitignore` ni `.agents/`, pa ih **radna stabla
nisu imala** (prave se iz Gita). Posledica: `.runtime/task-context.json` je
izgledao kao tuđa izmena i faza `challenge` je padala, a MCP bi preskočio sloj
zadatka i zakupa. `init` sada komituje ugovor i alate; regresioni test u
`tests/cli.test.mjs`.

## 2. Tri prolaza

| # | Revizija | Vault | ID | Poziva | Trajanje | `verify` odbijanja | `challenge` nalaza | Ručne intervencije | Završni status | Artefakti |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `b4d7fbe` | `k6-vault-1` | TASK-101 | 11 (4 agy, 4 dsh, 3 dsh) | 44 min | 1 | 3 | **nema** | `blocked` | `wiki/drafts/Flatpak.md` |
| 2 | `b4d7fbe` | `k6-vault-2` | TASK-101 | 11 (4 agy, 4 dsh, 3 dsh) | 48 min | 1 | 3 | **nema** | `blocked` | `wiki/drafts/Flatpak.md` |
| 3 | `b4d7fbe` | `k6-vault-3` | TASK-101 | 11 (4 agy, 4 dsh, 3 dsh) | 38 min | 1 | 3 | **nema** | `blocked` | `wiki/drafts/Flatpak.md` |

- Sva tri vault-a su pripremljena samo postojećim alatima
  (`agentctl init` + `agentctl ingest`), sa istim izvorom (isti sha256), bez
  starih zadataka, zakupa, artefakata i tuđeg manifesta.
- Sve tri petlje su prošle **identičan** put:
  `research → verify fail (pokušaj 1) → research → verify pass → challenge
  reproducible → research → verify pass → challenge reproducible → research →
  verify pass → challenge reproducible (3. nalaz) → blocked`.
- Ručnih intervencija **nije bilo**: ni prepravljanja sadržaja, ni podešavanja
  `verification`/`challenge` polja, ni `override`.
- Artefakti su u sva tri slučaja tačno `["wiki/drafts/Flatpak.md"]` — ispravka iz
  odeljka 1 radi u stvarnom toku. Lint: 0 grešaka, 0 upozorenja u svima.

## 3. Dijagnoza: zašto nijedan prolaz nije završen

Red-team je u svakom prolazu dokazao **tri reproduktivna nalaza** (skript u svežem
klonu, exit 0, `OBORENO`). Nalazi su stvarni — nisu lažni i nisu tautologije
(red-team je radio i negativnu kontrolu). Dve klase nalaza se ponavljaju:

**(A) Nacrt tvrdi više od izvora, a verifikator to propusti.**
- Vault 1, NALAZ-1: revizija tvrdi „nema izmišljenih tvrdnji“, a nacrt uvodi
  „hardverske resurse“ kojih izvor nema.
- Vault 1, NALAZ-2: tvrdnja „jedini broj je 700.000“ je netačna.
- Vault 3, NALAZ-2/NALAZ-3: „mehanizam granularnih dozvola“, „komponenta“
  (Bubblewrap), „tehnologija“ (PipeWire) — reči kojih izvor ne sadrži, uz
  izjavu revizije „0 nalaza“.

**(B) Zapis zadatka na zamrznutoj reviziji nije u skladu sa stvarnošću.**
- Vault 2, NALAZ-1: `verification.commit`/`challenge.revision` pokazuju na
  reviziju koja **nije dosežna** iz zamrznute revizije (postoji samo kao
  *dangling* objekat u deljenom object store-u, pa je svež `git clone --no-local`
  ne prenosi), a `verification.summary` opisuje drugi blob nacrta.
- Vault 2, NALAZ-2: zapis tvrdi reprodukovane skripte kojih u zamrznutoj reviziji
  nema.
- Vault 2, NALAZ-3 / Vault 3, NALAZ-1: revizija netačno citira mesto pravila
  (`.agents/roles/researcher.md:4` umesto 16–17).
- Vault 3, NALAZ-4: uz `verdict: pass`, zapis na istoj reviziji još nosi
  `status: ready` i `verification.verdict: fail` iz prethodnog pokušaja.

**Koren klase (B)** je u kontrolnom sloju: faza `challenge` zamrzava **granu
verifikatora**, a fajl zadatka u toj grani je snimak crne table iz trenutka kada
je grana nastala. Invarijanta 11 („grana se pre spajanja rebase-uje na `main`“)
rešava to za merge, ali **ne** za red-team, koji radi pre rebase-a. Zato red-team
dobija reviziju na kojoj `tasks/inbox/TASK-101.md` i stvarno stanje ne moraju da
se poklope — i to dokazuje skriptom.

Za klasu (B) autor (istraživač) **ne može** da ispravi ništa: to nije sadržaj
nacrta nego evidencija kontrolnog sloja. Zato petlja ne može da se izvuče:
istraživač menja nacrt, verifikator daje `pass`, red-team ponovo obara evidenciju,
i posle `maxRevisions` zadatak ide u `blocked`.

## 4. Šta je potvrđeno, a šta nedostaje

**Potvrđeno:**
- kapija stvarno blokira neispravan sadržaj i neispravnu evidenciju (sva tri
  prolaza; nalazi su reprodukovani skriptom);
- ispravka artefakata radi u stvarnom toku (artefakti su čisti u sva tri vault-a);
- ispravka iz Koraka 4 radi u stvarnom toku: posle **svakog** nalaza istraživač
  dobija novi posao (4 `agy` poziva po vault-u);
- `init` sada ostavlja ugovor u Gitu, pa radna stabla imaju `.gitignore` i
  `.agents/AGENTS.md`.

**Nedostaje (precizno):**
1. **Nijedan `consolidated` rezultat** — dakle nema dokaza o ponovljivosti
   objavljivanja na ovoj reviziji. Sadržajni pregled iz odeljka 4 predloga nije
   primenljiv jer nijedna beleška nije objavljena.
2. **Tri prolaza na istoj reviziji nisu dovršena** u smislu kriterijuma; sva tri
   su prekinuta istim pravilom (`maxRevisions`).
3. **Nije dokazano** da bi ispravka klase (B) — sinhronizacija crne table pre
   zamrzavanja red-team revizije — dovela do `consolidated` rezultata; to je
   sledeći eksperiment, sa novom revizijom.

## 5. Šta bi bila minimalna sledeća korekcija (predlog, nije izvršena)

Pre zamrzavanja revizije za red-team, crna tabla (`tasks/`) u toj reviziji mora
biti aktuelna: npr. rebase verifikatorove grane na `main` **pre** faze
`challenge`, ili prosleđivanje red-teamu kontrolnog korena koji nije snimak
grane. Time bi nalazi klase (B) prestali da budu mogući, a klasa (A) ostaje
posao modela.

Ovo **nije izvršeno** u ovom zadatku: menja kontrolni tok i zahteva nove stvarne
provere, a zadatak je tražio minimalnu korekciju potvrđene greške **artefakata**.

## 6. Skup i regresije

- `npm test`: **143 prolaza, 0 padova**, dva uzastopna izvođenja na reviziji
  `b4d7fbe` (posle ispravke artefakata i `init`-a).
- Regresioni testovi dodati u ovom zadatku:
  `E2E: odbijena konsolidacija ne upisuje tuđu putanju u artifacts (retry je ne
  prihvata)` i `CLI: init komituje ugovor i alate (radna stabla ih moraju imati)`.
- Logovi tri prolaza: [k6-run-1](K6-tok-1.log) · [k6-run-2](K6-tok-2.log) ·
  [k6-run-3](K6-tok-3.log).
