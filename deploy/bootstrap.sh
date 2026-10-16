#!/usr/bin/env bash
# Extas ERP: the one restore command (the restore guide, part C). It brings the
# whole ERP back on a new Ubuntu server from a backup in Google Drive: it
# installs what is needed, signs in to Google with a code on the phone, lists
# the backups newest first, downloads and checks the one picked (Enter: the
# newest), opens it with the recovery key (read from Drive when the owner keeps
# it there), restores the database, the files, the settings and the code,
# points the web address at this server in Cloudflare, gets HTTPS, starts the
# ERP and the demo site, runs the checks and compares every table and file with
# the backup's list.
#
# It is public and holds no secret, and it needs no GitHub sign-in: the code
# comes from the backup itself. The command in the restore guide downloads it
# at a fixed version (a commit), checks its SHA-256 and runs it:
#   c=<commit> &&
#   curl -fsSL https://raw.githubusercontent.com/mehadih32/Extas-ERP/$c/deploy/bootstrap.sh -o restore.sh &&
#   echo "<sha256> restore.sh" | sha256sum -c &&
#   sudo bash restore.sh $c
# It downloads deploy/restore-tool.py from the same commit and checks it against
# RESTORE_TOOL_SHA256 below (tests/unit/restore-guide.test.ts keeps the two
# the same). Secrets (the Google client, the recovery key) are asked only by the
# restore tool, as hidden input; none goes on a command line, on the screen or
# into the log (/var/log/extas-erp-restore.log).
#
# On a server that already has Extas ERP, nothing is replaced unless its web
# address is typed to confirm; its own ENCRYPTION_KEY is never replaced.
# Every question and every error code (R01, W01...) is in the restore guide.
#   sudo bash restore.sh [commit]     the restore
#   bash restore.sh --find            only says which Extas ERP this server has
set -euo pipefail
umask 022

REPO=mehadih32/Extas-ERP
RESTORE_TOOL_SHA256=59179fd8a2bfb543b7c502b7ec452c4802c83b8d5b8ffc60d1c98d4b863b19db
# Drills only: a stand-in for raw.githubusercontent.com (the tool is still checked).
RAW_BASE="${EXTAS_RAW_BASE:-https://raw.githubusercontent.com}"
SEARCH_ROOTS="${EXTAS_SEARCH_ROOTS:-/opt /srv /home /root /var/lib /data /mnt}"
# Drills only: a smaller disk than a real server needs (a test machine's own disk).
MIN_FREE_GB="${EXTAS_MIN_FREE_GB:-20}"
DIR=/opt/extras-erp
DATA=/srv/extras-erp
WORK=/var/lib/extas-erp-restore
LOG=/var/log/extas-erp-restore.log

started="$(date +%s)"
step_no=0
step() {
  step_no=$((step_no + 1))
  printf '\n==> Step %s: %s\n' "$step_no" "$*"
}
say() { printf '\n==> %s\n' "$*"; }
note() { printf '    %s\n' "$*"; }
fail() {
  local code="$1"
  shift
  printf '\nError %s: %s\n(Look up %s in the restore guide'"'"'s list of errors.)\n' "$code" "$*" "$code" >&2
  exit 2
}
warn() {
  local code="$1"
  shift
  printf '\nNote %s: %s\n(Look up %s in the restore guide'"'"'s list of errors.)\n' "$code" "$*" "$code"
}

# A setting from a settings file (the last line wins).
env_get() {
  [ -f "$1" ] || return 0
  sed -n "s/^$2=//p" "$1" 2>/dev/null | tail -n 1
}

# answer NAME "question": from the drill's answers file (RESTORE_ANSWERS) when it
# has NAME, else typed. Only for answers that are not secret.
answer() {
  local name="$1" prompt="$2" value=""
  if [ -n "${RESTORE_ANSWERS:-}" ] && grep -q "^$name=" "$RESTORE_ANSWERS" 2>/dev/null; then
    env_get "$RESTORE_ANSWERS" "$name"
    return 0
  fi
  { : </dev/tty; } 2>/dev/null ||
    fail R25 "there is no keyboard to answer \"$prompt\". Run the command in PuTTY as the guide shows."
  read -r -p "$prompt" value </dev/tty
  printf '%s' "$value"
}

plain_domain() { printf '%s' "$1" | tr '[:upper:]' '[:lower:]' | sed -e 's#^https\?://##' -e 's#/.*$##' -e 's/[[:space:]]//g'; }

# --- An Extas ERP already on this server (A6) ------------------------------------

declare -A found_dirs=() found_data=() running_dirs=()

# Every Extas ERP on this server: a running one (Docker's extras-erp project), its
# program folder (deploy/compose.yml) and its data (deploy.sh's mark, or a
# database folder), in any of the usual folders.
detect_installs() {
  local wd f root
  if command -v docker >/dev/null 2>&1; then
    while IFS= read -r wd; do
      [ -n "$wd" ] || continue
      found_dirs["$(dirname "$wd")"]=1
      running_dirs["$(dirname "$wd")"]=1
    done < <(docker ps --filter label=com.docker.compose.project=extras-erp \
      --format '{{index .Labels "com.docker.compose.project.working_dir"}}' 2>/dev/null | sort -u)
  fi
  for root in $SEARCH_ROOTS; do
    [ -d "$root" ] || continue
    while IFS= read -r f; do
      grep -qx 'name: extras-erp' "$f" 2>/dev/null && found_dirs["$(dirname "$(dirname "$f")")"]=1
    done < <(find "$root" -maxdepth 4 -path '*/deploy/compose.yml' -type f 2>/dev/null)
    while IFS= read -r f; do
      case "$f" in
        */demo/postgres/PG_VERSION) ;; # the demo site's, inside the ERP's data folder
        */.extas-erp-data) found_data["$(dirname "$f")"]=1 ;;
        */postgres/PG_VERSION) found_data["$(dirname "$(dirname "$f")")"]=1 ;;
      esac
    done < <(find "$root" -maxdepth 5 \( -name .extas-erp-data -o -path '*/postgres/PG_VERSION' \) -type f 2>/dev/null)
  done
}

# Whether a data folder holds an ERP's data: its database, or deploy.sh's mark.
has_data() { [ -n "$1" ] && { [ -f "$1/postgres/PG_VERSION" ] || [ -f "$1/.extas-erp-data" ]; }; }

# One line for each install found:
#   program folder|data folder|web address|running|has data
# A program folder that neither runs nor has data (a restore stopped half-way, when
# the connection dropped) has nothing to lose: the restore goes on over it.
list_installs() {
  local dir data domain claimed=" "
  for dir in "${!found_dirs[@]}"; do
    data="$(env_get "$dir/deploy/.env" DATA_DIR)"
    [ -f "$dir/deploy/.env" ] && data="${data:-/srv/extras-erp}"
    domain="$(env_get "$dir/deploy/.env" APP_DOMAIN)"
    [ -n "$data" ] && claimed+="$(realpath -m "$data") "
    printf '%s|%s|%s|%s|%s\n' "$dir" "$data" "$domain" "${running_dirs[$dir]:+yes}" \
      "$(has_data "$data" && echo yes)"
  done
  for data in "${!found_data[@]}"; do
    case "$claimed" in *" $(realpath -m "$data") "*) continue ;; esac
    printf '|%s|%s||yes\n' "$data" "$(env_get "$data/.extas-erp-data" APP_DOMAIN)"
  done
}

if [ "${1:-}" = --find ]; then
  detect_installs
  list_installs | LC_ALL=C sort
  exit 0
fi

# --- Checks before anything changes ------------------------------------------------

[ "$(id -u)" -eq 0 ] ||
  fail R01 "run it with sudo: paste the whole command from the guide, which has sudo in it."
commit="${1:-}"
[ -z "$commit" ] || [[ "$commit" =~ ^[0-9a-f]{40}$ ]] ||
  fail R24 "\"$commit\" after restore.sh is not a version (40 letters and digits). Copy the whole command from the guide again."
ref="${commit:-main}"

# shellcheck source=/dev/null
. /etc/os-release
major="${VERSION_ID%%.*}"
{ [ "${ID:-}" = ubuntu ] && [ "${major:-0}" -ge 22 ]; } 2>/dev/null ||
  fail R02 "this server runs ${PRETTY_NAME:-another system}. Make the VM with Ubuntu Server 24.04 LTS (step A6 in the guide)."

mkdir -p "$(dirname "$LOG")"
touch "$LOG" && chmod 600 "$LOG"
# One restore at a time. One that is already running (its PuTTY connection dropped)
# is shown here until it ends, instead of a second one starting.
exec 8>/run/extas-erp-restore.lock
if ! flock -n 8; then
  other="$(cat /run/extas-erp-restore.pid 2>/dev/null || true)"
  if [[ "$other" =~ ^[0-9]+$ ]] && kill -0 "$other" 2>/dev/null; then
    say "A restore is already running on this server (it goes on when the connection drops). Here it is, until it ends:"
    tail -n 40 --pid="$other" -f "$LOG" || true
    say "That restore has ended: its last lines are above. If they end with an error, paste the command again."
    exit 0
  fi
  fail R23 "another restore is already running on this server. Wait for it to finish, then paste the command again."
fi
echo "$$" >/run/extas-erp-restore.pid
# A dropped PuTTY connection does not stop the restore: it goes on, into the log.
trap '' HUP
exec > >(tee --output-error=warn -a "$LOG") 2>&1

say "Extas ERP: bringing the ERP back from a Google Drive backup ($(date '+%d %B %Y %H:%M'))"

step "Checking this server"
memory_kb="$(awk '/^MemTotal:/ {print $2}' /proc/meminfo)"
free_kb="$(df --output=avail -k / | tail -n 1 | tr -d ' ')"
[ "${memory_kb:-0}" -ge 3400000 ] ||
  fail R03 "this server has $((memory_kb / 1024)) MB of memory; the ERP needs 4 GB. Make the VM again with size B2s or larger (step A7 in the guide)."
[ "${free_kb:-0}" -ge $((MIN_FREE_GB * 1024 * 1024)) ] ||
  fail R03 "this server has $((free_kb / 1024 / 1024)) GB free on its disk; the ERP needs at least 20 GB. Make the VM again with a 64 GB disk (step A10 in the guide)."
note "Ubuntu ${VERSION_ID}, $((memory_kb / 1024)) MB memory, $((free_kb / 1024 / 1024)) GB free disk: fine."

step "Looking for an Extas ERP already on this server"
detect_installs
installs=()
unfinished=0
while IFS= read -r line; do
  IFS='|' read -r i_dir i_data i_domain i_running i_has_data <<<"$line"
  if [ -z "$i_running" ] && [ -z "$i_has_data" ]; then
    unfinished=1
    [ "$i_dir" != "$DIR" ] || note "A restore that stopped half-way is in $DIR (no data yet): it goes on from here."
    continue
  fi
  installs+=("$line")
done < <(list_installs | LC_ALL=C sort)
if [ "${#installs[@]}" -eq 0 ]; then
  [ "$unfinished" = 1 ] || note "None: this is a new server."
else
  say "This server already has Extas ERP"
  for line in "${installs[@]}"; do
    IFS='|' read -r i_dir i_data i_domain i_running i_has_data <<<"$line"
    note "Program folder: ${i_dir:-not found}"
    note "Data folder:    ${i_data:-not found}"
    note "Web address:    ${i_domain:-not known}"
    note "Running now:    ${i_running:-no}"
    echo
  done
  note "Restoring here REPLACES ALL its data with the backup (a safety copy of the data as"
  note "it is now is saved first). Its own keys and passwords stay."
  typed="$(plain_domain "$(answer replace 'Type the web address of the ERP on this server to replace its data, or press Enter to stop: ')")"
  chosen=""
  for line in "${installs[@]}"; do
    IFS='|' read -r i_dir i_data i_domain i_running i_has_data <<<"$line"
    if [ -n "$typed" ] && { [ "$typed" = "$(plain_domain "$i_domain")" ] ||
      { [ -z "$i_domain" ] && [ "$typed" = "$i_data" ]; }; }; then
      chosen="$line"
    fi
  done
  [ -n "$chosen" ] ||
    fail R04 "stopped: the web address typed is not the one of the ERP on this server, so nothing was changed."
  IFS='|' read -r i_dir i_data i_domain i_running i_has_data <<<"$chosen"
  { [ -n "$i_dir" ] && [ -f "$i_dir/deploy/.env" ]; } ||
    fail R29 "this server has Extas ERP data in $i_data but not its program folder and settings, so it cannot be restored over safely. Move the data away (sudo mv $i_data $i_data.old), then paste the command again."
  DIR="$i_dir"
  DATA="$i_data"
  note "Restoring over the ERP in $DIR (data in $DATA)."
fi

step "Installing the restore tools"
export DEBIAN_FRONTEND=noninteractive
apt_get() { apt-get -o DPkg::Lock::Timeout=900 -q "$@"; }
# An install cut off earlier (the VM restarted) is finished first, or nothing installs.
dpkg --configure -a >/dev/null 2>&1 || true
if ! { apt_get update >/dev/null && apt_get install -y --no-install-recommends \
  ca-certificates curl git python3 python3-cryptography >/dev/null; }; then
  fail R05 "the restore tools could not be installed. Wait 5 minutes (a new server installs its own updates first), then paste the command again."
fi
rm -rf "$WORK"
install -d -m 700 "$WORK"
restore_dir=""
cleanup() {
  # The opened backup is plain data and secrets: it never stays on the disk.
  rm -rf "$WORK"
  [ -z "$restore_dir" ] || rm -rf "$restore_dir"
}
trap cleanup EXIT
curl -fsSL --retry 3 "$RAW_BASE/$REPO/$ref/deploy/restore-tool.py" -o "$WORK/restore-tool.py" ||
  fail R06 "the restore tool could not be downloaded from GitHub. Check that the VM has internet access, then paste the command again."
echo "$RESTORE_TOOL_SHA256  $WORK/restore-tool.py" | sha256sum -c --quiet - >/dev/null 2>&1 ||
  fail R07 "the restore tool downloaded is not the expected one (its checksum differs). Copy the command from the newest guide and paste it again."
tool() { python3 -I "$WORK/restore-tool.py" "$@"; }
note "Done."

step "Signing in to Google and downloading the backup"
tool fetch --work "$WORK" || exit 3
name="$(tool fact --work "$WORK" name)"
backup_commit="$(tool fact --work "$WORK" commit)"
cp "$WORK/restore/manifest.json" "$WORK/manifest.json"

step "Putting the ERP's code in place"
if [ -n "$(tool fact --work "$WORK" hasCode)" ]; then
  # git checks a bundle only inside a repository: an empty one of its own.
  rm -rf "$WORK/code-check"
  { git init -q "$WORK/code-check" && git -C "$WORK/code-check" bundle verify -q "$WORK/code.bundle"; } >/dev/null 2>&1 ||
    fail R15 "the code inside the backup is damaged. Pick another backup (paste the command again)."
  rm -rf "$WORK/code-check"
  if [ -d "$DIR/.git" ]; then
    [ -z "$(git -C "$DIR" status --porcelain --untracked-files=no)" ] ||
      fail R26 "the code in $DIR has changes of its own, so it was not replaced. Nothing was changed."
    git -C "$DIR" fetch -q "$WORK/code.bundle" HEAD || fail R15 "the code inside the backup could not be read."
  else
    if [ -e "$DIR" ] && [ -n "$(ls -A "$DIR" 2>/dev/null)" ]; then
      fail R26 "the folder $DIR already has other files in it, so the code was not put there. Nothing was changed."
    fi
    git clone -q --no-checkout "$WORK/code.bundle" "$DIR" || fail R15 "the code inside the backup could not be read."
  fi
  git -C "$DIR" checkout -q -B main "${backup_commit:-FETCH_HEAD}" 2>/dev/null ||
    git -C "$DIR" checkout -q -B main FETCH_HEAD 2>/dev/null ||
    git -C "$DIR" checkout -q -B main HEAD ||
    fail R15 "the backup's version of the code could not be put in place."
else
  # A backup from before v6.4 has no code inside: the public code from GitHub, no sign-in.
  note "This backup has no code inside (it is from before v6.4): taking the code from GitHub."
  want="${backup_commit:-main}"
  if [ ! -d "$DIR/.git" ]; then
    GIT_TERMINAL_PROMPT=0 git clone -q "https://github.com/$REPO.git" "$DIR" ||
      fail R15 "the code could not be downloaded from GitHub. Check the VM's internet access, then paste the command again."
  fi
  GIT_TERMINAL_PROMPT=0 git -C "$DIR" fetch -q origin "$want" 2>/dev/null ||
    GIT_TERMINAL_PROMPT=0 git -C "$DIR" fetch -q origin main ||
    fail R15 "the code could not be downloaded from GitHub."
  git -C "$DIR" checkout -q -B main FETCH_HEAD || fail R15 "the code could not be put in place."
fi
git -C "$DIR" remote set-url origin "https://github.com/$REPO.git" 2>/dev/null ||
  git -C "$DIR" remote add origin "https://github.com/$REPO.git"
note "Code: $(git -C "$DIR" log -1 --format='%h, %cd' --date=format:'%d %B %Y')"

step "Writing this server's settings"
env_file="$DIR/deploy/.env"
status=0
tool env --work "$WORK" --env "$env_file" || status=$?
if [ "$status" = 5 ]; then
  # A backup from before v6.4 has no settings file: new settings, with its web address and owner.
  domain="$(plain_domain "$(tool fact --work "$WORK" appDomain)")"
  [ -n "$domain" ] || domain="$(plain_domain "$(answer domain 'Web address for the ERP (for example erp.extasbd.com): ')")"
  owner="$(tool fact --work "$WORK" ownerEmail)"
  email="$(answer acme_email "Email for HTTPS certificate notices [$owner]: ")"
  email="${email:-$owner}"
  APP_DOMAIN="$domain" ACME_EMAIL="$email" SEED_ADMIN_EMAIL="${owner:-$email}" SEED_ADMIN_NAME=Owner \
    SEED_COMPANIES=Extas DATA_DIR="$DATA" "$DIR/deploy/configure.sh" </dev/null >/dev/null ||
    fail R16 "the server's settings could not be written (the web address or the email is not right)."
  tool env --work "$WORK" --env "$env_file" || fail R16 "the server's settings could not be written."
elif [ "$status" != 0 ]; then
  exit 3
fi
chmod 600 "$env_file"
DATA="$(env_get "$env_file" DATA_DIR)"
DATA="${DATA:-/srv/extras-erp}"
APP_DOMAIN="$(env_get "$env_file" APP_DOMAIN)"
note "Web address: $APP_DOMAIN; data folder: $DATA"

step "Pointing the web address at this server"
tool dns --work "$WORK" --deploy "$DIR/deploy" ||
  warn W02 "Cloudflare could not be reached, so the web address was not changed. Point it to this server's Public IP address (see W01)."

step "Preparing the server (system updates, Docker, firewall: about 5 minutes)"
EXTAS_RESTORE=1 "$DIR/deploy/setup-server.sh" || fail R17 "the server could not be prepared; the lines above say why. Paste the command again."

step "Installing the ERP (building it takes about 10 to 20 minutes)"
"$DIR/deploy/deploy.sh" || fail R18 "the ERP could not be installed; the lines above say why. Paste the command again: it picks up where it stopped."

step "Restoring the database and the files"
mkdir -p "$DATA/backups/restores"
restore_dir="$DATA/backups/restores/$name"
rm -rf "$restore_dir"
mv "$WORK/restore" "$restore_dir"
counts=()
grep -q -- '--counts' "$DIR/deploy/restore.sh" && counts=(--counts "$WORK/counts.json")
"$DIR/deploy/restore.sh" --yes --check --result "$WORK/restore-result.json" "${counts[@]}" "$restore_dir" ||
  fail R19 "the backup could not be restored; the lines above say why. The ERP runs without the backup's data. Paste the command again."
rm -rf "$restore_dir"
restore_dir=""

step "Starting the demo site"
demo_note="off"
demo=0
(
  cd "$DIR"
  # shellcheck source=/dev/null
  source deploy/lib.sh
  load_settings
  [ -n "$DEMO_DOMAIN" ] || exit 10
  prepare_demo_site
  [ -n "$DEMO_DOMAIN" ] || exit 11
  start_demo
  compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile --force >/dev/null 2>&1 || true
) || demo=$?
case "$demo" in
  0) demo_note="running" ;;
  10) note "The demo site is off on this server." ;;
  *)
    demo_note="not started"
    warn W04 "the demo site did not start; the ERP itself is not affected. It starts again with the next update."
    ;;
esac

step "Running the checks"
screen_problems="$(python3 -c 'import json, sys; print(len(json.load(open(sys.argv[1])).get("checks", [])))' "$WORK/restore-result.json" 2>/dev/null || echo "?")"
if [ -x "$DIR/deploy/bug-guard.sh" ]; then
  "$DIR/deploy/bug-guard.sh" --after-restore ||
    warn W05 "Bug Guard found problems after the restore; they are in the ERP's inbox and on Telegram."
  checks_note="Bug Guard ran"
else
  note "Bug Guard is not part of this version; the full check (every screen and PDF opened as the owner) ran above."
  checks_note="full check"
fi
if [ "$screen_problems" != 0 ]; then
  warn W05 "$screen_problems screen(s) or PDF(s) did not open in the check (listed above). The ERP runs; tell the developer."
fi

step "Comparing every table and file with the backup"
compare=0
tool compare --work "$WORK" --manifest "$WORK/manifest.json" --counts "$WORK/counts.json" \
  --uploads "$DATA/uploads" --result "$WORK/compare.json" || compare=$?

step "Checking HTTPS"
https_ok=0
deadline=$(($(date +%s) + ${HTTPS_WAIT:-300}))
while [ "$(date +%s)" -lt "$deadline" ]; do
  if [ "$APP_DOMAIN" = localhost ]; then
    curl -skf --max-time 10 https://localhost/api/health >/dev/null 2>&1 && https_ok=1 && break
  elif curl -sf --max-time 10 --resolve "$APP_DOMAIN:443:127.0.0.1" "https://$APP_DOMAIN/api/health" >/dev/null 2>&1; then
    https_ok=1
    break
  fi
  sleep 10
done
ip="$(curl -s --max-time 10 https://1.1.1.1/cdn-cgi/trace 2>/dev/null | sed -n 's/^ip=//p')" || true
[ "$https_ok" = 1 ] || warn W03 "https://$APP_DOMAIN has no HTTPS certificate yet. Check that $APP_DOMAIN points to this server (${ip:-its Public IP address}) and that ports 80 and 443 are open in Azure; the certificate then comes by itself within a few minutes."

took=$(($(date +%s) - started))
say "Finished in $((took / 60)) min $((took % 60)) s"
note "Backup: $name"
python3 - "$WORK/compare.json" <<'PY' || true
import json, sys
try:
    r = json.load(open(sys.argv[1]))
except (OSError, ValueError):
    sys.exit(0)
if r.get("ok") and r["compared"]["records"] and r["compared"]["files"]:
    print(f"    All {r['records']:,} records and {r['files']:,} files are back.")
elif r.get("ok"):
    print("    The backup is back (it had no list of its tables and files to compare with).")
else:
    print(f"    Not everything is back: {len(r['problems'])} problem(s), listed above (R20).")
PY
if [ "$https_ok" = 1 ]; then
  note "The ERP is running at https://$APP_DOMAIN : sign in as before."
else
  note "The ERP is running; https://$APP_DOMAIN opens once its address points here (W03)."
fi
if [ "$demo_note" = running ]; then note "The demo site is running too."; fi
note "Checks: $checks_note; ${screen_problems} problem(s) found."
note "The full log of this restore: sudo less $LOG"
note "Next (part F of the guide): let GitHub update this server again: cd $DIR && sudo ./deploy/setup-auto-deploy.sh"
[ "$compare" = 0 ] || exit 4
