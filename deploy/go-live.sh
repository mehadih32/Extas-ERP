#!/usr/bin/env bash
# Makes this server the Extas ERP in use after a restore left it on standby
# (bootstrap.sh does, while the web address still points at the other server): its
# reminders and messages start within a minute (its backups and alarms ran on
# standby already). Run it only when the old server is off or will not be used
# again. It first checks that the web address really reaches this server (point it
# here first: the restore guide, step F6), then asks for it to be typed.
#   sudo ./deploy/go-live.sh
# shellcheck source=deploy/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

need_root
load_settings
leave_standby "$DATA_DIR/backups" "$APP_DOMAIN"
