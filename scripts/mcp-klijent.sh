#!/usr/bin/env bash
# MCP proba kroz stvarni harnes klijent za jednu ulogu.
# Upotreba: mcp-klijent.sh <researcher|extractor|red-team|librarian> <agy|dsh|codex>
set -euo pipefail
P='/home/gru/Projects/Agent 2.0'
ULOGA="$1"; AGENT="$2"
V="/home/gru/k13-mcp-$ULOGA"
LOG="$P/.k13-mcp-$ULOGA.log"
: > "$LOG"
rm -rf "$V"; mkdir -p "$V"
cp -r "$P/tools" "$V/tools"; cp -r "$P/.agents" "$V/.agents"
rm -f "$V/.agents/raw-manifest.json"
cp "$P/package.json" "$V/package.json"; cp "$P/.gitignore" "$V/.gitignore"
mkdir -p "$V/raw" "$V/wiki/drafts" "$V/wiki/drafts/fragments" "$V/tasks/inbox" "$V/tasks/active" "$V/tasks/review" "$V/tasks/completed" "$V/tasks/reviews" "$V/tasks/challenges" "$V/tasks/audits"
printf '# MCP izvor\n\nKratak izvor.\n' > "$V/raw/mcp.md"
if [ "$ULOGA" = librarian ]; then
  printf -- '---\ntitle: Flatpak\ncreated: 2026-01-01T00:00:00.000Z\nupdated: 2026-01-01T00:00:00.000Z\nauthors: [researcher]\nstatus: consolidated\ntags: [linux]\n---\n\n# Flatpak\n\nPostojeća beleška.\n' > "$V/wiki/Flatpak.md"
fi
cd "$P"
node tools/orchestrator/cli.mjs init --vault "$V" > /dev/null
git -C "$V" add -A >/dev/null 2>&1 || true
git -C "$V" -c user.name=op -c user.email=o@local commit -q -m izvor || true

echo "=== MCP ogled: uloga=$ULOGA klijent=$AGENT $(date -Is) revizija=$(git rev-parse --short HEAD) ===" >> "$LOG"
PRI=$(node tools/fixtures/mcp-pripremi.mjs "$V" "$ULOGA" "$AGENT")
# Token zakupa se NE upisuje u log (rediguje se pre ispisa).
echo "priprema: $(printf '%s' "$PRI" | python3 -c "import json,sys;d=json.load(sys.stdin);d.pop('token',None);print(json.dumps(d))")" >> "$LOG"
WT=$(printf '%s' "$PRI" | python3 -c "import json,sys;print(json.load(sys.stdin)['worktree'])")
TOKEN=$(printf '%s' "$PRI" | python3 -c "import json,sys;print(json.load(sys.stdin)['token'])")
ID=$(printf '%s' "$PRI" | python3 -c "import json,sys;print(json.load(sys.stdin)['id'])")
MARK='MCP proba kroz stvarni klijent'

case "$ULOGA" in
  researcher) OK='wiki/drafts/Kroz_klijenta.md'; NE='wiki/Produkcija.md' ;;
  extractor)  OK='wiki/drafts/fragments/Kroz_klijenta.md'; NE='wiki/drafts/Nije_fragment.md' ;;
  red-team)   OK='tasks/challenges/TASK-101/kroz-klijenta.sh'; NE='wiki/Nesto.md' ;;
  librarian)  OK='wiki/Flatpak.md'; NE='wiki/Ne_u_opsegu.md' ;;
  *) echo "nepoznata uloga" >&2; exit 2 ;;
esac
PROMPT="Koristi MCP alat obsidian_write_note tacno dva puta i prikazi rezultat svakog poziva. (1) path=$OK, content='# $MARK'. (2) path=$NE, content='# x'. Ne pisi fajlove direktno i ne ponavljaj pozive."

export OBSIDIAN_VAULT="$WT" OBSIDIAN_ROLE="$ULOGA" OBSIDIAN_AGENT="$AGENT" OBSIDIAN_TASK="$ID"
export OBSIDIAN_TASK_ROOT="$V" OBSIDIAN_LEASE_TOKEN="$TOKEN"

case "$AGENT" in
  agy)
    H=$(mktemp -d); mkdir -p "$H/.gemini/config"
    sed "s#__VAULT__#$V#g" "$P/tools/config/mcp/agy.json" > "$H/.gemini/config/mcp_config.json"
    cd "$WT"
    HOME="$H" timeout 420 agy --print="$PROMPT" --dangerously-skip-permissions --add-dir "$WT" >> "$LOG" 2>&1 || echo "agy exit=$?" >> "$LOG"
    rm -rf "$H"
    ;;
  dsh)
    PATCH=$(mktemp)
    # Privremeni patch sa konkretnim vrednostima za ovu probu: dsh profil ne
    # prosleđuje sve nasleđene promenljive MCP klijentu.
    cat > "$PATCH" <<PATCHYAML
- insert:
    - id: obsidian-mcp
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        transport: stdio
        serverName: obsidian
        command: node
        args:
          - $V/tools/mcp/obsidian-mcp.mjs
        env:
          OBSIDIAN_AGENT: dsh
          OBSIDIAN_VAULT: "$WT"
          OBSIDIAN_ROLE: "$ULOGA"
          OBSIDIAN_TASK: "$ID"
          OBSIDIAN_TASK_ROOT: "$V"
          OBSIDIAN_LEASE_TOKEN: "$TOKEN"
        toolCallTimeoutMs: 15000
        failOnStartupError: true
PATCHYAML
    cd "$WT"
    timeout 420 dsh --profile headless --patch "$PATCH" "$PROMPT" >> "$LOG" 2>&1 || echo "dsh exit=$?" >> "$LOG"
    rm -f "$PATCH"
    ;;
  codex)
    H=$(mktemp -d); cp ~/.codex/auth.json "$H/auth.json"
    # Codex ovde ne prosleđuje sve nasleđene promenljive MCP serveru, pa se
    # vrednosti za ovu probu upisuju u privremeni config (ne dira se ~/.codex).
    cat > "$H/config.toml" <<TOML
[mcp_servers.obsidian]
command = "node"
args = ["$P/tools/mcp/obsidian-mcp.mjs"]
startup_timeout_sec = 20
tool_timeout_sec = 60
default_tools_approval_mode = "approve"

[mcp_servers.obsidian.env]
OBSIDIAN_AGENT = "$AGENT"
OBSIDIAN_VAULT = "$WT"
OBSIDIAN_ROLE = "$ULOGA"
OBSIDIAN_TASK = "$ID"
OBSIDIAN_TASK_ROOT = "$V"
OBSIDIAN_LEASE_TOKEN = "$TOKEN"
TOML
    CODEX_HOME="$H" timeout 420 codex exec --sandbox workspace-write -C "$WT" "$PROMPT" >> "$LOG" 2>&1 || echo "codex exit=$?" >> "$LOG"
    rm -rf "$H"
    ;;
  *) echo "nepoznat klijent" >&2; exit 2 ;;
esac

echo '--- provere ---' >> "$LOG"
if [ "$ULOGA" = librarian ]; then
  git -C "$WT" diff --quiet -- "$OK" 2>/dev/null && echo "DOZVOLJEN_UPIS: NIJE PROSAO (sadrzaj nepromenjen)" >> "$LOG" || echo "DOZVOLJEN_UPIS: OK ($OK izmenjen kroz MCP)" >> "$LOG"
else
  grep -q "$MARK" "$WT/$OK" 2>/dev/null && echo "DOZVOLJEN_UPIS: OK ($OK)" >> "$LOG" || echo "DOZVOLJEN_UPIS: NIJE PROSAO ($OK)" >> "$LOG"
fi
[ -e "$WT/$NE" ] && echo "NEDOZVOLJEN_UPIS: PROSAO ($NE) - problem" >> "$LOG" || echo "NEDOZVOLJEN_UPIS: ODBIJEN ($NE)" >> "$LOG"
echo "=== kraj: $(date -Is) ===" >> "$LOG"