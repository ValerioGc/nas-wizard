#!/usr/bin/env bash
#
# Tells how the NAS is doing, from a console or over SSH. It only reads, it starts, stops and
# changes nothing. The installation copies it into ~/nas-tools of the person who ran the entry
# script with sudo, so it stays there even when an update breaks the files of the NAS.
#
#   ~/nas-tools/nas-status.sh                # services, answers, network, firewall, update
#   ~/nas-tools/nas-status.sh --logs [lines] # also the last lines of the log of each service
#   ~/nas-tools/nas-status.sh --full         # also the checks installed with the launcher and gateway
#   ~/nas-tools/nas-status.sh --save         # also writes all of it into ~/nas-report-<time>.txt
#
# With sudo it sees everything. Without it the firewall, the way out to the internet, the HTTPS
# port and part of the logs are skipped, and it says so.

set -uo pipefail

# Overridable so the script can be tested without a real NAS.
readonly STATE=${NAS_TOOLS_STATE:-/var/lib/nas-os}
readonly CONNECTION=${NAS_TOOLS_CONNECTION:-/var/lib/private/nas-os-gateway/gateway.connection}
readonly LAUNCHER_PORT=${NAS_TOOLS_LAUNCHER_PORT:-3000}
readonly GATEWAY_PORT=${NAS_TOOLS_GATEWAY_PORT:-80}
readonly PROBE_HOST=${NAS_TOOLS_PROBE_HOST:-api.github.com}
readonly LAUNCHER_CHECK=${NAS_TOOLS_LAUNCHER_CHECK:-/usr/local/lib/nas-os/check.sh}
readonly GATEWAY_CHECK=${NAS_TOOLS_GATEWAY_CHECK:-/usr/local/lib/nas-os-gateway/check.sh}
readonly SERVICE_USER=nas-os

readonly NAS_UNITS=(
  nas-os.service nas-os-gateway.service nas-os-base-firewall.service nas-os-firewall.service
  nas-os-storage-crypt.socket nas-os-terminal.socket nas-os-storage.timer nas-os-screen.service
  nas-os-wifi.service nas-wizard.service nas-os-update.service nas-os-update-verify.service
)
readonly DEBIAN_UNITS=(ssh.service NetworkManager.service polkit.service getty@tty1.service
  smbd.service)
readonly LOGGED_UNITS=(nas-os nas-os-gateway nas-os-base-firewall nas-os-update
  nas-os-update-verify nas-wizard)

usage() {
  printf 'usage: %s [--logs [lines]] [--full] [--save]\n' "${0##*/}" >&2
  exit 2
}

logs=0 full=false save=false
while (($# > 0)); do
  case $1 in
    --logs)
      logs=40
      if [[ ${2:-} =~ ^[0-9]+$ ]]; then
        logs=$2
        shift
      fi
      ;;
    --full) full=true ;;
    --save) save=true ;;
    *) usage ;;
  esac
  shift
done

root=false
((EUID == 0)) && root=true
problems=0

ok() { printf '  [ok]   %s\n' "$1"; }
no() {
  printf '  [KO]   %s\n' "$1"
  problems=$((problems + 1))
}
skip() { printf '  [--]   %s\n' "$1"; }
section() { printf '\n== %s\n' "$1"; }

answers() {
  timeout 5 bash -c 'exec 3<>"/dev/tcp/127.0.0.1/$1" || exit 1
    printf "GET /health HTTP/1.0\r\nHost: localhost\r\n\r\n" >&3
    head -n 1 <&3 | grep -q " 200 "' _ "$1" 2>/dev/null
}

listens() {
  timeout 5 bash -c 'exec 3<>"/dev/tcp/$1/$2"' _ "$1" "$2" 2>/dev/null
}

tls_port() {
  local port=''
  if [[ -r $CONNECTION ]]; then IFS= read -r port <"$CONNECTION"; fi
  [[ $port =~ ^[1-9][0-9]{0,4}$ ]] || port=443
  printf '%s' "$port"
}

unit_line() {
  local unit=$1 kind=$2 load active sub result since
  load=$(systemctl show -p LoadState --value "$unit" 2>/dev/null)
  if [[ $load != loaded ]]; then
    if [[ $kind == needed ]]; then no "$unit not installed"; else skip "$unit not installed"; fi
    return
  fi
  active=$(systemctl show -p ActiveState --value "$unit" 2>/dev/null)
  sub=$(systemctl show -p SubState --value "$unit" 2>/dev/null)
  result=$(systemctl show -p Result --value "$unit" 2>/dev/null)
  since=$(systemctl show -p StateChangeTimestamp --value "$unit" 2>/dev/null)
  local text="$unit $active ($sub)${since:+ since $since}"
  if [[ $active == failed || ($kind == needed && $active != active) ]]; then
    no "$text${result:+, result $result}"
  else
    ok "$text"
  fi
}

report() {
  printf 'NAS status on %s, %s\n' "$(hostname 2>/dev/null)" "$(date '+%F %T %z')"
  $root || printf 'Run it with sudo to see everything.\n'
  if systemctl is-active --quiet nas-wizard.service; then
    printf 'The wizard is running, the NAS is not configured yet and its services may be off.\n'
  fi

  section 'Services of the NAS'
  local unit
  for unit in "${NAS_UNITS[@]}"; do
    case $unit in
      nas-os.service | nas-os-gateway.service | nas-os-base-firewall.service) unit_line "$unit" needed ;;
      *) unit_line "$unit" optional ;;
    esac
  done

  section 'Services of Debian the NAS relies on'
  for unit in "${DEBIAN_UNITS[@]}"; do unit_line "$unit" optional; done

  section 'Applications'
  local apps
  apps=$(systemctl list-units --all --plain --no-legend 'nas-app@*.service' 2>/dev/null |
    awk '{ print "  " $1 " " $3 " (" $4 ")" }')
  if [[ -n $apps ]]; then printf '%s\n' "$apps"; else skip 'no application unit loaded'; fi

  section 'Failed units'
  local failed
  failed=$(systemctl list-units --failed --plain --no-legend 2>/dev/null | awk '{ print $1 }')
  if [[ -z $failed ]]; then
    ok 'no failed unit'
  else
    while IFS= read -r unit; do no "$unit failed (systemctl status $unit)"; done <<<"$failed"
  fi

  section 'Answers'
  if answers "$LAUNCHER_PORT"; then
    ok "the launcher answers on 127.0.0.1:$LAUNCHER_PORT"
  else
    no "the launcher does not answer on 127.0.0.1:$LAUNCHER_PORT"
  fi
  if answers "$GATEWAY_PORT"; then
    ok "the gateway answers on port $GATEWAY_PORT"
  else
    no "the gateway does not answer on port $GATEWAY_PORT"
  fi
  local port
  port=$(tls_port)
  if ! $root && [[ ! -r $CONNECTION ]]; then
    skip "the HTTPS port is read with sudo, trying the default $port"
  fi
  if listens 127.0.0.1 "$port"; then
    ok "the HTTPS port $port accepts connections"
  else
    no "nothing listens on the HTTPS port $port"
  fi

  section 'Network'
  if command -v ip >/dev/null; then
    local addresses
    addresses=$(ip -4 -o address show scope global 2>/dev/null | awk '{ print $2 " " $4 }')
    if [[ -n $addresses ]]; then
      while IFS= read -r line; do ok "address $line"; done <<<"$addresses"
    else
      no 'no interface has an IPv4 address'
    fi
    local route
    route=$(ip -4 route show default 2>/dev/null | head -n 1)
    if [[ -n $route ]]; then ok "default route ${route#default }"; else no 'no default route'; fi
  else
    skip 'ip is not installed'
  fi
  if getent hosts "$PROBE_HOST" >/dev/null 2>&1; then
    ok "$PROBE_HOST resolves"
  else
    no "$PROBE_HOST does not resolve, check the DNS"
  fi
  if $root && id -u "$SERVICE_USER" >/dev/null 2>&1; then
    if timeout 8 runuser -u "$SERVICE_USER" -- bash -c 'exec 3<>"/dev/tcp/$1/443"' _ \
      "$PROBE_HOST" 2>/dev/null; then
      ok "the launcher reaches $PROBE_HOST:443"
    else
      no "the launcher does not reach $PROBE_HOST:443, the updates cannot be checked"
    fi
  else
    skip 'the way out of the launcher is tried with sudo, the firewall lets only the NAS out'
  fi

  section 'Firewall'
  if ! $root; then
    skip 'the rules are read with sudo'
  elif ! command -v nft >/dev/null; then
    no 'nft is not installed'
  elif nft list table inet nas_base >/dev/null 2>&1; then
    ok 'the base firewall is loaded'
    if nft list set inet nas_base nas_https 2>/dev/null | grep -qw -- "$port"; then
      ok "the base firewall lets in the HTTPS port $port"
    else
      no "the base firewall does not let in the HTTPS port $port"
    fi
  else
    no 'the base firewall is not loaded, the NAS is not filtered'
  fi

  section 'Update'
  if [[ -r $STATE/launcher-update.status ]]; then
    skip "last status $(head -n 1 "$STATE/launcher-update.status")"
  else
    skip 'no update status, the launcher has already reported the last one'
  fi
  if [[ -e $STATE/update-verify/pending ]]; then
    skip 'a check after the update is pending, it runs at the next start'
    if $root; then sed 's/^/         /' "$STATE/update-verify/pending"; fi
    skip 'to turn it off, sudo systemctl disable nas-os-update-verify.service && sudo rm -rf '"$STATE"'/update-verify'
  elif [[ -d $STATE/update-verify ]] && ! $root; then
    skip 'the check after the update is read with sudo'
  else
    ok 'no check after an update is pending'
  fi
  if $root; then
    local backups
    backups=$(find "$STATE/backups" -maxdepth 1 -name '*.tar.gz' -printf '%f %s\n' 2>/dev/null |
      sort -r | head -n 3 | awk '{ printf "%s (%d MB)\n", $1, $2 / 1048576 }')
    if [[ -n $backups ]]; then
      while IFS= read -r line; do skip "backup $line"; done <<<"$backups"
    else
      skip 'no backup of an update'
    fi
  fi

  section 'Disk space'
  df -h / /var /usr/local 2>/dev/null | awk 'NR == 1 || !seen[$1]++' | sed 's/^/  /'

  section 'Errors in the log of this start'
  local units=() name
  for name in "${LOGGED_UNITS[@]}"; do units+=(-u "$name"); done
  local errors
  errors=$(journalctl -b -p err --no-pager -q -n 30 "${units[@]}" 2>/dev/null)
  if [[ -n $errors ]]; then
    printf '%s\n' "$errors" | sed 's/^/  /'
  elif $root; then
    ok 'no error'
  else
    skip 'no error readable without sudo'
  fi
  local previous
  previous=$(journalctl -b -1 -p err --no-pager -q -n 15 "${units[@]}" 2>/dev/null)
  if [[ -n $previous ]]; then
    printf '\n  Errors of the previous start\n'
    printf '%s\n' "$previous" | sed 's/^/  /'
  fi

  if ((logs > 0)); then
    for name in "${LOGGED_UNITS[@]}"; do
      section "Log of $name, last $logs lines"
      journalctl -b -u "$name" --no-pager -q -n "$logs" 2>/dev/null | sed 's/^/  /'
    done
  fi

  if $full; then
    local check
    for check in "$LAUNCHER_CHECK" "$GATEWAY_CHECK"; do
      section "$check"
      if [[ -x $check ]]; then
        "$check" 2>&1 | sed 's/^/  /'
      else
        no "$check is missing"
      fi
    done
  fi

  printf '\n'
  if ((problems == 0)); then
    printf 'Nothing wrong found.\n'
  else
    printf '%d problems found. To restart the services of the NAS, sudo ~/nas-tools/nas-restart.sh\n' \
      "$problems"
  fi
  ((problems == 0))
}

if ! $save; then
  report
  exit
fi

# The report goes into the home of the person who ran it, also through sudo.
home=''
if [[ -n ${SUDO_USER:-} ]]; then home=$(getent passwd "$SUDO_USER" | cut -d: -f6); fi
[[ -n $home && -d $home ]] || home=$HOME
file=$home/nas-report-$(date +%Y%m%d-%H%M%S).txt
(umask 077 && : >"$file") || {
  printf 'cannot write %s\n' "$file" >&2
  exit 1
}
report 2>&1 | tee -- "$file"
code=${PIPESTATUS[0]}
if $root && [[ -n ${SUDO_USER:-} ]]; then chown -- "$SUDO_USER:" "$file" 2>/dev/null; fi
printf 'Report written to %s\n' "$file"
exit "$code"
