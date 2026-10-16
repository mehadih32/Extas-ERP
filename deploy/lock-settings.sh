#!/usr/bin/env bash
# Locks this server's settings (deploy/.env) for the owner's backup public key, so
# every backup carries them and only the owner's recovery key opens them. systemd
# runs it when the owner sets or changes the recovery key on the Backups screen
# (extras-erp-settings-lock.path, installed by deploy.sh); every update does the
# same. Nothing of the settings is shown.
#   sudo ./deploy/lock-settings.sh
# shellcheck source=deploy/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

need_root
load_settings
if lock_settings; then
  say "The server's settings are locked for the backups"
else
  die "the server's settings could not be locked for the backups (is the ERP installed? sudo ./deploy/deploy.sh)"
fi
