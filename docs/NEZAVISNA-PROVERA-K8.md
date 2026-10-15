# Nezavisna provera (Codex) — potvrdni prolaz K8

Izvor: log DSH spoljnog agenta (provider codex, nit verify, mode full):
`/home/gru/.dsh/external-agents/runs/codex-mv95yv2d-a9596a24.log`

Zadatak je prosledjen kroz postojeci DSH mehanizam (external_agent); Codex je
radio u svom worktree-u i sopstvenom svežem klonu, bez menjanja vault-a i
glavnog workspace-a.

---
**Tehnički trag i svih 13 referentnih tvrdnji su potvrđeni. Sadržaj nije bez rezerve ograničen na izvor: u „Otvorenim pitanjima“ postoje dodatne pretpostavke opisane ispod.**

Nisam menjao originalni vault ni kandidata. Sopstveni klon napravljen je komandom:
```bash
git clone --quiet --no-local /home/gru/k8-vault-1 .verification/k8-clone
```

HEAD klona:
```text
26838b891c6069b72fa9ff2ba8bbf416c262f2ac
```

Stablo `tools/orchestrator/lib` u klonu identično je onom na `bd9a6f0`:
```text
f2e1c8e18c3c27ac7891168a35dbb29a66a0d74c
```

**Pregled rezultata**

Glavna proverna komanda:
```bash
node .verification/audit-k8.mjs > .verification/audit-k8.log 2>&1
```

[Skripta](/home/gru/.agent-worktrees/verify-session-08b4-codex/.verification/audit-k8.mjs) i [stvarni izlaz](/home/gru/.agent-worktrees/verify-session-08b4-codex/.verification/audit-k8.log) sačuvani su za ponavljanje.

| Provera | Ishod | Dokaz |
|---|---|---|
| Sopstveni svež klon | POTVRĐENO | `clone --no-local` uspeo; klon ima zasebnu objektnu bazu |
| Tagovi odgovaraju evidenciji zadatka | POTVRĐENO | Oba taga pokazuju na tačne zabeležene komite |
| Oba dokazna komita dostupna u klonu | POTVRĐENO | Sva četiri `cat-file -e` poziva izlaze sa 0 |
| Integritet izvora | POTVRĐENO | SHA-256 odgovara zadatom |
| `created` iz zadatka i `created ≤ updated` | POTVRĐENO | Modelov datum nacrta zamenjen datumom zadatka |
| `artifacts` i zakup | POTVRĐENO | Samo `wiki/Flatpak.md`; fajl postoji; nema aktivnog zakupa |
| Granice objave i istorije | POTVRĐENO | Dva dozvoljena fajla u merge-u; nema tuđih beleški |
| Telo nacrta jednako objavljenom telu | POTVRĐENO | Identitet svih 6473 bajta, isti body blob i SHA-256 |
| Lint | POTVRĐENO | Originalni vault i klon: 0 grešaka, 0 upozorenja |
| Tekst sadrži isključivo tvrdnje iz izvora | OBORENO u strogom obliku | Dodatne formulacije u otvorenim pitanjima, red 59 |

**Dokazi u svežem klonu**

Komande:
```bash
git -C .verification/k8-clone for-each-ref \
  --format='%(refname) %(objectname)' refs/tags

git -C .verification/k8-clone cat-file -e \
  'dokaz/TASK-101-verify^{commit}'
git -C .verification/k8-clone cat-file -e \
  '8b6107335d0cee62d2e35f38609adcc6457b3b60^{commit}'

git -C .verification/k8-clone cat-file -e \
  'dokaz/TASK-101-challenge^{commit}'
git -C .verification/k8-clone cat-file -e \
  'f3ea29a8964a5580e8a39fbec64b651bb281ebac^{commit}'
```

Stvarni izlaz tagova:
```text
refs/tags/dokaz/TASK-101-challenge f3ea29a8964a5580e8a39fbec64b651bb281ebac
refs/tags/dokaz/TASK-101-verify 8b6107335d0cee62d2e35f38609adcc6457b3b60
```

Sva četiri `cat-file` poziva završila su kodom **0**, bez izlaza. Hash-evi su jednaki poljima `challenge.revision` i `verification.commit` u završenom zadatku.

**Svih 13 referentnih tvrdnji**

Poređenje je urađeno prema [izvoru](/home/gru/.agent-worktrees/verify-session-08b4-codex/.verification/k8-clone/raw/flatpak.md) i [objavljenoj belešci](/home/gru/.agent-worktrees/verify-session-08b4-codex/.verification/k8-clone/wiki/Flatpak.md), uz `nl -ba` za brojeve redova.

| # | Tvrdnja | Ishod | Izvor → beleška |
|---|---|---|---|
| 1 | Naziv xdg-app do 2016. | POTVRĐENO — prisutna i tačna | 7 → 20, 32 |
| 2 | Distribucija softvera i upravljanje paketima na Linuxu | POTVRĐENO — prisutna i tačna | 7 → 20, 32 |
| 3 | Izolovano izvršavanje u sandbox-u | POTVRĐENO — prisutna i tačna | 7 → 20, 32 |
| 4 | Dozvole: Bluetooth, zvuk/PipeWire, mreža, fajlovi | POTVRĐENO — prisutna i tačna | 9 → 22, 33 |
| 5 | Održavalac konfiguriše dozvole, korisnik ih menja | POTVRĐENO — prisutna i tačna | 9 → 22, 33 |
| 6 | Direktna ažuriranja bez posredovanja distribucija | POTVRĐENO — prisutna i tačna | 11 → 24, 34 |
| 7 | Veći prostor zbog sandbox okruženja | POTVRĐENO — prisutna i tačna | 13 → 26, 35 |
| 8 | OSTree deduplikacija i kasnija efikasnost prostora | POTVRĐENO — prisutna i tačna | 13 → 26, 36 |
| 9 | Flathub/flathub.org kao de facto standard | POTVRĐENO — prisutna i tačna | 15 → 28, 37 |
| 10 | Do 2023, više od 700.000 preuzimanja dnevno | POTVRĐENO — broj i kontekst očuvani | 15 → 38 |
| 11 | Nezavisni Flatpak repozitorijum | POTVRĐENO — prisutna i tačna | 17 → 39 |
| 12 | Dostupnost Bubblewrap-a i OSTree-a kao uslov instalacije | POTVRĐENO — prisutna i tačna | 19 → 40 |
| 13 | Upotreba na ChromeOS-u | POTVRĐENO — prisutna i tačna | 19 → 41 |

Konkretna rečenica za referentnu tvrdnju 10:
> „Do 2023. godine Flathub je beležio više od 700.000 preuzimanja dnevno.“

To nije predstavljeno kao statistika za 2026. Red 61 dodatno navodi da aktuelni podaci nisu sadržani u izvoru.

Izračunati SHA-256 izvora:
```text
e75f3f1ac30c2bdaa785b5be06006cf11b47e8c9085416ec461fca03f095be6d
```

**Metapodaci, evidencija i granice**

Stvarni rezultat provere datuma:
```text
draftCreated:     2026-10-15T06:22:00.000Z
taskCreated:      2026-10-15T06:14:28.985Z
publishedCreated: 2026-10-15T06:14:28.985Z
publishedUpdated: 2026-10-15T06:33:43.424Z
equalToTask: true
ordered: true
```

Objavljeno je, dakle, vreme iz evidencije zadatka, u skladu sa dogovorom.

Evidencija zadatka:
```text
status: consolidated
artifacts: ["wiki/Flatpak.md"]
artifactExists: true
lock_owner: null
lock_token: null
lease_expires_at: null
challenge: clean
scripts: []
```

Komande:
```bash
git -C .verification/k8-clone ls-tree -r --name-only HEAD wiki
git -C .verification/k8-clone diff --name-status 70f4d08^1 70f4d08
```

Stvarni izlazi:
```text
wiki/Flatpak.md
wiki/Index.md
```
```text
A	tasks/reviews/TASK-101.md
A	wiki/Flatpak.md
```

Promena merge-a merena je prema prvom roditelju, odnosno prethodnom stanju main-a.

Komande za istoriju:
```bash
git -C .verification/k8-clone log --first-parent main \
  --format= --name-only -- wiki | sort -u

git -C .verification/k8-clone log main \
  --format= --name-only -- wiki | sort -u
```

Prvi izlaz:
```text
wiki/Flatpak.md
wiki/Index.md
```

Cela dosežna istorija dodatno sadrži samo sopstveni nacrt:
```text
wiki/Flatpak.md
wiki/Index.md
wiki/drafts/Flatpak.md
```

Nema tuđih beleški.

**Veza nacrt → objavljeno**

Blobovi su izračunati iz stvarnih bajtova:
```text
nacrt na challenge tagu:
cc092095fe5d4192bb81b0acea9f18e391055914

nacrt na verification.commit:
cc092095fe5d4192bb81b0acea9f18e391055914

objavljena cela beleška:
c88a04024db3f825e673c9152121c0e3b17ee938
```

Posle uklanjanja samo YAML frontmatter-a:
```text
draftBody:     348bf168a4b5e60f98fc36db4aa5126e9cab3f8a
publishedBody: 348bf168a4b5e60f98fc36db4aa5126e9cab3f8a
bodyBytes: 6473
bodyEqual: true
```

SHA-256 oba tela:
```text
a121b416f596da3783980b83754fbe9bc65e668741ac7d0290b6c020b36cb471
```

**Sadržajno sporne tačke**

Glavne tvrdnje verno prenose izvor. Generički naziv „tehnologija“ za Bubblewrap/PipeWire ne uvodi sam po sebi tvrdnju o arhitekturi ili privilegijama; odsustvo identične reči u izvoru nije dokaz greške.

Rezerva je [red 59](/home/gru/.agent-worktrees/verify-session-08b4-codex/.verification/k8-clone/wiki/Flatpak.md:59):

- „neophodnost podrške za neprivilegovane korisničke prostore imena“ može se pročitati kao već utvrđen tehnički zahtev;
- „nestandardnim C bibliotekama (poput musl libc)“ dodaje klasifikaciju koju izvor ne daje.

**Ulaz:** izvor govori o teorijskoj instalaciji uz dostupnost Bubblewrap-a i OSTree-a.  
**Očekivano:** dodatni tehnički uslovi ostaju jasno formulisana pitanja ili hipoteze.  
**Dobijeno:** navedene formulacije unose pretpostavke u opis onoga što nedostaje izvoru.

Ne tvrdim da su te pretpostavke stvarno netačne; tvrdim da nisu dokazane dostavljenim izvorom. Pominjanje XDG Desktop Portals u narednom otvorenom pitanju čitam kao predlog teme za istraživanje, ne kao potvrđenu tvrdnju da ih Flatpak ovde koristi.

**Lint**

Iz direktorijuma sopstvenog klona izvršeno je:
```bash
node tools/orchestrator/cli.mjs lint --vault /home/gru/k8-vault-1
```

Stvarni izlaz:
```text
OK — nema nalaza; invarijante ugovora su zadovoljene.

grešaka: 0, upozorenja: 0
```

Izlazni kod: **0**. Isti rezultat dobijen je i za sopstveni klon. Lint ne razrešava navedene semantičke rezerve.

**Ograničenja i konačna ocena**

Pregledan je jedan završeni rezultat, bez novih modelskih poziva. Zapisi odgovaraju nizu `research → verify → research → verify → challenge → consolidate`; sami Git i logovi ne mogu dokazati odsustvo svake nezabeležene ručne intervencije. Klon je posle provere čist.

**Rezultat ovog prolaza potvrđen je za dokazni trag, granice, metapodatke, identitet tela i svih 13 referentnih tvrdnji. Nije bezuslovno potvrđen kao tekst sastavljen isključivo od izvorom potkrepljenih tvrdnji, zbog navedenih formulacija u „Otvorenim pitanjima“.**
