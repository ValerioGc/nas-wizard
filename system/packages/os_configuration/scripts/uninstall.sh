#!/usr/bin/env bash
# Salva lo stato precedente al NAS e ripristina soltanto le configurazioni che il NAS modifica.
# --restore mantiene i pacchetti necessari al wizard; senza opzioni rimuove anche quelli aggiunti.
# La copia iniziale resta protetta in /var/lib/nas-os-configuration/original e non viene sovrascritta.
# --snapshot precede qualsiasi modifica; --check rifiuta ripristini senza una copia valida.
set -euo pipefail

readonly STATE=${NAS_CONFIGURATION_STATE:-/var/lib/nas-os-configuration}
readonly ROOT=${NAS_CONFIGURATION_ROOT:-}
readonly ORIGINAL=$STATE/original
readonly PATHS=(
  etc/hostname etc/hosts etc/machine-info etc/resolv.conf
  etc/network etc/NetworkManager etc/dhcpcd.conf etc/wpa_supplicant
  var/lib/NetworkManager var/lib/dhcpcd var/lib/dhcp
  etc/samba var/lib/samba/private/passdb.tdb var/lib/samba/private/secrets.tdb
  etc/clamav etc/systemd/system/clamav-freshclam.service.d
  etc/nas-os
)
readonly UNITS=(networking.service systemd-networkd.service systemd-resolved.service
  NetworkManager.service dhcpcd.service wpa_supplicant.service smbd.service nmbd.service
  clamav-freshclam.service)
readonly STORAGE_ROOTS=(srv/storage srv/nas-volumes)
readonly SHARED_DIRS=(etc/credstore.encrypted)
readonly PACKAGE_DATA=(var/lib/clamav var/log/clamav var/lib/samba var/cache/samba
  var/log/samba run/clamav run/samba)

fail() { printf 'error: %s\n' "$1" >&2; exit 1; }
packages() {
  dpkg-query -W -f='${binary:Package}\t${db:Status-Status}\n' |
    awk '$2 == "installed" { print $1 }' | LC_ALL=C sort -u
}
mounts() {
  findmnt -rn -o TARGET | while IFS= read -r target; do
    case $target in
      "$ROOT"/srv/storage|"$ROOT"/srv/storage/*|"$ROOT"/srv/nas-volumes|"$ROOT"/srv/nas-volumes/*)
        printf '%s\n' "$target" ;;
    esac
  done | LC_ALL=C sort -u
}
check_snapshot() {
  [[ -f $STATE/original-ready && -f $ORIGINAL/files.tar && -f $ORIGINAL/present &&
    -s $ORIGINAL/services && -s $ORIGINAL/packages && -f $ORIGINAL/auto && -f $ORIGINAL/users &&
    -f $ORIGINAL/groups && -f $ORIGINAL/mounts && -s $ORIGINAL/hostname ]] ||
    fail 'original system state is missing; an existing NAS cannot be treated as a fresh Debian installation'
  tar -tf "$ORIGINAL/files.tar" >/dev/null
  (cd "$ORIGINAL" && sha256sum --status -c checksums) || fail 'the original system backup is damaged'
}

snapshot() {
  if [[ -f $STATE/original-ready ]]; then check_snapshot; return; fi
  for unit in nas-wizard nas-os nas-os-base-firewall; do
    [[ ! -f $ROOT/etc/systemd/system/$unit.service ]] ||
      fail 'this NAS predates the system backup; recover the original configuration before upgrading or resetting'
  done
  [[ ! -s $STATE/packages ]] || fail 'system packages were already changed without an original system backup'
  install -d -m 0755 "$STATE"
  local staging path unit enabled active load
  staging=$(mktemp -d "$STATE/.original.XXXXXX")
  trap "rm -rf -- $(printf '%q' "$staging")" EXIT
  for path in "${PATHS[@]}"; do
    if [[ -e $ROOT/$path || -L $ROOT/$path ]]; then printf '%s\n' "$path"; fi
  done >"$staging/present"
  tar --acls --xattrs -C "${ROOT:-/}" -cpf "$staging/files.tar" -T "$staging/present"
  # Per dati dei pacchetti e mount salva solo la presenza e i metadati, senza copiarne i contenuti.
  for path in "${STORAGE_ROOTS[@]}" "${SHARED_DIRS[@]}" "${PACKAGE_DATA[@]}"; do
    if [[ -e $ROOT/$path || -L $ROOT/$path ]]; then
      tar --acls --xattrs --no-recursion -C "${ROOT:-/}" -rpf "$staging/files.tar" -- "$path"
      printf '%s\n' "$path" >>"$staging/present"
    fi
  done
  hostname >"$staging/hostname"
  packages >"$staging/packages"
  mounts >"$staging/mounts"
  getent passwd | cut -d: -f1 >"$staging/users"
  getent group | cut -d: -f1 >"$staging/groups"
  apt-mark showauto | LC_ALL=C sort -u >"$staging/auto"
  if [[ -r $ROOT/sys/class/rtc/rtc0/wakealarm ]]; then
    cat "$ROOT/sys/class/rtc/rtc0/wakealarm" >"$staging/wakealarm"
  fi
  for unit in "${UNITS[@]}"; do
    load=$(systemctl show "$unit" --property=LoadState --value)
    if [[ $load == not-found ]]; then enabled=not-found; active=inactive;
    else
      enabled=$(systemctl is-enabled "$unit" 2>/dev/null) || [[ -n $enabled ]]
      active=$(systemctl is-active "$unit") || [[ $active == inactive || $active == failed ]]
    fi
    printf '%s\t%s\t%s\n' "$unit" "$enabled" "$active"
  done >"$staging/services"
  (cd "$staging" && sha256sum files.tar present services packages auto hostname users groups mounts >checksums)
  if [[ -f $staging/wakealarm ]]; then (cd "$staging" && sha256sum wakealarm >>checksums); fi
  # La copia diventa disponibile solo dopo il completamento di tutti i salvataggi.
  rm -rf -- "$ORIGINAL"
  mv -- "$staging" "$ORIGINAL"
  chmod 0700 "$ORIGINAL"
  install -m 0644 /dev/null "$STATE/original-ready"
  trap - EXIT
}

restore_files() {
  local path
  local -a selected=("$@") present=()
  if ((${#selected[@]} == 0)); then selected=("${PATHS[@]}"); fi
  for path in "${selected[@]}"; do
    rm -rf -- "$ROOT/$path"
    if grep -qxF -- "$path" "$ORIGINAL/present"; then present+=("$path"); fi
  done
  if ((${#present[@]} > 0)); then
    tar --acls --xattrs -C "${ROOT:-/}" -xpf "$ORIGINAL/files.tar" -- "${present[@]}"
  fi
  local static=''
  if [[ -f $ROOT/etc/hostname ]]; then static=$(<"$ROOT/etc/hostname"); fi
  hostnamectl --static hostname "$static"
  hostnamectl --transient hostname "$(<"$ORIGINAL/hostname")"
  # hostnamectl può riscrivere il file: conserva anche contenuto e metadati originali.
  if grep -qxF etc/hostname "$ORIGINAL/present"; then
    tar --acls --xattrs -C "${ROOT:-/}" -xpf "$ORIGINAL/files.tar" -- etc/hostname
  else
    rm -f -- "$ROOT/etc/hostname"
  fi
}

stop_services() {
  local unit enabled active load
  while IFS=$'\t' read -r unit enabled active; do
    load=$(systemctl show "$unit" --property=LoadState --value)
    [[ $load == not-found ]] || systemctl stop "$unit"
  done <"$ORIGINAL/services"
}

restore_services() {
  local unit enabled active load
  systemctl daemon-reload
  while IFS=$'\t' read -r unit enabled active; do
    load=$(systemctl show "$unit" --property=LoadState --value)
    [[ $load != not-found ]] || continue
    systemctl unmask --runtime "$unit" >/dev/null
    systemctl unmask "$unit" >/dev/null
    case $enabled in
      enabled) systemctl enable "$unit" ;;
      enabled-runtime) systemctl enable --runtime "$unit" ;;
      disabled|not-found) systemctl disable "$unit" ;;
      masked|masked-runtime|static|indirect|generated|alias) ;;
      *) fail "unsupported original service state for $unit: $enabled" ;;
    esac
    if [[ $active == active ]]; then systemctl start "$unit"; fi
    case $enabled in
      masked) systemctl mask "$unit" ;;
      masked-runtime) systemctl mask --runtime "$unit" ;;
    esac
  done <"$ORIGINAL/services"
}

remove_packages() {
  local name simulation record=${1:-$STATE/packages}
  local -a added=() removed=()
  if [[ -s $record ]]; then
    mapfile -t added < <(LC_ALL=C sort -u "$record" |
      LC_ALL=C comm -23 - "$ORIGINAL/packages" |
      grep -E '^[a-z0-9][a-z0-9+.:~-]{0,200}$' | LC_ALL=C comm -12 - <(packages))
  fi
  if ((${#added[@]} > 0)); then
    simulation=$(apt-get -s purge -- "${added[@]}")
    mapfile -t removed < <(printf '%s\n' "$simulation" | awk '$1 == "Remv" || $1 == "Purg" { print $2 }')
    for name in "${removed[@]}"; do
      if awk -F: -v name="${name%%:*}" '$1 == name { found = 1 } END { exit !found }' "$ORIGINAL/packages"; then
        fail "removing NAS packages would remove pre-existing package $name"
      fi
    done
    DEBIAN_FRONTEND=noninteractive apt-get purge -q -y -o DPkg::Lock::Timeout=600 -- "${added[@]}"
  fi
  # Ripristina le marcature apt senza fare un autoremove globale.
  local -a auto=() manual=()
  mapfile -t auto < <(LC_ALL=C comm -12 "$ORIGINAL/auto" <(packages))
  mapfile -t manual < <(LC_ALL=C comm -23 "$ORIGINAL/packages" "$ORIGINAL/auto" |
    LC_ALL=C comm -12 - <(packages))
  ((${#auto[@]} == 0)) || apt-mark auto "${auto[@]}" >/dev/null
  ((${#manual[@]} == 0)) || apt-mark manual "${manual[@]}" >/dev/null
}

[[ $EUID -eq 0 || -n ${NAS_CONFIGURATION_STATE:-} ]] || fail 'run this script as root'
case ${1:-} in
  --snapshot) snapshot; exit 0 ;;
  --check) check_snapshot; exit 0 ;;
  --user-existed)
    check_snapshot
    if grep -qxF -- "${2:?missing user}" "$ORIGINAL/users"; then echo yes; else echo no; fi
    exit 0 ;;
  --group-existed)
    check_snapshot
    if grep -qxF -- "${2:?missing group}" "$ORIGINAL/groups"; then echo yes; else echo no; fi
    exit 0 ;;
  --remove-terminal-user)
    user=${2:-}
    [[ $user =~ ^[a-z_][a-z0-9_-]{0,31}$ ]] || fail 'invalid terminal user'
    # L'amministratore Debian nas non appartiene al wizard e non va mai rimosso.
    [[ $user != nas ]] || exit 0
    check_snapshot
    if grep -qxF -- "$user" "$ORIGINAL/users"; then exit 0; fi
    if entry=$(getent passwd "$user"); then
      [[ $(cut -d: -f5 <<<"$entry") == 'nas-os terminal' ]] || fail 'refusing to remove a user not created for the NAS terminal'
      pkill -KILL -u "$user" || [[ $? -eq 1 ]]
      if command -v pdbedit >/dev/null; then
        accounts=$(pdbedit -L)
        if grep -q "^$user:" <<<"$accounts"; then smbpasswd -x "$user"; fi
      fi
      userdel --remove "$user"
    fi
    exit 0 ;;
  --restore-hostname)
    check_snapshot
    restore_files etc/hostname etc/hosts etc/machine-info
    exit 0 ;;
  --remove-app-packages)
    check_snapshot
    record=${NAS_APP_PACKAGES_RECORD:-/var/lib/nas-os-app-packages/installed}
    remove_packages "$record"
    # Rimuove solo dipendenze aggiunte dal NAS che apt non considera più necessarie.
    simulation=$(apt-get -s autoremove)
    temporary=$(mktemp)
    trap 'rm -f -- "$temporary"' EXIT
    if [[ -f $STATE/packages ]]; then
      LC_ALL=C comm -12 <(LC_ALL=C sort -u "$STATE/packages") \
        <(printf '%s\n' "$simulation" | awk '$1 == "Remv" || $1 == "Purg" { print $2 }' | LC_ALL=C sort -u) >"$temporary"
    fi
    remove_packages "$temporary"
    rm -rf -- "$(dirname "$record")"
    exit 0 ;;
  --record-packages)
    [[ -f ${2:-} ]] || fail 'missing package inventory before installation'
    install -d -m 0755 "$STATE"
    LC_ALL=C comm -13 "$2" <(packages) >>"$STATE/packages"
    exit 0 ;;
  --dry-run) echo '[dry run] restore original system configuration and remove recorded NAS packages'; exit 0 ;;
  --restore|'') ;;
  *) fail "unknown option: $1" ;;
esac
check_snapshot
if [[ ${NAS_RESTORE_RECOVERY:-} != 1 ]]; then
  # Anche un purge fallito deve lasciare ripristinata la rete precedente.
  trap 'status=$?; if ((status != 0)); then NAS_RESTORE_RECOVERY=1 bash "$0" --restore || printf "error: recovery failed; original system backup retained in %s\n" "$ORIGINAL" >&2; fi' EXIT
fi
stop_services
if [[ ${1:-} != --restore ]]; then remove_packages; fi
current_mounts=$(mounts)
while IFS= read -r target; do
  [[ -n $target ]] || continue
  # Smonta soltanto i punti introdotti dal NAS, prima i figli. Non elimina file dai dischi.
  umount -- "$target"
  rmdir -- "$target" 2>/dev/null || true
done < <(LC_ALL=C comm -23 <(printf '%s\n' "$current_mounts") "$ORIGINAL/mounts" | LC_ALL=C sort -r)
for path in "${PACKAGE_DATA[@]}"; do
  if grep -qxF -- "$path" "$ORIGINAL/present"; then
    tar --acls --xattrs -C "${ROOT:-/}" -xpf "$ORIGINAL/files.tar" -- "$path"
  else
    # Rimuove dati e cache dei pacchetti solo se la directory non esisteva prima del NAS.
    rm -rf -- "$ROOT/$path"
  fi
done
for path in "${STORAGE_ROOTS[@]}" "${SHARED_DIRS[@]}"; do
  if grep -qxF -- "$path" "$ORIGINAL/present"; then
    tar --acls --xattrs -C "${ROOT:-/}" -xpf "$ORIGINAL/files.tar" -- "$path"
  else
    rmdir -- "$ROOT/$path" 2>/dev/null || true
  fi
done
restore_files
if [[ -f $ORIGINAL/wakealarm && -w $ROOT/sys/class/rtc/rtc0/wakealarm ]]; then
  printf '0\n' >"$ROOT/sys/class/rtc/rtc0/wakealarm"
  alarm=$(<"$ORIGINAL/wakealarm")
  if [[ $alarm =~ ^[0-9]+$ ]] && ((alarm > $(date +%s))); then
    printf '%s\n' "$alarm" >"$ROOT/sys/class/rtc/rtc0/wakealarm"
  fi
fi
restore_services
if [[ ${1:-} != --restore ]]; then
  for group in nas-storage nas-os-share-password nas-screen nas-os; do
    if ! grep -qxF -- "$group" "$ORIGINAL/groups" && getent group "$group" >/dev/null; then
      groupdel "$group"
    fi
  done
  rm -rf -- "$STATE"
fi
printf 'original hostname, hosts, network configuration and service state restored\n'
