#!/usr/bin/env bash
# Sets up Extas ERP on a fresh Ubuntu server from a backup in Google Drive, in one
# go: it installs everything, asks for the web address and the recovery key, shows
# a Google sign-in code to enter on a phone, lists the backups in Drive, restores
# the newest (or the one picked), starts the ERP with HTTPS and opens every screen
# to check it. The Backups screen shows the exact command to paste (it holds the
# Google client); it downloads this file and runs:
#   sudo GITHUB_REPOSITORY=owner/repo GITHUB_TOKEN=... GOOGLE_CLIENT_ID=... \
#     GOOGLE_CLIENT_SECRET=... bash bootstrap.sh
# GITHUB_TOKEN is only needed while the repository is private: a token that can read
# it (GitHub, Settings > Developer settings > Fine-grained tokens, Contents: Read).
# The server keeps it (root only) for later updates.
# Answers can also be given as environment variables, for a run without questions:
#   APP_DOMAIN, ACME_EMAIL, RECOVERY_KEY, PICK (newest, ask, or a backup's name),
#   INSTALL_DIR (/opt/extras-erp), DATA_DIR (/srv/extras-erp), BRANCH (main),
#   DEMO_SITE (on/off), HTTPS_WAIT (seconds to wait for the certificate, 300).
set -euo pipefail

started="$(date +%s)"
say() { printf '\n==> %s\n' "$*"; }
die() {
  printf '\nError: %s\n' "$*" >&2
  exit 1
}

REPO="${GITHUB_REPOSITORY:-mehadih32/Extas-ERP}"
TOKEN="${GITHUB_TOKEN:-}"
DIR="${INSTALL_DIR:-/opt/extras-erp}"
DATA="${DATA_DIR:-/srv/extras-erp}"
BRANCH="${BRANCH:-main}"
PICK="${PICK:-}"

[ "$(id -u)" -eq 0 ] || die "run it with sudo (the command on the Backups screen does)."
# shellcheck source=/dev/null
. /etc/os-release
[ "${ID:-}" = ubuntu ] || die "this is for a new Ubuntu server (24.04 LTS); this one runs ${PRETTY_NAME:-something else}."
[[ "$REPO" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || die "GITHUB_REPOSITORY \"$REPO\" is not owner/name."
[[ "$DATA" == /* ]] || die "DATA_DIR must be a full path, like /srv/extras-erp."
if [ -e "$DATA/postgres/PG_VERSION" ]; then
  die "this server already has an Extas ERP database in $DATA. To restore a backup on it, use the Backups screen or sudo ./deploy/restore.sh."
fi
if [ -z "${GOOGLE_CLIENT_ID:-}" ] || [ -z "${GOOGLE_CLIENT_SECRET:-}" ]; then
  die "the Google client is missing: copy the whole command from the ERP's Backups screen (New server). Without the ERP, see deploy/README.md, \"Moving to a new server\"."
fi

# ask NAME "question" [default] [secret]: keeps NAME if it is already set.
ask() {
  local answer="${!1:-}"
  while [ -z "$answer" ]; do
    [ -t 0 ] || die "$1 is not set, and there is no keyboard to ask for it."
    if [ "${4:-}" = secret ]; then
      read -rsp "$2: " answer
      echo
    elif [ -n "${3:-}" ]; then
      read -rp "$2 [$3]: " answer
      answer="${answer:-$3}"
    else
      read -rp "$2: " answer
    fi
  done
  printf -v "$1" '%s' "$answer"
}

say "Extas ERP: a new server from a Google Drive backup"
ask APP_DOMAIN "Web address for the ERP (for example erp.extasbd.com)"
APP_DOMAIN="$(printf '%s' "$APP_DOMAIN" | tr '[:upper:]' '[:lower:]' | sed -e 's#^https\?://##' -e 's#/.*$##')"
[[ "$APP_DOMAIN" =~ ^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$ || "$APP_DOMAIN" == localhost ]] ||
  die "\"$APP_DOMAIN\" is not a web address like erp.yourcompany.com."
ask RECOVERY_KEY "Recovery key (56 letters and digits; it is not shown as you type)" "" secret
# The full check of the key is in drive-restore.ts; this catches a paste that went wrong.
plain_key="$(printf '%s' "$RECOVERY_KEY" | tr -d ' \t\r\n-')"
[ "${#plain_key}" -eq 56 ] || die "a recovery key is 56 letters and digits (14 groups of 4); the one given has ${#plain_key}."

say "Installing git and curl"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq ca-certificates curl git python3 >/dev/null

say "Getting the code from GitHub ($REPO)"
credentials=/root/.extras-erp-git-credentials
if [ -n "$TOKEN" ]; then
  # Kept (root only) so the server can fetch updates while the repository is private.
  (
    umask 077
    printf 'https://x-access-token:%s@github.com\n' "$TOKEN" >"$credentials"
  )
fi
git_auth=()
if [ -f "$credentials" ]; then git_auth=(-c "credential.helper=store --file=$credentials"); fi
if [ -d "$DIR/.git" ]; then
  git -C "$DIR" "${git_auth[@]}" fetch --quiet origin "$BRANCH" ||
    die "could not get the code from GitHub. If the repository is private, run the command again and paste a GitHub token that can read it."
  git -C "$DIR" checkout --quiet "$BRANCH"
  git -C "$DIR" merge --quiet --ff-only "origin/$BRANCH"
else
  GIT_TERMINAL_PROMPT=0 git "${git_auth[@]}" clone --quiet --branch "$BRANCH" "https://github.com/$REPO.git" "$DIR" ||
    die "could not get the code from GitHub. If the repository is private, run the command again and paste a GitHub token that can read it."
fi
if [ -f "$credentials" ]; then
  git -C "$DIR" config credential.helper "store --file=$credentials"
fi
cd "$DIR"
echo "Code: $(git log -1 --format='%h (%s)')"

say "Preparing the server (system updates, Docker, firewall)"
./deploy/setup-server.sh

say "Building the tools (a few minutes)"
docker build --quiet --target tools -t extras-erp-tools:latest . >/dev/null

mkdir -p "$DATA/backups/restores"
work="$(mktemp -d)"
chmod 700 "$work"
trap 'rm -rf "$work"' EXIT
(
  umask 077
  printf '%s\n' "$RECOVERY_KEY" >"$work/recovery-key"
)
unset RECOVERY_KEY plain_key

say "Finding the backups in Google Drive"
tty=()
if [ -t 0 ] && [ -t 1 ]; then tty=(-it); fi
if [ -z "$PICK" ]; then
  PICK=newest
  [ -t 0 ] && PICK=ask
fi
google_env=(-e GOOGLE_CLIENT_ID -e GOOGLE_CLIENT_SECRET)
# Only for the restore drill (.github/workflows/restore-drill.yml), which stands in for Google.
if [ -n "${GOOGLE_OAUTH_BASE:-}" ]; then google_env+=(-e GOOGLE_OAUTH_BASE); fi
if [ -n "${GOOGLE_DRIVE_BASE:-}" ]; then google_env+=(-e GOOGLE_DRIVE_BASE); fi
docker run --rm "${tty[@]}" --add-host host.docker.internal:host-gateway \
  "${google_env[@]}" -e PICK="$PICK" \
  -e RECOVERY_KEY_FILE=/work/recovery-key -e SERVER_FILE=/work/server.json \
  -e OUT_DIR=/data/backups/restores \
  -v "$work:/work" -v "$DATA/backups:/data/backups" \
  extras-erp-tools:latest npx tsx scripts/drive-restore.ts ||
  die "the backup could not be taken from Google Drive; the lines above say why. Nothing was installed yet: run the command again."

fact() { python3 -c 'import json, sys; v = json.load(open(sys.argv[1])).get(sys.argv[2]); print(v or "")' "$work/server.json" "$1"; }
name="$(fact name)"
old_key="$(fact encryptionKey)"
owner="$(fact ownerEmail)"
if [ -z "$name" ] || [ ! -d "$DATA/backups/restores/$name" ]; then die "the opened backup is missing."; fi
chown -R 1001:1001 "$DATA/backups"

say "Writing this server's settings"
if [ ! -f deploy/.env ]; then
  ask ACME_EMAIL "Email for HTTPS certificate notices" "$owner"
  SEED_ADMIN_EMAIL="${owner:-$ACME_EMAIL}"
  export APP_DOMAIN ACME_EMAIL SEED_ADMIN_EMAIL
  SEED_ADMIN_NAME=Owner SEED_COMPANIES=Extas DATA_DIR="$DATA" ./deploy/configure.sh
fi
set_setting() {
  local file=deploy/.env
  if grep -q "^$1=" "$file"; then
    NAME="$1" VALUE="$2" python3 - "$file" <<'PY'
import os, sys
path, name, value = sys.argv[1], os.environ["NAME"], os.environ["VALUE"]
lines = open(path).read().splitlines()
lines = [f"{name}={value}" if line.startswith(f"{name}=") else line for line in lines]
open(path, "w").write("\n".join(lines) + "\n")
PY
  else
    printf '%s=%s\n' "$1" "$2" >>"$file"
  fi
}
# The old server's key opens the settings sealed in the database (Google Drive, AI keys, bots).
if [ -n "$old_key" ]; then set_setting ENCRYPTION_KEY "$old_key"; fi
if [ -n "$owner" ]; then set_setting SEED_ADMIN_EMAIL "$owner"; fi
set_setting GOOGLE_DRIVE_CLIENT_ID "$GOOGLE_CLIENT_ID"
set_setting GOOGLE_DRIVE_CLIENT_SECRET "$GOOGLE_CLIENT_SECRET"
if [ -n "${DEMO_SITE:-}" ]; then set_setting DEMO_SITE "$DEMO_SITE"; fi
chmod 600 deploy/.env

say "Installing the ERP"
./deploy/deploy.sh

say "Restoring the backup $name"
result="$work/restore-result.json"
./deploy/restore.sh --yes --check --result "$result" "$DATA/backups/restores/$name" ||
  die "the restore did not finish; the lines above say why. The ERP runs without the backup's data."
rm -rf "${DATA:?}/backups/restores/$name"

https_ok=0
if [ "$APP_DOMAIN" = localhost ]; then
  curl -skf --max-time 10 https://localhost/api/health >/dev/null && https_ok=1
else
  say "Waiting for the HTTPS certificate for $APP_DOMAIN"
  deadline=$(($(date +%s) + ${HTTPS_WAIT:-300}))
  while [ "$(date +%s)" -lt "$deadline" ]; do
    if curl -sf --max-time 10 "https://$APP_DOMAIN/api/health" >/dev/null; then
      https_ok=1
      break
    fi
    sleep 10
  done
fi

took=$(($(date +%s) - started))
problems="$(python3 -c 'import json, sys; print(len(json.load(open(sys.argv[1])).get("checks", [])))' "$result" 2>/dev/null || echo "?")"
say "Done in $((took / 60)) min $((took % 60)) s"
echo "Restored: $name"
if [ "$problems" = 0 ]; then
  echo "Full check: every screen opened."
else
  echo "Full check: $problems screen(s) or PDF(s) did not open; see the lines above."
fi
if [ "$https_ok" = 1 ]; then
  echo "The ERP is running at https://$APP_DOMAIN"
else
  ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
  echo "The ERP is running, but https://$APP_DOMAIN does not answer yet. Point the web address"
  echo "at this server's public IP (deploy/README.md, step 2; this server's own address is ${ip:-?})."
  echo "The certificate then comes by itself within a few minutes."
fi
echo "Next: sign in as before. To let GitHub update this server after each merge, run"
echo "  cd $DIR && sudo ./deploy/setup-auto-deploy.sh"
