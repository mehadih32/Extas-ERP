#!/usr/bin/env bash
# Puts Extas ERP back to a backup: the database, and the uploaded files when the
# backup has them. It first saves a safety copy of the database as it is now, so
# a restore can be undone by restoring that copy.
#   sudo ./deploy/restore.sh /srv/extras-erp/backups/2026-10-04_020000
# The folder must be inside DATA_DIR/backups or DATA_DIR/safety-copies and hold
# database.dump (media.tar.gz and manifest.json are used when present). To use a
# copy downloaded from Google Drive, put its folder in DATA_DIR/backups first.
# Add --yes to skip the question (for scripts).
# shellcheck source=deploy/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

confirmed=0
folder_arg=""
for arg in "$@"; do
  case "$arg" in
    --yes) confirmed=1 ;;
    -*) die "unknown option $arg" ;;
    *) folder_arg="$arg" ;;
  esac
done

need_root
load_settings
take_update_lock
[ -n "$folder_arg" ] || die "say which backup to restore, for example: sudo $0 $DATA_DIR/backups/2026-10-04_020000"
folder="$(realpath -e "$folder_arg" 2>/dev/null)" || die "$folder_arg does not exist."
data="$(realpath -e "$DATA_DIR")"
case "$folder/" in
  "$data/backups/"?*) inside="/backups/${folder#"$data/backups/"}" ;;
  "$data/safety-copies/"?*) inside="/safety-copies/${folder#"$data/safety-copies/"}" ;;
  *) die "the backup must be a folder inside $DATA_DIR/backups or $DATA_DIR/safety-copies." ;;
esac
[ -f "$folder/database.dump" ] || die "$folder has no database.dump."
media=""
[ -f "$folder/media.tar.gz" ] && media="$folder/media.tar.gz"

if [ -f "$folder/manifest.json" ]; then
  say "Checking the backup files against their checksums"
  python3 - "$folder" <<'PY' || die "the backup is damaged; nothing was changed."
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
  read -rp "Type RESTORE to go ahead: " answer
  [ "$answer" = RESTORE ] || die "nothing was changed."
fi

stamp="$(date +%Y-%m-%d_%H%M%S)"
prepare_folders

say "Starting the database"
compose up -d db
wait_healthy db || die "the database did not start; see sudo ./deploy/logs.sh db"

say "Saving a safety copy of the database as it is now"
safety="$(safety_copy "before-restore-$stamp")"
echo "Saved in $safety"

say "Stopping the app"
compose stop app

say "Restoring the database"
# One transaction, committed only once the whole backup has gone in: the database
# is either fully restored or left as it was. ($1 to $3 are filled in inside the
# database container.)
# shellcheck disable=SC2016
if ! compose exec -T db sh -c '
    set -o pipefail
    {
      echo "SET client_min_messages = warning; BEGIN; DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
      pg_restore --no-owner --no-privileges --file=- "$1" || exit 1
      echo "COMMIT;"
    } | psql -q -v ON_ERROR_STOP=1 -U "$2" -d "$3" >/dev/null
  ' restore "$inside/database.dump" "$APP_DB_USER" "$POSTGRES_DB"; then
  compose up -d
  wait_healthy app || true
  die "the database could not be restored, so it was left as it was."
fi

if [ -n "$media" ]; then
  say "Restoring the uploaded files"
  incoming="$DATA_DIR/uploads.restoring"
  rm -rf "$incoming"
  mkdir -p "$incoming"
  tar -xzf "$media" -C "$incoming"
  chown -R "$APP_UID:$APP_UID" "$incoming"
  mv "$DATA_DIR/uploads" "$DATA_DIR/uploads.before-restore-$stamp"
  mv "$incoming" "$DATA_DIR/uploads"
  echo "The files that were there before are kept in $DATA_DIR/uploads.before-restore-$stamp"
fi

say "Starting the app (the database is brought up to this version of the code)"
compose up -d
wait_healthy app || die "the app did not start after the restore; see sudo ./deploy/logs.sh app"

say "Restored from $folder"
echo "To undo it, restore the safety copy: sudo $0 $safety"
