# Mrežna izolacija `agy`-ja — analiza i odluka

[Dokumentacija](README.md) · [Bezbednost](BEZBEDNOST.md) · [Dogfood](DOGFOOD.md)

## Problem

`agy` u `safe` modu već ide kroz `bwrap`: prazan `HOME` (tmpfs), read-only radni
direktorijum, maskirani `~/.dsh`, `~/.ssh`, `~/.gnupg`, jedini write kanal je
`<cwd>/.wiki`. Ostaju dve svesne granice: **mreža je dostupna** (agy mora do svog
provajdera) i **host keyring je dostupan** kroz `/run/user/<uid>/bus` (agy-jev
OAuth). To nije kontejnerska izolacija.

Cilj je bio zatvoriti mrežni kanal: `--unshare-net` + loopback proxy koji drži
akreditive, kao kod `dsh-worker` sidecar proxy-ja.

## Zašto to danas nije moguće bez promene samog `agy`-ja

1. `bwrap --unshare-net` daje nov mrežni namespace u kome postoji **samo**
   `127.0.0.1`. Proxy na hostu tada nije dostupan, pa agy nema kuda da pošalje
   HTTPS zahtev.
2. Proxy bi morao da bude dostupan kroz UNIX socket koji se `--bind`-uje u
   namespace. Ali `agy` je Node/Go CLI koji ne podržava `HTTPS_PROXY` sa UNIX
   socketom — za to je potrebna izmena klijenta (custom dispatcher/agent).
3. `socat`/`TCP→UNIX` tunel unutar namespace-a ne rešava izlaz: nov namespace
   nema kuda da tunelira osim kroz proces koji je već unutra, a taj proces nema
   mrežu.
4. Docker varijanta (agy u kontejneru) je **već isprobana i odbijena** — agy
   zahteva keyring za OAuth i u kontejneru traži interaktivnu prijavu; kopija
   `oauth_creds.json` nije dovoljna (vidi `~/.dsh/docker/AGY-KONTEJNER-ANALIZA.md`).

## Opcije

| opcija | šta traži | procena |
|---|---|---|
| **A. Patch `agy`-ja** za proxy-namespace (env `AGY_HTTPS_PROXY` kroz unix socket) | izmena spoljnog CLI-ja ili upstream PR | najčistije, ali van naše kontrole; prati upstream |
| **B. Docker + keyring proxy** (D-Bus/secret service forward) | rizično: prosleđivanje keyringa u kontejner ruši svrhu izolacije | ne preporučuje se |
| **C. Prihvatiti granicu i dokumentovati je** | ništa dodatno | trenutno stanje: mreža + keyring dostupni, ali `~/.dsh`/`~/.ssh`/`~/.gnupg` maskirani; rizik sveden na „agy može da pozove svoj provajder“ |

## Odluka

**C za sada, sa tačkom praćenja za A.** Mrežna izolacija se ne može postići bez
podrške u `agy`-ju; pokušaj Docker varijante je već dokumentovan kao neuspešan.
Umesto toga je uložen trud u ono što je izvodljivo i merljivo:

- Docker sandbox za **nepoverljive reprodukcione skripte** (`reproduce.mjs`, opcija
  `challengeSandbox: docker`) — tu izolacija jeste potpuna i dokazana testom
  (`tests/reproduce-sandbox.test.mjs`);
- maskiranje osetljivih putanja u `bwrap`-u (roadmap: verify test u
  `~/.dsh/Plugins/external-agents/verify.mjs`);
- abort harnesa na gubitak zakupa (da agy ne troši kvotu na tuđi posao).

## Kada se vratiti na A

Ako `agy` dobije podršku za proxy kroz UNIX socket ili `--proxy` flag, treba:

1. podići loopback proxy koji drži OAuth i prosleđuje samo ka provajderu;
2. pokrenuti agy sa `--unshare-net` i bind-ovanim socketom;
3. dodati test u `external-agents/verify.mjs` koji dokazuje da agy odgovara dok
   su mu svi spoljni interfejsi blokirani i da keyring nije dostupan.
