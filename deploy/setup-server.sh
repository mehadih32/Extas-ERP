#!/usr/bin/env bash
# Prepares a fresh Ubuntu 24.04 server for Extas ERP: system updates, Docker,
# automatic security updates, the firewall and a swap file. Safe to run again: a
# run cut off half-way is finished first. On a new VM it first waits for the
# server's own updates (cloud-init, automatic updates), which hold apt's lock.
#   sudo ./deploy/setup-server.sh
# shellcheck source=deploy/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

need_root
# shellcheck source=/dev/null
. /etc/os-release
[ "${ID:-}" = ubuntu ] || die "this script is for Ubuntu (24.04 LTS); this server runs ${PRETTY_NAME:-something else}."
export DEBIAN_FRONTEND=noninteractive
# Waits for apt's lock as well, should the automatic updates start again meanwhile.
apt_get() { apt-get -o DPkg::Lock::Timeout=900 "$@"; }

wait_for_apt ||
  die "the server's own updates did not finish in 30 minutes. Restart the VM in Azure, then run this again."
# An install cut off earlier (the VM restarted) is finished first, or nothing installs.
dpkg --configure -a || true

say "Updating the system"
apt_get update
apt_get -y upgrade
apt_get install -y ca-certificates curl git openssl python3 ufw unattended-upgrades

say "Installing Docker"
if ! command -v docker >/dev/null; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${UBUNTU_CODENAME:-$VERSION_CODENAME} stable" \
    >/etc/apt/sources.list.d/docker.list
  apt_get update
  apt_get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
systemctl enable --now docker
docker --version
docker compose version

say "Turning on automatic security updates"
cat >/etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
EOF
# An update that needs a restart gets it at 04:30 Bangladesh time, after the 02:00
# backup and the 03:30 housekeeping (the time is written in the server's own clock).
reboot_at="$(date -d 'TZ="Asia/Dhaka" 04:30' +%H:%M)"
cat >/etc/apt/apt.conf.d/52extras-erp-reboot <<EOF
Unattended-Upgrade::Automatic-Reboot "true";
Unattended-Upgrade::Automatic-Reboot-Time "$reboot_at";
EOF

say "Firewall: only SSH, HTTP and HTTPS come in"
ufw allow 22/tcp comment SSH
ufw allow 80/tcp comment HTTP
ufw allow 443/tcp comment HTTPS
ufw allow 443/udp comment HTTP/3
ufw --force enable
ufw status

say "Swap file (room for building the app on a small server)"
if [ -z "$(swapon --show --noheadings)" ]; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >>/etc/fstab
fi
swapon --show

if [ -n "${EXTAS_RESTORE:-}" ]; then
  # The restore (bootstrap.sh) goes on by itself: no next step to show.
  say "The server is ready."
else
  say "The server is ready. Next: sudo ./deploy/configure.sh"
fi
