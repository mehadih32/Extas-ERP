#!/usr/bin/env bash
# Writes deploy/.env, the server's settings: asks for the ERP's web address and
# the owner's details, and makes fresh passwords and keys. Run it once, before
# the first deploy. It never replaces an existing deploy/.env.
#   sudo ./deploy/configure.sh
# Answers can also be given as environment variables (APP_DOMAIN, ACME_EMAIL,
# SEED_ADMIN_EMAIL, SEED_ADMIN_NAME, SEED_COMPANIES, DATA_DIR).
# shellcheck source=deploy/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

need_root
[ ! -e "$ENV_FILE" ] || die "deploy/.env already exists. It holds this server's passwords and keys, so it is never replaced. To change one setting: sudo nano deploy/.env"
command -v openssl >/dev/null || die "openssl is missing: run sudo ./deploy/setup-server.sh first."

# ask NAME "question" [default]: keeps NAME if it is already set.
ask() {
  local answer="${!1:-}"
  while [ -z "$answer" ]; do
    if [ -n "${3:-}" ]; then
      read -rp "$2 [$3]: " answer
      answer="${answer:-$3}"
    else
      read -rp "$2: " answer
    fi
  done
  printf -v "$1" '%s' "$answer"
}

ask APP_DOMAIN "Web address for the ERP (for example erp.yourcompany.com)"
APP_DOMAIN="$(printf '%s' "$APP_DOMAIN" | tr '[:upper:]' '[:lower:]' | sed -e 's#^https\?://##' -e 's#/.*$##')"
[[ "$APP_DOMAIN" =~ ^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$ || "$APP_DOMAIN" == localhost ]] ||
  die "\"$APP_DOMAIN\" is not a web address like erp.yourcompany.com."

email_ok() { [[ "$1" =~ ^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$ ]]; }
ask ACME_EMAIL "Email for HTTPS certificate notices"
email_ok "$ACME_EMAIL" || die "\"$ACME_EMAIL\" is not an email address."
ask SEED_ADMIN_EMAIL "Owner's email (the first sign-in)" "$ACME_EMAIL"
email_ok "$SEED_ADMIN_EMAIL" || die "\"$SEED_ADMIN_EMAIL\" is not an email address."
ask SEED_ADMIN_NAME "Owner's name" "Owner"
ask SEED_COMPANIES "Company names, separated by commas" "Extras,Fabric Apparel"
ask DATA_DIR "Folder for the data on this server" "/srv/extras-erp"
[[ "$DATA_DIR" == /* ]] || die "the data folder must be a full path, like /srv/extras-erp."

secret() { openssl rand -hex 32; }

umask 077
cat >"$ENV_FILE" <<EOF
# Extras ERP server settings, written by configure.sh on $(date -u +%Y-%m-%d).
# Keep a copy somewhere safe (a password manager): it holds this server's
# passwords and keys and is not part of the backups. deploy/.env.example
# explains each setting.

APP_DOMAIN=$APP_DOMAIN
ACME_EMAIL=$ACME_EMAIL

POSTGRES_DB=extras_erp
POSTGRES_PASSWORD=$(secret)
APP_DB_USER=extras_app
APP_DB_PASSWORD=$(secret)
PG_SHARED_BUFFERS=512MB
PG_EFFECTIVE_CACHE_SIZE=2GB

ENCRYPTION_KEY=$(secret)

DATA_DIR=$DATA_DIR

GOOGLE_DRIVE_CLIENT_ID=
GOOGLE_DRIVE_CLIENT_SECRET=

AI_API_KEY=
AI_INTAKE_MODEL=

SEED_ADMIN_EMAIL=$SEED_ADMIN_EMAIL
SEED_ADMIN_NAME=$SEED_ADMIN_NAME
SEED_COMPANIES=$SEED_COMPANIES
EOF

say "Saved the settings in deploy/.env (readable by root only)."
echo "Next: point $APP_DOMAIN at this server's public IP, then run: sudo ./deploy/deploy.sh"
