# Agent 2.0 — dokumentacija projekta

Dokumentacija implementacije verzije `1.0.0`, pregledane 14. oktobra 2026. na Git reviziji `a0dc5c8`. Dokumenti su na srpskom jeziku; nazivi komandi, uloga i polja ostaju isti kao u kodu.

Agent 2.0 pretvara izvore u povezanu Markdown bazu znanja. Šest uloga koordinira rad preko fajlova zadataka, vremenskih zakupa i Git grana. Kontrolni sloj upravlja stanjima, nezavisnom verifikacijom, reprodukcijom red-team nalaza i objavljivanjem belešaka. Obsidian služi kao interfejs za čitanje baze; nije potreban za izvršavanje sistema.

## Sadržaj

| Dokument | Sadržaj |
|---|---|
| [Instalacija i prvi koraci](INSTALACIJA.md) | zahtevi, provera okruženja, demo i prvi zadatak |
| [Korisnički vodič](KORISCENJE.md) | unos, ekstrakcija, faze, revizija baze i realni adapteri |
| [Arhitektura](ARHITEKTURA.md) | komponente, tokovi, izolacija, odgovornosti i moduli |
| [CLI referenca](CLI.md) | sve komande, opcije, izlazni kodovi i primeri |
| [Konfiguracija](KONFIGURACIJA.md) | YAML parametri, podrazumevane vrednosti i okruženje |
| [Model podataka](MODEL-PODATAKA.md) | zadaci, automat stanja, beleške, manifest i događaji |
| [MCP referenca](MCP.md) | osam alata, protokol, registracija i lokalni CLI |
| [Bezbednost i ograničenja](BEZBEDNOST.md) | kapije, izvršavanje skripti i granice zaštite |
| [Izolovane kopije DSH-a](IZOLACIJA-KOPIJA.md) | worker u Dockeru: granica, tok, provera i ograničenja |
| [Plan bez Codex-a](PLAN-BEZ-CODEX.md) | uklanjanje OpenAI Codex-a, nove uloge i dokazi |
| [Dogfood: samopregled sistema](DOGFOOD.md) | protokol samopregleda, nalazi P1–P7, popravke i slepe verifikacije |
| [Operacije i rešavanje problema](OPERACIJE.md) | nadzor, zakupi, blokade, oporavak i rezervne kopije |
| [Razvoj i testiranje](RAZVOJ.md) | interni API, proširivanje i testni skup |
| [Izveštaj provere](PROVERA.md) | rezultat proveravanja dokumentacije i postojećeg sistema |

## Preporučeni redosled čitanja

Za prvi prolaz pročitaj instalaciju i korisnički vodič. Za automatizaciju koristi CLI, konfiguraciju i MCP referencu. Za izmene koda pročitaj arhitekturu, model podataka i razvoj. Pre rada sa pravim modelima pročitaj bezbednost i operativni vodič.

## Izvori i istorijski dokumenti

Ova dokumentacija opisuje kod u `tools/`, konfiguracije i testove. Originalna [arhitektonska specifikacija](../Arhitektura%20asinhronog%20multi-agentskog%20sistema.md) opisuje projektni cilj. [Konsultacija o ulogama](../KONSULTACIJA-ULOGA.md), [nezavisna verifikacija](../VERIFIKACIJA.md) i [procena spremnosti](../SPREMNOST.md) čuvaju ranije odluke i rezultate. Njihove tvrdnje o instaliranim harnesima, kvotama, broju testova ili realnim prolazima nisu nova provera trenutnog okruženja.

`raw/` sadrži nepromenljive izvore; `wiki/` sadrži domensko znanje. Tehnička dokumentacija projekta nalazi se u `docs/` i ne ulazi u izvedeni indeks baze znanja. Datoteka `.agents/AGENTS.md` je artefakt ugovora aplikacije koji kod koristi kao oznaku kontrolisanog skladišta; korisnička pravila za GPT uređuju se zasebno u `agents_gpt.md`.
