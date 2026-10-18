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
# shellcheck source=deploy/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

confirmed=0
check=0
result_file=""
status_file=""
counts_file=""
keep_settings=0
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

step "Saving a safety copy of the database as it is now"
safety="$(safety_copy "before-restore-$stamp")" ||
  fail "the safety copy of the database could not be saved (is the disk full? sudo df -h), so nothing was restored."
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

step "Stopping the app"
compose stop app

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
    compose up -d
    wait_healthy app || true
    fail "this server's backup settings could not be read, so nothing was restored."
  fi
fi

step "Restoring the database"
# One transaction, committed only once the whole backup has gone in: the database
# is either fully restored or left as it was.
if ! restore_database "$inside/database.dump"; then
  [ -z "$kept_file" ] || rm -f "$kept_file"
  compose up -d
  wait_healthy app || true
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

if [ "$check" = 1 ]; then
  step "Opening every screen to check the restored ERP"
  if ! check_output="$(check_update 2>&1)"; then
    count="$(check_problems <<<"$check_output")"
    problems="$(sed -n 's/^==> Problem: //p' <<<"$check_output")"
    printf '%s\n' "$check_output"
    if [ "$count" -gt 0 ]; then
      outcome="Restored from $(basename "$folder"), but the check found problems: $count screen(s) or PDF(s) did not open."
    else
      outcome="Restored from $(basename "$folder"), but the check after it did not finish; the restore log says why."
    fi
  else
    printf '%s\n' "$check_output"
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
