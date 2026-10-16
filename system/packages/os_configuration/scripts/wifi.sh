#!/usr/bin/env bash
#
# Installs the check that keeps wpa_supplicant off on a machine without a wireless card: the
# script, the unit that runs it at every boot and the udev rule that runs it when a card appears.
# It runs the check once now. With --remove it takes them away and lets wpa_supplicant be.
#
#   sudo scripts/wifi.sh [--dry-run | --remove]

set -euo pipefail

here=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
readonly ROOT=${NAS_CONFIGURATION_ROOT:-}
readonly CHECK=$ROOT/usr/local/lib/nas-os-configuration/wifi.sh
readonly UNIT=$ROOT/etc/systemd/system/nas-os-wifi.service
readonly RULE=$ROOT/etc/udev/rules.d/80-nas-os-wifi.rules
readonly NAME=nas-os-wifi.service

fail() {
  printf 'error: %s\n' "$1" >&2
  exit 1
}

case ${1:-} in
  --dry-run)
    printf '[dry run] install %s, %s and %s, enable %s and run it\n' "$CHECK" "$UNIT" "$RULE" "$NAME"
    exit 0
    ;;
  --remove)
    [[ $EUID -eq 0 || -n $ROOT ]] || fail "it has to run as root: sudo $0"
    load=$(systemctl show "$NAME" --property=LoadState --value)
    if [[ $load != not-found ]]; then systemctl disable --now "$NAME"; fi
    rm -f -- "$UNIT" "$RULE" "$CHECK"
    # Shared with the base firewall: the last of the two to go removes it.
    rmdir "$(dirname "$CHECK")" 2>/dev/null || true
    systemctl unmask --runtime wpa_supplicant.service >/dev/null
    systemctl daemon-reload
    udevadm control --reload >/dev/null 2>&1 || true
    echo 'wireless check removed'
    exit 0
    ;;
  '') ;;
  *) fail "unknown option: $1" ;;
esac

[[ $EUID -eq 0 || -n $ROOT ]] || fail "it has to run as root: sudo $0"

install -d -m 0755 "$(dirname "$CHECK")" "$(dirname "$UNIT")" "$(dirname "$RULE")"
install -m 0755 "$here/files/wifi.sh" "$CHECK"
install -m 0644 "$here/files/nas-os-wifi.service" "$UNIT"
install -m 0644 "$here/files/80-nas-os-wifi.rules" "$RULE"
systemctl daemon-reload
udevadm control --reload >/dev/null 2>&1 || true
systemctl enable "$NAME"
systemctl restart "$NAME"
echo 'wireless check installed: wpa_supplicant runs only with a wireless card'
