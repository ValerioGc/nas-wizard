#!/usr/bin/env bash
#
# Installs the Debian packages the launcher relies on, only the ones that are missing, without what
# they recommend:
#
#   polkitd          grants the launcher its few actions: reboot, network, starting its own units
#   nftables         turns the list of allowed addresses into a filter in front of the whole NAS
#   network-manager  lists the wireless networks and joins one from the interface
#   wpasupplicant    joins a wireless network for NetworkManager (off without a wireless card)
#   wireless-regdb   the radio rules of the country, for the wireless cards
#   parted/e2fsprogs initialize empty data disks explicitly selected in nas-disk-manager
#   smartmontools    reads the health of the disks for nas-disk-manager
#   cryptsetup       encrypts the data disks with LUKS2 (already there on the encrypted system)
#
# NetworkManager leaves alone the interfaces already declared in /etc/network/interfaces, so a
# machine reached over SSH keeps its connection while it is installed.
#
# Packages and caches present before the NAS are never removed.
#
# What it installs is written down in /var/lib/nas-os-configuration/packages, so that
# scripts/uninstall.sh removes those and leaves alone the ones that were already there.
#
#   sudo scripts/system-packages.sh [--dry-run]

set -euo pipefail

readonly PACKAGES=(polkitd nftables network-manager wpasupplicant wireless-regdb parted e2fsprogs smartmontools cryptsetup)

# Overridable so the script can be tested without root and without writing into /var/lib.
readonly STATE=${NAS_CONFIGURATION_STATE:-/var/lib/nas-os-configuration}
readonly ROOT=${NAS_CONFIGURATION_ROOT:-}

readonly LOCK_WAIT=(-o DPkg::Lock::Timeout=600)

fail() {
  printf 'error: %s\n' "$1" >&2
  exit 1
}

dry_run=false
case ${1:-} in
  --dry-run) dry_run=true ;;
  '') ;;
  *) fail "unknown option: $1" ;;
esac

$dry_run || [[ $EUID -eq 0 || -n ${NAS_CONFIGURATION_STATE:-} ]] || fail "it has to run as root: sudo $0"

installed() {
  dpkg-query -W -f='${Status}' "$1" 2>/dev/null | grep -q 'install ok installed'
}

missing=()
for package in "${PACKAGES[@]}"; do
  installed "$package" || missing+=("$package")
done
if $dry_run; then
  if ((${#missing[@]} == 0)); then
    printf 'system packages already installed: %s\n' "${PACKAGES[*]}"
  else
    printf '[dry run] apt-get install --no-install-recommends %s\n' "${missing[*]}"
  fi
  exit 0
fi

export DEBIAN_FRONTEND=noninteractive
before=$(mktemp)
trap 'rm -f -- "$before"' EXIT
dpkg-query -W -f='${binary:Package}\t${db:Status-Status}\n' |
  awk '$2 == "installed" { print $1 }' | LC_ALL=C sort -u >"$before"
record_packages() {
  local status=$?
  "$(dirname -- "${BASH_SOURCE[0]}")/uninstall.sh" --record-packages "$before" || status=1
  rm -f -- "$before"
  exit "$status"
}
trap record_packages EXIT

if ((${#missing[@]} == 0)); then
  printf 'system packages already installed: %s\n' "${PACKAGES[*]}"
else
  apt-get update -q -o APT::Update::Error-Mode=any "${LOCK_WAIT[@]}" || fail 'the package index could not be refreshed'
  install -d -m 0755 "$STATE"
  printf '%s\n' "${missing[@]}" >>"$STATE/packages"
  apt-get install -q -y --no-install-recommends "${LOCK_WAIT[@]}" -- "${missing[@]}" ||
    fail "apt-get could not install ${missing[*]}"
  printf 'installed: %s\n' "${missing[*]}"
fi

if [[ ! -f $ROOT/etc/NetworkManager/NetworkManager.conf ]]; then
  install -d -m 0755 "$ROOT/etc/NetworkManager"
  cat >"$ROOT/etc/NetworkManager/NetworkManager.conf" <<'CONFIG'
[main]
plugins=ifupdown,keyfile

[ifupdown]
managed=false
CONFIG
fi
systemctl enable --now NetworkManager.service
