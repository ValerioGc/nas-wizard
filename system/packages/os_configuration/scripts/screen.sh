#!/usr/bin/env bash
#
# Prepares the screen of the NAS: the interface on a monitor connected to it, through cog with no
# display server, only while a monitor is connected and in use. It stays off until it is turned on
# with `systemctl enable --now nas-os-screen.service`. A machine with no video output gets nothing.
# With --remove it takes the screen away; cog goes with the other packages.
#
#   sudo scripts/screen.sh [--dry-run | --remove]
#
# It installs cog without what it recommends, but with the OpenGL ES library WebKit draws with,
# records them beside the other packages of the configuration so scripts/uninstall.sh removes them,
# creates the user nas-screen the browser runs as (the video, input and render groups, no password,
# no shell), the PAM service of its session and the two units: nas-os-screen.service, left
# disabled, and nas-os-screen-browser.service, which it starts and stops. The base firewall, loaded after this, opens the port of the screen to nas-screen
# only.

set -euo pipefail

here=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
readonly ROOT=${NAS_CONFIGURATION_ROOT:-}
readonly STATE=${NAS_CONFIGURATION_STATE:-/var/lib/nas-os-configuration}
readonly OUTPUTS=${NAS_CONFIGURATION_DRM:-/sys/class/drm}
readonly USER_NAME=nas-screen
readonly PACKAGES=(cog libgles2)
readonly WATCHER=nas-os-screen.service
readonly BROWSER=nas-os-screen-browser.service
readonly UNITS=$ROOT/etc/systemd/system
readonly PAM=$ROOT/etc/pam.d/nas-os-screen
# Another apt may hold the lock of dpkg (apt-daily at the first boot): wait for it.
readonly LOCK_WAIT=(-o DPkg::Lock::Timeout=600)

fail() {
  printf 'error: %s\n' "$1" >&2
  exit 1
}

remove() {
  systemctl disable --now "$WATCHER" "$BROWSER" >/dev/null 2>&1 || true
  rm -f -- "$UNITS/$WATCHER" "$UNITS/$BROWSER" "$PAM"
  systemctl daemon-reload
  if [[ -z $ROOT ]] && id -u "$USER_NAME" >/dev/null 2>&1; then
    userdel "$USER_NAME"
  fi
  echo 'screen removed'
}

dry_run=false
case ${1:-} in
  --dry-run) dry_run=true ;;
  --remove)
    [[ $EUID -eq 0 || -n $ROOT ]] || fail "it has to run as root: sudo $0"
    remove
    exit 0
    ;;
  '') ;;
  *) fail "unknown option: $1" ;;
esac

shopt -s nullglob
cards=("$OUTPUTS"/card[0-9])
shopt -u nullglob
if ((${#cards[@]} == 0)); then
  echo 'no video output on this machine: no screen'
  exit 0
fi

missing=()
for package in "${PACKAGES[@]}"; do
  dpkg-query -W -f='${Status}' "$package" 2>/dev/null | grep -q 'install ok installed' ||
    missing+=("$package")
done

if $dry_run; then
  ((${#missing[@]} == 0)) || printf '[dry run] apt-get install --no-install-recommends %s\n' "${missing[*]}"
  printf '[dry run] create %s, install %s and %s, both off\n' "$USER_NAME" "$WATCHER" "$BROWSER"
  exit 0
fi

[[ $EUID -eq 0 || -n $ROOT ]] || fail "it has to run as root: sudo $0"

if ((${#missing[@]} > 0)); then
  export DEBIAN_FRONTEND=noninteractive
  apt-get install -q -y --no-install-recommends "${LOCK_WAIT[@]}" -- "${missing[@]}" ||
    fail "apt-get could not install ${missing[*]}"
  apt-get clean || echo 'warning: the downloaded archives could not be removed'
  install -d -m 0755 "$STATE"
  printf '%s\n' "${missing[@]}" >>"$STATE/packages"
fi

if [[ -z $ROOT ]] && ! id -u "$USER_NAME" >/dev/null 2>&1; then
  groups=()
  for group in video input render; do
    getent group "$group" >/dev/null && groups+=("$group")
  done
  useradd --system --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin \
    ${groups[@]:+--groups "$(IFS=,; echo "${groups[*]}")"} "$USER_NAME"
fi

install -d -m 0755 "$UNITS" "$(dirname "$PAM")"
install -m 0644 "$here/files/screen/$WATCHER" "$UNITS/$WATCHER"
install -m 0644 "$here/files/screen/$BROWSER" "$UNITS/$BROWSER"
install -m 0644 "$here/files/screen/nas-os-screen.pam" "$PAM"
systemctl daemon-reload
echo "screen installed and off: sudo systemctl enable --now $WATCHER turns it on"
