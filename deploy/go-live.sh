#!/usr/bin/env bash
# Makes this server the Extas ERP in use after a restore left it on standby
# (bootstrap.sh does, while the web address still points at the other server): its
# backups, reminders and other clocks start within a minute. Run it only when the
# old server is off or will not be used again, and the web address points here
# (the restore guide, step F6). It asks for the web address to be typed.
#   sudo ./deploy/go-live.sh
# shellcheck source=deploy/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

need_root
load_settings
leave_standby "$DATA_DIR/backups" "$APP_DOMAIN"
