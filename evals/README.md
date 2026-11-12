# Zlatni set evala

Evali su **poznati scenariji sa poznatim ishodom**: ne mere se utisak modela ni
kvalitet teksta, nego ishod toka na slučajevima gde se tačno zna šta sme da se
desi. Služe za dve stvari:

1. **Regresiona mreža** — posle svake promene pipelines, `node tools/evals/run.mjs`
   mora da vrati sve slučajeve kako je očekivano (podrazumevano sa mock adapterima,
   deterministički, bez mreže i kvote).
2. **Merenje modela** — isti set se može pustiti sa pravim harnesima; tada se ishod
   ne mora poklopiti sa očekivanim — to je podatak, ne pad testa.

## Komanda

```bash
node tools/evals/run.mjs          # mock adapteri: očekivani ishodi su obavezni
```

## Slučajevi

| id | šta proverava | očekivano |
|---|---|---|
| `bug-fix` | programer popravi bug, doda regresioni test, dokaz padne na osnovi | `ok: true` |
| `bug-se-ne-reprodukuje` | popravka za bug koji ne postoji | odbijeno (`ok: false`) |
| `van-opsega` | programer menja `tests/` van opsega `src/**` | odbijeno (`ok: false`) |

## Kako dodati slučaj

1. Dopiši stavku u `CASES` u `tools/evals/run.mjs` (`priprema` prima iste opcije kao
   `tests/helpers/coding-fixture.mjs`: `saBugom`, `scope`, `testCommand`, `lease`...).
2. Očekivani ishod mora biti izveden iz invarijante, ne iz trenutnog ponašanja koda —
   inače eval samo lockdown-uje postojeći bug.
3. Ako slučaj koristi novi fixture ili novu komandu, dodaj i `tests/evals.test.mjs`
   asertaciju da set ostaje zelen.

`tests/evals.test.mjs` pokreće isti set u okviru `npm test`, pa je zlatni set deo
CI mreže, a ne samo ručna skripta.
