#!/usr/bin/env bash
#
# Puts the console tools of the NAS (tools/) into ~/nas-tools of a person, and takes them away again.
# The entry script runs it for the person who ran it with sudo, who is the one who logs in over SSH
# or at the console. It is a copy of its own, so an update or a broken install of the NAS never
# touches it. Each folder it fills is written down, so the removal of the NAS takes away only those
# files and nothing else the person keeps there.
#
#   sudo ./tools.sh --install <user>
#   sudo ./tools.sh --remove
#
# Nothing here fails the installation or the removal, what it cannot do it says.

set -euo pipefail

# Overridable so the script can be tested without writing into a real home or into /var/lib.
readonly RECORD=${NAS_TOOLS_RECORD:-/var/lib/nas-os-configuration/nas-tools}
readonly HOME_OVERRIDE=${NAS_TOOLS_HOME:-}
SOURCE=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/tools
readonly SOURCE
readonly FILES=(nas-status.sh nas-restart.sh README.txt)

warn() { printf 'warning: %s\n' "$1"; }
fail() {
  printf 'error: %s\n' "$1" >&2
  exit 2
}

install_tools() {
  local user=$1 home target file mode
  [[ $user =~ ^[a-z_][a-z0-9_-]{0,31}$ ]] || fail "not a user name: ${user:-<empty>}"
  home=$HOME_OVERRIDE
  [[ -n $home ]] || home=$(getent passwd "$user" | cut -d: -f6) || home=''
  if [[ -z $home || ! -d $home || -L $home ]]; then
    warn "$user has no home, the tools stay in $SOURCE"
    return 0
  fi
  target=$home/nas-tools
  if [[ -L $target ]] || ! mkdir -p -- "$target" || ! chown -- "$user:" "$target"; then
    warn "the tools could not be copied into $target"
    return 0
  fi
  for file in "${FILES[@]}"; do
    [[ -f $SOURCE/$file ]] || continue
    if [[ $file == *.sh ]]; then mode=0755; else mode=0644; fi
    if install -m "$mode" -- "$SOURCE/$file" "$target/$file" && chown -- "$user:" "$target/$file"; then
      echo "tool copied: $target/$file"
    else
      warn "$file could not be copied into $target"
    fi
  done
  mkdir -p -- "$(dirname -- "$RECORD")"
  touch -- "$RECORD"
  grep -qxF -- "$target" "$RECORD" || printf '%s\n' "$target" >>"$RECORD"
}

remove_tools() {
  local target file
  [[ -f $RECORD ]] || {
    echo 'no console tools to remove'
    return 0
  }
  while IFS= read -r target; do
    [[ $target == /*/nas-tools && $target != *..* && -d $target && ! -L $target ]] || continue
    for file in "${FILES[@]}"; do
      rm -f -- "$target/$file"
    done
    if rmdir -- "$target" 2>/dev/null; then
      echo "tools removed: $target"
    else
      echo "tools removed, $target keeps the other files there"
    fi
  done <"$RECORD"
  rm -f -- "$RECORD"
}

case ${1:-} in
  --install)
    (($# == 2)) || fail 'usage: tools.sh --install <user>'
    install_tools "$2"
    ;;
  --remove) remove_tools ;;
  *) fail 'usage: tools.sh --install <user> | --remove' ;;
esac
