# Plan: sistem bez OpenAI Codex-a

**Status:** izvršeno 11. novembra 2026. Codex je uklonjen iz sistema; dokument
beleži šta je zamenjeno i kako se promena proverava.

## Zašto

System je imao tri vendora i tri sloja pomoći, ali je `codex` držao tri
nepovezane uloge: pisca/konsolidatora, watchdog integriteta testova i treće
mišljenje u red-team-u. Sa dva vendora (DeepSeek `dsh` i Google `agy`) sistem
ostaje nezavisan tamo gde nezavisnost nešto znači — nijedan model ne verifikuje
sopstveni rad — a mehaničke provere postaju skripte, ne modeli.

## Šta je uklonjeno

| Mesto | Promena |
|---|---|
| `~/.dsh/Plugins/external-agents` | provider `codex` obrisan (komanda, resume oblik, `.codex` bwrap mount, terminal ruta, tool enum); `verify.mjs` prepisan za agy |
| `~/.dsh/roles/codex-node.md`, `codex-verify.md` | obrisani; `roles/README.md` ažuriran |
| `~/.dsh/AGENTS_DS.md` | uloge i invarijante prepisane: `agy` + `dsh-worker`, watchdog je kapija |
| `~/.dsh/Plugins/agent-quotas` | uklonjen iz web profila (jedini izvor je bio codex) |
| `tools/config/agents.yml` | `consolidator` → `agy`, `librarian` → `dsh` |
| `tools/orchestrator/lib/agents/harness.mjs` | `HARNESS_COMMANDS.codex` obrisan |
| `tools/orchestrator/lib/config.mjs` | podrazumevani harnesi: `consolidator` → `agy`, `librarian`/`reviewer` → `dsh` |
| `tests/` | codex testovi zamenjeni (dsh/agy), `npm test` zelen |
| `.agents/AGENTS.md`, `docs/ARHITEKTURA.md`, `README.md` | tabele uloga i opisi ažurirani |

## Šta je preuzelo uloge

| Bivša codex uloga | Novi nosilac | Dokaz |
|---|---|---|
| konsolidacija (`wiki/`) | `agy` | `agents.yml`, verifikuje `dsh` |
| bibliotekar / audit | `dsh` | `agents.yml`, verifikuje `agy` |
| watchdog integriteta testova | **mehanička kapija** (`test-lock check --require-git`) | izlaz kapije ide u `tasks/events.jsonl`; model nema pravo da je preskoči |
| treće mišljenje u red-team-u | izgubljeno svesno | red-team ostaje `dsh`; `correlationRisk` je već beležen |

## Nova invarijanta

**Kopije DSH-a nisu verifikatori.** Isti vendor, nulta nezavisnost. One su
izvršioci: pišu granu, orkestrator pregleda diff, a verifikuje drugi vendor
(`agy`) uz determinističke provere.

## Kako se proverava

```bash
cd ~/.dsh/Plugins && node external-agents/verify.mjs   # 12/12, bez codex providera
node external-agents/verify.mjs                        # agy komandna linija, resume, zabrane
cd ~/Projects/Agent\ 2.0 && npm test                    # ceo test skup
grep -ri codex ~/.dsh/Plugins/external-agents/index.js  # samo istorijska napomena
```

## Šta nije urađeno

- `dsh-docker` adapter u `agentctl`-u nije uključen: pipeline koristi MCP nad
  glavnim vault-om, a worker namerno ne dobija MCP. To je nova odluka o
  sandboxu, ne prečica; kandidat je da worker dobije read-only glavni vault i
  piše samo u worktree.
- `agy` je i dalje jedini spoljni asistent kome trebaju trajne niti; worker je
  jednokratan.
