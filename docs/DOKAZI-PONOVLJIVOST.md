# Dokazi — ponovljivost tekstualnog toka u tri čista vault-a

[Dokumentacija](README.md) · [Predlog posle koraka 4](../Agent-2.0-Predlog-za-dsh-posle-koraka-4.md) · [K1](DOKAZI-KORAK-1.md) · [K2](DOKAZI-KORAK-2.md) · [K3](DOKAZI-KORAK-3.md) · [K4](DOKAZI-KORAK-4.md)

Datum: 14/15. oktobar 2026.
Izvor (isti u svim prolazima): `raw/flatpak.md`, sha256
`e75f3f1ac30c2bdaa785b5be06006cf11b47e8c9085416ec461fca03f095be6d`.
Referentna lista: [K3-REFERENCA.md](K3-REFERENCA.md).
Konfiguracija: `tools/config/agents.real.yml` (agy / dsh / codex).

**Kriterijum:** tri sadržajno prihvatljiva `consolidated` rezultata na istoj
reviziji, u odvojenim vault-ima, bez ručnog podešavanja stanja, sa ispravnim
artefaktima i očuvanim granicama upisa.

**Ishod: 2 od 3.** Vault 1 i vault 3 su `consolidated`; vault 2 je `blocked`
posle reproduktivnog nalaza red-teama. Kriterijum u celini **nije** ispunjen —
tačan dokaz koji nedostaje naveden je u odeljku 5.

## 1. Šta je ispravljeno pre ove runde

1. **Evidencija na zamrznutoj reviziji** (`6735b6c`). Red-team je u prethodnoj
   rundi obarao *evidenciju*, ne sadržaj: grana nosi snimak `tasks/` iz trenutka
   nastanka, pa je zapis mogao da tvrdi verifikaciju na nedosežnoj reviziji,
   skripte kojih u reviziji nema, ili stari status i verdikt. Sada se pre
   zamrzavanja u radno stablo prenosi aktuelni zapis zadatka (bez polja
   `challenge`, koje pripada prethodnom pokušaju i ostaje u istoriji tela), a
   provera zone se meri od te revizije. Dokaz lokalnim testom:
   `E2E: red-team dobija usklađen zapis zadatka na zamrznutoj reviziji` — pada
   bez ispravke, prolazi sa njom.
2. **`created` u objavljenoj belešci** (`0700160`). Vault 3 je objavio belešku sa
   `created: 2026-10-15T00:15:00.000Z` dok je `updated` bio `2026-10-14T22:23` —
   vreme posle sopstvenog izvora; isti razred je u vault-u 2 blokirao zadatak.
   `normalizeConsolidatedNote` je verovao modelu; sada `created` dolazi iz zapisa
   zadatka. Test: `E2E: objavljena beleška nosi created iz evidencije zadatka`.
3. **Povremeni pad testa trke** (`c9b8264`). Pod opterećenjem celog skupa ne
   pokrene se svih 10 dece, pa je test padao bez veze sa lockom. Sada se traži
   bar 10 od 12 procesa i nema preklapanja; kod pre ispravke trke i dalje pada
   (4/4), a skup je stabilan.

## 2. Tri prolaza (revizija `6735b6c`, jedan po jedan)

| # | Vault | ID | Poziva | Trajanje | `verify` odbijanja | `challenge` | Ručne intervencije | Status | Artefakti |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `k7-vault-1` | TASK-101 | 12 | 39 min | 1 (pokušaj 1) | 2 reproduktivna, pa **čist** | **nema** | **consolidated** (`b0d205c2`) | `wiki/Flatpak.md` |
| 2 | `k7-vault-2` | TASK-101 | 10 | 33 min | 2 | 1 reproduktivan, pa **blokada** | **nema** | `blocked` | `wiki/drafts/Flatpak.md` |
| 3 | `k7-vault-3` | TASK-101 | 12 | 37 min | 1 | 2 reproduktivna, pa **čist** | **nema** | **consolidated** (`b790f1b7`) | `wiki/Flatpak.md` |

Pozivi po vault-u (1 i 3): 4 `agy` (istraživač), 4 `dsh` (verifikator), 3 `dsh`
(red-team), 1 `codex` (konsolidator). Vault 2: 4 + 4 + 2 (bez konsolidatora).

Petlja je u svim prolazima prošla pun ciklus ispravke: posle **svakog** nalaza
istraživač dobija novi posao (ispravka iz Koraka 4 radi u stvarnom toku).
Nijedan prolaz nije tražio ručno vraćanje stanja, podešavanje polja ni override.

## 3. Pregled sadržaja

- **Vault 1** (`wiki/Flatpak.md`, 60 redova): svih 13 referentnih tvrdnji
  prisutno, broj **700.000** očuvan, WSL/ChromeOS i uslov „uz Bubblewrap i
  OSTree“ tačni, neizvesnost označena. `created` = vreme zadatka.
- **Vault 3** (`wiki/Flatpak.md`): sve ključne tvrdnje i brojevi prisutni,
  neizvesnost označena, indeks sadrži `[[Flatpak]]`, zadatak `consolidated`,
  nema aktivnog zakupa. **Ali** `created` je bio netačan (vreme posle `updated`) —
  to je nalaz iz odeljka 1.2 i on je popravljen posle ovih prolaza.
- **Vault 2**: nema objavljene beleške. Završni nalaz red-teama: „lažan
  `created` u zaglavlju nacrta“ (isti razred). Artefakti ostaju na nacrtu —
  ispravka iz Koraka 3/4 radi: kapija nije pustila ništa u `main`.

## 4. Ograničenja zapažena pri radu

- Poruka blokade u vault-u 2 glasi „red-team je reprodukovao nalaz **1** put(a)
  (dozvoljeno 3)“ iako je zadatak blokiran po **brojaču** ulazaka u `review`
  (N17 iz Koraka 4). Poruka navodi broj nalaza iz tog prolaza, a ne vrednost
  brojača koja je odlučila; to je zbunjujuće, ali ne menja ponašanje.
- Red-team i verifikator dele vendor (`dsh`); korelacioni rizik je zabeležen u
  svakom prolazu.

## 5. Šta nedostaje (precizno)

1. **Treći `consolidated` rezultat** na istoj reviziji. Vault 2 je blokiran
   nalazom koji je red-team dokazao skriptom; autor je ispravljao nacrt dva puta,
   ali zadatak je dostigao dozvoljeni broj pokušaja. Da bi kriterijum bio
   ispunjen, potreban je prolaz u kome nijedan reproduktivni nalaz ne ostane
   posle dozvoljenog broja ispravki.
2. **Potvrda ispravke `created`** na novoj reviziji (`0700160`): tri prolaza su
   izvršena na `6735b6c`, pre te ispravke. Prolazi se **ne smeju** spajati u
   tvrdnju „tri prolaza na istoj reviziji“ sa novom revizijom.
3. **Ponovljivost na novoj reviziji** nije izmerena; prva dva prolaza i treći
   pokazuju da je ishod zavisan od sadržaja koji modeli proizvedu (klasa A), a ne
   od kontrolnog sloja.

## 6. Zaključak

- Kontrolni sloj sada **samostalno** dovodi zadatak od `raw` izvora do
  `consolidated` produkcione beleške sa stvarnim modelima, bez ručnih
  intervencija (vaultovi 1 i 3), uz tačne artefakte i očuvane granice upisa.
- Kada sadržaj ne zadovolji kapiju, zadatak se **blokira** i ništa ne ulazi u
  `main` (vault 2) — kapija je radila tri puta u tri prolaza.
- Ponovljivost u smislu „tri od tri“ **nije dokazana**; dokaz koji nedostaje je
  naveden u odeljku 5.



## 8. Odgovor na poruku o nezavisnosti provere

[Poruka](../docs/PORUKA-ZA-DSH-NEZAVISNA-PROVERA.md) je primljena i primenjena.
Puni zapis rundi je u [NEZAVISNA-PROVERA-CODEX.md](NEZAVISNA-PROVERA-CODEX.md).

**Šta prihvatam:**
1. Razdvajanje izvršioca i konačne provere: dsh menja kod i piše regresione
   testove, a nezavisnu proveru završne promene radi drugi vendor. Tako je i
   urađeno (pet Codex rundi kroz postojeći DSH mehanizam, bez nove uloge,
   servisa ili kapije).
2. Nalaz kontrolnog sloja **ne vraća se istraživaču** kao da može da ga ispravi.
   U ovoj rundi su tri takva nalaza (zastarela evidencija, dokaz koji ne putuje,
   zakup u revizorskom toku) popravljena u odgovarajućem modulu.
3. Autor ne zatvara nalaz oznakom „nezavisno potvrđeno“ na osnovu svog testa.
   U zapisu je izričito odvojeno šta je Codex potvrdio od autorovog tumačenja.
4. Spor o značenju se **ne preglasava tiho**: nalaz K6-3 (Bubblewrap
   „zavisnost“) je zabeležen kao spor jer skript dokazuje leksičku, a ne nužno
   semantičku razliku; K7-2 je ocenjen kao osnovan. Nijedan override nije
   korišćen.

**Koja revizija je išla na nezavisan pregled:** polazna `b345b47` →
kandidati `892d3c0` → `9c3676b` → `ddf856d` → `7aab767` → `bd9a6f0`
(svaka sledeća zbog dokazivog nalaza prethodne runde).

**Šta je nezavisno potvrđeno:** tačnost nacrta u zamrznutoj reviziji (blob, ne
ime), aktuelnost verifikacionih polja, očuvanje sadržaja pri sinhronizaciji,
očuvanje kapija (challenge, zone, zakup), dokaz u svežem klonu posle ispravke,
poredak `created`/\`updated\`, neuspeh upisa dokaznog taga u oba toka sa
ponovnim pokušajem, i skup 149/149 u tri izvođenja.

**Šta ostaje otvoreno:**
1. **Ispravke iz rundi 2–5 nisu proverene stvarnim sadržajnim prolazom.** K7
   prolazi su izvršeni na `6735b6c`, pre njih. Codex preporučuje jedan
   ograničen realni prolaz (sa proverom kloniranja dokaza posle konsolidacije),
   tek posle čega bi kriterijum „tri od tri“ ponovo imao smisla.
2. **Spor o značenju** nalaza K6-3 ostaje zabeležen, bez izmene kapije.
3. **Poruka blokade** u `challenge` fazi i dalje navodi broj nalaza iz tog
   prolaza, a ne vrednost brojača koji je odlučio (N17).

## 7. Istorijski kontekst (prethodna runda, revizija `b4d7fbe`)

Na reviziji pre ispravke evidencije, sva tri prolaza su bila `blocked` (11
poziva svaki), jer je red-team obarao zapis zadatka, a ne sadržaj: nedosežna
revizija u `verification.commit`, skripte kojih u reviziji nema, stari status i
verdikt. Logovi te runde: [k6-1](K6-tok-1.log) · [k6-2](K6-tok-2.log) ·
[k6-3](K6-tok-3.log). Ta runda je i dovela do ispravke iz odeljka 1.1.

Logovi završne runde: [k7-1](K7-tok-1.log) · [k7-2](K7-tok-2.log) ·
[k7-3](K7-tok-3.log).
