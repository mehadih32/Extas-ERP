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
mark_data_folder || true
prepare_https || { rm -f "$DATA_DIR/caddy/tls/cloudflare.caddy" && choose_caddy; }
prepare_demo_site

# The version running now is kept, so a failed update can go back to it.
can_go_back=0
keep_running_version && can_go_back=1

# A build needs room: with less than 5 GB free, every unused build step and untagged image
# goes first (the kept :previous version stays), then the free space is measured again.
# Under 3 GB even then, the update stops before anything changes.
docker_root="$(docker info -f '{{.DockerRootDir}}' 2>/dev/null || echo /var/lib/docker)"
free_kb() { df --output=avail -k "$docker_root" 2>/dev/null | tail -n 1 | tr -d ' '; }
free="$(free_kb)"
if [ -n "$free" ] && [ "$free" -lt $((5 * 1024 * 1024)) ]; then
  say "Less than 5 GB is free on the server ($((free / 1024 / 1024)) GB): clearing old build steps first"
  docker builder prune -a -f >/dev/null 2>&1 || true
  docker image prune -f >/dev/null 2>&1 || true
  free="$(free_kb)"
  say "Free space now: $((free / 1024 / 1024)) GB"
  if [ -n "$free" ] && [ "$free" -lt $((3 * 1024 * 1024)) ]; then
    die "only $((free / 1024 / 1024)) GB is free on the server even after clearing old build steps, and an update needs about 3 GB. Nothing was changed: the ERP still runs the version it ran before. See what takes the room with: sudo du -xh -d1 / | sort -h"
  fi
fi

say "Building the app (this takes a few minutes)"
build=(build)
if [ "$pull" = 1 ]; then
  compose pull db
  # Caddy with Cloudflare's module is built here (prepare_https), not downloaded.
  if [ "$CADDY_IMAGE" = "$PLAIN_CADDY" ]; then compose pull caddy; fi
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
# An ERP whose database is not running is not updated: no safety copy could be saved, and
# starting it here would bring the database up to date without one. Only a new server
# (no database yet) goes on without a copy.
if ! db_running && [ -s "$DATA_DIR/postgres/PG_VERSION" ]; then
  [ "$can_go_back" = 1 ] && use_previous_version
  die "the database is not running, so no safety copy could be saved and the update was not installed. Nothing was changed. See why with: sudo ./deploy/status.sh"
fi
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
    # Without a copy to go back to, the update does not start: the version that ran before
    # opens again as it was (never the new build, whose start would change the database).
    [ "$can_go_back" = 1 ] && use_previous_version
    [ -n "$pending" ] && { compose up -d --no-build app caddy || true; }
    die "the safety copy of the database could not be saved (is the disk full? sudo df -h), so the update was not installed. Nothing was changed: the ERP still runs the version it ran before."
  fi
  echo "Saved in $saved"
  # Kept on the server for 24 hours (the ERP also locks it and sends it to Google Drive).
  prune_safety_copies
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
  local restored=1
  if [ -n "$pending" ] && [ -n "$copy" ]; then
    say "Putting the database back as it was just before the update"
    if ! restore_database "/safety-copies/$copy/database.dump"; then
      # The ERP does not stay down for it: the earlier version starts on the database as it is.
      restored=0
      say "The database could not be put back, so it was left as it was. The earlier version starts on it anyway; put it back by hand later: sudo ./deploy/restore.sh $DATA_DIR/safety-copies/$copy"
    fi
  fi
  use_previous_version
  if compose up -d --no-build --remove-orphans && wait_healthy app; then
    say "Went back: the ERP runs the version from before the update again"
    # The failed version's image, no longer used.
    docker image prune -f >/dev/null 2>&1 || true
    [ "$restored" = 1 ] ||
      die "the update was not installed ($reason), and the database could not be put back as it was: the ERP runs the earlier version on it. Put it back by hand: sudo ./deploy/restore.sh $DATA_DIR/safety-copies/$copy"
    die "the update was not installed ($reason). The full log on the server says why."
  fi
  compose ps || true
  compose logs --tail 80 migrate app || true
  die "the earlier version did not start either; the logs above say why. The safety copy of the database is in $DATA_DIR/safety-copies/$copy."
}

say "Starting the database, bringing it up to date, then starting the app"
if ! compose up -d --remove-orphans "${services[@]}"; then
  compose logs --tail 80 migrate app || true
  go_back "the database could not be brought up to date, or the app could not start"
fi

say "Waiting for the app to answer"
if ! wait_healthy app; then
  compose ps || true
  compose logs --tail 80 app || true
  go_back "the new version did not start"
fi

say "Opening every screen to check the new version"
check_update || go_back "a screen or a PDF did not work in the new version"
if [ -n "$pending" ]; then
  say "The new version passed its check: opening the ERP to its users again"
  compose up -d caddy
fi

# Backups: the monthly restore drill's temporary database, Restore from the Backups
# screen, locking the settings when the backup key changes, clearing safety copies
# after 24 hours, and what every backup takes from the server (this version's code
# and the locked settings). None of it can fail the update.
allow_test_restores ||
  say "The monthly restore drill may not make its temporary database; it says so on the Backups screen"
install_backup_helpers ||
  say "Restore from the Backups screen is not set up on this server (no systemd); restore with deploy/restore.sh"
install_host_status ||
  say "Bug Guard cannot see this server's own updates; it says nothing about them"
record_host_files ||
  say "The backups could not take this version's code or settings this time; the Backups screen says what is missing"
forget_github_token || true
forget_secrets_in_history || true

# The demo site starts after the ERP itself, so the ERP never waits on it.
if [ -n "$DEMO_DOMAIN" ]; then
  say "Starting the demo site"
  if start_demo; then
    say "The demo site is running"
    # The test bookings' numbers (prisma/demo/test-bookings.ts) and the v6.2 sample
    # order (prisma/demo/v62-samples.ts), for the Deploy log.
    demo_compose logs --no-log-prefix demo-seed 2>/dev/null |
      grep -F -e 'Test booking' -e 'v6.2 sample order' |
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
docker image prune -f >/dev/null || true
docker builder prune -f --filter until=720h >/dev/null || true
free="$(free_kb)"
[ -n "$free" ] && say "Free space on the server: $((free / 1024 / 1024)) GB"

say "Extas ERP is running at https://$APP_DOMAIN"
echo "Check it: https://$APP_DOMAIN/api/health should show \"status\":\"ok\"."
if [ -n "$DEMO_DOMAIN" ]; then
  echo "The demo site: https://$DEMO_DOMAIN (README.md, \"The demo site\")."
fi
