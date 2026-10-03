#!/usr/bin/env bash
# Follows the logs until Ctrl+C. Name a service to see only that one: app, db,
# caddy or migrate.
#   sudo ./deploy/logs.sh
#   sudo ./deploy/logs.sh app
# shellcheck source=deploy/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

need_root
load_settings
compose logs --tail 200 --follow "$@"
