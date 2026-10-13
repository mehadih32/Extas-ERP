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
  # The demo site's address, for compose.yml (empty while it is off).
  DEMO_DOMAIN="$(demo_domain)"
  export DEMO_DOMAIN
}

# The demo site's address (README.md, "The demo site"), or nothing while it is
# off: DEMO_DOMAIN from deploy/.env, else demo.<the ERP's domain> (erp.x.com ->
# demo.x.com). On while deploy/demo.conf says DEMO_SITE=on, unless deploy/.env
# says DEMO_SITE=off on this server.
demo_domain() {
  local on domain
  on="$(setting DEMO_SITE)"
  [ -n "$on" ] || on="$(sed -n 's/^DEMO_SITE=//p' "$DEPLOY_DIR/demo.conf" 2>/dev/null | tail -n 1)"
  [ "$on" = on ] || return 0
  domain="$(setting DEMO_DOMAIN)"
  domain="${domain,,}"
  if [ -z "$domain" ]; then
    case "$APP_DOMAIN" in
      "" | localhost) return 0 ;;
      *.*.*) domain="demo.${APP_DOMAIN#*.}" ;;
      *) domain="demo.$APP_DOMAIN" ;;
    esac
  fi
  # A web address like demo.yourcompany.com, and never the ERP's own.
  [[ "$domain" =~ ^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$ && "$domain" != "$APP_DOMAIN" ]] ||
    return 0
  printf '%s' "$domain"
}

compose() {
  docker compose --project-directory "$DEPLOY_DIR" -f "$DEPLOY_DIR/compose.yml" \
    --env-file "$ENV_FILE" "$@"
}

# The same, with the demo site's services (demo-db, demo-seed, demo-app) too.
demo_compose() {
  compose --profile demo "$@"
}

# The folders on the server that hold the data, each owned by whoever writes it.
prepare_folders() {
  mkdir -p "$DATA_DIR"/{postgres,uploads,backups,safety-copies,caddy/data,caddy/config,caddy/sites}
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
    id="$(demo_compose ps -q "$1")"
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

# --- The demo site (README.md, "The demo site") ---------------------------------

# Its own passwords, key, folders and HTTPS part while it is on; no HTTPS part while
# it is off. A part Caddy would not accept is taken away again, so HTTPS for the
# ERP itself never depends on it.
prepare_demo_site() {
  local part="$DATA_DIR/caddy/sites/demo.caddy" name
  if [ -z "$DEMO_DOMAIN" ]; then
    rm -f "$part"
    return 0
  fi
  if [ -z "$(setting DEMO_POSTGRES_PASSWORD)" ]; then
    printf '\n# The demo site (README.md, "The demo site"): its own passwords and key.\n' >>"$ENV_FILE"
  fi
  for name in DEMO_POSTGRES_PASSWORD DEMO_APP_DB_PASSWORD DEMO_ENCRYPTION_KEY; do
    [ -n "$(setting "$name")" ] || printf '%s=%s\n' "$name" "$(openssl rand -hex 32)" >>"$ENV_FILE"
  done
  mkdir -p "$DATA_DIR"/demo/{postgres,uploads,backups}
  chown "$APP_UID:$APP_UID" "$DATA_DIR/demo/uploads" "$DATA_DIR/demo/backups"
  sed "s/^__DEMO_DOMAIN__ {/$DEMO_DOMAIN {/" "$DEPLOY_DIR/demo.caddy" >"$part"
  chmod 644 "$part"
  if ! compose run --rm --no-deps -T caddy \
    caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1; then
    rm -f "$part"
    DEMO_DOMAIN=""
    say "The demo site's HTTPS part did not check out, so the demo site stays off this time"
  fi
}

# Starts the demo site. Its owner signs in with the same password as on the live
# ERP: only that one password hash is read from the live database.
start_demo() {
  local email hash
  email="$(setting SEED_ADMIN_EMAIL)"
  email="${email,,}"
  hash="$(compose exec -T db psql -X -q -At -U postgres -d "$POSTGRES_DB" -v email="$email" <<'SQL'
SELECT "passwordHash" FROM "User" WHERE email = :'email';
SQL
  )" || return 1
  if [ -z "$hash" ]; then
    say "The demo site needs the owner (SEED_ADMIN_EMAIL in deploy/.env) to have a password on the live ERP"
    return 1
  fi
  DEMO_OWNER_PASSWORD_HASH="$hash" demo_compose up -d demo-db demo-seed demo-app || return 1
  wait_healthy demo-app
}

# Whether Caddy has the demo site's HTTPS certificate (DATA_DIR/caddy/data is its /data).
demo_certificate_ready() {
  local crt
  for crt in "$DATA_DIR"/caddy/data/caddy/certificates/*/"$DEMO_DOMAIN/$DEMO_DOMAIN.crt"; do
    case "$crt" in
      *staging*) ;;
      *) [ -s "$crt" ] && return 0 ;;
    esac
  done
  return 1
}

# Says whether the demo site has its HTTPS certificate. Caddy gets it in the
# background once the demo address's DNS record points at this server, so this
# waits up to two minutes for it, then says what Let's Encrypt answered. GitHub's
# log is public, so web and email addresses are left out of that answer.
report_demo_certificate() {
  local reason
  for _ in $(seq 1 40); do
    if demo_certificate_ready; then
      say "The demo site's HTTPS certificate is ready"
      return 0
    fi
    sleep 3
  done
  reason="$(compose logs --no-log-prefix --since 5m caddy 2>/dev/null |
    grep -F "\"identifier\":\"$DEMO_DOMAIN\"" | grep -F '"could not get certificate from issuer"' |
    grep -F letsencrypt | tail -n 1 | sed -n 's/.*"error":"\(.*\)"}$/\1/p' |
    sed -E 's#https?://[^ ]+##g; s/ ?\[?mailto:[^] ]*\]?//g; s/[^ ]+@[^ ]+/an email address/g; s/\\"/"/g' |
    cut -c1-300)" || true
  say "The demo site has no HTTPS certificate yet, so its address does not open. Let's Encrypt said: ${reason:-nothing yet}. Caddy keeps trying by itself, and each update tries again at once"
}

# Stops the demo site, when it is running; its data stays in DATA_DIR/demo.
stop_demo() {
  [ -n "$(demo_compose ps -aq demo-app demo-seed demo-db 2>/dev/null)" ] || return 0
  say "Stopping the demo site (its data stays in $DATA_DIR/demo)"
  demo_compose rm --stop --force demo-app demo-seed demo-db >/dev/null
}
