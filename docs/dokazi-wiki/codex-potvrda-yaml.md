Pregledana revizija: **`62f7e3bfafa40a800542803fa35224c7c58c443f`**.

Prethodni primeri sada prolaze kroz **frontmatter API**. Širi YAML parser i dalje ima reprodukovane probleme sa krajem dokumenta, folded blokovima i zabranjenim tabovima.

| Tvrdnja | Ishod | Dokaz |
|---|---|---|
| Prethodni frontmatter round-trip kontraprimeri | **POTVRĐENO** | Svi navedeni ulazi očuvani, uključujući vodeće i završne prelome. |
| Direktni `parseYaml(stringifyYaml(...))` | **OBORENO** | Za string sa završnim prelomom dodaje još jedan prelom. |
| Folded `>`, `>-`, `>+` uopšteno | **OBORENO** | Jače uvučene linije pogrešno se spajaju; postoje i greške završnih preloma. |
| Zabranjeni tab u YAML indentaciji se odbija | **OBORENO** | U bloku prihvata tab i parsira `alpha` kao `lpha`. |
| Prazan string i samo prelomi kroz frontmatter | **POTVRĐENO** | `""`, `"\n"` i `"\n\n"` očuvani. |
| Veoma dug frontmatter blok | **POTVRĐENO za probanih 1.500.000 znakova** | Ista dužina i sadržaj posle round-trip-a. |

Program i puni rezultati: [yaml-check.mjs](/home/gru/.agent-worktrees/verify-session-08b4-codex/.verification/yaml-check.mjs), [results.jsonl](/home/gru/.agent-worktrees/verify-session-08b4-codex/.verification/results.jsonl), [frontmatter.log](/home/gru/.agent-worktrees/verify-session-08b4-codex/.verification/frontmatter.log). Nezavisni parser za poređenje: **PyYAML 6.0.3**.

### Popravljeni prethodni primeri

Kroz `stringifyFrontmatter` → `parseFrontmatter` dobijeno je:

```text
{"input":"a\nb","actual":"a\nb","equal":true}
{"input":"a\nb\n","actual":"a\nb\n","equal":true}
{"input":"a\nb\n\n","actual":"a\nb\n\n","equal":true}
{"input":"\n\n","actual":"\n\n","equal":true}
{"input":"\nprva\n\ndruga\n\n\n","actual":"\nprva\n\ndruga\n\n\n","equal":true}
{"input":"","actual":"","equal":true}
{"input":"\n","actual":"\n","equal":true}
{"long":true,"length":1500000,"actualLength":1500000,"equal":true}
```

### 1. Direktni YAML round-trip dodaje prelom

Komanda za sve probe:

```bash
node .verification/yaml-check.mjs
```

Minimalni kontraprimer:

```js
parseYaml(stringifyYaml({value: 'a\nb\n'})).value
```

Stvarni rezultat:

```text
input:  "a\nb\n"
actual: "a\nb\n\n"
```

Serializer proizvodi:

```text
"value: |\n  a\n  b\n"
```

PyYAML isti dokument čita kao `"a\nb\n"`, dakle serializer ovde daje ispravan dokument, a lokalni parser dodaje prelom.

Isto važi za `|+`:

```text
input:  "a\nb\n\n"
actual: "a\nb\n\n\n"
PyYAML: "a\nb\n\n"
```

Razlika je vezana za kraj YAML dokumenta. Frontmatter obrada u prethodnim primerima ne pokazuje ovu grešku.

### 2. Folded blok gubi strukturu jače uvučenog teksta

Ulaz:

```yaml
value: >-
  alpha
    indented
  omega
next: x
```

Stvarni rezultati:

```text
očekivano/PyYAML: "alpha\n  indented\nomega"
dobijeno:        "alpha   indented omega"
```

Ista greška postoji sa `>` i `>+`: jače uvučene linije treba da zadrže prelome, a lokalni parser ih spaja razmacima.

Pronađena je i greška običnog clip stila `>` sa više završnih praznih linija:

```text
očekivano/PyYAML: "\nalpha beta\ngamma\n"
dobijeno:        "\nalpha beta\ngamma\n\n\n"
```

Dakle, popravljeno je osnovno razdvajanje pasusa, ali folded i chomping pravila nisu potpuno sprovedena.

### 3. Zabranjen tab u indentaciji bloka nije odbijen

Ulaz, gde je `\t` stvarni tab:

```text
value: |-
\talpha
next: x
```

Očekivano: greška zbog taba u indentaciji. PyYAML odbija dokument.

Lokalni parser vraća:

```json
{"value":"lpha","next":"x"}
```

Tab je obračunat kao dva mesta indentacije, a zatim se toliko znakova odseca iz sirovog reda. Time nestaje i `a`.

Kontrole:

- tab ispred običnog YAML ključa pravilno je odbijen;
- tab kao sadržaj posle pravilne indentacije, `a\tb`, očuvan je i slaže se sa PyYAML-om;
- vodeći tabovi u stringu koji serializer normalizuje takođe nisu očuvani.

### Testovi i ograničenja

```bash
node --test tests/yaml.test.mjs
```

```text
ℹ tests 16
ℹ pass 16
ℹ fail 0
ℹ skipped 0
```

Y4–Y6 prolaze, ali ne pokrivaju navedenu razliku između frontmatter-a i samostalnog YAML dokumenta, jače uvučene folded linije ni tab u indentaciji blok skalara.

Ostaje nepokrivena iscrpna kombinatorika blokova u listama i ugnježdenim mapama, eksplicitni indikatori indentacije, svi završeci redova i konkurentni korisnici parsera. Proba dugog bloka potvrđuje ispravnost jednog ulaza, ne granice memorije ili performansi.

Kandidat nije menjan:

```console
$ git diff --exit-code
$ git rev-parse HEAD
62f7e3bfafa40a800542803fa35224c7c58c443f
$ git status --porcelain
?? .verification/
```

`git diff --exit-code` završio je sa 0.
