#!/usr/bin/env bash
# Puts Extas's Google client for Google Drive backups on this server: the one OAuth
# client of the type "TVs and Limited Input devices" that an Extas maintainer made
# once in Extas's Google Cloud project (deploy/README.md, "Google Drive backups:
# the Extas client"). It goes in deploy/.env as GOOGLE_DRIVE_CLIENT_ID and
# GOOGLE_DRIVE_CLIENT_SECRET, asked with hidden typing: never on a command line, in
# a log or on the screen. The ERP then restarts with it, and the copy of the settings
# the backups carry is locked again. The owner then presses Connect Google Drive on
# Settings > Backups; nobody opens Google Cloud.
#
# The restore guide prints this same client for a new server, and the one restore
# command puts it back in deploy/.env by itself: nothing to do after a restore.
#   sudo ./deploy/set-google-client.sh
# shellcheck source=deploy/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

# Google's client IDs and secrets are letters, digits, "-" and "_" (and the ID ends in
# .apps.googleusercontent.com), so nothing else ever reaches deploy/.env.
valid_client_id() { [[ "$1" =~ ^[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$ ]]; }
valid_client_secret() { [[ ${#1} -ge 10 && ${#1} -le 200 && "$1" =~ ^[A-Za-z0-9_-]+$ ]]; }

# Writes the two settings into deploy/.env (replacing earlier ones), keeping its
# other lines, its owner and its mode. Shell built-ins only: the values never become
# a program's arguments. It runs in a subshell, so the new file is made readable only
# by root from its first byte (umask), and is removed if anything stops it.
write_google_client() (
  local id="$1" secret="$2" new="$ENV_FILE.new" line
  umask 077
  trap 'rm -f "$new"' EXIT
  rm -f "$new"
  {
    while IFS= read -r line || [ -n "$line" ]; do
      case "$line" in
        GOOGLE_DRIVE_CLIENT_ID=* | GOOGLE_DRIVE_CLIENT_SECRET=*) ;;
        *) printf '%s\n' "$line" ;;
      esac
    done <"$ENV_FILE"
    printf 'GOOGLE_DRIVE_CLIENT_ID=%s\n' "$id"
    printf 'GOOGLE_DRIVE_CLIENT_SECRET=%s\n' "$secret"
  } >"$new"
  chown --reference="$ENV_FILE" "$new"
  chmod --reference="$ENV_FILE" "$new"
  mv -f "$new" "$ENV_FILE"
)

ask_hidden() {
  local answer
  flush_keys
  IFS= read -r -s -p "$1" answer </dev/tty
  printf '\n' >/dev/tty
  printf '%s' "${answer//[[:space:]]/}"
}

main() {
  need_root
  load_settings
  [ -t 0 ] || die "run this in a terminal: it asks for the Google client ID and secret."
  take_update_lock

  say "Extas's Google client for Google Drive backups"
  echo "Paste each one with a right-click and press Enter. Nothing shows while you paste: that is normal."
  local id secret earlier answer
  id="$(ask_hidden "Google client ID (it ends in .apps.googleusercontent.com): ")"
  valid_client_id "$id" || die "that is not a Google client ID: it ends in .apps.googleusercontent.com. Nothing was changed."
  echo "Got the client ID (${#id} characters, ending in ...${id: -30})."
  secret="$(ask_hidden "Google client secret: ")"
  valid_client_secret "$secret" || die "that is not a Google client secret (letters, digits, - and _ only). Nothing was changed."
  echo "Got the client secret (${#secret} characters)."

  earlier="$(setting GOOGLE_DRIVE_CLIENT_ID)"
  if [ -n "$earlier" ] && [ "$earlier" != "$id" ]; then
    echo "This server already has another Google client (ending in ...${earlier: -30})."
    echo "If Google Drive is connected with it, the Backups screen then asks to Reconnect Google Drive."
    flush_keys
    read -r -p "Type yes to replace it: " answer </dev/tty
    [ "$answer" = yes ] || die "nothing was changed."
  fi

  write_google_client "$id" "$secret"
  say "Saved in deploy/.env. Restarting the ERP with it"
  compose up -d --no-deps app >/dev/null
  wait_healthy app || die "the ERP did not come back healthy: see sudo ./deploy/logs.sh app"
  if ! lock_settings; then
    echo "Note: the copy of the settings in the backups is locked again at the next update."
  fi
  say "Done. On Settings > Backups, press Connect Google Drive (Reconnect if it asks)."
  echo "If that screen says the Google client is (your own), the owner set one there: it is used instead of this one."
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  main "$@"
fi
