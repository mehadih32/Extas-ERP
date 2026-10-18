#!/usr/bin/env bash
# Puts Extas ERP back to a backup: the database, and the uploaded files when the
# backup has them. It first saves a safety copy of the database as it is now, so
# a restore can be undone by restoring that copy. When the ERP does not start on
# the restored database, it goes back to that safety copy by itself.
#   sudo ./deploy/restore.sh /srv/extras-erp/backups/2026-10-04_020000
# The folder must be inside DATA_DIR/backups or DATA_DIR/safety-copies and hold
# database.dump (media.tar.gz and manifest.json are used when present). Backups in
# Google Drive are locked: restore them from the Backups screen, or on a new server
# with deploy/bootstrap.sh, which open them first.
#   --yes          skip the question (for scripts)
#   --check        open every screen afterwards, as after an update (the full check)
#   --result FILE  write how it went, as JSON (restore-request.sh, bootstrap.sh)
#   --status FILE  write each step as it starts, as JSON (the Backups screen shows it)
#   --counts FILE  write every table's row count just after the restore, as JSON
#                  (bootstrap.sh compares them with the backup's manifest)
#   --keep-backup-settings
#                  keep this server's own backup settings (the recovery key, the
#                  schedule, Google Drive), not the backup's (restore-request.sh)
#   --after-restart
#                  only settle a restore cut off half-way (the server restarted, or it
#                  was stopped): start the ERP as it is and tell the owner how to undo
#                  it, never putting anything back by itself (lib.sh settle_cut_restore);
#                  delete opened backups left from before the server started; end a
#                  standby the restore command left over the ERP in use once its web
#                  address points here. systemd runs it when the server starts (lib.sh
#                  install_backup_helpers). Every restore and update settles first too.
# A dropped PuTTY connection does not stop a restore: it goes on, and what it says
# goes on into the log too (/var/log/extas-erp-restore.log). Ctrl+C, or a stop at
# shutdown, ends it as NOT done.
# shellcheck source=deploy/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
trap '' HUP

confirmed=0
check=0
result_file=""
status_file=""
counts_file=""
keep_settings=0
after_restart=0
folder_arg=""
while [ $# -gt 0 ]; do
  case "$1" in
    --yes) confirmed=1 ;;
    --check) check=1 ;;
    --result)
      result_file="${2:-}"
      shift
      ;;
    --status)
      status_file="${2:-}"
      shift
      ;;
    --counts)
      counts_file="${2:-}"
      shift
      ;;
    --keep-backup-settings) keep_settings=1 ;;
    --after-restart) after_restart=1 ;;
    -*) die "unknown option $1" ;;
    *) folder_arg="$1" ;;
  esac
  shift
done

# How it went, for the Backups screen: written when the script ends, however it ends.
started_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
outcome=""
safety=""
went_back=0
problems=""
# 1 once the restore got to its end (the last line); with exit code 0 and no running
# mark left, only then is it written as done.
finished=0
running_mark=""
step() {
  say "$1"
  [ -n "$status_file" ] || return 0
  STEP="$1" python3 -c 'import json, os, sys; json.dump({"step": os.environ["STEP"]}, open(sys.argv[1], "w"))' \
    "$status_file" 2>/dev/null || true
}
write_result() {
  local code=$? ok=0
  [ -n "$result_file" ] || return 0
  if [ "$code" = 0 ] && [ "$finished" = 1 ] && { [ -z "$running_mark" ] || [ ! -f "$running_mark" ]; }; then
    ok=1
  fi
  OK="$ok" MESSAGE="${outcome:-the restore stopped (exit code $code)}" \
    NAME="$(basename "${folder_arg:-}")" STARTED="$started_at" SAFETY="$safety" WENT_BACK="$went_back" \
    PROBLEMS="$problems" python3 - "$result_file" <<'PY' || true
import json, os, sys, datetime
json.dump({
    "ok": os.environ["OK"] == "1",
    "name": os.environ["NAME"],
    "startedAt": os.environ["STARTED"],
    "finishedAt": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    "safetyCopy": os.environ["SAFETY"],
    "wentBack": os.environ["WENT_BACK"] == "1",
    "message": os.environ["MESSAGE"],
    "checks": [line for line in os.environ["PROBLEMS"].split("\n") if line],
}, open(sys.argv[1], "w"), indent=2)
PY
  chown "$APP_UID:$APP_UID" "$result_file" 2>/dev/null || true
  [ -z "$status_file" ] || rm -f "$status_file"
}
trap write_result EXIT
# The reason, for the result file, then the usual error.
fail() {
  outcome="$1"
  die "$1"
}
# Ctrl+C, or a stop (systemd at shutdown): never written as done (I1). A restore
# still going on inside the database container is ended there first. When the
# database is surely as it was (not touched yet, or that restore was rolled back),
# the ERP is started again on it, unless the server is shutting down. Otherwise
# nothing is put back here: the next start of the server, the next restore or update
# settles it (lib.sh settle_cut_restore).
restored=0
# 1 once this restore wrote its own mark (a mark there before is an earlier restore's,
# settled by settle_cut_restore); 1 from the first restore_database on the live
# database; the database's id once the safety copy is saved (lib.sh database_id).
own_mark=0
db_touched=0
db_id=""
# Said when the ERP did not start again after a restore that changed nothing.
down_note=""
shutting_down() {
  [ "$(systemctl is-system-running 2>/dev/null || true)" = stopping ]
}
# What the ERP does after such a stop, for its message: stopped while it was being
# started (on the restored data, or on the safety copy), it may be running now.
erp_after_stop() {
  if [ "$db_touched" = 1 ] && app_running; then
    echo "the ERP may be running on it now (it was being started); the server settles it when it starts again, or run: sudo $DEPLOY_DIR/restore.sh --after-restart"
  else
    echo "the ERP stays stopped until the server starts again or until you run: sudo $DEPLOY_DIR/restore.sh --after-restart"
  fi
}
on_stop() {
  trap '' INT TERM
  local ended=1 unsure="" erp
  if [ "$own_mark" = 0 ] && [ -n "$running_mark" ] && [ -f "$running_mark" ]; then
    fail "the restore was stopped ($1) while the restore cut off earlier was being settled. This restore changed nothing. That earlier one is settled when the server starts again, or run: sudo $DEPLOY_DIR/restore.sh --after-restart"
  fi
  if [ "$own_mark" = 1 ] && [ -f "$running_mark" ]; then
    [ "$db_touched" = 0 ] || stop_restore_in_db || ended=0
    if [ "$went_back" = 1 ]; then
      erp="$(erp_after_stop)"
      fail "the restore was stopped ($1) while going back to the safety copy, after its database was back as it was before the restore. ${erp^} (it then starts the ERP)."
    fi
    if [ "$ended" = 1 ] && ! shutting_down &&
      { [ "$db_touched" = 0 ] || { [ -n "$db_id" ] && [ "$(database_id)" = "$db_id" ]; }; }; then
      # Nothing changed: no saved settings and no half safety copy stay; the ERP runs again.
      [ -z "${kept_file:-}" ] || rm -f "$kept_file"
      [ -n "$safety" ] || rm -rf "$DATA_DIR/safety-copies/before-restore-${stamp:-}"
      start_again
      [ -n "$down_note" ] ||
        fail "the restore was stopped before it changed anything ($1); the ERP's data were not changed, and it was started again."
      fail "the restore was stopped before it changed anything ($1); the ERP's data were not changed.$down_note"
    fi
    erp="$(erp_after_stop)"
    [ "$ended" = 1 ] ||
      unsure=" The backup may still be going in for a few minutes: wait 10 minutes before you run that."
    fail "the restore was stopped before it finished ($1). Nothing was put back automatically, and $erp (it then starts the ERP and says how to undo the restore).$unsure"
  elif [ "$restored" = 1 ]; then
    fail "the restore was stopped ($1) after the backup was back and the ERP was running, before its check finished: the screens were NOT all checked. To undo it, restore the safety copy: sudo $DEPLOY_DIR/restore.sh $safety"
  fi
  fail "the restore was stopped before it finished ($1); the ERP's data was not changed."
}
trap 'on_stop "Ctrl+C"' INT
trap 'on_stop "it was told to stop"' TERM

need_root
load_settings
# Run in a terminal (PuTTY): also into the log, so a dropped connection loses nothing.
# Only root reads the log, as bootstrap.sh's.
if [ -t 1 ] || [ -t 2 ]; then
  { (umask 077 && touch "$RESTORE_LOG") && chmod 600 "$RESTORE_LOG"; } || true
  exec > >(
    trap '' INT TERM
    exec tee --output-error=warn -a "$RESTORE_LOG"
  ) 2>&1
fi

# While a restore runs, from stopping the app until it runs again (on the restored
# data, or on the data from before): what it did so far (lib.sh write_restore_mark).
# Left behind only when the restore was cut off half-way (the server restarted, or it
# was stopped), or when the ERP did not start again: the app then stays stopped until
# the next start of the server (systemd, --after-restart), the next restore or the
# next update settles it (lib.sh settle_cut_restore).
running_mark="$DATA_DIR/backups/.restore-running"
if [ "$after_restart" = 1 ]; then
  # At the server's start: an update or restore running now settles it itself; it is
  # waited for (up to an hour), never skipped.
  wait_update_lock 3600 ||
    die "another update or restore was still running after an hour; it settles the restore that was cut off itself."
  CUT_RESTORE=0
  settle_cut_restore || app_down=1
  # Opened backups (plain data) left by a restore cut off before the server started.
  boot="$(awk '/^btime/ {print $2}' /proc/stat)"
  if [ -n "$boot" ] && [ -d "$DATA_DIR/backups/restores" ]; then
    find "$DATA_DIR/backups/restores" -mindepth 1 -maxdepth 1 ! -newermt "@$boot" \
      -exec rm -rf {} + 2>/dev/null || true
  fi
  # The restore command (bootstrap.sh) put the ERP in use here on standby and was cut
  # off before it finished, with no restore cut off half-way: in use again once its web
  # address points here, as the command does itself (standby_after_failure).
  backups="$DATA_DIR/backups"
  if [ "$CUT_RESTORE" = 0 ] && [ -f "$backups/.standby.was-in-use" ] && [ ! -f "$backups/.drill" ] &&
    [ -n "$APP_DOMAIN" ] && [ "$APP_DOMAIN" != localhost ] &&
    web_address_here "$APP_DOMAIN" "$backups/.standby" >/dev/null 2>&1; then
    rm -f "$backups/.standby" "$backups/.standby.was-in-use"
    say "The ERP that was in use here is not on standby: its web address points to this server"
  fi
  exit "${app_down:-0}"
fi
take_update_lock
settle_cut_restore || say "Note: the ERP did not start after the restore that was cut off; this restore goes on"

prune_old_uploads
forget_secrets_in_history || true
[ -n "$folder_arg" ] || fail "say which backup to restore, for example: sudo $0 $DATA_DIR/backups/2026-10-04_020000"
folder="$(realpath -e "$folder_arg" 2>/dev/null)" || fail "$folder_arg does not exist."
data="$(realpath -e "$DATA_DIR")"
case "$folder/" in
  "$data/backups/"?*) inside="/backups/${folder#"$data/backups/"}" ;;
  "$data/safety-copies/"?*) inside="/safety-copies/${folder#"$data/safety-copies/"}" ;;
  *) fail "the backup must be a folder inside $DATA_DIR/backups or $DATA_DIR/safety-copies." ;;
esac
[ -f "$folder/database.dump" ] || fail "$folder has no database.dump."
media=""
[ -f "$folder/media.tar.gz" ] && media="$folder/media.tar.gz"

if [ -f "$folder/manifest.json" ]; then
  step "Checking the backup files against their checksums"
  python3 - "$folder" <<'PY' || fail "the backup is damaged; nothing was changed."
import hashlib, json, os, sys

folder = sys.argv[1]
with open(os.path.join(folder, "manifest.json")) as f:
    manifest = json.load(f)
for entry in manifest.get("files", []):
    digest = hashlib.sha256()
    with open(os.path.join(folder, entry["name"]), "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            digest.update(chunk)
    if digest.hexdigest() != entry["sha256"]:
        sys.exit(f"  {entry['name']} does not match its checksum.")
    print(f"  {entry['name']}: OK")
PY
fi

echo
echo "This replaces ALL of the ERP's current data with the backup in:"
echo "  $folder"
[ -n "$media" ] && echo "including the uploaded files."
if [ "$confirmed" != 1 ]; then
  flush_keys
  read -rp "Type RESTORE to go ahead: " answer
  [ "$answer" = RESTORE ] || fail "nothing was changed."
fi

stamp="$(date +%Y-%m-%d_%H%M%S)"
prepare_folders

step "Starting the database"
compose up -d db
wait_healthy db || fail "the database did not start; see sudo ./deploy/logs.sh db"

# The app stops before the safety copy, so nothing saved in the ERP after the copy
# is lost when the restore goes back to it or is undone. The site is down from here
# until the restored ERP starts (or the one from before, when anything fails).
step "Stopping the app"
write_restore_mark "$stamp" "" "$(basename "$folder")"
own_mark=1
compose stop app

# The restore is over (the ERP runs): its mark goes, and its safety copy is kept the
# usual 24 hours.
clear_running_mark() {
  rm -f "$running_mark" "$DATA_DIR/safety-copies/before-restore-$stamp.keep"
}

# Starts the app again on the database as it was (nothing replaced yet), whatever the
# reason it stops here; never aborts before the reason is said. When the ERP does not
# start, the mark stays, so the next start of the server tries again (down_note).
start_again() {
  compose up -d || true
  if wait_healthy app; then
    clear_running_mark
  else
    down_note=" But the ERP did NOT start again: see why with: sudo $DEPLOY_DIR/logs.sh app. The server tries again when it starts, or run: sudo $DEPLOY_DIR/restore.sh --after-restart."
    say "${down_note# }"
  fi
}

step "Saving a safety copy of the database as it is now"
if ! safety="$(safety_copy "before-restore-$stamp")"; then
  start_again
  fail "the safety copy of the database could not be saved (is the disk full? sudo df -h), so nothing was restored.$down_note"
fi
# Kept from the hourly clean-up while the restore may still need it (lib.sh
# prune_safety_copies); the database's id says later whether anything went in.
touch "$safety.keep"
db_id="$(database_id)"
write_restore_mark "$stamp" "safety copy" "$(basename "$folder")" "$db_id"
echo "Saved in $safety"

# Puts the ERP back as it was just before the restore (the safety copy of the
# database, and the uploaded files from before) and starts it: never left half
# restored or down. $1: what went wrong, for the message.
go_back() {
  step "Going back to the safety copy: $1"
  rm -f "$restored_mark"
  compose stop app >/dev/null 2>&1 || true
  restore_database "/safety-copies/before-restore-$stamp/database.dump" ||
    fail "$1, and the safety copy could not be put back either: restore it by hand: sudo $0 $safety"
  # Only now is the database back as it was before (never said before it is).
  went_back=1
  if [ -d "$DATA_DIR/uploads.before-restore-$stamp" ]; then
    rm -rf "$DATA_DIR/uploads.failed-restore-$stamp"
    [ ! -e "$DATA_DIR/uploads" ] || mv "$DATA_DIR/uploads" "$DATA_DIR/uploads.failed-restore-$stamp"
    mv "$DATA_DIR/uploads.before-restore-$stamp" "$DATA_DIR/uploads"
  fi
  # The files from before are back too: nothing is left to swap after a restart.
  write_restore_mark "$stamp" "went back" "$(basename "$folder")"
  rm -rf "$DATA_DIR/uploads.restoring"
  compose up -d || true
  # Still not running: the mark ("went back") stays, so the next start of the server
  # tries again, and puts nothing back.
  wait_healthy app ||
    fail "$1, nor after going back to the safety copy; see sudo ./deploy/logs.sh app. The server tries again when it starts, or run: sudo $DEPLOY_DIR/restore.sh --after-restart"
  # As it was before the restore: nothing is left to put back after a restart.
  clear_running_mark
  fail "$1, so it was put back as it was before the restore (the safety copy). The lines above say why."
}

# The uploaded files from the backup, in place of the ones there now (kept for 30
# days). False, with the reason said, when any part fails: nothing is left half done.
restore_uploads() {
  local incoming="$DATA_DIR/uploads.restoring"
  rm -rf "$incoming"
  mkdir -p "$incoming" || return 1
  if ! tar -xzf "$media" -C "$incoming"; then
    say "The uploaded files could not be unpacked from the backup (is the disk full? sudo df -h)"
    return 1
  fi
  chown -R "$APP_UID:$APP_UID" "$incoming" || return 1
  if [ -e "$DATA_DIR/uploads" ]; then
    mv "$DATA_DIR/uploads" "$DATA_DIR/uploads.before-restore-$stamp" || return 1
    touch "$DATA_DIR/uploads.before-restore-$stamp"
  fi
  mv "$incoming" "$DATA_DIR/uploads" || return 1
}

# This server's own backup settings, read just before the database is replaced,
# for the ERP to put back when it starts (G4): only root can read the file.
KEEP_SQL='SELECT row_to_json(c) FROM "BackupConfig" c LIMIT 1'
kept_file=""
restored_mark="$DATA_DIR/backups/.restored.json"
if [ "$keep_settings" = 1 ]; then
  kept_file="$DATA_DIR/backups/.restored.kept"
  if ! (umask 077 && compose exec -T db psql -X -q -At -U postgres -d "$POSTGRES_DB" \
    -c "$KEEP_SQL" >"$kept_file"); then
    rm -f "$kept_file"
    start_again
    fail "this server's backup settings could not be read, so nothing was restored.$down_note"
  fi
fi

step "Restoring the database"
# One transaction, committed only once the whole backup has gone in: the database
# is either fully restored or left as it was.
db_touched=1
if ! restore_database "$inside/database.dump"; then
  [ -z "$kept_file" ] || rm -f "$kept_file"
  start_again
  fail "the database could not be restored, so it was left as it was.$down_note"
fi
# For the ERP when it starts: which backup came back (its own run, left running in
# it, is finished then; G5) and the settings to keep.
write_restored_mark "$folder" "$kept_file" "$restored_mark" ||
  say "Note: the ERP was not told which backup came back; a backup may wait up to 6 hours to start"

if [ -n "$counts_file" ]; then
  # Counted before the app starts, so nothing has been added yet (the same count as
  # src/modules/backups/contents.ts makes for the manifest).
  step "Counting the records in every table"
  if ! compose exec -T db psql -X -q -At -U postgres -d "$POSTGRES_DB" >"$counts_file" <<'SQL'; then
SELECT coalesce(json_object_agg(table_name, n ORDER BY table_name), '{}')
  FROM (SELECT table_name::text AS table_name,
               (xpath('/row/n/text()',
                 query_to_xml(format('SELECT count(*) AS n FROM %I.%I', table_schema, table_name),
                              false, true, '')))[1]::text::bigint AS n
          FROM information_schema.tables
         WHERE table_schema = 'public' AND table_type = 'BASE TABLE') AS t;
SQL
    # No half count is left to be taken for a whole one.
    rm -f "$counts_file"
    say "The records could NOT be counted, so they cannot be checked against the backup; the restore goes on"
  fi
fi

if [ -n "$media" ]; then
  step "Restoring the uploaded files"
  # The database is already replaced: a failure here goes back to the safety copy.
  restore_uploads || go_back "the uploaded files could not be restored"
  echo "The files that were there before are kept for 30 days in $DATA_DIR/uploads.before-restore-$stamp"
fi

step "Starting the app (the database is brought up to this version of the code)"
if ! compose up -d || ! wait_healthy app; then
  compose logs --tail 80 migrate app || true
  # Never left down: back to the data as it was just before the restore.
  go_back "the ERP did not start on the restored data"
fi
# The restored ERP runs: from here on, nothing is left to settle after a restart.
clear_running_mark
restored=1

if [ "$check" = 1 ]; then
  step "Opening every screen to check the restored ERP"
  check_ok=1
  check_output="$(check_update 2>&1)" || check_ok=0
  printf '%s\n' "$check_output"
  # Every problem line, whatever the exit code: screens not checked at all (no owner
  # to open them as) are one too. A check that did not run or did not finish, with no
  # line of its own, gets one here. Either way the screens count as NOT checked, and
  # bootstrap.sh never moves the web address to this server (W13).
  problems="$(sed -n 's/^==> Problem: //p' <<<"$check_output")"
  if [ "$check_ok" = 0 ] && [ -z "$problems" ]; then
    problems="The check after the restore did not run or did not finish (the restore log says why)"
    say "Problem: $problems"
  fi
  count="$(check_problems <<<"$check_output")"
  if grep -q '^Screens not checked' <<<"$problems"; then
    outcome="Restored from $(basename "$folder"), but its screens were NOT checked: $(grep -m1 '^Screens not checked' <<<"$problems")."
  elif [ "$check_ok" = 0 ] && ! grep -qv '^The check' <<<"$problems"; then
    outcome="Restored from $(basename "$folder"), but the check after it did not finish; the restore log says why."
  elif [ -n "$problems" ]; then
    outcome="Restored from $(basename "$folder"), but the check found problems: $count screen(s) or PDF(s) did not open."
  fi
fi

say "Restored from $folder"
echo "To undo it, restore the safety copy: sudo $0 $safety. That puts back the database only;"
if [ -n "$media" ]; then
  echo "the uploaded files from before stay in $DATA_DIR/uploads.before-restore-$stamp for 30 days."
else
  echo "the uploaded files were not changed by this restore."
fi
outcome="${outcome:-Restored from $(basename "$folder"); every screen opened.}"
finished=1
