# Prvi coding prolaz — dokazi

[Dokumentacija](README.md) · [Plan](PLAN-CODING-TOK.md) · [Dokazi (fixture)](dokazi-k9/)

Datum: 15. oktobar 2026.
Polazna revizija kontrolnog koda: `480db23` (plan) → tok izgrađen u `8a7f837`.
Zvanični prolaz izvršen na kontrolnoj reviziji **`72165db`**, ciljni repozitorijum
`/home/gru/k9-target-3` (osnova `5157b69796aa2f2630c20f943e4eb44fbeff8138`).

## 1. Koji programski zadatak je sistem rešio

Mali Node projekat `range-fixture` sa poznatim bugom: funkcija `parseRange` je
granicu `0` gubila kao falsy vrednost (`Number('0') || null` → `null`).
Zamrznut zahtev ([ZAHTEV.md](../fixtures/code-target/ZAHTEV.md), bez gotovog
rešenja): `parseRange('0-3')` → `{ from: 0, to: 3 }`, `parseRange('0')` →
`{ from: 0, to: 0 }`, neispravan ulaz se i dalje odbija.

Rezultat: zadatak `TASK-101` je `consolidated`; popravka i regresioni test su
prihvaćeni u `main` ciljnog repoa (`b096aa73`), uz dokazni tag
`dokaz/TASK-101-accept`.

## 2. Ko je pisao kod i testove

- **Kod i regresioni test:** uloga `programer`, harnes **`dsh`** (DeepSeek
  Harness), u izolovanom git worktree-u ciljnog repoa. Commit
  `fe027df7d11b50c5d1e310eb8dd9d3fa5d6d7293`, autor `dsh`.
  Fajlovi: `src/range.js`, `tests/range-zero.test.js`.
- **Kontrolni sloj** (dsh kao orkestrator) je napisao kapije, tok i testove toka —
  ali **nije** pisao popravku ni regresioni test ciljnog projekta.

## 3. Ko je nezavisno proveravao

- **`agy` (Google Antigravity/Gemini)** — vendor različit od autora. Napisao je
  sopstveni kontrolni scenario `.agent-review/reviewer-control.js`, izvršio ga i
  dao `VERDICT: pass`.
- **Codex je bio prvi izbor i nije bio dostupan:** njegov poziv je vratio
  `You've hit your usage limit ... try again at 1:23 PM` (spoljna prepreka, ne
  defekt sistema). Zato je nezavisni pregled obavio drugi dostupan vendor, što je
  u ovom izveštaju izričito navedeno.
- Scenariji u kojima **nema** nezavisnog pregleda ne prolaze: faza odbija nalaz
  bez verdikta (drugi prolaz je tako i pao).

## 4. Koje su komande pale pre i prošle posle

| Komanda | Pre popravke (osnova `5157b69`) | Posle popravke (`b096aa7`) |
|---|---|---|
| `bash /home/gru/k9-repro.sh` (kratka reprodukcija) | **exit 1** — `BUG: from = null` | **exit 0** — `OK: from = 0` |
| `npm test` (postojeći testovi) | exit 0 (bug nije bio pokriven) | **exit 0**, 7/7 |
| `npm test` sa regresionim testom, na osnovi | **exit 1** — 5 padajućih testova | — |
| `node .agent-review/reviewer-control.js` (scenario reviewera) | **exit 1** | **exit 0** |

Dokaz 1 je izveo **kontrolni sloj**, ne agent: u koraku `check` regresioni test se
prekopira u čist worktree na početnoj reviziji i tamo **mora pasti**
(`code_evidence.baseline.exitCode = 1`, 5 padajućih testova).

## 5. Da li je bilo ručnih intervencija

**Nije bilo.** Nijedno podešavanje statusa, pečata, opsega ni override-a; nijedna
izmena koda ili kriterijuma tokom prolaza. Tok je sam izveo:

```
reproduce → implement (dsh) → check → review (agy) → accept (merge u main)
```

Tokom prolaza je potrošeno **2 model poziva** (jedan programer, jedan reviewer) i
**3 min 39 s** (10:19:32 → 10:23:11).

Prva dva prolaza su **pala** i njihovi uzroci su dijagnostikovani i popravljeni
van prolaza (revizije `8f54794` i `72165db`):

1. faza `code` je birala samo `ready` zadatke, pa je zadatak posle izrade ostao
   u `verified` i pregled se nikad nije pokrenuo;
2. nezavisni pregled je pokušan Codex-om, koji je bio bez kvote — nalaz je ostao
   prazan i faza ga je ispravno odbila.

## 6. Šta je ponovljivo iz čistog checkout-a

```bash
git clone --no-local /home/gru/k9-target-3 /tmp/provera && cd /tmp/provera
npm test                                  # 7/7 prolazi
bash /home/gru/k9-repro.sh                # OK: from = 0
git checkout 5157b69 && bash /home/gru/k9-repro.sh   # pada (bug se reprodukuje)
git log --oneline -1                      # b096aa7 agentctl(TASK-101): prihvacena popravka
git tag --list                            # dokaz/TASK-101-accept
```

Reviewer-ov scenario iz čistog checkout-a: `mkdir .agent-review && cp
docs/dokazi-k9/reviewer-control.js .agent-review/` pa
`node .agent-review/reviewer-control.js` → prolazi na prihvaćenoj reviziji, a
**pada** na početnoj (nije tautologija).

## 7. Dokazi (šest tačaka iz zahteva)

| # | Dokaz | Gde |
|---|---|---|
| 1 | regresioni test pada na početnoj reviziji | `code_evidence.baseline` (exit 1, 5 padajućih) |
| 2 | posle popravke prolazi | `code_evidence.check` (exit 0, 7/7) |
| 3 | postojeće provere prolaze | `npm test` u čistom klonu; nepromenjen `tests/range.test.js` |
| 4 | nezavisan pregled sa sopstvenim slučajem | [TASK-101-review.md](dokazi-k9/TASK-101-review.md) + [reviewer-control.js](dokazi-k9/reviewer-control.js) |
| 5 | diff ograničen na zadatak | `code_evidence.implement.outside = []`; izmene samo `src/**`, `tests/**` |
| 6 | commit za pregled iz čistog checkout-a | ciljni repo `b096aa7`, tag `dokaz/TASK-101-accept` |

**Negativni scenario** (mora sprečiti prihvatanje) — pokriveno testovima
`tests/coding.test.mjs`:

- izmena van `code_scope` → `ok: false`, `reason: izmena van dozvoljenog opsega`,
  zadatak se vraća u `ready`, ništa ne ulazi u ciljni repo;
- test ne prolazi posle popravke → odbijeno pre merge-a;
- bug koji se ne reprodukuje (repro prolazi na osnovi) → odbijeno.

## 8. Ograničenja

1. **Nezavisni pregled je obavio drugi vendor, ali ne Codex** (kvota). Nezavisnost
   od autora je zadovoljena; ponavljanje Codex-om ostaje otvoreno.
2. Pregled je radio nad izolovanim checkout-om, ali **nije** ponovo pokrenuo
   punu proveru iz svežeg klona; to je uradio kontrolni sloj (gore).
3. Fixture je namerno mali; stvarni projekat donosi veće diff-ove, zavisnosti i
   duže testove — kapije (opseg, „test pada na osnovi“, nezavisan nalaz) ostaju
   iste, ali granice nisu izmerene na stvarnom repozitorijumu.
4. `code_scope` je lista globova; zadatak se oslanja na to da je operater zadaje
   precizno. Pogrešno širok opseg ne bi bio odbijen.
