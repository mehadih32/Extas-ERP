#!/usr/bin/env bash
# Extas ERP: the one restore command (the restore guide, part C). It brings the
# whole ERP back on a new Ubuntu server from a backup in Google Drive: it
# installs what is needed, signs in to Google with a code on the phone, lists
# the backups newest first, downloads and checks the one picked (Enter: the
# newest that passed its check), opens it with the recovery key (read from Drive
# when the owner keeps it there), restores the database, the files, the settings
# and the code, and only then points the web address at this server in
# Cloudflare, gets HTTPS, starts the demo site, runs the checks and compares
# every table and file with the backup's list. A second try after a stop goes on
# with the download of the first (kept only while still locked); nothing opened,
# and no Google sign-in, stays on the disk: what a restore cut off half-way left
# is deleted at every start, at the end, and when the server starts (a boot unit
# this command installs), even if the command is never run again.
#
# It is public and holds no secret, and it needs no GitHub sign-in: the ERP's
# code comes from the backup itself. The restore steps (restore.sh,
# setup-server.sh and their lib.sh) are this command's own version (from the
# backup's code when it has that version, else from GitHub at it), so older
# backups get every fix of the restore too. The command in the restore guide downloads it
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
# address is typed to confirm; its own ENCRYPTION_KEY is never replaced, and a
# restore over it that does not finish puts its own code back. The command run
# again on the new server of a restore that stopped there goes on by itself
# (the mark DATA/backups/.restore-unfinished), without that question.
# Every question and every error code (R01, W01...) is in the restore guide.
#   sudo bash restore.sh [commit]     the restore
#   sudo bash restore.sh <commit> --drill
#                                     a practice drill: a test web address, and the
#                                     copy in test mode (the guide's "Practice: a
#                                     restore drill"; BACKUP_DIR/.drill)
#   bash restore.sh --find            only says which Extas ERP this server has
#   bash restore.sh --choose          only the A6 decision (drills and tests)
# Without GitHub (G17): restore.sh and restore-tool.py from the Drive backup folder,
# side by side in one folder; the tool beside the script is used when it is the right one.
set -euo pipefail
umask 022

REPO=mehadih32/Extas-ERP
RESTORE_TOOL_SHA256=60880331308c65328fd87a4361ba33ef8cd463dff57adcf95ac11c65a1ee3320
# Drills only: a stand-in for raw.githubusercontent.com (the tool is still checked).
RAW_BASE="${EXTAS_RAW_BASE:-https://raw.githubusercontent.com}"
# Tests only: a stand-in for github.com (the restore steps of this command's version).
GIT_BASE="${EXTAS_GIT_BASE:-https://github.com}"
SEARCH_ROOTS="${EXTAS_SEARCH_ROOTS:-/opt /srv /home /root /var/lib /data /mnt}"
# Drills only: a smaller disk than a real server needs (a test machine's own disk).
MIN_FREE_GB="${EXTAS_MIN_FREE_GB:-20}"
DIR=/opt/extras-erp
DATA=/srv/extras-erp
WORK=/var/lib/extas-erp-restore
LOG=/var/log/extas-erp-restore.log
# The boot unit that deletes what a restore cut off half-way opened (forget_opened).
CLEAN_SCRIPT=/usr/local/sbin/extras-erp-restore-clean
CLEAN_UNIT=extras-erp-restore-clean.service
# In DATA/backups of a new server from its settings until the command has done every
# step, or its web address points here (it may be in use from then on): the command
# run again there goes on by itself (choose_install), even when the backup was in and a
# later step (Cloudflare, HTTPS, the checks) stopped it.
UNFINISHED=.restore-unfinished

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
  flush_keys
  read -r -p "$prompt" value </dev/tty
  printf '%s' "$value"
}

# Drops whatever was typed before a question: an Enter pressed earlier (while the
# restore worked, or a second one after a paste) must never answer it.
flush_keys() {
  python3 -I -c 'import os, termios
fd = os.open("/dev/tty", os.O_RDWR | os.O_NOCTTY)
termios.tcflush(fd, termios.TCIFLUSH)' 2>/dev/null || true
}

# A new Azure VM installs its own updates in its first minutes (cloud-init, then
# the automatic updates): apt waits until they are done instead of failing.
apt_busy() {
  local lock
  if command -v fuser >/dev/null 2>&1; then
    for lock in ${APT_LOCKS:-/var/lib/dpkg/lock-frontend /var/lib/dpkg/lock /var/lib/apt/lists/lock /var/cache/apt/archives/lock}; do
      [ -e "$lock" ] && fuser "$lock" >/dev/null 2>&1 && return 0
    done
    return 1
  fi
  pgrep -x 'apt|apt-get|dpkg|unattended-upgr|aptd' >/dev/null 2>&1
}
# One time limit for both waits (cloud-init, then apt's lock): 30 minutes in all.
wait_for_apt() {
  local waited=0 limit="${APT_WAIT_SECONDS:-1800}" said=0 start="$SECONDS"
  if command -v cloud-init >/dev/null 2>&1; then
    timeout "$limit" cloud-init status --wait >/dev/null 2>&1 || true
    waited=$((SECONDS - start))
  fi
  while apt_busy; do
    [ "$waited" -lt "$limit" ] || return 1
    if [ "$said" = 0 ]; then
      note "The server is installing its own updates first; waiting for them to finish (up to $(((limit - waited + 59) / 60)) minutes)..."
      said=1
    fi
    sleep 5
    waited=$((waited + 5))
  done
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

# The A6 decision: on a server that already has Extas ERP (running, or with data),
# the restore goes on only over the one whose web address is typed, and only when
# its program folder and settings are there (its own keys stay). Sets DIR and DATA.
choose_install() {
  local line typed chosen i_dir i_data i_domain i_running i_has_data unfinished=0
  local installs=()
  replacing=0
  while IFS= read -r line; do
    IFS='|' read -r i_dir i_data i_domain i_running i_has_data <<<"$line"
    # This command's own restore on a new server, stopped before it finished and
    # before its web address pointed here (its mark): nothing of anyone's is there but
    # what the command put, so it goes on.
    if [ -n "$i_data" ] && [ -f "$i_data/backups/$UNFINISHED" ] && [ -n "$i_dir" ] &&
      [ -f "$i_dir/deploy/.env" ]; then
      unfinished=1
      DIR="$i_dir"
      DATA="$i_data"
      note "A restore that stopped half-way on this new server is in $DIR (it is not in use yet): it goes on from here."
      continue
    fi
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
    # A drill never runs over an ERP in use: only on a new server, or again over a
    # drill copy (its data folder holds the drill's mark).
    if [ -n "${drill:-}" ]; then
      for line in "${installs[@]}"; do
        IFS='|' read -r i_dir i_data i_domain i_running i_has_data <<<"$line"
        [ -f "$i_data/backups/.drill" ] ||
          fail R31 "this server already has an Extas ERP that is not a drill copy (${i_domain:-in $i_data}), so a drill does not run here. A drill needs a new test server: make one as the guide's drill part says. Nothing was changed."
      done
    fi
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
    replacing=1
    note "Restoring over the ERP in $DIR (data in $DATA)."
  fi
}

# --- Standby while the backup comes back (G2) --------------------------------------

# The restored ERP waits on standby until its web address points here: the mark
# (DATA/backups/.standby, read by src/modules/backups/standby.ts) is in place before
# the restored database first starts, and goes only once the web address reaches this
# server (below) or with deploy/go-live.sh. Its random words tell this server from
# another one (go-live.sh checks the web address reaches this server by them). $1:
# the data folder; $2: 1 when the restore goes over an ERP already here (A6). Over one
# that was in use (it had no mark of its own), .standby.was-in-use says so, kept
# across a restore cut off half-way: a restore that fails leaves it in use, as it was
# (standby_after_failure), never on standby.
mark_standby() {
  local backups="$1/backups"
  mkdir -p "$backups"
  if [ "$2" = 1 ] && [ ! -f "$backups/.standby" ]; then
    : >"$backups/.standby.was-in-use"
  fi
  head -c 16 /dev/urandom | od -An -tx1 | tr -d ' \n' >"$backups/.standby"
  chmod 644 "$backups/.standby"
}

# Whether $APP_DOMAIN reaches this server already (its DNS, or the ERP answering
# there shows this server's standby mark: deploy/lib.sh web_address_here).
# shellcheck source=/dev/null
address_here() {
  [ "$APP_DOMAIN" != localhost ] &&
    (cd "$DIR" && source deploy/lib.sh && web_address_here "$APP_DOMAIN" "$DATA/backups/.standby") >/dev/null 2>&1
}

# After a restore that did not finish ($1: 1 when the backup's data is in already):
# an ERP that was in use here before this command is not left on standby by it. With
# the data from before (put back, or never replaced) it is in use again at once; with
# the backup's data, only when its web address reaches this server. True when it
# was taken off standby.
standby_after_failure() {
  local backups="$DATA/backups"
  [ -f "$backups/.standby.was-in-use" ] || return 1
  if [ "$1" = 1 ] && ! address_here; then
    return 1
  fi
  rm -f "$backups/.standby" "$backups/.standby.was-in-use"
  return 0
}

# --- A practice drill (the guide's "Practice: a restore drill") --------------------

# The drill's own web address and test mode, on the settings file $1 with the data
# folder $2 ($3: the web address in the backup, when known): a test address is asked
# (never the ERP's own or its demo site's), set as APP_DOMAIN with the demo site off,
# so the real address's DNS is never touched; and DATA/backups/.drill marks the copy
# as a drill before the ERP first starts: no emails, bot messages, Drive backups or
# scheduled jobs (standby.ts reads it). The real address is kept as DRILL_OF, so a
# drill run again on the same test server (its APP_DOMAIN is the drill's by then)
# still knows it; such a run keeps the drill address in its mark, without asking.
drill_settings() {
  local env_file="$1" data="$2" live live_demo example test_domain earlier
  earlier="$(python3 -I -c 'import json, sys; print(json.load(open(sys.argv[1])).get("address") or "")' \
    "$data/backups/.drill" 2>/dev/null || true)"
  live="$(plain_domain "$(env_get "$env_file" DRILL_OF)")"
  [ -n "$live" ] || live="$(plain_domain "${3:-}")"
  [ -n "$live" ] || live="$(plain_domain "$APP_DOMAIN")"
  if [ -z "$live" ] || [ "$live" = "$(plain_domain "$earlier")" ]; then
    # A drill copy made before v6.4.1 (no DRILL_OF), run again with a backup from
    # before v6.4 (no web address in it): the real address is asked, once (kept as
    # DRILL_OF), never guessed.
    live="$(plain_domain "$(answer live_domain 'Web address of the real ERP this drill copies (for example erp.extasbd.com): ')")"
    { [[ "$live" =~ ^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$ ]] && [ "$live" != "$(plain_domain "$earlier")" ]; } ||
      fail R30 "\"$live\" is not the real ERP's web address. Paste the command again and type the address of your real ERP (like erp.extasbd.com), never the drill's ($(plain_domain "$earlier"))."
  fi
  case "$live" in *.*.*) live_demo="demo.${live#*.}" ;; *) live_demo="demo.$live" ;; esac
  example="drill.${live#*.}"
  if [ -n "$earlier" ]; then
    test_domain="$(plain_domain "$earlier")"
    note "This server holds a drill copy for $test_domain: the drill runs again at that address."
  else
    test_domain="$(plain_domain "$(answer drill_domain "Test web address for this drill (for example $example): ")")"
  fi
  { [[ "$test_domain" =~ ^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$ ]] && [ "$test_domain" != "$live" ] &&
    [ "$test_domain" != "$live_demo" ] &&
    [ "$test_domain" != "$(plain_domain "$(env_get "$env_file" DEMO_DOMAIN)")" ]; } ||
    fail R30 "\"$test_domain\" cannot be the drill's web address. Type a new test address like $example, never the ERP's own ($live) or its demo site's."
  sed -i -e '/^APP_DOMAIN=/d' -e '/^DEMO_SITE=/d' -e '/^DRILL_OF=/d' "$env_file"
  printf 'APP_DOMAIN=%s\nDEMO_SITE=off\nDRILL_OF=%s\n' "$test_domain" "$live" >>"$env_file"
  APP_DOMAIN="$test_domain"
  mkdir -p "$data/backups"
  printf '{"address":"%s","startedAt":"%s"}\n' "$test_domain" "$(date -u -d "@$started" +%Y-%m-%dT%H:%M:%SZ)" \
    >"$data/backups/.drill"
  chmod 644 "$data/backups/.drill"
  note "Restore drill (test mode): this copy's web address is $APP_DOMAIN; $live is not touched."
}

# The drill's result into its mark $1 (for its Backups screen and the real ERP's
# "Record a drill"), from the comparison $2, the seconds $3, the backup's name $4,
# HTTPS (1: working) $5 and the screens that did not open $6; prints the outcome.
drill_result() {
  python3 - "$@" <<'PY' || echo "with problems"
import datetime, json, os, sys
path, compare, took, name, https, screens = sys.argv[1:7]
try:
    drill = json.load(open(path))
except (OSError, ValueError):
    drill = {}
try:
    r = json.load(open(compare))
except (OSError, ValueError):
    r = {}
worked = bool(r.get("ok")) and https == "1" and screens == "0"
drill.update({
    "finishedAt": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    "seconds": int(took),
    "backup": name,
    "records": r.get("records"),
    "files": r.get("files"),
    "problems": len(r.get("problems") or []) if r else None,
    "screenProblems": int(screens) if screens.isdigit() else None,
    "https": https == "1",
    "result": "worked" if worked else "problems",
})
with open(path + ".new", "w") as out:
    json.dump(drill, out)
os.chmod(path + ".new", 0o644)
os.replace(path + ".new", path)
print("it worked" if worked else "with problems (see the lines above)")
PY
}

# The restore tool ($1): the copy beside this script when it is the right one (from
# the Drive backup folder, when GitHub cannot be reached: G17), else from GitHub at
# the same commit. Either way it must match RESTORE_TOOL_SHA256.
get_restore_tool() {
  local here
  here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  if [ -f "$here/restore-tool.py" ] &&
    echo "$RESTORE_TOOL_SHA256  $here/restore-tool.py" | sha256sum -c --quiet - >/dev/null 2>&1; then
    cp "$here/restore-tool.py" "$1"
    note "Using the restore tool beside this script (restore-tool.py, from the Drive backup folder)."
    return 0
  fi
  curl -fsSL --retry 3 "$RAW_BASE/$REPO/$ref/deploy/restore-tool.py" -o "$1" 2>/dev/null ||
    fail R06 "the restore tool could not be downloaded from GitHub. Check that the VM has internet access, then paste the command again."
  echo "$RESTORE_TOOL_SHA256  $1" | sha256sum -c --quiet - >/dev/null 2>&1 ||
    fail R07 "the restore tool downloaded is not the expected one (its checksum differs). Copy the command from the newest guide and paste it again."
}

# --- Nothing opened stays on the disk (v6.4.2) ---------------------------------------

# The opened backup is plain data and secrets (the database, the settings file,
# server.json with the server's keys): it never stays on the disk, not even after a
# restore cut off half-way (the VM restarted or was turned off, or the restore was
# stopped). What such a restore left is deleted at every start of this command, when
# it ends, and when the server starts (the boot unit, install_boot_clean), even if the
# command is never run again. Only the download from Drive stays, and only while every
# file in it is still locked as in Drive (a backup of v6.3 or newer: its manifest's
# format 2 or 3), so the next try does not download it again. The Google sign-in
# (google.json) never stays: with it, the download could be opened when the recovery
# key is kept in Drive; the next try asks for a new code. The download goes too when
# the restore ends well.
still_locked() {
  python3 -I -c 'import json, sys
sys.exit(0 if int(json.load(open(sys.argv[1])).get("format") or 1) >= 2 else 1)' "$1/manifest.json" 2>/dev/null
}
forget_opened() {
  local copy
  if [ -f "$WORK/opened-copy" ]; then
    copy="$(cat "$WORK/opened-copy")"
    case "$copy" in */backups/restores/?*) rm -rf "$copy" ;; esac
    rm -f "$WORK/opened-copy"
  fi
  [ -d "$WORK" ] || return 0
  [ ! -d "$WORK/download" ] || still_locked "$WORK/download" || rm -rf "$WORK/download"
  # done/ only says which slow steps an earlier try finished (no data, no secret).
  find "$WORK" -mindepth 1 -maxdepth 1 ! -name download ! -name "done" -exec rm -rf {} +
}

# The boot unit's script and unit, into the folder $1: forget_opened when the server
# starts, before Docker (the ERP) starts; never while a restore runs.
write_boot_clean() {
  {
    printf '#!/usr/bin/env bash\n'
    printf '# Extas ERP: written by the restore command (deploy/bootstrap.sh). When the server\n'
    printf '# starts, deletes what a restore cut off half-way opened; the download from Drive\n'
    printf '# stays only while it is still locked.\n'
    printf 'set -euo pipefail\nWORK=%q\n' "$WORK"
    declare -f still_locked forget_opened
    printf 'exec 8>/run/extas-erp-restore.lock\nflock -n 8 || exit 0\nforget_opened\n'
  } >"$1/extras-erp-restore-clean"
  chmod 700 "$1/extras-erp-restore-clean"
  printf '%s\n' \
    "[Unit]" \
    "Description=Extas ERP restore: delete what a restore cut off half-way opened" \
    "After=local-fs.target" \
    "Before=docker.service" \
    "" \
    "[Service]" \
    "Type=oneshot" \
    "ExecStart=$CLEAN_SCRIPT" \
    "" \
    "[Install]" \
    "WantedBy=multi-user.target" >"$1/$CLEAN_UNIT"
}

# Installs the boot unit, before anything is downloaded or opened. It stays after the
# restore (it then finds nothing to delete), for a later restore on this server.
install_boot_clean() {
  local at
  at="$(mktemp -d)"
  write_boot_clean "$at"
  if install -m 700 "$at/extras-erp-restore-clean" "$CLEAN_SCRIPT" &&
    install -m 644 "$at/$CLEAN_UNIT" "/etc/systemd/system/$CLEAN_UNIT" &&
    systemctl daemon-reload && systemctl enable -q "$CLEAN_UNIT"; then
    note "If the VM stops during the restore, what was opened is deleted when it starts again."
  else
    note "Could not set up the clean-up at start: if the VM stops during the restore, paste the command again (it deletes what was opened first), or delete the VM."
  fi
  rm -rf "$at"
}

# --- The restore steps of this command's own version (v6.4.2) -----------------------

# restore.sh, setup-server.sh and their lib.sh as in this command's version, never the
# backup's, so a backup made by an older version still gets every fix of the restore.
# From the code already in $DIR when it has that version (a backup newer than the
# command), else from GitHub at that version: git checks every file against it, as the
# guide's command checks this script. They work on the ERP in $DIR (lib.sh's
# EXTRAS_DEPLOY_DIR); only a version that can (v6.4.2 or newer). Sets STEPS.
own_steps() {
  local at="$WORK/steps" repo="$DIR" want="${commit:-main}"
  rm -rf "$at" "$WORK/steps.git"
  if [ -z "$commit" ] || ! git -C "$DIR" cat-file -e "$commit^{commit}" 2>/dev/null; then
    repo="$WORK/steps.git"
    git init -q --bare "$repo" >/dev/null 2>&1 || return 1
    GIT_TERMINAL_PROMPT=0 git -C "$repo" fetch -q --depth 1 "$GIT_BASE/$REPO.git" "$want" >/dev/null 2>&1 ||
      return 1
    want=FETCH_HEAD
  fi
  mkdir -p "$at"
  git -c tar.umask=0022 -C "$repo" archive "$want" deploy/lib.sh deploy/restore.sh deploy/setup-server.sh deploy/self-update.sh 2>/dev/null |
    tar -x -C "$at" 2>/dev/null || return 1
  grep -q 'EXTRAS_DEPLOY_DIR' "$at/deploy/lib.sh" || return 1
  STEPS="$at/deploy"
}

# --- A restore over an ERP in use that does not finish (v6.4.2) ---------------------

# Over an ERP in use here (A6), its own code is replaced by the backup's for the
# restore. A restore that does not finish (the backup is not in) puts its own code back,
# the version it ran before, and installs it again when the backup's code was installed
# already, so it never stays on the backup's code with its own data.
own_head=""
code_moved=0
deployed=0
own_code_back() {
  { [ "${replacing:-0}" = 1 ] && [ -n "$own_head" ] && [ "$code_moved" = 1 ]; } || return 0
  [ "$(git -C "$DIR" rev-parse -q --verify HEAD 2>/dev/null)" != "$own_head" ] || return 0
  say "Putting back the code of the ERP that was in use here (version ${own_head:0:7})"
  if ! git -C "$DIR" checkout -q -B main "$own_head"; then
    note "Its code could not be put back. Run: cd $DIR && sudo git checkout -B main $own_head && sudo ./deploy/deploy.sh"
    return 0
  fi
  if [ "$deployed" = 1 ] && ! "$DIR/deploy/deploy.sh"; then
    note "Its own code is back, but it did not install again. Run: cd $DIR && sudo ./deploy/deploy.sh"
    return 0
  fi
  note "The ERP that was in use here runs on its own code again."
}

if [ "${1:-}" = --find ]; then
  detect_installs
  list_installs | LC_ALL=C sort
  exit 0
fi
# Tests only: gets and checks the restore tool into the folder $2; nothing else.
if [ "${1:-}" = --tool ]; then
  ref=main
  get_restore_tool "${2:?}/restore-tool.py"
  exit 0
fi

# Tests only: the drill's settings (drill_settings) on the settings file $2 with the
# data folder $3, and the drill's result (drill_result) into the mark $2.
if [ "${1:-}" = --drill-settings ]; then
  APP_DOMAIN="$(env_get "${2:?}" APP_DOMAIN)"
  drill_settings "$2" "${3:?}" "${4:-}"
  echo "DRILL $APP_DOMAIN"
  exit 0
fi
if [ "${1:-}" = --drill-result ]; then
  shift
  drill_result "$@"
  exit 0
fi
# Tests only: the standby mark as the restore writes it (mark_standby) on the data
# folder $2 ($3: 1 over an ERP already here), and what a restore that failed does
# with it ($3: 1 when the backup's data was in); nothing else.
if [ "${1:-}" = --standby-mark ]; then
  mark_standby "${2:?}" "${3:?}"
  exit 0
fi
if [ "${1:-}" = --standby-failed ]; then
  DATA="${2:?}"
  APP_DOMAIN=localhost
  standby_after_failure "${3:?}" && echo "IN USE AGAIN" || echo "STANDBY KEPT"
  exit 0
fi
# Tests only: waits for apt as the restore does; nothing else.
if [ "${1:-}" = --wait-apt ]; then
  wait_for_apt && echo "APT FREE" || echo "APT STILL BUSY"
  exit 0
fi

# Drills and tests only: the A6 decision alone; nothing is changed.
if [ "${1:-}" = --choose ]; then
  drill=""
  [ "${2:-}" != --drill ] || drill=1
  detect_installs
  choose_install
  echo "CHOSEN $DIR|$DATA"
  exit 0
fi
# Tests only: what every start does with the work folder $2 (forget_opened); the boot
# unit's files for the work folder $3, written into $2; the restore steps of the
# version $4 for the program folder $2 (work folder $3); and a restore over the ERP in
# the program folder $2 that did not finish, back to its version $3 ($4: 1 when the
# backup's code was installed).
# --keys: the Google client and the recovery key come with the command (the guide in
# Google Drive prints them inside it, sealed as one block), so nothing is typed. They
# are read from the command's input, never from its words (no process list or shell
# history shows them), and kept only in memory (/run) for this run, readable by root
# only; they are deleted when the command ends. read_keys FILE: the block on the
# input, opened into FILE as the restore tool's answers (RESTORE_ANSWERS).
KEYS_FILE=""
forget_keys() { [ -z "$KEYS_FILE" ] || rm -f "$KEYS_FILE"; }
read_keys() {
  [ ! -t 0 ] || fail R32 "the keys are missing after --keys. Copy the whole command from the newest guide in Google Drive again: it ends with the keys."
  # The block ends with end=ok: a block cut short anywhere is never taken for a whole one.
  if ! (umask 077 && tr -d '[:space:]' | head -c 20000 | base64 -d >"$1" 2>/dev/null) ||
    [ "$(tail -n 1 "$1")" != end=ok ] || ! sed -i '$d' "$1" || [ ! -s "$1" ] ||
    grep -qvE '^(google_client_id|google_client_secret|recovery_key|pick)=' "$1"; then
    rm -f "$1"
    fail R32 "the keys at the end of the command are damaged (part of them was not copied). Copy the whole command from the newest guide in Google Drive again."
  fi
}
# Tests only: read_keys into the folder $2 (as the command's --keys does into /run).
if [ "${1:-}" = --read-keys ]; then
  read_keys "${2:?}/answers"
  echo "KEYS ${2}/answers"
  exit 0
fi
if [ "${1:-}" = --forget-opened ]; then
  WORK="${2:?}"
  forget_opened
  exit 0
fi
if [ "${1:-}" = --boot-clean-files ]; then
  WORK="${3:?}"
  write_boot_clean "${2:?}"
  exit 0
fi
if [ "${1:-}" = --own-steps ]; then
  DIR="${2:?}"
  WORK="${3:?}"
  commit="${4:-}"
  if own_steps; then echo "STEPS $STEPS"; else echo "NO STEPS"; fi
  exit 0
fi
if [ "${1:-}" = --own-code-back ]; then
  DIR="${2:?}"
  replacing=1
  own_head="${3:?}"
  code_moved=1
  deployed="${4:?}"
  own_code_back
  exit 0
fi

# --- Checks before anything changes ------------------------------------------------

[ "$(id -u)" -eq 0 ] ||
  fail R01 "run it with sudo: paste the whole command from the guide, which has sudo in it."
commit="${1:-}"
[ -z "$commit" ] || [[ "$commit" =~ ^[0-9a-f]{40}$ ]] ||
  fail R24 "\"$commit\" after restore.sh is not a version (40 letters and digits). Copy the whole command from the guide again."
ref="${commit:-main}"
drill=""
keys=""
new_domain=""
if [ $# -gt 0 ]; then shift; fi
while [ $# -gt 0 ]; do
  case "$1" in
    --drill) drill=1 ;;
    --keys) keys=1 ;;
    --domain)
      new_domain="$(plain_domain "${2:-}")"
      [[ "$new_domain" =~ ^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$ ]] ||
        fail R32 "\"${2:-}\" after --domain is not a web address like erp.yourcompany.com. Type the new address after --domain, then paste the command again."
      if [ $# -gt 1 ]; then shift; fi
      ;;
    *) fail R24 "\"$1\" after the version is not --drill, --keys or --domain. Copy the whole command from the guide again." ;;
  esac
  shift
done
[ -z "$drill" ] || [ -z "$new_domain" ] ||
  fail R32 "a drill always asks for its own test address: leave --domain out of the drill command."

# The keys that came with the command (read_keys), for this run only.
if [ -n "$keys" ]; then
  [ -z "${RESTORE_ANSWERS:-}" ] || fail R32 "--keys cannot be used with an answers file."
  KEYS_FILE="/run/extras-erp-restore-answers.$$"
  trap forget_keys EXIT
  read_keys "$KEYS_FILE"
  export RESTORE_ANSWERS="$KEYS_FILE"
fi

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

# What a restore cut off half-way left is deleted now, first (forget_opened).
restored=0
standby=0
cleanup() {
  local code=$?
  # Stopped after the standby mark was written (an error, or a step that failed): an
  # ERP that was in use here is not left on standby.
  if [ "$code" != 0 ] && [ "$standby" = 1 ] && standby_after_failure "$restored"; then
    note "The ERP that was in use on this server is not on standby: it runs as before this restore."
  fi
  # Nor on the backup's code: its own goes back (the backup is not in).
  if [ "$code" != 0 ] && [ "$restored" = 0 ] && [ "${replacing:-0}" = 1 ] && [ "$code_moved" = 1 ]; then
    own_code_back
    note "The restore did NOT finish: the error is above."
  fi
  forget_opened
  forget_keys
  if [ "$restored" = 1 ]; then
    rm -rf "$WORK"
  elif [ -d "$WORK/download" ]; then
    note "The backup downloaded from Drive (still locked) is kept for the next try in $WORK (only root can read it). Nothing opened and no Google sign-in stays on the disk: the next try asks for a new Google code, then goes on from the step that stopped."
  fi
}
forget_opened

step "Checking this server"
# What this server has, beside what the ERP needs; the restore goes on by itself when
# it is enough. Building the ERP needs the memory most (B2ms: 2 CPUs, 8 GB).
memory_kb="$(awk '/^MemTotal:/ {print $2}' /proc/meminfo)"
free_kb="$(df --output=avail -k / | tail -n 1 | tr -d ' ')"
cpus="$(nproc 2>/dev/null || echo 1)"
gb() { awk -v kb="${1:-0}" 'BEGIN { printf "%.1f", kb / 1024 / 1024 }'; }
note "This server:   $cpus CPU(s), $(gb "$memory_kb") GB memory, $(gb "$free_kb") GB free disk, Ubuntu ${VERSION_ID}"
note "The ERP needs: 2 CPUs, 8 GB memory (Azure size B2ms), ${MIN_FREE_GB} GB free disk, Ubuntu 22.04 or newer"
[ "${memory_kb:-0}" -ge 7000000 ] ||
  fail R03 "this server has $(gb "$memory_kb") GB of memory; the ERP needs 8 GB. In Azure, change the VM's size to B2ms (Size, then Resize), then paste the command again."
[ "${free_kb:-0}" -ge $((MIN_FREE_GB * 1024 * 1024)) ] ||
  fail R03 "this server has $(gb "$free_kb") GB free on its disk; the ERP needs at least 20 GB. Make the VM again with a 64 GB disk (step A10 in the guide)."
[ "$cpus" -ge 2 ] ||
  warn W15 "this server has 1 CPU: the restore works, but slowly. B2ms (2 CPUs) is the size to use."
note "Enough: the restore goes on by itself."
[ -z "$KEYS_FILE" ] || note "The Google client and the recovery key come from the command: nothing to type, nothing kept on the disk."
[ -z "$new_domain" ] || note "New web address for this ERP: $new_domain"

step "Looking for an Extas ERP already on this server"
detect_installs
choose_install

step "Installing the restore tools"
export DEBIAN_FRONTEND=noninteractive
apt_get() { apt-get -o DPkg::Lock::Timeout=900 -q "$@"; }
wait_for_apt ||
  fail R05 "the restore tools could not be installed: the server's own updates did not finish in 30 minutes. Restart the VM in Azure, then paste the command again."
# An install cut off earlier (the VM restarted) is finished first, or nothing installs;
# only once the server's own updates are done, so the two never run at once.
dpkg --configure -a >/dev/null 2>&1 || true
if ! { apt_get update >/dev/null && apt_get install -y --no-install-recommends \
  ca-certificates curl git python3 python3-cryptography >/dev/null; }; then
  fail R05 "the restore tools could not be installed. Wait 5 minutes (a new server installs its own updates first), then paste the command again."
fi
install -d -m 700 "$WORK"
chmod 700 "$WORK"
install_boot_clean
trap cleanup EXIT
get_restore_tool "$WORK/restore-tool.py"
tool() { python3 -I "$WORK/restore-tool.py" "$@"; }
note "Done."

step "Signing in to Google and downloading the backup"
tool fetch --work "$WORK" || exit 3
name="$(tool fact --work "$WORK" name)"
backup_commit="$(tool fact --work "$WORK" commit)"
cp "$WORK/restore/manifest.json" "$WORK/manifest.json"

step "Putting the ERP's code in place"
# Over an ERP in use: its own version, put back if the restore does not finish.
[ "${replacing:-0}" != 1 ] || own_head="$(git -C "$DIR" rev-parse -q --verify HEAD 2>/dev/null || true)"
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
  code_moved=1
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
  code_moved=1
  git -C "$DIR" checkout -q -B main FETCH_HEAD || fail R15 "the code could not be put in place."
fi
git -C "$DIR" remote set-url origin "https://github.com/$REPO.git" 2>/dev/null ||
  git -C "$DIR" remote add origin "https://github.com/$REPO.git"
note "Code: $(git -C "$DIR" log -1 --format='%h, %cd' --date=format:'%d %B %Y')"
# The restore steps: this command's own version (own_steps), else the backup's.
if own_steps; then
  note "Restore steps: this command's own version."
else
  STEPS="$DIR/deploy"
  warn W14 "the restore steps of this command's version could not be downloaded from GitHub, so the backup's own are used: a backup made by an older version may miss later fixes of the restore."
fi

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
if [ -z "$drill" ] && [ -f "$DATA/backups/.drill" ]; then
  # A drill copy stays one: it never takes the real web address (make a new VM for
  # a real restore).
  drill=1
  note "This server holds a restore drill copy, so this run is a drill too (test mode)."
fi
[ -z "$drill" ] || drill_settings "$env_file" "$DATA" "$(tool fact --work "$WORK" appDomain)"
# A new web address (--domain): the ERP comes up there instead of the backup's (its
# demo site at demo.<the new domain>). Its DNS must point to this server.
if [ -n "$new_domain" ] && [ "$new_domain" != "$APP_DOMAIN" ]; then
  sed -i -e '/^APP_DOMAIN=/d' -e '/^DEMO_DOMAIN=/d' "$env_file"
  printf 'APP_DOMAIN=%s\n' "$new_domain" >>"$env_file"
  note "The backup's web address was $APP_DOMAIN; this ERP's is $new_domain."
  APP_DOMAIN="$new_domain"
fi
note "Web address: $APP_DOMAIN; data folder: $DATA"
# A new server: marked until the backup is in, so the command run again here goes on.
if [ "${replacing:-0}" = 0 ]; then
  mkdir -p "$DATA/backups"
  : >"$DATA/backups/$UNFINISHED"
fi

# The slow steps an earlier try on this new server finished (WORK/done) are not done
# again: the command pasted again goes on from where it stopped. Never over an ERP in
# use (A6), which always gets every step.
done_dir="$WORK/done"
mkdir -p "$done_dir"
[ "${replacing:-0}" = 0 ] || rm -rf "${done_dir:?}"/*
code_now="$(git -C "$DIR" rev-parse -q --verify HEAD 2>/dev/null || true)"
erp_up() {
  (
    cd "$DIR"
    # shellcheck source=/dev/null
    source deploy/lib.sh
    load_settings
    [ -n "$(compose ps --status running -q app 2>/dev/null)" ]
  ) >/dev/null 2>&1
}

step "Preparing the server (system updates, Docker, firewall: about 5 minutes)"
if [ -f "$done_dir/prepared" ] && systemctl is-active -q docker 2>/dev/null; then
  note "Done in the earlier try: not done again."
else
  EXTAS_RESTORE=1 EXTRAS_DEPLOY_DIR="$DIR/deploy" "$STEPS/setup-server.sh" || fail R17 "the server could not be prepared; the lines above say why. Paste the command again."
  : >"$done_dir/prepared"
fi

step "Installing the ERP (building it takes about 10 to 20 minutes)"
deployed=1
if [ -n "$code_now" ] && [ "$(cat "$done_dir/installed" 2>/dev/null)" = "$code_now" ] && erp_up; then
  note "Installed in the earlier try (version ${code_now:0:7}): not built again."
else
  rm -f "$done_dir/installed"
  "$DIR/deploy/deploy.sh" || fail R18 "the ERP could not be installed; the lines above say why. If they end with \"npm run build\" that did not complete, the server ran out of memory: in Azure change the VM's size to B4ms (16 GB) for the restore and back to B2ms after it. Then paste the command again: it goes on from where it stopped."
  [ -z "$code_now" ] || printf '%s' "$code_now" >"$done_dir/installed"
fi

step "Restoring the database and the files"
mkdir -p "$DATA/backups/restores"
# The restored ERP waits on standby (G2) until its web address points here
# (mark_standby). On standby its backups and alarms run; its reminders and messages
# wait, so two ERPs never send them at once (a practice run, or the old server
# still in use).
mark_standby "$DATA" "${replacing:-0}"
standby=1
restore_dir="$DATA/backups/restores/$name"
rm -rf "$restore_dir"
# Written first, so a restore cut off from here on has its opened copy deleted at the next start.
printf '%s' "$restore_dir" >"$WORK/opened-copy"
mv "$WORK/restore" "$restore_dir"
counts=()
grep -q -- '--counts' "$STEPS/restore.sh" && counts=(--counts "$WORK/counts.json")
if ! EXTRAS_DEPLOY_DIR="$DIR/deploy" "$STEPS/restore.sh" --yes --check --result "$WORK/restore-result.json" \
  "${counts[@]}" "$restore_dir"; then
  # What restore.sh did: put back as it was (its safety copy), or left as it was.
  why="$(python3 -c 'import json, sys; print(json.load(open(sys.argv[1])).get("message") or "")' "$WORK/restore-result.json" 2>/dev/null || true)"
  if standby_after_failure 0; then
    left="The ERP that was in use here runs as before (not on standby); its web address was not changed."
  else
    left="The web address was not changed."
  fi
  fail R19 "the backup could not be restored: ${why:-the lines above say why}. $left To try again, paste the command again: it goes on with the backup already downloaded."
fi
rm -rf "$restore_dir"
rm -f "$WORK/opened-copy"
# The backup is in: what is left in $WORK is deleted when the restore ends, the download too.
restored=1

# The screens that did not open in restore.sh's check, and every table and file
# compared with the backup: both before the web address question, which never comes
# when either found a problem.
screen_problems="$(python3 -c 'import json, sys; print(len(json.load(open(sys.argv[1])).get("checks", [])))' "$WORK/restore-result.json" 2>/dev/null || echo "?")"
# Said here, before W13 (which points to it), with the check's lines just above.
if [ "$screen_problems" != 0 ]; then
  warn W05 "the check after the restore found $screen_problems problem(s) (listed above: a screen or PDF that did not open, or the screens not checked at all). The ERP runs; tell the developer."
fi

step "Comparing every table and file with the backup"
compare=0
tool compare --work "$WORK" --manifest "$WORK/manifest.json" --counts "$WORK/counts.json" \
  --uploads "$DATA/uploads" --result "$WORK/compare.json" || compare=$?

step "Pointing the web address at this server"
# Only now that the restore went well, and every screen opened and everything came
# back: the web address never comes to a server that could not restore the backup.
if [ "$compare" = 0 ] && [ "$screen_problems" = 0 ]; then
  tool dns --work "$WORK" --deploy "$DIR/deploy" --drill "$drill" ||
    warn W02 "the web address was not changed (the lines above say why). Point it to this server's Public IP address yourself (see W01)."
else
  warn W13 "the web address was not moved to this server, because the checks found problems (above): read them first. When this ERP is right, point the web address here yourself (step F6)."
fi
moved="$(tool fact --work "$WORK" dnsMoved)"
# Restored over the ERP in use, or pointed here by hand already: the web address
# reaches this server, so this ERP is the one in use and never waits on standby.
if [ -z "$moved" ] && address_here; then
  note "$APP_DOMAIN already points to this server."
  moved=yes
fi
# Decided: whether this ERP was in use before no longer matters.
rm -f "$DATA/backups/.standby.was-in-use"
if [ -n "$moved" ]; then
  rm -f "$DATA/backups/.standby"
  standby=0
  # Live here now (it may be in use from now on): a run again asks first (A6).
  rm -f "$DATA/backups/$UNFINISHED"
  # HTTPS: Caddy asks for the certificate again at once, now that the address points here.
  (
    cd "$DIR"
    # shellcheck source=/dev/null
    source deploy/lib.sh
    load_settings
    compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile --force
  ) >/dev/null 2>&1 || true
fi

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
if [ -x "$DIR/deploy/bug-guard.sh" ]; then
  # Every company, only reading; its report goes to the inbox and Telegram (G1).
  bug_guard=0
  "$DIR/deploy/bug-guard.sh" --after-restore || bug_guard=$?
  case "$bug_guard" in
    0) checks_note="Bug Guard ran (nothing urgent or important)" ;;
    1)
      checks_note="Bug Guard ran (it found problems)"
      warn W05 "Bug Guard found problems after the restore; they are in the ERP's inbox and on Telegram."
      ;;
    *)
      checks_note="Bug Guard ran (not everything was checked)"
      warn W05 "Bug Guard could not check everything after the restore; it checks again on its own schedule."
      ;;
  esac
else
  note "Bug Guard is not part of this version; the full check (every screen and PDF opened as the owner) ran above."
  checks_note="full check"
fi

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
[ "$https_ok" = 1 ] || [ "$standby" = 1 ] || warn W03 "https://$APP_DOMAIN has no HTTPS certificate yet. Check that $APP_DOMAIN points to this server (${ip:-its Public IP address}) and that ports 80 and 443 are open in Azure; the certificate then comes by itself within a few minutes."

took=$(($(date +%s) - started))
# Never a plain "Finished" when a step went wrong.
if [ "$compare" = 0 ] && [ "$screen_problems" = 0 ]; then
  say "Finished in $((took / 60)) min $((took % 60)) s"
else
  say "Finished in $((took / 60)) min $((took % 60)) s, but NOT everything is right: read the notes above and below"
fi
note "Backup: $name"
python3 - "$WORK/compare.json" <<'PY' || true
import json, sys
try:
    r = json.load(open(sys.argv[1]))
except (OSError, ValueError):
    print("    The records and files were NOT compared with the backup (the comparison did not finish).")
    sys.exit(0)
if r.get("ok") and r["compared"]["records"] and r["compared"]["files"]:
    print(f"    All {r['records']:,} records and {r['files']:,} files are back.")
elif r.get("recordsNotChecked"):
    print(f"    The records were NOT checked against the backup (W11 above); {len(r['problems'])} other problem(s).")
elif r.get("ok"):
    print("    The backup is back (it had no list of its tables and files to compare with).")
else:
    print(f"    Not everything is back: {len(r['problems'])} problem(s), listed above (R20).")
PY
if [ -n "$drill" ]; then
  drill_word="$(drill_result "$DATA/backups/.drill" "$WORK/compare.json" "$took" "$name" "$https_ok" "$screen_problems")"
  say "Restore drill finished in $((took / 60)) min $((took % 60)) s: $drill_word"
  note "This copy runs in test mode at https://$APP_DOMAIN: it sends no emails or bot messages,"
  note "makes no Google Drive backups and runs no scheduled jobs."
  note "On your real ERP: Settings > Backups > Record a drill, and type $APP_DOMAIN."
  note "Then delete this drill server's resource group in Azure, and the drill's line in Cloudflare."
elif [ "$standby" = 1 ]; then
  warn W10 "this ERP waits on standby: $APP_DOMAIN does not point to this server yet. Its backups and alarms run; its reminders and messages wait until it goes live. When this server is the one to use (the old one is off), point the web address here (step F6) and run: cd $DIR && sudo ./deploy/go-live.sh"
elif [ "$https_ok" = 1 ]; then
  note "The ERP is running at https://$APP_DOMAIN : sign in as before."
else
  note "The ERP is running; https://$APP_DOMAIN opens once its address points here (W03)."
fi
if [ "$demo_note" = running ]; then note "The demo site is running too."; fi
note "Checks: $checks_note; ${screen_problems} problem(s) found."
note "The full log of this restore: sudo less $LOG"
# New versions go to the ERP in use only (self-update.sh): on standby, after go-live.sh (F6).
if [ -z "$drill" ] && [ "$standby" = 1 ]; then
  note "New versions from GitHub install by themselves once this ERP is live (go-live.sh, step F6)."
elif [ -z "$drill" ]; then
  note "New versions from GitHub install by themselves (step F5): nothing to set up."
fi
if [ -z "$drill" ] && [ "$standby" = 1 ]; then
  # Never on standby without a word: the last thing on the screen.
  printf '\n%s\n' "################################################################"
  printf '##  %s\n' "THIS ERP IS ON STANDBY" "" \
    "$APP_DOMAIN does NOT point to this server yet." \
    "Its backups and alarms run; its reminders and messages wait." \
    "Every page of the ERP says so until it goes live." "" \
    "When this server is the one to use (the old one is off):" \
    "  1. point $APP_DOMAIN to this server (step F6)" \
    "  2. run: cd $DIR && sudo ./deploy/go-live.sh"
  printf '%s\n' "################################################################"
fi
# Every step done: a run again on this server asks first (A6).
rm -f "$DATA/backups/$UNFINISHED"
[ "$compare" = 0 ] || exit 4
