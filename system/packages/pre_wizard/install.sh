#!/usr/bin/env bash
# Prepares Debian for the NAS. The entry script of the package runs it first,
# as root, before it starts the wizard. Nothing here asks for anything, the token included, which
# the user gives in the wizard.
#
#   sudo ./install.sh
#   ./install.sh --dry-run        # prints what it would do, without doing it
#
# Today that is the configuration of the operating system (../os_configuration). The system
# packages the NAS relies on, then the base firewall. What the machine needs before the wizard,
# such as cleaning up or removing packages, goes here too, as a step of its own.

set -euo pipefail

here=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)

case ${1:-} in
  --dry-run | '') ;;
  *)
    printf 'error: unknown option: %s\n' "$1" >&2
    exit 2
    ;;
esac

say() { printf '\n== %s\n' "$1"; }

say "Operating system"
"$here/../os_configuration/install.sh" "$@"
