#!/usr/bin/env bash
# Tells Bug Guard (AI Center > Bug Guard) whether the server itself has updates
# waiting: how many Ubuntu updates, how many of them are security updates, and
# whether a restart is needed to finish them. It only reads; it never installs
# anything. deploy.sh runs it after every update and installs a daily cron line
# for it (/etc/cron.d/extras-erp-host-status). The answer goes to
# DATA_DIR/backups/host-status.json, which the ERP reads as BACKUP_DIR.
#   sudo ./deploy/host-status.sh
# shellcheck source=deploy/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

need_root
DATA_DIR="$(setting DATA_DIR /srv/extras-erp)"
out="$DATA_DIR/backups/host-status.json"
[ -d "$DATA_DIR/backups" ] || exit 0

updates=0
security=0
if [ -x /usr/lib/update-notifier/apt-check ]; then
  # Prints "<all>;<security>" on stderr.
  counts="$(/usr/lib/update-notifier/apt-check 2>&1 >/dev/null | tail -n 1)"
  if [[ "$counts" =~ ^([0-9]+)\;([0-9]+)$ ]]; then
    updates="${BASH_REMATCH[1]}"
    security="${BASH_REMATCH[2]}"
  fi
elif command -v apt >/dev/null; then
  list="$(apt list --upgradable 2>/dev/null | grep -F '[upgradable from' || true)"
  updates="$(printf '%s' "$list" | grep -c . || true)"
  security="$(printf '%s' "$list" | grep -c -- '-security' || true)"
fi
reboot=false
[ -f /var/run/reboot-required ] && reboot=true

tmp="$(mktemp "$DATA_DIR/backups/.host-status.XXXXXX")"
printf '{"updates": %d, "security": %d, "rebootRequired": %s, "checkedAt": "%s"}\n' \
  "$updates" "$security" "$reboot" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >"$tmp"
chown "$APP_UID:$APP_UID" "$tmp"
chmod 644 "$tmp"
mv -f "$tmp" "$out"
