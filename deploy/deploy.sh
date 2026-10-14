#!/usr/bin/env bash
# Installs or updates Extas ERP on this server. It saves a safety copy of the
# database (when there is one), builds the app from this copy of the code, brings
# the database up to date and starts everything. Run it again after every
# `git pull`.
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

if db_running; then
  say "Saving a safety copy of the database"
  copy="$(safety_copy "before-update-$(date +%Y-%m-%d_%H%M%S)")"
  echo "Saved in $copy"
  # The newest 10 are kept.
  find "$DATA_DIR/safety-copies" -mindepth 1 -maxdepth 1 -name 'before-update-*' -printf '%T@ %p\n' |
    sort -rn | tail -n +11 | cut -d' ' -f2- | xargs -r rm -rf
fi

say "Building the app (this takes a few minutes)"
if [ "$pull" = 1 ]; then
  compose pull db caddy
  compose build --pull
else
  compose build
fi

say "Starting the database, bringing it up to date, then starting the app and HTTPS"
if ! compose up -d --remove-orphans; then
  compose logs --tail 80 migrate app
  die "starting failed; the logs above say why. The safety copy of the database is in $DATA_DIR/safety-copies."
fi

say "Waiting for the app to answer"
if ! wait_healthy app; then
  compose ps
  compose logs --tail 80 app
  die "the app did not start; the logs above say why."
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
