#!/usr/bin/env bash
# Updates Extras ERP to the newest code on GitHub's main branch and installs it
# with deploy.sh. GitHub runs it after every merge into main, over SSH with the
# key that setup-auto-deploy.sh made (see .github/workflows/deploy.yml). It can
# also be run by hand:
#   sudo ./deploy/auto-deploy.sh
# The full log is kept on the server, in DATA_DIR/deploy-logs. Only the steps and
# the result are sent back, because anyone can read GitHub's logs while the
# repository is public. The update keeps going if the connection drops.
# shellcheck source=deploy/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

update() {
  local repo
  repo="$(dirname "$DEPLOY_DIR")"
  take_update_lock

  say "Getting the newest code from GitHub"
  git -C "$repo" fetch --quiet origin main
  # A server put back to an earlier version (deploy/README.md) returns to main.
  [ "$(git -C "$repo" branch --show-current)" = main ] || git -C "$repo" checkout --quiet main
  git -C "$repo" merge --quiet --ff-only origin/main ||
    die "the server's copy of the code has changes of its own, so it was not updated. See them with: cd $repo && sudo git status"

  say "Installing $(git -C "$repo" log -1 --format='%h (%s)')"
  "$DEPLOY_DIR/deploy.sh"
}

main() {
  need_root
  load_settings

  local logs="$DATA_DIR/deploy-logs" log pid
  mkdir -p "$logs"
  chmod 700 "$logs"
  log="$logs/update-$(date +%Y-%m-%d_%H%M%S).log"
  : >"$log"

  # The update runs on its own, writing to the log, and this follows it.
  (
    trap '' HUP
    update
  ) >"$log" 2>&1 </dev/null &
  pid=$!
  tail -n +1 -f --pid="$pid" "$log" |
    grep --line-buffered -E '^(==> |Error: )' |
    sed -u -E 's#https://[^ ]+#the ERP address#g' || true

  # The newest 30 logs are kept.
  find "$logs" -mindepth 1 -maxdepth 1 -name 'update-*.log' -printf '%T@ %p\n' |
    sort -rn | tail -n +31 | cut -d' ' -f2- | xargs -r rm -f

  if wait "$pid"; then
    echo
    echo "Updated. The full log is on the server: sudo less $log"
  else
    echo
    echo "The update failed. The full log on the server says why: sudo less $log"
    exit 1
  fi
}

main "$@"
