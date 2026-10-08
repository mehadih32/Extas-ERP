#!/usr/bin/env bash
# Lets GitHub update the ERP by itself after every merge into main. Run it once,
# after the first install, signed in as the account you use on the server (for
# example erpadmin):
#   sudo ./deploy/setup-auto-deploy.sh
# It makes a key for GitHub that can do one thing only: run auto-deploy.sh. It
# cannot open a shell, copy files or reach anything else. It prints what to put
# in the repository's secrets on GitHub, then deletes the private half from the
# server. Run it again to replace the key; the old one stops working.
# shellcheck source=deploy/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

KEY_NAME=extras-erp-auto-deploy

main() {
  need_root
  load_settings

  local user="${SUDO_USER:-}"
  if [ -z "$user" ] || [ "$user" = root ]; then
    die "run it with sudo from the account you sign in with (for example erpadmin), not as root."
  fi
  local group home
  group="$(id -gn "$user")"
  home="$(getent passwd "$user" | cut -d: -f6)"

  # GitHub's machines change address, so SSH has to accept them; it must then
  # accept keys only.
  local sshd_settings
  sshd_settings="$(sshd -T 2>/dev/null || true)"
  if grep -Eqi '^(passwordauthentication|kbdinteractiveauthentication) yes$' <<<"$sshd_settings"; then
    die "this server still accepts passwords over SSH. Turn them off first. If you sign in with a key file (.pem), run:
  printf 'PasswordAuthentication no\\nKbdInteractiveAuthentication no\\n' | sudo tee /etc/ssh/sshd_config.d/00-keys-only.conf && sudo systemctl restart ssh
If you sign in with a password, that would lock you out: set up a key first."
  fi

  local tmp
  tmp="$(mktemp -d)"
  # shellcheck disable=SC2064  # $tmp is fixed now
  trap "rm -rf '$tmp'" EXIT

  say "Making GitHub's key"
  ssh-keygen -q -t ed25519 -N "" -C "$KEY_NAME" -f "$tmp/key"

  say "Letting the key run auto-deploy.sh, and nothing else"
  local ssh_dir="$home/.ssh" auth="$home/.ssh/authorized_keys"
  install -d -m 700 -o "$user" -g "$group" "$ssh_dir"
  touch "$auth"
  {
    grep -v " $KEY_NAME\$" "$auth" || true
    printf 'restrict,command="/usr/bin/sudo -n %s/auto-deploy.sh" %s\n' "$DEPLOY_DIR" "$(cat "$tmp/key.pub")"
  } >"$tmp/authorized_keys"
  install -m 600 -o "$user" -g "$group" "$tmp/authorized_keys" "$auth.new"
  mv "$auth.new" "$auth"

  printf '# Lets the key from deploy/setup-auto-deploy.sh run the update.\n%s ALL=(root) NOPASSWD: %s/auto-deploy.sh\n' \
    "$user" "$DEPLOY_DIR" >"$tmp/sudoers"
  visudo -cqf "$tmp/sudoers" || die "the sudo rule did not check out; nothing was added to sudo."
  install -m 440 -o root -g root "$tmp/sudoers" /etc/sudoers.d/extras-erp-auto-deploy

  local host_key
  host_key="$(cut -d' ' -f1,2 /etc/ssh/ssh_host_ed25519_key.pub)"

  cat <<EOF

==> Done. Add these on GitHub: the repository's Settings, then Secrets and variables,
    then Actions, then "New repository secret", once for each.

USERNAME
$user

SSH_HOST_KEY
$host_key

SSH_PRIVATE_KEY (all of it, from the BEGIN line to the END line)
$(cat "$tmp/key")

SERVER_IP
The server's public IP address, the one you sign in to it with.

The private key is now deleted from this server; GitHub keeps the only copy.
EOF
}

main "$@"
