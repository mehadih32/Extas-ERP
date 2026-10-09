#!/usr/bin/env bash
# Prepares a fresh Ubuntu 24.04 server for Extas ERP: system updates, Docker,
# automatic security updates, the firewall and a swap file. Safe to run again.
#   sudo ./deploy/setup-server.sh
# shellcheck source=deploy/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

need_root
# shellcheck source=/dev/null
. /etc/os-release
[ "${ID:-}" = ubuntu ] || die "this script is for Ubuntu (24.04 LTS); this server runs ${PRETTY_NAME:-something else}."
export DEBIAN_FRONTEND=noninteractive

say "Updating the system"
apt-get update
apt-get -y upgrade
apt-get install -y ca-certificates curl git openssl python3 ufw unattended-upgrades

say "Installing Docker"
if ! command -v docker >/dev/null; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${UBUNTU_CODENAME:-$VERSION_CODENAME} stable" \
    >/etc/apt/sources.list.d/docker.list
  apt-get update
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
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

say "The server is ready. Next: sudo ./deploy/configure.sh"
