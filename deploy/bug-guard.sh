#!/usr/bin/env bash
# Runs Bug Guard on the ERP running here and prints what it found. The restore
# command (bootstrap.sh) runs it once the restored ERP is up:
#   sudo ./deploy/bug-guard.sh --after-restore
# It leaves DATA_DIR/backups/bug-guard-request.json; the ERP takes it within a
# minute (src/modules/bug-guard/after-restore.ts), checks every company (only
# reading; the report goes to the inbox and Telegram as after every run) and
# writes bug-guard-result.json. Exit code 0: nothing urgent or important;
# 1: Bug Guard found urgent or important problems; 2: it could not check
# everything, or did not answer within 20 minutes.
# shellcheck source=deploy/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

[ "${1:-}" = --after-restore ] || die "usage: sudo $0 --after-restore"
need_root
load_settings
run_bug_guard "$DATA_DIR/backups" "${BUG_GUARD_WAIT:-1200}"
