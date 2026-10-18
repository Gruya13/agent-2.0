Pregledao sam `27f6b9f406042db4c350eab57f469d9d0cf58d92` u izdvojenom checkout-u. **Kandidat odbija tab u uvlačenju i jače uvučen folded blok.** Negativna kontrola sa `958d3a6` za tab, međutim, ne može pokazati staro ponašanje: ta revizija već sadrži ispravku `8e55194`. Našao sam i dosežne slučajeve u kojima parser dodaje završne prelome pri čitanju ručno napisanog YAML-a.

Sopstvene probe su u [yaml-probe.mjs](</home/gru/.agent-worktrees/verify-session-08b4-codex/.verification/yaml-probe.mjs>), a potpuni stvarni izlaz u [yaml-probe.log](</home/gru/.agent-worktrees/verify-session-08b4-codex/.verification/yaml-probe.log>). Pokrenuo sam ih komandom `node .verification/yaml-probe.mjs`; za poređenje je korišćen PyYAML `6.0.3`.

| Tvrdnja | Ishod | Dokaz iz sopstvene probe |
|---|---|---|
| A — tab u uvlačenju bloka se jasno odbija | **POTVRĐENO** | Ulaz `value: \|-\n\talpha\nnext: x\n` → `YamlError: tabulator u YAML-u nije dozvoljen (linija 2)`. Nema skraćenog teksta. |
| B — isti ulaz na roditelju `958d3a6` pokazuje staro ponašanje | **OBORENO** | Roditelj daje *istu* grešku. Tek `62f7e3b`, pre ispravke `8e55194`, daje `{"value":"lpha","next":"x"}`. `git rev-parse 27f6b9f^` → `958d3a62cfbfa850e1f6578f2e88e1114d794844`; `git rev-parse 8e55194^` → `62f7e3bfafa40a800542803fa35224c7c58c443f`. |
| C — tab usred pravilno uvučenog sadržaja ostaje sadržaj | **POTVRĐENO** | Ulaz `value: \|-\n  alpha\tbeta\nnext: x\n` → `{"value":"alpha\tbeta","next":"x"}`. |
| D — reprezentativni višelinijski izveštaji prolaze kroz frontmatter | **POTVRĐENO za isprobane izveštaje** | Izveštaji sa praznim redovima, početnim i završnim prelomima, tačkama i stavkama liste dali su `equal:true, repeatEqual:true`. Dva postojeća zapisa, [dokumentni-TASK-101.md](</home/gru/.agent-worktrees/verify-session-08b4-codex/docs/dokazi-wiki/zatvaranje/dokumentni-TASK-101.md>) i [pdf-TASK-101.md](</home/gru/.agent-worktrees/verify-session-08b4-codex/docs/dokazi-wiki/zatvaranje/pdf-TASK-101.md>), dala su `roundtripEqual:true`, `bodyEqual:true` i `oracleSummaryEqual:true`; sažeci imaju 1467 i 1296 znakova. |
| E — jače uvučen `>`, `>-` ili `>+` odbija se bez tihog menjanja značenja | **POTVRĐENO** | Sva tri stila daju `YamlError: folded blok (">") sa uvlacenjem nije podrzan`. Isti `>-` na roditelju daje `"alpha   indented omega"`, dok PyYAML daje `"alpha\n  indented\nomega"`. Običan folded blok bez dodatnog uvlačenja i dalje daje `"alpha beta"`. |
| E — `loadConfig`, `readNote`, zadatak i MCP mogu dosegnuti ove blokove | **POTVRĐENO** | [config.mjs](</home/gru/.agent-worktrees/verify-session-08b4-codex/tools/orchestrator/lib/config.mjs:72>) zove `parseYaml`; [vault.mjs](</home/gru/.agent-worktrees/verify-session-08b4-codex/tools/orchestrator/lib/vault.mjs:81>), [task.mjs](</home/gru/.agent-worktrees/verify-session-08b4-codex/tools/orchestrator/lib/task.mjs:127>) i [MCP read](</home/gru/.agent-worktrees/verify-session-08b4-codex/tools/mcp/obsidian-mcp.mjs:352>) čitaju frontmatter. Probe kroz te ulaze dale su iste vrednosti ili greške. |
| E — frontmatter put je uopšteno veran | **OBORENO** | Za ručno napisano `summary: \|` sa praznim redovima pred zatvaračem, `readNote` i `parseTaskText` vraćaju `"alpha\n\n\n"`, a PyYAML `"alpha\n"`. Za `\|+` vraćaju `"alpha\n\n\n"`, a PyYAML `"alpha\n\n"`. Serijalizovani primeri iz reda D zato jesu verni, ali tvrdnja ne važi za svaki učitani frontmatter. |

Proba stvarnog MCP čitanja bila je:

```text
$ env OBSIDIAN_VAULT=/home/gru/.agent-worktrees/verify-session-08b4-codex/.verification/fixture-vault node tools/mcp/obsidian-mcp.mjs read wiki/clip.md --frontmatter
## wiki/clip.md

```yaml
title: T
summary: |+
  alpha


```

_(samo zaglavlje; telo ima 5 B)_
```

Za `wiki/foldedIndented.md` ista komanda završila se kodom 1 i izlazom `obsidian-mcp: neispravan frontmatter: folded blok (">") sa uvlacenjem nije podrzan; koristi "|-" ili "|"`. Dakle, odbijanje je dosežno i kroz javno MCP čitanje.

Preostali rubovi su konkretni:

- `loadConfig` za dokument `report: |\n  alpha\n` vraća `"alpha\n\n"`, a PyYAML `"alpha\n"`; za `|+` sa dva završna preloma vraća tri. Sadržaj reči ostaje, ali se tačni bajtovi vrednosti menjaju u [parseBlockScalar](</home/gru/.agent-worktrees/verify-session-08b4-codex/tools/orchestrator/lib/yaml.mjs:179>).
- Serijalizacija izveštaja koji počinje razmacima nije bajtno verna: `"  uvod\n  dokaz"` postaje `"uvod\ndokaz"`. [dumpBlockText](</home/gru/.agent-worktrees/verify-session-08b4-codex/tools/orchestrator/lib/yaml.mjs:415>) normalizuje to početno uvlačenje.
- Višelinijski string u listi, na primer `{report:["a\nb\n"]}`, serijalizuje se, ali ponovno čitanje daje `YamlError: neispravan frontmatter: neočekivana indentacija: a (linija 3)`. Nisam utvrdio da li postojeći tok upisuje takav oblik izveštaja.
- Bez završnog `---`, `parseFrontmatter('---\nsummary: |\n  alpha\n')` vraća `present:false`; to nije putanja kojom se čita važeći frontmatter.

`node --test tests/yaml.test.mjs` dao je **18 prolaza, 0 padova** (Y1–Y8 prolaze). Nisam pokretao ceo skup testova niti proveravao sve oblike YAML-a, uključujući eksplicitne indikatore uvlačenja i sve kombinacije krajeva redova.

Završno stanje checkout-a: `git rev-parse HEAD` → `27f6b9f406042db4c350eab57f469d9d0cf58d92`; `git diff --exit-code` → bez izlaza, kod 0; `git status --porcelain` → `?? .verification/` (samo moji probe i logovi).
