#!/usr/bin/env bash
# Installs or updates Extras ERP on this server. It saves a safety copy of the
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
[ -n "$APP_DOMAIN" ] || die "APP_DOMAIN is empty in deploy/.env."

say "Preparing the data folders in $DATA_DIR"
prepare_folders

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

# Images and build steps left over from earlier versions.
docker image prune -f >/dev/null
docker builder prune -f --filter until=720h >/dev/null

say "Extras ERP is running at https://$APP_DOMAIN"
echo "Check it: https://$APP_DOMAIN/api/health should show \"status\":\"ok\"."
