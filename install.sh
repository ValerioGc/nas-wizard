#!/usr/bin/env bash
#
# The entry of the NAS: run once, as root, from the unpacked package of the wizard on a Debian 13
# just installed. Everything else happens from the browser.
#
#   sudo ./install.sh
#   ./install.sh --dry-run        # prints what it would do, without doing it
#   sudo ./install.sh --update    # the update of a configured NAS, run by the launcher
#
# In order: it checks the machine, runs what comes before the wizard (packages/pre_wizard: the
# configuration of the operating system), looks for a newer wizard and, when there is one, runs
# that one instead. Then it installs the wizard on the machine (/usr/local/lib/nas-wizard, with
# what runs after it and the configuration of the system) and starts it as the unit nas-wizard on port 80, so a closed SSH session or a
# reboot does not stop it, and follows it until it hands the NAS over to the gateway. The unit
# stays, disabled, once the NAS is configured: the factory reset of the launcher starts it again.
# At its end the wizard empties this folder but for uninstall.sh, and puts the manuals in the home
# of the user it creates.
# It asks nothing: the token of the private releases is given in the wizard, which runs what comes
# after it (packages/post_wizard) with that token.
#
# With --update the NAS is already configured: the launcher runs it from a newer package, when it
# updates the NAS or before its factory reset. It configures the operating system again, which is
# idempotent and brings the changes of the release (the firewall, for one), and puts the new wizard
# in place, but neither looks for a newer wizard nor starts it: the unit keeps the state it had.

set -euo pipefail

here=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
readonly UNIT=nas-wizard
readonly PORT=${NAS_WIZARD_PORT:-80}
readonly WIZARD=$here/wizard/bin/nas-wizard
readonly UPDATES=${NAS_WIZARD_UPDATES:-/var/lib/nas-wizard-updates}
# Where the wizard lives on the machine, independent of this folder, and its unit.
readonly INSTALLED=${NAS_WIZARD_HOME:-/usr/local/lib/nas-wizard}
readonly UNIT_FILE=${NAS_WIZARD_UNIT_FILE:-/etc/systemd/system/$UNIT.service}
readonly OS_RELEASE=${NAS_OS_RELEASE:-/etc/os-release}
# The watcher of the monitor, installed by the configuration of the system on a machine with a
# video output: it runs the wizard installed here.
readonly SCREEN_UNIT=nas-os-screen.service
readonly SCREEN_UNIT_FILE=${NAS_SCREEN_UNIT_FILE:-/etc/systemd/system/$SCREEN_UNIT}
# packages/ in the release package, system/packages/ in the repository it is built from.
packages=$here/packages
[[ -d $packages ]] || packages=$here/system/packages
readonly packages

say() { printf '\n== %s\n' "$1"; }
fail() {
  printf 'error: %s\n' "$1" >&2
  exit 1
}

dry_run=false
update=false
for option in "$@"; do
  case $option in
    --dry-run) dry_run=true ;;
    --update) update=true ;;
    *) fail "unknown option: $option" ;;
  esac
done

$dry_run || [[ $EUID -eq 0 ]] || fail "it has to run as root: sudo $0"
[[ -x $WIZARD ]] || $dry_run || fail "$WIZARD is missing: run this script from the unpacked package"
command -v systemctl >/dev/null || fail 'systemd is not available on this machine'
# shellcheck disable=SC1090
version=$(. "$OS_RELEASE" 2>/dev/null && printf '%s %s' "${ID:-}" "${VERSION_ID:-}") || version=''
[[ $version == 'debian 13' ]] || fail "this NAS runs on Debian 13, not on '${version:-an unknown system}'"
$dry_run && printf '\nDry run: no change will be applied.\n'

if $dry_run; then
  "$packages/pre_wizard/install.sh" --dry-run
else
  "$packages/pre_wizard/install.sh"
fi

say "Version of the wizard"
# Without a token, which the user gives only in the wizard: a private repository answers that it
# has no release, and the wizard of this package goes on.
if $update; then
  echo "   no search for a newer one: the launcher chose this wizard"
elif $dry_run; then
  echo "   [dry run] $WIZARD self-update --into $UPDATES"
elif [[ -n ${NAS_WIZARD_UPDATED:-} ]]; then
  echo "   $("$WIZARD" --version), just downloaded"
else
  set +e
  newer=$("$WIZARD" self-update --into "$UPDATES")
  outcome=$?
  set -e
  case $outcome in
    0)
      echo "   a newer wizard is out: running $newer/install.sh"
      exec env NAS_WIZARD_UPDATED=1 NAS_WIZARD_ORIGIN="$here" bash "$newer/install.sh"
      ;;
    3) echo "   $("$WIZARD" --version) is the latest" ;;
    *) echo "   warning: the latest version could not be read, going on with this one" ;;
  esac
fi

say "Wizard"
# NAS_WIZARD_PACKAGE: the folder the user unpacked, which the script after the wizard empties at
# its end, the first one when a newer wizard runs in its place; it falls back to $INSTALLED once
# this folder is gone. An update runs from a folder the launcher removes right after: the wizard's
# own one is named.
package=${NAS_WIZARD_ORIGIN:-$here}
$update && package=$INSTALLED
unit() {
  cat <<UNIT
[Unit]
Description=nas-os wizard, the first configuration of the NAS
Wants=network-online.target
After=network-online.target

[Service]
Type=simple
ExecStart=$INSTALLED/wizard/bin/nas-wizard
StateDirectory=nas-wizard
Environment=WIZARD_MODE=real
Environment=WIZARD_ADDRESS=0.0.0.0
Environment=WIZARD_PORT=$PORT
Environment=WIZARD_SCREEN_PORT=8081
Environment=WIZARD_UI_DIR=$INSTALLED/wizard/ui
Environment="NAS_WIZARD_PACKAGE=$package"

[Install]
WantedBy=multi-user.target
UNIT
}
if $dry_run; then
  echo "   [dry run] install the wizard in $INSTALLED, write $UNIT_FILE and start $UNIT:"
  unit | sed 's/^/     /'
  exit 0
fi
load=$(systemctl show "$UNIT" --property=LoadState --value)
if [[ $load != not-found ]]; then systemctl stop "$UNIT"; fi
# The binary, the interface and the script after the wizard, laid out as in this package: the
# wizard finds the script three folders above its binary. The configuration of the system too, for
# the uninstall.sh that stays alone in this folder once the wizard is done.
install -d -m 0755 "$(dirname "$INSTALLED")"
staging=$(mktemp -d "$(dirname "$INSTALLED")/.nas-wizard.XXXXXX")
chmod 0755 "$staging"
trap 'rm -rf -- "$staging"' EXIT
install -d -m 0755 "$staging/packages"
cp -a "$here/wizard" "$staging/wizard"
cp -a "$packages/post_wizard" "$staging/packages/post_wizard"
cp -a "$packages/os_configuration" "$staging/packages/os_configuration"
for manual in "$here"/nas_os_installation_manual_*.pdf; do
  [[ -f $manual ]] && install -m 0644 "$manual" "$staging/"
done
[[ -x $staging/wizard/bin/nas-wizard ]] || fail 'the new wizard has no executable binary'
previous=$INSTALLED.previous
[[ ! -e $previous ]] || fail "previous installation still exists: $previous"
if [[ -e $INSTALLED ]]; then mv -- "$INSTALLED" "$previous"; fi
if ! mv -- "$staging" "$INSTALLED"; then
  if [[ -e $previous ]]; then mv -- "$previous" "$INSTALLED"; fi
  fail 'the new wizard could not be installed; the previous installation was retained'
fi
trap - EXIT
rm -rf -- "$previous"
unit >"$UNIT_FILE"
chmod 0644 "$UNIT_FILE"
systemctl daemon-reload
# The screen of a monitor connected to the NAS runs this program, when it was turned on: with the
# new one from now on.
if [[ -f $SCREEN_UNIT_FILE ]] && systemctl is-enabled --quiet "$SCREEN_UNIT"; then
  systemctl restart "$SCREEN_UNIT"
fi
if $update; then
  echo "   the wizard $("$INSTALLED/wizard/bin/nas-wizard" --version) is installed in $INSTALLED"
  exit 0
fi
# Enabled until the handover, which disables it: a reboot in the middle finds the wizard again.
systemctl enable --quiet "$UNIT"
# Reinstallation may find an old gateway still holding port 80. The wizard owns it until handover.
if systemctl is-active --quiet nas-os-gateway; then
  systemctl stop nas-os-gateway
fi
systemctl start "$UNIT"

address=$(hostname -I 2>/dev/null | awk '{print $1}') || address=''
port_suffix=''
[[ $PORT == 80 ]] || port_suffix=:$PORT
cat <<EOF

   Configuration page http://${address:-<address of this machine>}${port_suffix}/setup, from a browser on the same network.
   Wizard installed in $INSTALLED. At the end this folder keeps only uninstall.sh.
   Closing this terminal does not stop the wizard.

EOF

journalctl --unit="$UNIT" --follow --output=cat --lines=0 &
follower=$!
trap 'kill "$follower" 2>/dev/null || true' EXIT
while systemctl is-active --quiet "$UNIT"; do
  sleep 2
done

# An old gateway still running does not prove this wizard completed successfully.
result=$(systemctl show "$UNIT" --property=Result --value)
status=$(systemctl show "$UNIT" --property=ExecMainStatus --value)
if [[ $result != success || $status != 0 ]]; then
  journalctl --unit="$UNIT" --output=cat --lines=40 --no-pager >&2
  fail "the wizard failed ($result, exit $status), the NAS is not configured"
fi

say "Done"
if systemctl is-active --quiet nas-os-gateway; then
  echo "   NAS configured, available at http://${address:-<address of this machine>}/"
else
  if [[ -f $here/install.sh ]]; then
    echo "   the wizard ended before the handover, running this script again restarts it"
  else
    echo "   the wizard ended before the handover, sudo systemctl start $UNIT restarts it"
  fi
  exit 1
fi
