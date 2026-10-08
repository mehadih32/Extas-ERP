# Shared by the scripts in this folder; not run on its own.
# shellcheck shell=bash

set -euo pipefail

DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$DEPLOY_DIR/.env"
# The app's user inside its container (see the Dockerfile).
APP_UID=1001

say() { printf '\n==> %s\n' "$*"; }
die() {
  printf '\nError: %s\n' "$*" >&2
  exit 1
}

need_root() {
  [ "$(id -u)" -eq 0 ] || die "run this with sudo, for example: sudo $0"
}

# One update or restore at a time. The lock stays held until the script ends, and
# a script started by one that holds it (auto-deploy.sh runs deploy.sh) shares it.
take_update_lock() {
  [ -n "${EXTRAS_ERP_UPDATE_LOCK:-}" ] && return 0
  exec 9>/run/extras-erp-update.lock
  flock -n 9 || die "another update or restore is running. Wait for it to finish, then try again."
  export EXTRAS_ERP_UPDATE_LOCK=1
}

# A setting from deploy/.env (the last line wins), or the default given.
setting() {
  local value
  value="$(sed -n "s/^$1=//p" "$ENV_FILE" | tail -n 1)"
  printf '%s' "${value:-${2:-}}"
}

load_settings() {
  [ -f "$ENV_FILE" ] || die "deploy/.env is missing: run sudo ./deploy/configure.sh first."
  command -v docker >/dev/null || die "Docker is not installed: run sudo ./deploy/setup-server.sh first."
  DATA_DIR="$(setting DATA_DIR /srv/extras-erp)"
  POSTGRES_DB="$(setting POSTGRES_DB extras_erp)"
  APP_DB_USER="$(setting APP_DB_USER extras_app)"
  # shellcheck disable=SC2034  # read by deploy.sh
  APP_DOMAIN="$(setting APP_DOMAIN)"
}

compose() {
  docker compose --project-directory "$DEPLOY_DIR" -f "$DEPLOY_DIR/compose.yml" \
    --env-file "$ENV_FILE" "$@"
}

# The folders on the server that hold the data, each owned by whoever writes it.
prepare_folders() {
  mkdir -p "$DATA_DIR"/{postgres,uploads,backups,safety-copies,caddy/data,caddy/config}
  chown "$APP_UID:$APP_UID" "$DATA_DIR/uploads" "$DATA_DIR/backups"
  chmod 700 "$DATA_DIR/safety-copies"
}

db_running() {
  [ -n "$(compose ps -q db 2>/dev/null)" ] && compose exec -T db pg_isready -q -U postgres
}

# Waits for a service's health check to pass (about 3 minutes at most).
wait_healthy() {
  local id status
  for _ in $(seq 1 60); do
    id="$(compose ps -q "$1")"
    status=""
    [ -n "$id" ] && status="$(docker inspect -f '{{.State.Health.Status}}' "$id" 2>/dev/null || true)"
    [ "$status" = healthy ] && return 0
    sleep 3
  done
  return 1
}

# Saves the whole database to safety-copies/<name>/database.dump; prints the folder.
safety_copy() {
  local dir="$DATA_DIR/safety-copies/$1"
  mkdir -p "$dir"
  compose exec -T db pg_dump -U "$APP_DB_USER" -d "$POSTGRES_DB" \
    --format=custom --no-owner --no-privileges >"$dir/database.dump"
  printf '%s' "$dir"
}
