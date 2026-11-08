#!/usr/bin/env bash
#
# Restarts the services of the NAS when the interface stops answering, then checks that they
# answer again. It touches only units of the NAS, never SSH, the consoles, the network or a unit
# of Debian, so the console and the SSH session it runs from keep working.
#
#   sudo ~/nas-tools/nas-restart.sh              # the launcher and the gateway
#   sudo ~/nas-tools/nas-restart.sh --apps       # also the applications that are running
#   sudo ~/nas-tools/nas-restart.sh --firewall   # also loads the base firewall again, atomically
#   sudo ~/nas-tools/nas-restart.sh --force      # even while an update or its check is running
#
# While an update runs, a restart would make its check fail and put the previous version back. While
# the wizard runs, the gateway would take its port. In both cases it refuses unless --force is given.

set -uo pipefail

# Overridable so the script can be tested without a real NAS.
readonly STATE=${NAS_TOOLS_STATE:-/var/lib/nas-os}
readonly LAUNCHER_PORT=${NAS_TOOLS_LAUNCHER_PORT:-3000}
readonly GATEWAY_PORT=${NAS_TOOLS_GATEWAY_PORT:-80}
readonly TRIES=${NAS_TOOLS_TRIES:-30}
readonly PAUSE=${NAS_TOOLS_PAUSE:-2}

usage() {
  printf 'usage: sudo %s [--apps] [--firewall] [--force]\n' "${0##*/}" >&2
  exit 2
}

apps=false firewall=false force=false
for option in "$@"; do
  case $option in
    --apps) apps=true ;;
    --firewall) firewall=true ;;
    --force) force=true ;;
    *) usage ;;
  esac
done

if ((EUID != 0)) && [[ -z ${NAS_TOOLS_STATE:-} ]]; then
  printf 'it has to run as root, sudo %s\n' "$0" >&2
  exit 1
fi

installed() {
  [[ $(systemctl show -p LoadState --value "$1" 2>/dev/null) == loaded ]]
}

answers() {
  timeout 5 bash -c 'exec 3<>"/dev/tcp/127.0.0.1/$1" || exit 1
    printf "GET /health HTTP/1.0\r\nHost: localhost\r\n\r\n" >&3
    head -n 1 <&3 | grep -q " 200 "' _ "$1" 2>/dev/null
}

wait_for() {
  local try
  for ((try = 0; try < TRIES; try++)); do
    answers "$1" && return 0
    sleep "$PAUSE"
  done
  return 1
}

if ! $force; then
  if systemctl is-active --quiet nas-wizard.service; then
    printf 'the wizard is configuring the NAS, finish it in the browser or add --force\n' >&2
    exit 1
  fi
  if systemctl is-active --quiet nas-os-update.service ||
    systemctl is-active --quiet nas-os-update-verify.service; then
    printf 'an update of the NAS is running, wait for it to end or add --force\n' >&2
    exit 1
  fi
  if [[ -e $STATE/update-verify/pending ]]; then
    printf 'an update waits for its check after the restart, add --force to restart anyway\n' >&2
    exit 1
  fi
fi

units=()
for unit in nas-os.service nas-os-gateway.service; do
  installed "$unit" && units+=("$unit")
done
((${#units[@]} > 0)) || {
  printf 'neither the launcher nor the gateway is installed\n' >&2
  exit 1
}

if $firewall; then
  if systemctl is-active --quiet nas-os-base-firewall.service; then
    if systemctl reload nas-os-base-firewall.service; then
      echo 'base firewall loaded again'
    else
      echo 'the base firewall could not be loaded again, the rules in place stay' >&2
    fi
  else
    echo 'the base firewall is not active, start it with sudo systemctl start nas-os-base-firewall' >&2
  fi
fi

systemctl reset-failed "${units[@]}" 2>/dev/null
echo "restarting ${units[*]}"
systemctl restart "${units[@]}" || echo 'systemd reported an error, checking the answers' >&2

if $apps; then
  running=$(systemctl list-units --state=active --plain --no-legend 'nas-app@*.service' 2>/dev/null |
    awk '{ print $1 }')
  if [[ -n $running ]]; then
    mapfile -t running_apps <<<"$running"
    echo "restarting ${running_apps[*]}"
    systemctl restart "${running_apps[@]}" || echo 'an application did not restart' >&2
  else
    echo 'no application is running'
  fi
fi

problems=0
if installed nas-os.service; then
  if wait_for "$LAUNCHER_PORT"; then
    echo '  [ok]   the launcher answers'
  else
    echo '  [KO]   the launcher does not answer'
    problems=$((problems + 1))
  fi
fi
if installed nas-os-gateway.service; then
  if wait_for "$GATEWAY_PORT"; then
    echo '  [ok]   the gateway answers'
  else
    echo '  [KO]   the gateway does not answer'
    problems=$((problems + 1))
  fi
fi

if ((problems > 0)); then
  printf 'The NAS does not answer yet. See why with sudo ~/nas-tools/nas-status.sh --logs\n' >&2
  exit 1
fi
echo 'The NAS answers again.'
