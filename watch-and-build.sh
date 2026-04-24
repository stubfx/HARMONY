#!/usr/bin/env bash
# Polls the remote git repo every 30 seconds.
# On new commits: pulls, reinstalls deps, and rebuilds.

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
INTERVAL=30

cd "$REPO_DIR"

echo "[watch] Starting. Checking for updates every ${INTERVAL}s."

while true; do
    git fetch origin main --quiet

    LOCAL=$(git rev-parse HEAD)
    REMOTE=$(git rev-parse origin/main)

    if [ "$LOCAL" != "$REMOTE" ]; then
        echo "[watch] $(date '+%H:%M:%S') — new commits detected, pulling..."
        git pull origin main

        echo "[watch] Running npm ci..."
        npm ci

        echo "[watch] Running npm run build..."
        npm run build

        echo "[watch] Build complete."
    fi

    sleep "$INTERVAL"
done
