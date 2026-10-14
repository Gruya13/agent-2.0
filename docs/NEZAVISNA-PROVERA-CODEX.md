# Nezavisna provera (Codex) — zapis rundi i nalaza

[Dokumentacija](README.md) · [Ponovljivost](DOKAZI-PONOVLJIVOST.md) · [Poruka o nezavisnosti](PORUKA-ZA-DSH-NEZAVISNA-PROVERA.md)

Datum: 15. oktobar 2026.
Zahtev: [PORUKA-ZA-DSH-NEZAVISNA-PROVERA.md](PORUKA-ZA-DSH-NEZAVISNA-PROVERA.md) —
nezavisnu proveru završne relevantne promene obavlja vendor koji nije autor
promene; dsh je izvršilac, Codex proverava.

Svi pozivi su izvršeni kroz postojeći DSH mehanizam (`external_agent`,
`verify` nit, `mode: full`). Logovi su u `~/.dsh/external-agents/runs/` i
navedeni su uz svaku rundu. Puna verzija odgovora je u logu; ovde je sažetak sa
ishodima, komandama i dokazima.

## Runde

| # | Kandidat | Log | Ishod |
|---|---|---|---|
| 1 | `892d3c0` | `codex-mv8osemn-b8d58f48.log` | tvrdnje 1, 2, 4, 5, 7 **potvrđene**; 3 i 6 **oborene** |
| 2 | `9c3676b` | `codex-mv8p1ral-d61d1586.log` | N1 oboren kao bezuslovna garancija (upis taga se ignoriše); N2, N3 potvrđeni |
| 3 | `ddf856d` | `codex-mv8p7kmp-287e0337.log` | izvorni kontraprimer zatvoren; varijanta oborena (nema ponovnog pokušaja) |
| 4 | `7aab767` | `codex-mv8pdbph-2442c1dd.log` | ingest potvrđen; **audit tok oboren** (zakup ostaje aktivan) |
| 5 | `bd9a6f0` | `codex-mv8pivkp-f343ac44.log` | U1–U4 **potvrđeni** |

## Nalazi i ispravke

1. **Dokaz ne putuje u svež klon** (runda 1, tvrdnja 3). Posle konsolidacije
   grane se brišu, pa `verification.commit` i `challenge.revision` ostaju samo
   kao nedosežni objekti izvornog object store-a. Ispravka (`9c3676b`): tagovi
   `dokaz/<id>-verify` i `dokaz/<id>-challenge` (tagovi se kloniraju po
   defaultu). Test: `E2E: dokaz posle konsolidacije je dostupan u svežem klonu`.
2. **`created` posle `updated`** (runda 1, tvrdnja 6). Ispravka (`9c3676b`):
   `created` iz evidencije zadatka + provera poretka. Test:
   `E2E: normalizeConsolidatedNote ne dopušta created posle updated`.
3. **Neuspeh upisa taga se ignorisao** (runda 2, kontraprimer: zaostao
   `refs/tags/dokaz/<id>-verify.lock`, git izlazi 128). Ispravka (`ddf856d`):
   provera da je tag nastao; ako nije, faza se prekida.
4. **Označavanje posle tranzicije** (runda 3): posle neuspeha zadatak je već bio
   `consolidated`, pa ponovni pokušaj nije bio moguć. Ispravka (`7aab767`):
   označavanje **pre** merge-a, a neuspeh kroz `failPhase` u `verified`.
5. **Zakup u revizorskom toku** (runda 4): `mergeAudit` nije pamtiо token
   zakupa, pa `failPhase` nije mogao da ga otpusti i zadatak je ostajao
   `in_progress`. Ispravka (`bd9a6f0`): token se pamti. Test:
   `E2E: neuspeh dokaznog taga u revizorskom toku otpušta zakup i dopušta
   ponovni pokušaj`.

Svih pet ispravki ima regresioni test koji **pada bez ispravke** i prolazi sa
njom; skup je **149/149** u tri uzastopna izvođenja.

## Spor o značenju sadržaja (zabeležen, ne preglasán)

Runda 1 je odvojeno pregledala dva reprezentativna blokirajuća nalaza:

- **K6-3 (Bubblewrap kao „zavisnost“)** — skript dokazuje **leksičku** razliku
  (reč `zavisnost` nije u izvoru), a negativna kontrola sa „preduslov“ uz isti
  uslov dostupnosti skript **ne obara**. Zaključak: blokirajući kriterijum tog
  nalaza bio je slabiji od njegove težine; ovo ostaje zabeleženo kao spor, bez
  naknadnog ublažavanja kapije.
- **K7-2 („puna podrška“ za nezavisne repozitorijume)** — formulacija dodaje
  ocenu potpunosti koju izvor ne nosi; prigovor **ima semantičko uporište**.

Nijedan nalaz nije prepravljan „u clean“ i nijedan override nije korišćen da se
dobije prolaz.

## Šta je Codex stvarno potvrdio, a šta je autorovo tumačenje

- **Codex je potvrdio sopstvenim fixture-ima:** tačnost nacrta u zamrznutoj
  reviziji (blob, ne ime fajla), aktuelnost verifikacionih polja, očuvanje
  sadržaja pri sinhronizaciji, očuvanje kapija (challenge, zone, zakup), dokaz u
  svežem klonu posle ispravke, poredak datuma, neuspeh upisa taga u oba toka i
  ponovni pokušaj, i 149/149.
- **Autorovo tumačenje (nije nezavisno potvrđeno):** da su stvarni K7 prolazi
  reprezentativni za podržani režim; da je preostali prozor `stat`→`rm` u
  `withFileLock` beznačajan u praksi; procena težine spora K6-3.

## Ograničenja i preporuka

- Ispravke iz rundi 2–5 **nisu proverene stvarnim sadržajnim prolazom**: K7
  prolazi su izvršeni na `6735b6c`, pre njih.
- Codex preporučuje: prvo trajno dostupan dokaz i vremenski ugovor za `created`
  (isporučeno), a zatim **jedan ograničen realni prolaz** uz proveru kloniranja
  dokaza posle konsolidacije. To nije izvršeno u ovom zadatku.
- Ovo nije sertifikat sistema: potpuna bezbednost i ponovljivost nisu dokazane.
