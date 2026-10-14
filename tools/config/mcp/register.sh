#!/usr/bin/env bash
# Registruj obsidian-mcp u sva tri harnesa, sa apsolutnom putanjom vault-a.
#
#   ./tools/config/mcp/register.sh --print     # samo ispiši konfiguracije
#   ./tools/config/mcp/register.sh --agy       # registruj kod Antigravity (agy mcp add)
#   ./tools/config/mcp/register.sh --check     # proveri da su serveri registrovani
#
# DSH i Codex se ne menjaju automatski: DSH profil je korisnički fajl, a
# ~/.codex/config.toml je deljen sa drugim projektima, pa skripta ispisuje
# gotov blok i ostavlja odluku operateru.
set -euo pipefail

VAULT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
SERVER="$VAULT/tools/mcp/obsidian-mcp.mjs"
MODE="${1:---print}"

render() {
  sed "s#__VAULT__#$VAULT#g" "$1"
}

case "$MODE" in
  --print|"")
    echo "# vault: $VAULT"
    echo
    echo "## agy (~/.gemini/config/mcp_config.json ili: agy mcp add)"
    render "$VAULT/tools/config/mcp/agy.json"
    echo
    echo "## codex (~/.codex/config.toml)"
    render "$VAULT/tools/config/mcp/codex.toml"
    echo
    echo "## dsh (cordis.patch.yml profila ili: dsh --patch <fajl>)"
    render "$VAULT/tools/config/mcp/dsh.patch.yml"
    ;;
  --agy)
    command -v agy >/dev/null || { echo "agy nije instaliran" >&2; exit 1; }
    agy mcp add \
      --env OBSIDIAN_AGENT=agy \
      obsidian node "$SERVER"
    echo "napomena: OBSIDIAN_ROLE, OBSIDIAN_VAULT i OBSIDIAN_TASK dolaze iz okruženja po pozivu;" >&2
    echo "statična OBSIDIAN_ROLE bi pobeđivala po-call ulogu, pa se ne upisuje." >&2
    agy mcp list
    ;;
  --check)
    command -v node >/dev/null || { echo "node nije instaliran" >&2; exit 1; }
    [ -f "$SERVER" ] || { echo "server ne postoji: $SERVER" >&2; exit 1; }
    echo "server: $SERVER"
    OBSIDIAN_VAULT="$VAULT" OBSIDIAN_ROLE=readonly OBSIDIAN_AGENT=probe \
      node "$SERVER" info
    ;;
  *)
    echo "nepoznata opcija: $MODE (koristi --print, --agy ili --check)" >&2
    exit 2
    ;;
esac
