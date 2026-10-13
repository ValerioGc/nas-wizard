#!/usr/bin/env bash
#
# Removes the Debian packages that scripts/system-packages.sh installed, and only those: the list
# it wrote in /var/lib/nas-os-configuration/packages says which. A package that was on the machine
# before is not in the list and stays. What they pulled in and nothing else needs goes with them.
#
#   sudo scripts/uninstall.sh [--dry-run]

set -euo pipefail

readonly STATE=${NAS_CONFIGURATION_STATE:-/var/lib/nas-os-configuration}

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

if [[ ! -s $STATE/packages ]]; then
  echo 'no system package was installed by the configuration: nothing to remove'
  exit 0
fi

# Only names of Debian packages, once each: the list is a file, and a file can be anything.
mapfile -t installed < <(grep -E '^[a-z0-9][a-z0-9+.-]{0,127}$' "$STATE/packages" | sort -u)

if $dry_run; then
  printf '[dry run] apt-get purge --autoremove %s\n' "${installed[*]}"
  exit 0
fi

if ((${#installed[@]} > 0)); then
  DEBIAN_FRONTEND=noninteractive apt-get purge -q -y --autoremove -- "${installed[@]}" ||
    fail "apt-get could not remove ${installed[*]}"
fi
rm -rf "$STATE"
printf 'removed: %s\n' "${installed[*]}"
