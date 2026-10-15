# Wiki kao memorija i mesto coding toka

[Dokumentacija](README.md) · [Arhitektura](ARHITEKTURA.md) · [Plan coding toka](PLAN-CODING-TOK.md) · [Prvi coding prolaz](CODING-PROLaz-1.md)

Datum: 15. oktobar 2026. Pitanje: da li je wiki zamišljen kao memorijski
podsistem coding agenta i gde je predviđen coding tok?

## 1. Wiki je zamišljen kao MEMORIJA, ne kao predmet obrade

Arhitektonski dokument (`Arhitektura asinhronog multi-agentskog sistema.md`,
odnosno njegov izvor `raw/arhitektura-asinhronog-multi-agentskog-sistema.md`)
to kaže izričito:

> „Agenti međusobno ne komuniciraju neposrednim slanjem poruka, već isključivo
> posredstvom **globalno dostupne, postojane i strukturisane memorije**.“

> „Savremeni pandan klasičnoj crnoj tabli predstavlja koncept **LLM Vikija** ili
> kognitivne baze znanja… Markdown [je] najpogodniji format za uskladištenje
> **eksterne memorije** jezičkih modela.“

> „Uvođenjem tri heterogena modela… Obsidian skladište prestaje da bude pasivno
> skladište tekstova i transformiše se u **aktivnu crnu tablu** na kojoj se odvija
> koordinacija, verifikacija i stabilna akumulacija znanja.“

Isto ponavlja i `docs/ARHITEKTURA.md:7`:

> „Agent 2.0 je **crna tabla** nad lokalnim fajl sistemom. Agenti ostavljaju
> artefakte u svojim zonama, dok kontrolni sloj čita trajno stanje zadatka…“

Asimetrija iz arhitekture je takođe jasna: `raw/` je append-only skladište
primarnih dokaza, a `wiki/` je **kompajlirana baza znanja** koju održavaju modeli.

**Zaključak 1:** wiki je memorijski podsistem (crna tabla, eksterna memorija).
Obrada dokumenata je bila *prvi* sadržaj te memorije, ne njena svrha.

## 2. Coding tok nije bio predviđen — sada je dodat

Do ovog rada arhitektura i dokumentacija **nigde ne opisuju** coding tok:

- `docs/ARHITEKTURA.md` opisuje uloge nad beleškama (`researcher`, `verifier`,
  `red-team`, `librarian`, `consolidator`) i tok `ingest → research → verify →
  challenge → consolidate → reflect`;
- `docs/MODEL-PODATAKA.md` modeluje **zadatak**, **belešku**, **fragment**,
  **Vikilink**, **manifest izvora** i **dnevnik događaja** — nema pojma ciljnog
  repozitorijuma, opsega nad kodom ni komande provere;
- pretraga za „coding“ u dokumentaciji pre ovog rada ne daje ništa.

Coding tok je zato **dodat** i to kao nova vrsta zadatka, bez ukidanja stare:

- revizija `8a7f837`: `kind: code`, polja `code_target`, `code_base`,
  `code_scope`, `code_test`, `code_repro`, `code_evidence`, modul
  `lib/coding.mjs`, uloge `programer` i `reviewer`, faza `code` u kontrolnoj
  petlji, CLI komanda `code`;
- plan i granice: [PLAN-CODING-TOK.md](PLAN-CODING-TOK.md);
- prvi dokaz prolaza: [CODING-PROLaz-1.md](CODING-PROLaz-1.md).

**Zaključak 2:** mesto coding toka je uz postojeću crnu tablu — isti zadaci,
zakupi, worktree-i, adapteri i evidencija — a ne u novom servisu. Zadatak
`kind: code` je **druga vrsta posla nad istom memorijom**, ne zamena za
dokumentni tok.

## 3. Zaštite wiki-ja ostaju

Kapije se **ne** diraju i ne pretvaraju u dozvole za menjanje koda:

| Zaštita | Stanje |
|---|---|
| `zonePolicyFor` i `ROLE_ARTIFACT_ZONE` (`wiki/drafts/`, `wiki/`, `tasks/…`) | **nepromenjeno** |
| `mergeIntoMain` allow-lista u kontrolnom repou | **nepromenjeno** |
| `BOOKKEEPING_ALLOW` | proširena **samo** na `tasks/reviews/` (evidencija pregleda), ne na `wiki/` |
| `raw/` append-only, manifest izvora | **nepromenjeno** |
| MCP ugovor i provera zakupa | **nepromenjeno** |

Radni agent (programer) **nema** pravo pisanja u `wiki/`:
- `code_scope` važi za **ciljni** repozitorijum i ne obuhvata kontrolni wiki;
- putanje kontrolnog repoa nisu u `code_target` (proverava se pre svakog koraka);
- `wiki` upisuje **kontrolni sloj**, i to tek posle prihvaćene promene.

## 4. Kako zadatak koristi memoriju (i šta se time ne menja)

Veza je jednosmerna u oba smera, ali kroz kontrolni sloj:

1. **memorija → zadatak (čitanje):** zadatak može da navede `code_memory` (lista
   wiki belešaka). Kontrolni sloj ih pre poziva programera **eksportuje** u radno
   stablo ciljnog repoa kao `MEMORY.md`; agent ih čita kao kontekst i **ne može**
   ih menjati (fajl je van `code_scope` i ne komituje se).
2. **zadatak → memorija (zapis):** kada je promena prihvaćena, kontrolni sloj
   upisuje zapis u wiki (`wiki/Izmene/<TASK-ID>.md`) sa dokazima: zahtev,
   popravka, testovi, nezavisan pregled, merge. Piše `agentctl`, sa autorima iz
   evidencije zadatka.

Time wiki ostaje **memorija rada**, a ne zona pisanja radnog agenta.
