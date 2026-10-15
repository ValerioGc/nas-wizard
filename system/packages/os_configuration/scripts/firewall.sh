#!/usr/bin/env bash
#
# Installs the base firewall and loads it now and at every boot. With --remove it unloads it and
# takes it away.
#
#   sudo scripts/firewall.sh [--dry-run | --remove]

set -euo pipefail

here=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
readonly ROOT=${NAS_CONFIGURATION_ROOT:-}
readonly LOADER=$ROOT/usr/local/lib/nas-os-configuration/base-firewall.sh
readonly UNIT=$ROOT/etc/systemd/system/nas-os-base-firewall.service
readonly NAME=nas-os-base-firewall.service

fail() {
  printf 'error: %s\n' "$1" >&2
  exit 1
}

case ${1:-} in
  --dry-run)
    printf '[dry run] install %s and %s, then enable and start %s\n' "$LOADER" "$UNIT" "$NAME"
    exit 0
    ;;
  --remove)
    [[ $EUID -eq 0 || -n $ROOT ]] || fail "it has to run as root: sudo $0"
    if command -v nft >/dev/null; then
      tables=$(nft list tables) || fail 'cannot inspect nftables rules'
      for table in nas_launcher nas_base; do
        if grep -qxF "table inet $table" <<<"$tables"; then
          nft delete table inet "$table" || fail "cannot remove $table"
        fi
      done
    elif [[ -e $UNIT || -e $LOADER ]]; then
      fail 'nft is missing: removal of the installed NAS firewall cannot be verified'
    fi
    load=$(systemctl show "$NAME" --property=LoadState --value)
    if [[ $load != not-found ]]; then
      systemctl disable --now "$NAME" || fail 'cannot stop the base firewall'
    fi
    rm -f "$UNIT" "$LOADER"
    rmdir "$(dirname "$LOADER")" 2>/dev/null || true
    systemctl daemon-reload
    echo 'base firewall removed'
    exit 0
    ;;
  '') ;;
  *) fail "unknown option: $1" ;;
esac

[[ $EUID -eq 0 || -n $ROOT ]] || fail "it has to run as root: sudo $0"

install -d -m 0755 "$(dirname "$LOADER")" "$(dirname "$UNIT")"
install -m 0755 "$here/files/base-firewall.sh" "$LOADER"
install -m 0644 "$here/files/nas-os-base-firewall.service" "$UNIT"
systemctl daemon-reload
systemctl enable "$NAME"
systemctl restart "$NAME"
echo 'base firewall loaded and enabled at boot'
