#!/usr/bin/env bash
# Installs each merge into main by itself, with nothing to set up on GitHub (the
# owner's decision, 2026-10-30: no keys or secrets, nothing typed on the server,
# nothing to redo when the server or its IP address changes). Every 5 minutes
# (/etc/cron.d/extras-erp-self-update) it asks GitHub which commit is newest on main and,
# once GitHub's checks ("Tests and build") passed on exactly that commit, installs
# it with auto-deploy.sh (which keeps the running version and its safety copy, and
# goes back by itself if anything fails). It only reads from GitHub: the
# repository is public. Never on a restore drill copy, an ERP on standby, during a
# restore, or while the code is put back to an earlier version by hand (not on
# main). A commit whose checks failed is never installed; a failed install is
# tried again after an hour, three times at most. AUTO_UPDATE=off in deploy/.env
# turns it off. Installed (lib.sh: install_self_update) as
#   /usr/local/sbin/extras-erp-self-update <program folder>
# and kept outside the program folder, so an ERP restored from an older backup
# still updates itself. The newest 30 logs: DATA_DIR/deploy-logs.
set -euo pipefail

DIR="${1:-/opt/extras-erp}"
API="${EXTRAS_GITHUB_API:-https://api.github.com}"
GIT_BASE="${EXTRAS_GIT_BASE:-https://github.com}"
# Tests only: another folder for the locks.
RUN="${EXTRAS_RUN_DIR:-/run}"

setting() { sed -n "s/^$1=//p" "$DIR/deploy/.env" 2>/dev/null | tail -n 1; }
log() { printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >>"$DATA/deploy-logs/self-update.log"; }

[ -f "$DIR/deploy/.env" ] && [ -x "$DIR/deploy/auto-deploy.sh" ] || exit 0
# One at a time: an update takes longer than the 5 minutes between two runs.
exec 9>"$RUN/extras-erp-self-update.lock"
flock -n 9 || exit 0
DATA="$(setting DATA_DIR)"
DATA="${DATA:-/srv/extras-erp}"
[ "$(setting AUTO_UPDATE)" != off ] || exit 0
for mark in .drill .standby .restore-unfinished; do
  [ ! -e "$DATA/backups/$mark" ] || exit 0
done
# A restore running now (bootstrap.sh holds this lock).
if [ -e "$RUN/extas-erp-restore.lock" ]; then
  exec 7>>"$RUN/extas-erp-restore.lock"
  flock -n 7 || exit 0
  exec 7>&-
fi
# Put back to an earlier version by hand (README): it stays there until main is checked out.
[ "$(git -C "$DIR" branch --show-current 2>/dev/null)" = main ] || exit 0
mkdir -p "$DATA/deploy-logs"
chmod 700 "$DATA/deploy-logs"

repo="$(git -C "$DIR" remote get-url origin 2>/dev/null | sed -E 's#^.*github\.com[:/]##; s#\.git$##')"
[[ "$repo" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || repo=mehadih32/Extas-ERP
want="$(GIT_TERMINAL_PROMPT=0 timeout 60 git ls-remote "$GIT_BASE/$repo.git" refs/heads/main 2>/dev/null | cut -f1)"
[[ "$want" =~ ^[0-9a-f]{40}$ ]] || exit 0

# What was tried for a commit that did not install: "<commit> <tries> <time of the
# last try>" (a failed update goes back to the earlier version, but its code stays).
state="$DATA/deploy-logs/self-update.state"
tried="" tries=0 at=0
read -r tried tries at <"$state" 2>/dev/null || true
if [ "$tried" = "$want" ]; then
  [ "${tries:-0}" -lt 3 ] && [ $(($(date +%s) - ${at:-0})) -ge 3600 ] || exit 0
else
  # Already in (by hand, or by the restore): nothing to do.
  [ "$(git -C "$DIR" rev-parse HEAD 2>/dev/null)" != "$want" ] || exit 0
  tries=0
fi

# GitHub's checks on exactly this commit: passed, failed, or not finished yet.
verdict="$(curl -fsS --max-time 30 -H 'Accept: application/vnd.github+json' \
  "$API/repos/$repo/commits/$want/check-runs?per_page=100" 2>/dev/null |
  python3 -I -c '
import json, sys
runs = [r for r in json.load(sys.stdin).get("check_runs", []) if r.get("name", "").endswith("Tests and build")]
if not runs:
    print("waiting")
else:
    last = max(runs, key=lambda r: r.get("id", 0))
    if last.get("status") != "completed":
        print("waiting")
    else:
        print("passed" if last.get("conclusion") == "success" else "failed")
' 2>/dev/null || echo waiting)"
case "$verdict" in
  passed) ;;
  failed)
    if [ "$tried" != "$want" ]; then
      log "${want:0:7}: GitHub's checks failed on it, so it is not installed."
      printf '%s 3 %s\n' "$want" "$(date +%s)" >"$state"
    fi
    exit 0
    ;;
  *) exit 0 ;;
esac

printf '%s %s %s\n' "$want" "$((tries + 1))" "$(date +%s)" >"$state"
log "${want:0:7}: GitHub's checks passed; installing it."
if printf '%s\n' "$want" | "$DIR/deploy/auto-deploy.sh" >/dev/null 2>&1; then
  log "${want:0:7}: installed."
  rm -f "$state"
else
  log "${want:0:7}: the update failed (try $((tries + 1)) of 3); its log in this folder says why."
fi
