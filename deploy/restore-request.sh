#!/usr/bin/env bash
# Runs a restore asked for on the Backups screen (Settings > Backups). systemd
# starts it when the ERP leaves BACKUP_DIR/restore-request.json (deploy.sh installs
# extras-erp-restore.path). The ERP has already downloaded the backup from Google
# Drive, checked every file and opened it with the recovery key into
# BACKUP_DIR/restores/<name>; this checks that the request is the ERP's own (its
# signature, made with the server's ENCRYPTION_KEY) and runs restore.sh: a safety
# copy first, then the restore, then the full check. The result goes to
# BACKUP_DIR/restore-result.json, which the ERP records and sends to the owner.
# The opened backup is plain data and never stays: it is deleted when the restore
# ends or is refused, and one left by a restore cut off earlier (the server restarted)
# at the next start (and by the hourly clean-up deploy.sh installs, lib.sh).
# shellcheck source=deploy/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

need_root
load_settings
backups="$DATA_DIR/backups"
request="$backups/restore-request.json"
result="$backups/restore-result.json"
[ -f "$request" ] || exit 0
# Taken at once, so systemd does not start it twice.
taken="$backups/restore-request.taken"
mv -f "$request" "$taken"
# The opened backup this request names (restores/<name>), even before its signature is
# checked: only to delete it when the request is refused.
named="$(python3 -c 'import json, re, sys
f = str(json.load(open(sys.argv[1])).get("folder", ""))
print(f if re.fullmatch(r"restores/[\w.-]+", f) else "")' "$taken" 2>/dev/null || true)"

refuse() {
  [ -z "$named" ] || rm -rf "${backups:?}/$named"
  MESSAGE="$1" python3 - "$result" <<'PY'
import json, os, sys, datetime
now = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
json.dump({"ok": False, "message": os.environ["MESSAGE"], "startedAt": now, "finishedAt": now},
          open(sys.argv[1], "w"), indent=2)
PY
  chown "$APP_UID:$APP_UID" "$result"
  rm -f "$taken"
  die "$1"
}

key="$(setting ENCRYPTION_KEY)"
[ -n "$key" ] || refuse "the server has no ENCRYPTION_KEY in deploy/.env, so the request could not be checked."
# The folder, if the request is the ERP's own and names a folder in backups/restores.
folder="$(KEY="$key" python3 - "$taken" <<'PY'
import hashlib, hmac, json, os, re, sys
r = json.load(open(sys.argv[1]))
folder, at, given = str(r.get("folder", "")), str(r.get("requestedAt", "")), str(r.get("signature", ""))
want = hmac.new(os.environ["KEY"].encode(), f"{folder}|{at}".encode(), hashlib.sha256).hexdigest()
if not hmac.compare_digest(want, given) or not re.fullmatch(r"restores/[\w.-]+", folder):
    sys.exit(1)
print(folder)
PY
)" || refuse "the restore request was not the ERP's own (its signature did not match), so nothing was restored."
rm -f "$taken"

# One update or restore at a time: a running update is waited for (up to an hour).
wait_update_lock 3600 || refuse "an update was still running after an hour, so the restore did not start. Ask for it again."

# Opened backups left by a restore cut off earlier (more than 2 hours old: never one
# the ERP is opening now) go first.
find "$backups/restores" -mindepth 1 -maxdepth 1 ! -name "$(basename "$folder")" -mmin +120 \
  -exec rm -rf {} + 2>/dev/null || true

status=0
# This server's own backup settings (recovery key, schedule, Google Drive) stay as they are.
"$DEPLOY_DIR/restore.sh" --yes --check --keep-backup-settings --result "$result" \
  --status "$backups/restore-status.json" "$backups/$folder" || status=$?
# The opened backup is plain data: it does not stay on the disk.
rm -rf "${backups:?}/$folder"
exit "$status"
