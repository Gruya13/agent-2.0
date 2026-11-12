# MCP server i alati

[Dokumentacija](README.md) · [Bezbednost](BEZBEDNOST.md)

## Pokretanje i protokol

```bash
node tools/mcp/obsidian-mcp.mjs
```

Bez argumenata server radi preko stdio. Svaka poruka je JSON-RPC 2.0 objekat u zasebnoj liniji. Stdout sadrži protokol, stderr dijagnostiku. Implementirani metodi su initialize, ping, tools/list i tools/call. Obaveštenja bez ID-a ignorišu se. Server nema HTTP transport, autentifikacioni servis, resources ili prompts endpoint.

Server je `obsidian-mcp`, verzija `1.0.0`. Rezervna verzija protokola je `2024-11-05`; initialize vraća traženu verziju kada je poslata kao string, što samo po sebi ne potvrđuje punu implementaciju svake specifikacije te verzije.

Primer read-only sesije, poslati svaki red posebno:

```json
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"probe","version":"1"}}}
{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}
{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"obsidian_read_notes","arguments":{"path":"wiki/Index.md","frontmatter_only":true}}}
```

## Osam alata

| Alat | Obavezno | Ostali argumenti / vrednosti |
|---|---|---|
| obsidian_search_notes | query | tag, dir, limit=20, context=0 |
| obsidian_read_notes | path ili paths u handleru | frontmatter_only=false, section, max_bytes=20000 |
| obsidian_patch_note | path, section, content | mode=replace: replace/append/prepend; create=true |
| obsidian_backlinks | path | dir=wiki |
| obsidian_write_note | path, content | title, status, tags, authors |
| obsidian_list_notes | — | dir, prefix |
| obsidian_lint_vault | — | nema |
| obsidian_vault_info | — | nema |

Search je pretraga podstringa bez razlike velikih i malih slova, ne semantički ili vektorski indeks. Limit broji pogotke po redovima, ne jedinstvene beleške. Podrazumevano list/search obilaze wiki, raw i tasks Markdown datoteke.

Read prima jednu putanju ili listu. `paths` ima prednost nad `path`; prazna lista nema ulaz za čitanje. Frontmatter-only prikazuje samo zaglavlje; section prikazuje prvi podudarni naslov i sadržaj do narednog naslova istog ili višeg nivoa. `max_bytes` u trenutnom kodu skraćuje telo string operacijom, pa nije strogi UTF-8 bajtovni limit. `.pdf` izvori ne postaju PDF ekstrakcija ovim alatom.

Patch menja jedan odeljak. Ako ga nema i create=true, dodaje ga; create=false odbija nedostajući odeljak. Postojeći frontmatter dobija novi updated datum. Patch nad novim fajlom sam ne garantuje standardni frontmatter, pa za novu belešku koristi write.

Write sa kompletnim frontmatter-om čuva poslati sadržaj; bez njega dodaje title, created, updated, authors, status i tags. Podrazumevani status je draft čak i u zoni produkcije; u konsolidaciji pošalji odgovarajuće metapodatke. Dozvoljeni status argumenti su draft, review, verified i consolidated. Pristupne kapije proveravaju upis nezavisno od argumenta status.

Rezultat je `{ content: [{ type: 'text', text: '...' }], isError }`. Odbijena operacija često stiže kao rezultat sa `isError: true`, a ne JSON-RPC transportna greška. Šeme navode additionalProperties=false, ali server ne koristi pun JSON Schema validator pre svakog handlera; handler provere su stvarno izvršeni ugovor.

## Registracija

```bash
./tools/config/mcp/register.sh --print
./tools/config/mcp/register.sh --check
```

Print zamenjuje `__VAULT__` apsolutnom putanjom projekta i ispisuje šablone. Check izvršava lokalni `info` poziv; ne proverava živu tools/call vezu kod sva tri klijenta. Registracija za agy postoji kao zasebna operacija:

```bash
./tools/config/mcp/register.sh --agy
```

Ona menja korisničku agy MCP konfiguraciju. DSH konfiguraciju skripta samo ispisuje; operater ih dodaje u odgovarajući profil/kontrolisanu konfiguraciju.

| Šablon | Klijent | Fiksirana uloga |
|---|---|---|
| `tools/config/mcp/agy.json` | agy | researcher |
| `tools/config/mcp/dsh.patch.yml` | dsh headless profil | verifier |

Ovi šabloni odgovaraju prvobitnim trima ulogama. Ako ista statična env tabela ostane aktivna, može odbiti extractor, red-team ili librarian upis. Runtime fajl ne nadjačava fiksirane role/agent promenljive. Za šest uloga obezbedi MCP konfiguraciju koja prenosi stvarnu ulogu poziva, pa proveri vault_info u konkretnom worktree-u. Nemoj fiksirati OBSIDIAN_VAULT, TASK, TASK_ROOT ili LEASE_TOKEN na jedan zadatak u zajedničkoj konfiguraciji.

## Pristup

Čitanje pojedinačnih belešaka dozvoljeno je u wiki, raw, tasks i .agents, uz realpath proveru. Upis zahteva odgovarajuću ulogu, zonu, zadatak i zakup u kontrolisanom skladištu. Produkcioni upis ograničen je na vršne `wiki/*.md` datoteke. `raw/`, indeks, manifest i events nisu upisivi kroz MCP.

Vault bez `.agents/AGENTS.md` preskače kapiju zadatka i zakupa, ali zadržava zone i zaštitu putanja. Zato očuvanje ugovornog marker fajla pripada integritetu kontrolisanog skladišta.

## Lokalni CLI servera

```bash
OBSIDIAN_VAULT="$PWD" OBSIDIAN_ROLE=readonly node tools/mcp/obsidian-mcp.mjs info
OBSIDIAN_VAULT="$PWD" node tools/mcp/obsidian-mcp.mjs list --dir wiki
OBSIDIAN_VAULT="$PWD" node tools/mcp/obsidian-mcp.mjs read wiki/Index.md --frontmatter
OBSIDIAN_VAULT="$PWD" node tools/mcp/obsidian-mcp.mjs search 'zakup' --limit 5
OBSIDIAN_VAULT="$PWD" node tools/mcp/obsidian-mcp.mjs backlinks 'Operativni_vodic_asinhronog_sistema'
OBSIDIAN_VAULT="$PWD" node tools/mcp/obsidian-mcp.mjs lint
```

Write i patch lokalno prihvataju `--content-file FAJL` ili sadržaj preko stdin i podležu istim dozvolama. Read koristi `--section NASLOV` i `--max-bytes N`; search podržava tag, dir i limit. MCP dodatno ima neke argumente koje lokalni CLI ne izlaže, poput read više putanja ili patch create=false.
