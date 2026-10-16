---
task_id: TASK-101
role: librarian
created: 2026-10-16T07:21:37.184Z
audit_scope: ["wiki/*.md"]
reviewed_notes: 4
findings_total: 4
fixed: 2
human_action_required: 2
---

# Revizija baze — TASK-101

Pregledane su sve četiri beleške: `wiki/Flatpak.md`, `wiki/OSTree.md`,
`wiki/PipeWire.md` i izvedeni `wiki/Index.md`. Upoređeni su sadržaj, YAML
zaglavlja, oznake i sve međusobne Vikiveze. Index je samo pročitan.

## Nalazi

| ID | Vrsta | Putanja i dokaz pre izmene | Sada / ishod | Ostaje čoveku |
|---|---|---|---|---|
| 1 | Pokvaren Vikilink | `wiki/Flatpak.md`: `[[Nepostojeca beleska]]`; u opsegu nema ciljne beleške niti dokaza za preusmeravanje. | Zamenjeno običnim tekstom `Nepostojeca beleska`; sačuvane su reči, uklonjena nevažeća veza. | Nema obavezne strukturne radnje; ako se cilj naknadno utvrdi, povezati ga u novom zadatku. |
| 2 | Siroče | `wiki/PipeWire.md`: 0 ulaznih veza; tekst izričito pominje zvuk u Flatpak sandbox-u. | U `wiki/Flatpak.md` dodat red `Povezano: [[PipeWire]].`; PipeWire sada ima 1 ulaznu vezu. | Ništa. |
| 3 | Siroče — izvedeni indeks | `wiki/Index.md`: 0 ulaznih veza iz ostale tri beleške. | Neizmenjeno; indeks nije tematski članak i nema osnova da se proizvoljno povezuje iz članaka. | Odlučiti da li je centralni indeks izuzet od pravila o siročićima ili zadati navigaciono povezivanje. |
| 4 | Zastareo izvedeni indeks | `wiki/Index.md`: `Beleške (0)` i `_nema belešaka_`, iako postoje Flatpak, OSTree i PipeWire. | Neizmenjeno zbog izričite zabrane uređivanja indeksa. | Regenerisati indeks kroz `agentctl index` u zasebnom ovlašćenom koraku. |

Broj nalaza po vrsti: pokvareni Vikilinkovi **1**, siročići **2** (jedan je
izvedeni indeks), zastareo indeks **1**, duplikati **0**, kontradikcije između
članaka **0**, neujednačene oznake **0**, zastarele `status` vrednosti **0**.
Ukupno **4** nalaza: **2 popravljena**, **2 ostavljena čoveku**.

Oznake `linux`, `paketi`, `zvuk` i `index` već su malim slovima; zapis
`[linux,zvuk]` je važeća YAML lista i nije različita oznaka.
Sva četiri statusa su `consolidated`, što je dozvoljeno prema
`NOTE_STATUSES` u `tools/orchestrator/lib/vault.mjs`; nema dokaza za promenu
statusa. Sadržaj članaka ne pruža osnov za predlog spajanja niti pokazuje
međusobnu kontradikciju. Ovo nije provera činjenične tačnosti.

## Sve izmene

- `wiki/Flatpak.md`: uklonjene dvostruke zagrade oko nepostojećeg cilja i
  dodat red `Povezano: [[PipeWire]].`, kako je dokazano u nalazima 1 i 2.
- `wiki/Flatpak.md`: `updated: 2026-10-01T00:00:00.000Z` →
  `updated: 2026-10-16T07:21:37.184Z` radi evidencije ove strukturne izmene.
- `tasks/audits/TASK-101.md`: kreiran zahtevani izveštaj; nije novi članak.

## Provera

Provereni su YAML zaglavlja i svi Vikilinkovi pomoću postojećih funkcija iz
`vault.mjs` i `lintNotes`: nema grešaka. Posle izmene ulazne veze su:
Flatpak **1** (iz OSTree), OSTree **1** (iz Flatpak), PipeWire **1** (iz Flatpak),
Index **0**. `git diff --check` prolazi. Index, OSTree i PipeWire ostaju
neizmenjeni; nema izmena izvan dozvoljenih belešaka i izveštaja.

## Eksplicitno ostaje čoveku

1. Odlučiti o tretmanu centralnog indeksa bez ulaznih veza (nalaz 3).
2. Regenerisati zastareli indeks u zasebnom ovlašćenom koraku (nalaz 4).
