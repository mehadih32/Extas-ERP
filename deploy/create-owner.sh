#!/usr/bin/env bash
# Creates the platform owner's account and the companies from SEED_ADMIN_EMAIL,
# SEED_ADMIN_NAME and SEED_COMPANIES in deploy/.env. Each company gets its
# built-in roles, chart of accounts, warehouse, sizes, expense and cost heads and
# HR rules. A new owner gets a temporary password, shown once, to change at the
# first sign-in. Safe to run again: it only adds what is missing.
#   sudo ./deploy/create-owner.sh
# shellcheck source=deploy/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

need_root
load_settings
email="$(setting SEED_ADMIN_EMAIL)"
[ -n "$email" ] || die "set SEED_ADMIN_EMAIL in deploy/.env first."
[ -n "$(compose ps -q app 2>/dev/null)" ] || die "Extras ERP is not installed yet: run sudo ./deploy/deploy.sh first."

say "Setting up the owner account ($email) and the companies"
compose run --rm \
  -e SEED_ADMIN_EMAIL="$email" \
  -e SEED_ADMIN_NAME="$(setting SEED_ADMIN_NAME Owner)" \
  -e SEED_COMPANIES="$(setting SEED_COMPANIES 'Extras,Fabric Apparel')" \
  migrate npx prisma db seed
