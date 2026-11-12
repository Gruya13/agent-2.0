#!/usr/bin/env bash
# Build agent2-sandbox slike (izvršavanje nepoverljivih reprodukcionih skripti).
# Docker CLI konfiguracija može biti u privremenom DOCKER_CONFIG ako ~/.docker
# nije upisiv: DOCKER_CONFIG=/tmp/docker-config ./build.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
exec docker build -t "${1:-agent2-sandbox:latest}" "$HERE"
