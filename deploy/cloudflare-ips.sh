#!/usr/bin/env bash
# Cloudflare's proxy addresses, for Caddy and the ERP (v6.4.1 B2). Behind the
# orange cloud every visitor reaches the server from one of them: Caddy takes
# the visitor's own address (CF-Connecting-IP) only from those, and the ERP
# never blocks or slows down one of them as if it were one visitor. Cloudflare
# changes the list now and then, so this fetches it from Cloudflare
# (https://www.cloudflare.com/ips-v4 and /ips-v6) into DATA_DIR/caddy/cloudflare:
#   ips.txt         the ranges, one per line (the ERP reads it)
#   trusted.caddy   the same for Caddy ("trusted_proxies static ...")
# Only a sound list is ever written; when a fetch fails or brings something
# else, the last good list stays, and before the first one the copy that came
# with the ERP (deploy/cloudflare-ips.txt) stands in.
#   sudo ./deploy/cloudflare-ips.sh           fetch now; Caddy reads a changed list
#   sudo ./deploy/cloudflare-ips.sh --setup   (deploy.sh) the daily cron line, then fetch
# shellcheck source=deploy/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

# Where the lists come from (tests use local files).
CLOUDFLARE_IPS_BASE="${CLOUDFLARE_IPS_BASE:-https://www.cloudflare.com}"

# Whether the last update_cloudflare_ips wrote a new list.
CLOUDFLARE_IPS_CHANGED=0

# One of Cloudflare's lists (v4 or v6), its ranges one per line; fails when it
# cannot be fetched or is not a sound list (a line that is not a range, a range
# wider than /8 or /16, or too few of them).
fetch_cloudflare_list() {
  local kind="$1" body line out="" count=0 octet ok
  body="$(curl -fsS --max-time 20 --retry 2 --retry-delay 3 "$CLOUDFLARE_IPS_BASE/ips-$kind" 2>/dev/null)" ||
    return 1
  while IFS= read -r line; do
    line="${line//$'\r'/}"
    line="${line#"${line%%[![:space:]]*}"}"
    line="${line%"${line##*[![:space:]]}"}"
    [ -n "$line" ] || continue
    if [ "$kind" = v4 ]; then
      [[ "$line" =~ ^([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})/([0-9]{1,2})$ ]] || return 1
      ok=1
      for octet in "${BASH_REMATCH[@]:1:4}"; do [ "$((10#$octet))" -le 255 ] || ok=0; done
      [ "$ok" = 1 ] && [ "$((10#${BASH_REMATCH[5]}))" -ge 8 ] && [ "$((10#${BASH_REMATCH[5]}))" -le 32 ] ||
        return 1
    else
      [[ "$line" =~ ^[0-9a-fA-F:]*:[0-9a-fA-F:]*/([0-9]{1,3})$ ]] || return 1
      [ "$((10#${BASH_REMATCH[1]}))" -ge 16 ] && [ "$((10#${BASH_REMATCH[1]}))" -le 128 ] || return 1
    fi
    out+="$line"$'\n'
    count=$((count + 1))
  done <<<"$body"
  if [ "$kind" = v4 ]; then [ "$count" -ge 5 ] || return 1; else [ "$count" -ge 3 ] || return 1; fi
  [ "$count" -le 200 ] || return 1
  printf '%s' "$out"
}

# Writes the list into the folder (only when it changed), as the ERP and Caddy read it.
write_cloudflare_files() {
  local dir="$1" list="$2"
  if [ -f "$dir/trusted.caddy" ] && [ "$list" = "$(cat "$dir/ips.txt" 2>/dev/null)" ]; then
    return 0
  fi
  printf '%s\n' "$list" >"$dir/ips.txt.new"
  {
    printf "# Cloudflare's proxy addresses (deploy/cloudflare-ips.sh, %s): only these may name a visitor.\n" \
      "$(date -u +%Y-%m-%d)"
    printf 'trusted_proxies static %s\n' "$(tr '\n' ' ' <<<"$list" | sed 's/ *$//')"
  } >"$dir/trusted.caddy.new"
  chmod 644 "$dir/ips.txt.new" "$dir/trusted.caddy.new"
  mv -f "$dir/ips.txt.new" "$dir/ips.txt"
  mv -f "$dir/trusted.caddy.new" "$dir/trusted.caddy"
  CLOUDFLARE_IPS_CHANGED=1
}

# Fetches both lists into the folder; keeps the last good one when it cannot.
update_cloudflare_ips() {
  local dir="$1" fallback="${2:-$DEPLOY_DIR/cloudflare-ips.txt}" v4 v6 list
  CLOUDFLARE_IPS_CHANGED=0
  mkdir -p "$dir"
  if v4="$(fetch_cloudflare_list v4)" && v6="$(fetch_cloudflare_list v6)"; then
    list="$v4"$'\n'"$v6"
  elif [ -s "$dir/ips.txt" ]; then
    say "Cloudflare's address list could not be fetched; the last one fetched stays"
    list="$(cat "$dir/ips.txt")"
  else
    say "Cloudflare's address list could not be fetched; the copy that came with the ERP stands in until it can"
    list="$(sed -e 's/#.*$//' -e 's/[[:space:]]//g' -e '/^$/d' "$fallback")"
  fi
  write_cloudflare_files "$dir" "${list%$'\n'}"
}

# Once a day, at a quiet hour (it only reads from Cloudflare), in the cron file given.
install_cloudflare_cron() {
  local file="$1"
  cat >"$file" <<EOF
# Extas ERP (deploy.sh): Cloudflare's proxy addresses, for Caddy and the ERP.
29 5 * * * root $DEPLOY_DIR/cloudflare-ips.sh >/dev/null 2>&1
EOF
  chmod 644 "$file"
}

main() {
  need_root
  load_settings
  local dir="$DATA_DIR/caddy/cloudflare"
  case "${1:-}" in
    --setup)
      install_cloudflare_cron /etc/cron.d/extras-erp-cloudflare-ips
      # deploy.sh starts or reloads Caddy afterwards; it reads the list then.
      update_cloudflare_ips "$dir"
      ;;
    "")
      update_cloudflare_ips "$dir"
      if [ "$CLOUDFLARE_IPS_CHANGED" = 1 ]; then
        say "Cloudflare's address list changed"
        if [ -n "$(compose ps -q caddy 2>/dev/null)" ]; then
          compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1 ||
            say "Caddy kept its earlier list; see sudo ./deploy/logs.sh caddy"
        fi
      fi
      ;;
    *) die "unknown option $1" ;;
  esac
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then main "$@"; fi
