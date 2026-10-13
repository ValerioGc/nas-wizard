#!/usr/bin/env bash
#
# Prepares Debian for the NAS, before the wizard installs the gateway and the launcher. It installs
# the system packages the launcher relies on, the check that keeps wpa_supplicant off without a
# wireless card, the screen for a monitor connected to the NAS (on a machine with a video output),
# then the base firewall, which learns the user of the screen. The entry script of the wizard
# package runs it first.
#
#   sudo ./install.sh
#   ./install.sh --dry-run      # prints what it would do, without doing it

set -euo pipefail

here=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
"$here/scripts/system-packages.sh" "$@"
"$here/scripts/wifi.sh" "$@"
"$here/scripts/screen.sh" "$@"
"$here/scripts/firewall.sh" "$@"
