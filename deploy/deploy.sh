#!/usr/bin/env bash
# Installs or updates Extas ERP on this server. It builds the app from this copy of
# the code, saves a safety copy of the database (when there is one), brings the
# database up to date, starts everything and opens every screen to check it. Run it
# again after every `git pull`.
#
# A failed update never leaves the ERP down: when the new version cannot be built,
# nothing changes; when it does not start, or a screen does not open, the server goes
# back by itself to the version that ran before it, and to the safety copy of the
# database when the update had changed the database.
#   sudo ./deploy/deploy.sh             the usual run
#   sudo ./deploy/deploy.sh --no-pull   keep the downloaded base images as they are
# shellcheck source=deploy/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

pull=1
for arg in "$@"; do
  case "$arg" in
    --no-pull) pull=0 ;;
    *) die "unknown option $arg" ;;
  esac
done

need_root
load_settings
take_update_lock
[ -n "$APP_DOMAIN" ] || die "APP_DOMAIN is empty in deploy/.env."

say "Preparing the data folders in $DATA_DIR"
prepare_folders
prepare_demo_site

# The version running now is kept, so a failed update can go back to it.
can_go_back=0
keep_running_version && can_go_back=1

say "Building the app (this takes a few minutes)"
build=(build)
if [ "$pull" = 1 ]; then
  compose pull db caddy
  build+=(--pull)
fi
if ! compose "${build[@]}"; then
  # A part that was built is not kept: the :latest names stay on the running version.
  [ "$can_go_back" = 1 ] && use_previous_version
  die "the new version could not be built; the log above says why. Nothing was changed: the ERP still runs the version it ran before."
fi

# Changes to the database the update brings, if any. While there are some, the ERP
# closes to its users (HTTPS stops) from just before the safety copy until the new
# version has passed its check, so nothing is written that putting the copy back
# would lose.
pending=""
copy=""
services=()
if db_running; then
  pending="$(pending_migrations)"
  if [ -n "$pending" ]; then
    say "The update changes the database ($(grep -c . <<<"$pending") change(s)): the ERP closes for a few minutes while it is saved, updated and checked"
    compose stop caddy app
    services=(db migrate app)
  fi
  say "Saving a safety copy of the database"
  copy="before-update-$(date +%Y-%m-%d_%H%M%S)"
  if ! saved="$(safety_copy "$copy")"; then
    # Without a copy to go back to, the update does not start: the ERP opens again as it was.
    [ -n "$pending" ] && compose up -d app caddy
    die "the safety copy of the database could not be saved (is the disk full? sudo df -h), so the update was not installed. Nothing was changed: the ERP still runs the version it ran before."
  fi
  echo "Saved in $saved"
  # The newest 10 are kept.
  find "$DATA_DIR/safety-copies" -mindepth 1 -maxdepth 1 -name 'before-update-*' -printf '%T@ %p\n' |
    sort -rn | tail -n +11 | cut -d' ' -f2- | xargs -r rm -rf
fi

# A failed update: back to the version that ran before it, and to the safety copy of
# the database when the update changed the database. It always ends deploy.sh with
# the reason, so the Deploy run shows that the update was not installed.
go_back() {
  local reason="$1"
  [ "$can_go_back" = 1 ] ||
    die "$reason; the logs above say why. There is no earlier version on this server to go back to."
  say "The update failed ($reason). Going back to the version that ran before it"
  compose stop app >/dev/null 2>&1 || true
  if [ -n "$pending" ] && [ -n "$copy" ]; then
    say "Putting the database back as it was just before the update"
    restore_database "/safety-copies/$copy/database.dump" ||
      die "the database could not be put back, so it was left as it was. Put it back by hand: sudo ./deploy/restore.sh $DATA_DIR/safety-copies/$copy"
  fi
  use_previous_version
  if compose up -d --no-build --remove-orphans && wait_healthy app; then
    say "Went back: the ERP runs the version from before the update again"
    # The failed version's image, no longer used.
    docker image prune -f >/dev/null 2>&1 || true
    die "the update was not installed ($reason). The full log on the server says why."
  fi
  compose ps
  compose logs --tail 80 migrate app
  die "the earlier version did not start either; the logs above say why. The safety copy of the database is in $DATA_DIR/safety-copies/$copy."
}

say "Starting the database, bringing it up to date, then starting the app"
if ! compose up -d --remove-orphans "${services[@]}"; then
  compose logs --tail 80 migrate app
  go_back "the database could not be brought up to date, or the app could not start"
fi

say "Waiting for the app to answer"
if ! wait_healthy app; then
  compose ps
  compose logs --tail 80 app
  go_back "the new version did not start"
fi

say "Opening every screen to check the new version"
check_update || go_back "a screen or a PDF did not work in the new version"
if [ -n "$pending" ]; then
  say "The new version passed its check: opening the ERP to its users again"
  compose up -d caddy
fi

# The demo site starts after the ERP itself, so the ERP never waits on it.
if [ -n "$DEMO_DOMAIN" ]; then
  say "Starting the demo site"
  if start_demo; then
    say "The demo site is running"
    # The test bookings' numbers (prisma/demo/test-bookings.ts), for the Deploy log.
    demo_compose logs --no-log-prefix demo-seed 2>/dev/null | grep -F 'Test booking' |
      while read -r line; do say "Demo: $line"; done || true
  else
    demo_compose logs --tail 80 demo-seed demo-app || true
    say "The demo site did not start; the live ERP is not affected. The logs above say why"
  fi
else
  stop_demo
fi
# Caddy reads the demo site's part, or that it is gone. If it cannot, it keeps what it had.
# While the demo still has no HTTPS certificate, the reload is forced, so Caddy tries for
# it at once: it waits longer after each failed try, and its DNS record may be new.
reload=(caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile)
if [ -n "$DEMO_DOMAIN" ] && ! demo_certificate_ready; then reload+=(--force); fi
compose exec -T caddy "${reload[@]}" >/dev/null 2>&1 ||
  say "HTTPS kept its earlier setup; see sudo ./deploy/logs.sh caddy"
if [ -n "$DEMO_DOMAIN" ]; then report_demo_certificate; fi

# Images and build steps left over from earlier versions.
docker image prune -f >/dev/null
docker builder prune -f --filter until=720h >/dev/null

say "Extas ERP is running at https://$APP_DOMAIN"
echo "Check it: https://$APP_DOMAIN/api/health should show \"status\":\"ok\"."
if [ -n "$DEMO_DOMAIN" ]; then
  echo "The demo site: https://$DEMO_DOMAIN (README.md, \"The demo site\")."
fi
