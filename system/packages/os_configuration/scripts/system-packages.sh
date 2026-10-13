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
#
# NetworkManager leaves alone the interfaces already declared in /etc/network/interfaces, so a
# machine reached over SSH keeps its connection while it is installed.
#
# Then it purges what a NAS has no use for (ModemManager, for mobile modems, BlueZ, for Bluetooth,
# and cron, whose work the timers of systemd do on Debian 13), each only when nothing else goes
# with it: a desktop that relies on one keeps it. cron stays as well while it has work of its own:
# a crontab of a user, or a job in /etc/cron.* that no package installed. It ends with the packages
# nothing needs any more and the downloaded archives.
#
# What it installs is written down in /var/lib/nas-os-configuration/packages, so that
# scripts/uninstall.sh removes those and leaves alone the ones that were already there.
#
#   sudo scripts/system-packages.sh [--dry-run]

set -euo pipefail

readonly PACKAGES=(polkitd nftables network-manager wpasupplicant wireless-regdb parted e2fsprogs smartmontools)
readonly UNNEEDED=(modemmanager bluez cron)
# Overridable so the script can be tested without root and without writing into /var/lib.
readonly STATE=${NAS_CONFIGURATION_STATE:-/var/lib/nas-os-configuration}
# Where the jobs of cron are, under / on the machine.
readonly CRON_ROOT=${NAS_CRON_ROOT:-}
# A Debian just installed often runs apt-daily at its first boot: wait for its lock.
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
# Whether cron has work nobody would expect to vanish with it: a crontab of a user, or a job in
# /etc/cron.d or /etc/cron.<period> that no package installed.
cron_in_use() {
  local job
  compgen -G "$CRON_ROOT/var/spool/cron/crontabs/*" >/dev/null && return 0
  for job in "$CRON_ROOT"/etc/cron.d/* "$CRON_ROOT"/etc/cron.{hourly,daily,weekly,monthly}/*; do
    [[ -f $job && ${job##*/} != .placeholder ]] || continue
    dpkg-query -S "${job#"$CRON_ROOT"}" >/dev/null 2>&1 || return 0
  done
  return 1
}

present=()
kept_cron=false
for package in "${UNNEEDED[@]}"; do
  installed "$package" || continue
  if [[ $package == cron ]] && cron_in_use; then
    kept_cron=true
    continue
  fi
  present+=("$package")
done
$kept_cron && echo 'kept cron: it has jobs of its own (a crontab, or a job no package installed)'

if $dry_run; then
  if ((${#missing[@]} == 0)); then
    printf 'system packages already installed: %s\n' "${PACKAGES[*]}"
  else
    printf '[dry run] apt-get install --no-install-recommends %s\n' "${missing[*]}"
  fi
  ((${#present[@]} == 0)) || printf '[dry run] apt-get purge %s\n' "${present[*]}"
  echo '[dry run] apt-get autoremove --purge, apt-get clean'
  exit 0
fi

export DEBIAN_FRONTEND=noninteractive

if ((${#missing[@]} == 0)); then
  printf 'system packages already installed: %s\n' "${PACKAGES[*]}"
else
  apt-get update -q "${LOCK_WAIT[@]}" || fail 'the package index could not be refreshed'
  apt-get install -q -y --no-install-recommends "${LOCK_WAIT[@]}" -- "${missing[@]}" ||
    fail "apt-get could not install ${missing[*]}"
  install -d -m 0755 "$STATE"
  printf '%s\n' "${missing[@]}" >>"$STATE/packages"
  printf 'installed: %s\n' "${missing[*]}"
fi

# What apt would take away with each of them: that package alone, or it stays.
removable=()
kept=()
for package in "${present[@]}"; do
  # A simulation apt refuses keeps the package, as one that would take others away.
  taken=$(apt-get -s purge -q -- "$package" | awk '$1 == "Purg" { print $2 }') || taken=''
  if [[ $taken == "$package" ]]; then
    removable+=("$package")
  else
    kept+=("$package")
  fi
done
((${#kept[@]} == 0)) ||
  printf 'kept %s: removing them would take away other packages too\n' "${kept[*]}"
if ((${#removable[@]} > 0)); then
  apt-get purge -q -y "${LOCK_WAIT[@]}" -- "${removable[@]}" ||
    fail "apt-get could not remove ${removable[*]}"
  printf 'removed, a NAS has no use for them: %s\n' "${removable[*]}"
fi

# A clean-up that does not happen leaves the NAS as it was: a warning, not a failure.
apt-get autoremove --purge -q -y "${LOCK_WAIT[@]}" ||
  echo 'warning: the packages nothing needs any more could not be removed'
apt-get clean || echo 'warning: the downloaded archives could not be removed'
