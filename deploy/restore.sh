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
#                  only put back a restore cut off half-way (the server restarted, or
#                  it was stopped) and start the ERP; systemd runs it when the server
#                  starts (lib.sh install_backup_helpers). Every restore does it first.
# shellcheck source=deploy/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

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
step() {
  say "$1"
  [ -n "$status_file" ] || return 0
  STEP="$1" python3 -c 'import json, os, sys; json.dump({"step": os.environ["STEP"]}, open(sys.argv[1], "w"))' \
    "$status_file" 2>/dev/null || true
}
write_result() {
  local code=$?
  [ -n "$result_file" ] || return 0
  OK="$([ "$code" = 0 ] && echo 1 || echo 0)" MESSAGE="${outcome:-the restore stopped (exit code $code)}" \
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

need_root
load_settings
take_update_lock

# While a restore runs, from stopping the app until it runs again (on the restored
# data, or on the data from before): line 1 the restore's time, line 2 "safety copy"
# once that is saved. Left behind only when the restore was cut off half-way (the
# server restarted, or it was stopped): the app then stays stopped, so the next
# start of the server (systemd, --after-restart) or the next restore puts the ERP
# back as it was before that restore and starts it. Never left down, never half
# restored.
running_mark="$DATA_DIR/backups/.restore-running"
put_back=0
undo_cut_restore() {
  [ -f "$running_mark" ] || return 0
  local cut cut_safety database=1
  cut="$(sed -n 1p "$running_mark")"
  cut_safety="$(sed -n 2p "$running_mark")"
  [[ "$cut" =~ ^[0-9_-]+$ ]] || cut=""
  step "A restore was cut off before it finished (the server restarted, or it was stopped): putting the ERP back as it was before that restore"
  compose up -d db || true
  wait_healthy db || fail "the database did not start; see sudo ./deploy/logs.sh db. The ERP stays stopped until this runs again: sudo $0 --after-restart"
  compose stop app >/dev/null 2>&1 || true
  if [ -n "$cut" ] && [ "$cut_safety" = "safety copy" ]; then
    # The database may have been replaced already: back to its safety copy (the
    # app was stopped before it was saved, so nothing is lost).
    if [ -f "$DATA_DIR/safety-copies/before-restore-$cut/database.dump" ] &&
      restore_database "/safety-copies/before-restore-$cut/database.dump"; then
      rm -f "$DATA_DIR/backups/.restored.json" "$DATA_DIR/backups/.restored.kept"
    else
      database=0
    fi
  fi
  if [ -n "$cut" ] && [ -d "$DATA_DIR/uploads.before-restore-$cut" ]; then
    rm -rf "$DATA_DIR/uploads.failed-restore-$cut"
    [ ! -e "$DATA_DIR/uploads" ] || mv "$DATA_DIR/uploads" "$DATA_DIR/uploads.failed-restore-$cut"
    mv "$DATA_DIR/uploads.before-restore-$cut" "$DATA_DIR/uploads"
  fi
  rm -rf "$DATA_DIR/uploads.restoring"
  if [ "$database" = 0 ]; then
    # Never started on a database that may be half way: the owner restores by hand,
    # or the restore asked for now replaces it.
    [ "$after_restart" = 0 ] || fail "the database could not be put back as it was before the restore that was cut off, so the ERP stays stopped. Restore its safety copy: sudo $0 $DATA_DIR/safety-copies/before-restore-$cut (or a backup)."
    rm -f "$running_mark"
    say "Note: the database could not be put back as it was before the restore that was cut off; this restore replaces it"
    return 0
  fi
  # The data is as it was before that restore: nothing is left to put back.
  rm -f "$running_mark"
  put_back=1
  compose up -d || true
  if wait_healthy app; then
    say "The ERP runs again as it was before the restore that was cut off"
  elif [ "$after_restart" = 1 ]; then
    fail "the data is back as it was before the restore that was cut off, but the ERP did not start on it; see sudo ./deploy/logs.sh app"
  else
    say "The data is back as it was before the restore that was cut off, but the ERP did not start on it; this restore goes on"
  fi
}
undo_cut_restore
if [ "$after_restart" = 1 ]; then
  # At the server's start: an ERP that was in use, put on standby by the restore
  # command (bootstrap.sh) for a restore that never finished, is in use again.
  if [ "$put_back" = 1 ] && [ -f "$DATA_DIR/backups/.standby.was-in-use" ]; then
    rm -f "$DATA_DIR/backups/.standby" "$DATA_DIR/backups/.standby.was-in-use"
    say "The ERP that was in use here is not on standby: it runs as before the restore that was cut off"
  fi
  exit 0
fi

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
printf '%s\n' "$stamp" >"$running_mark"
compose stop app

# Starts the app again on the database as it was (nothing replaced yet), whatever the
# reason it stops here; never aborts before the reason is said.
start_again() {
  compose up -d || true
  wait_healthy app || true
  rm -f "$running_mark"
}

step "Saving a safety copy of the database as it is now"
if ! safety="$(safety_copy "before-restore-$stamp")"; then
  start_again
  fail "the safety copy of the database could not be saved (is the disk full? sudo df -h), so nothing was restored."
fi
printf '%s\nsafety copy\n' "$stamp" >"$running_mark"
echo "Saved in $safety"

# Puts the ERP back as it was just before the restore (the safety copy of the
# database, and the uploaded files from before) and starts it: never left half
# restored or down. $1: what went wrong, for the message.
go_back() {
  went_back=1
  step "Going back to the safety copy: $1"
  rm -f "$restored_mark"
  compose stop app >/dev/null 2>&1 || true
  restore_database "/safety-copies/before-restore-$stamp/database.dump" ||
    fail "$1, and the safety copy could not be put back either: restore it by hand: sudo $0 $safety"
  if [ -d "$DATA_DIR/uploads.before-restore-$stamp" ]; then
    rm -rf "$DATA_DIR/uploads.failed-restore-$stamp"
    [ ! -e "$DATA_DIR/uploads" ] || mv "$DATA_DIR/uploads" "$DATA_DIR/uploads.failed-restore-$stamp"
    mv "$DATA_DIR/uploads.before-restore-$stamp" "$DATA_DIR/uploads"
  fi
  rm -rf "$DATA_DIR/uploads.restoring"
  # As it was before the restore: nothing is left to put back after a restart.
  rm -f "$running_mark"
  compose up -d || true
  wait_healthy app ||
    fail "$1, nor after going back to the safety copy; see sudo ./deploy/logs.sh app"
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
    fail "this server's backup settings could not be read, so nothing was restored."
  fi
fi

step "Restoring the database"
# One transaction, committed only once the whole backup has gone in: the database
# is either fully restored or left as it was.
if ! restore_database "$inside/database.dump"; then
  [ -z "$kept_file" ] || rm -f "$kept_file"
  start_again
  fail "the database could not be restored, so it was left as it was."
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
# The restored ERP runs: from here on, a restart never takes it back.
rm -f "$running_mark"

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
