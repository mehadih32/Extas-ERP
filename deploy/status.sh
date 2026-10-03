#!/usr/bin/env bash
# Shows whether everything is running, the app's health check, the latest
# backups and the free disk space.
#   sudo ./deploy/status.sh
# shellcheck source=deploy/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

need_root
load_settings

say "Services"
compose ps --all

say "Health check"
compose exec -T app node -e \
  "fetch('http://127.0.0.1:3000/api/health').then((r) => r.text()).then(console.log)" ||
  echo "The app is not answering: see sudo ./deploy/logs.sh app"

say "Latest daily backups (in $DATA_DIR/backups)"
find "$DATA_DIR/backups" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' 2>/dev/null |
  sort -r | head -n 5 | sed 's/^/  /'

say "Safety copies (in $DATA_DIR/safety-copies)"
find "$DATA_DIR/safety-copies" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' 2>/dev/null |
  sort -r | head -n 5 | sed 's/^/  /'

say "Disk space"
df -h "$DATA_DIR"
