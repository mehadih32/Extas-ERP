#!/bin/sh
# Runs once, the first time the database starts with an empty data folder: makes
# the app's own database user. It owns the ERP database but is not a superuser,
# so the app cannot touch anything outside its own data.
set -eu

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  --set app_user="$APP_DB_USER" \
  --set app_password="$APP_DB_PASSWORD" \
  --set db_name="$POSTGRES_DB" <<'SQL'
CREATE ROLE :"app_user" LOGIN PASSWORD :'app_password';
ALTER DATABASE :"db_name" OWNER TO :"app_user";
ALTER SCHEMA public OWNER TO :"app_user";
SQL
