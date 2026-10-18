#!/usr/bin/env bash
#
# The end of the installation. Once the launcher is installed and configured, the manuals go to the
# home of the user the wizard created, and the package the NAS was installed from is emptied. Only
# uninstall.sh stays in its folder, which takes the configuration of the system from the installed
# wizard from then on; the archive the package came from, beside the folder, goes too, and so does
# a newer wizard the entry script downloaded. post_wizard/install.sh runs it as root, last.
#
#   sudo ./clean-package.sh --user <name> --package <folder> --installed <folder> --work <directory>
#
# The folder is emptied only when it is an unpacked package (its install.sh, its packages/ with
# uninstall.sh and its wizard/), never the installed wizard. Nothing here fails the installation:
# what it cannot do it says, and leaves as it is.

set -euo pipefail

# Overridable so the script can be tested without writing into a real home or into /var/lib.
readonly UPDATES=${NAS_WIZARD_UPDATES:-/var/lib/nas-wizard-updates}
readonly USER_HOME=${NAS_PACKAGE_USER_HOME:-}

fail() {
  printf 'error: %s\n' "$1" >&2
  exit 2
}
warn() { printf 'warning: %s\n' "$1"; }

user='' package='' installed='' work=''
while (($# > 0)); do
  case $1 in
    --user | --package | --installed | --work)
      (($# >= 2)) || fail "$1 needs a value"
      declare "${1#--}=$2"
      shift 2
      ;;
    *) fail "unknown option: $1" ;;
  esac
done
[[ $user =~ ^[a-z_][a-z0-9_-]{0,31}$ ]] || fail "not a user name: ${user:-<empty>}"
[[ -n $package && -n $installed && -n $work ]] || fail '--package, --installed and --work name a folder each'

hand_over() {
  local kind=$1 home=$2
  shift 2
  local manual
  for manual in "$@"; do
    [[ -f $manual ]] || continue
    rm -f -- "$home"/nas_os_"$kind"_manual_*.pdf
    if install -m 0644 -- "$manual" "$home/" && chown -- "$user:" "$home/${manual##*/}"; then
      echo "manual copied: $home/${manual##*/}"
    else
      warn "${manual##*/} could not be copied into $home"
    fi
  done
}

home=$USER_HOME
[[ -n $home ]] || home=$(getent passwd "$user" | cut -d: -f6) || home=''
if [[ -n $home && -d $home ]]; then
  hand_over installation "$home" "$installed"/nas_os_installation_manual_*.pdf
  hand_over user "$home" "$work"/ui/nas_os_user_manual_*.pdf
else
  warn "$user has no home: the installation manual stays in $installed"
fi

rm -rf -- "$UPDATES" || warn "$UPDATES could not be removed"

folder=$(realpath -e -- "$package" 2>/dev/null) || folder=''
target=$(realpath -m -- "$installed")
if [[ -z $folder || $folder == / || $folder == "$target" || ! -f $folder/install.sh ||
  ! -f $folder/packages/uninstall.sh || ! -d $folder/wizard ]]; then
  echo "no unpacked package to empty: ${folder:-$package}"
  exit 0
fi
if ! install -m 0755 -- "$folder/packages/uninstall.sh" "$folder/uninstall.sh"; then
  warn "uninstall.sh could not be kept: $folder stays as it is"
  exit 0
fi
chown --reference="$folder" -- "$folder/uninstall.sh" || true
find "$folder" -mindepth 1 -maxdepth 1 ! -name uninstall.sh -exec rm -rf -- {} + ||
  warn "$folder could not be emptied"
parent=${folder%/*}
rm -f -- "${parent:-}"/nas-wizard-*-linux-x64.tar.gz "${parent:-}"/nas-wizard-*-linux-x64.tar.gz.sha256 ||
  warn "the archive of the package could not be removed"
echo "package emptied: $folder keeps only uninstall.sh"
