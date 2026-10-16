#!/usr/bin/env bash
#
# Takes the machine back to where it was before nas-os: the inverse, in reverse order, of what the
# wizard did. It removes the token of the private releases, the launcher and the gateway with their
# units, permissions and data, through the removal scripts their installations left on the machine,
# then the base firewall and the Debian packages the OS configuration installed, only those, not
# the ones that were already there, and last the wizard installed on the machine.
#
# It is the only file the wizard leaves in the unpacked package once the NAS is configured: then it
# takes the configuration of the system from the installed wizard, which it removes after it.
#
#   sudo ./uninstall.sh          # asks to type 'delete' first
#   sudo ./uninstall.sh --yes    # without asking

set -euo pipefail

here=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
# Where the installations of the launcher and of the gateway leave their tools.
readonly LAUNCHER_TOOLS=${NAS_LAUNCHER_TOOLS:-/usr/local/lib/nas-os}
readonly GATEWAY_TOOLS=${NAS_GATEWAY_TOOLS:-/usr/local/lib/nas-os-gateway}
readonly WIZARD_STATE=/var/lib/nas-wizard
# Where the entry script installs the wizard, and its unit.
readonly WIZARD_HOME=${NAS_WIZARD_HOME:-/usr/local/lib/nas-wizard}
readonly WIZARD_UNIT=${NAS_WIZARD_UNIT_FILE:-/etc/systemd/system/nas-wizard.service}
# Where the entry script unpacks a newer wizard it found.
readonly WIZARD_UPDATES=/var/lib/nas-wizard-updates
# The configuration of the system: the one of this package, or the copy of the installed wizard.
configuration=$here/os_configuration
[[ -d $configuration ]] || configuration=$WIZARD_HOME/packages/os_configuration
readonly configuration

say() { printf '\n== %s\n' "$1"; }
fail() {
  printf 'error: %s\n' "$1" >&2
  exit 1
}

confirmed=false
case ${1:-} in
  --yes) confirmed=true ;;
  '') ;;
  *) fail "unknown option: $1" ;;
esac

[[ $EUID -eq 0 ]] || fail "it has to run as root: sudo $0"
[[ -d $configuration ]] || fail "the configuration of the system is missing: $configuration"
"$configuration/scripts/uninstall.sh" --check

if ! $confirmed; then
  cat <<'TEXT'
This removes from the machine:
  - the token of the private releases
  - the launcher and the gateway, their units and their permissions
  - the database, the account, the catalogue, the backups, the installed applications and their data
  - the wizard installed on the machine and its unit
  - the screen for a monitor connected to the NAS
  - the base firewall, the wireless check and the Debian packages the OS configuration installed
TEXT
  read -r -p "Type 'delete' to confirm: " answer
  [[ $answer == delete ]] || fail 'cancelled: nothing was removed'
fi

busy=$(systemctl list-units --plain --no-legend --state=active,activating,deactivating,reloading \
  'nas-os-reset.service' 'nas-os-update.service' 'nas-os-apt@*.service' 'nas-os-app-packages@*.service' \
  'nas-os-storage-initialize.service' 'nas-os-storage-rename.service' 'nas-os-storage-eject.service' \
  'nas-os-storage-crypt@*.service')
[[ -z $busy ]] || fail 'wait for NAS reset, updates, package installation or disk operations before uninstalling'

say "Stop NAS services"
for unit in nas-os.service nas-os-gateway.service nas-wizard.service nas-os-storage.timer; do
  load=$(systemctl show "$unit" --property=LoadState --value)
  if [[ $load != not-found ]]; then systemctl disable --now "$unit"; fi
done
for unit in nas-os-firewall.service nas-os-smb-shares.service nas-os-sync-ports.service nas-os-discovery.service; do
  load=$(systemctl show "$unit" --property=LoadState --value)
  if [[ $load != not-found ]]; then systemctl stop "$unit"; fi
done

say "Base firewall"
# Before any purge, while nft is still there.
"$configuration/scripts/firewall.sh" --remove

say "Token"
rm -f /etc/credstore.encrypted/nas-os.launcher-token
rmdir /etc/credstore.encrypted 2>/dev/null || true

say "Launcher"
if [[ -x $LAUNCHER_TOOLS/uninstall.sh ]]; then
  "$LAUNCHER_TOOLS/uninstall.sh" --purge <<<'delete'
else
  echo "   not installed"
fi

say "Gateway"
if [[ -x $GATEWAY_TOOLS/uninstall.sh ]]; then
  "$GATEWAY_TOOLS/uninstall.sh" --purge <<<'delete'
else
  echo "   not installed"
fi

say "Screen"
# Before the wizard: its program is the one that watches the monitor.
"$configuration/scripts/screen.sh" --remove

say "Wireless check"
"$configuration/scripts/wifi.sh" --remove

say "System packages"
"$configuration/scripts/uninstall.sh"

say "Wizard"
# Last: the configuration of the system above may be its copy.
systemctl disable --now nas-wizard.service 2>/dev/null || true
rm -f -- "$WIZARD_UNIT"
systemctl daemon-reload
rm -rf -- "$WIZARD_HOME" "$WIZARD_HOME.previous" "$WIZARD_STATE" "$WIZARD_UPDATES"
echo "   the wizard, its unit and what it downloaded are gone"

say "Done"
echo "   the machine is back where it was before nas-os"
