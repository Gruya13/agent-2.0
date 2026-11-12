# Nepoverljivo izvršavanje reprodukcionih skripti (red-team nalaza).
# Kontejner vidi samo privremeni klon revizije, nema mrežu ni host home.
FROM node:26.8.2-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends bash python3 git ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /work
USER node
