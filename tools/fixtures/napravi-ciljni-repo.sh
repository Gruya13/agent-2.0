#!/usr/bin/env bash
# Napravi mali ciljni repozitorijum sa poznatim bugom (fixture za coding tok).
# Upotreba: napravi-ciljni-repo.sh <ciljni-direktorijum>
set -euo pipefail
PONUDA="$(cd "$(dirname "$0")/../.." && pwd)/fixtures/code-target"
CILJ="${1:?putanja ciljnog repozitorijuma}"
if [ -e "$CILJ" ]; then echo "cilj već postoji: $CILJ" >&2; exit 2; fi
mkdir -p "$CILJ"
cp -r "$PONUDA/." "$CILJ/"
rm -f "$CILJ/ZAHTEV.md"
cd "$CILJ"
git init -q -b main
git add -A
git -c user.name=fixture -c user.email=fixture@local commit -q -m "pocetno stanje (sa bugom)"
echo "repo: $CILJ"
echo "base: $(git rev-parse HEAD)"
echo "provera pre popravke: $(npm test >/dev/null 2>&1 && echo PROLAZI || echo PADA)"
