#!/usr/bin/env bash
#
# Checks that the machine keeps the data of the NAS for itself when a disk is taken away: the root
# filesystem on LUKS, /etc and /var/lib on an encrypted disk too (the keys of the data disks will
# live there, and a folder on another unencrypted partition would leave them readable), every swap
# encrypted, and a TPM 2.0 on the board or in the CPU. It changes nothing.
#
#   check-security.sh                          # exits 1 when something is missing
#   check-security.sh --warn-only              # says what is missing and exits 3, 0 when nothing is
#   check-security.sh --warn-only --state FILE # also writes system= and tpm= in FILE
#
# The entry script runs it with --warn-only before it changes anything on the machine: a system
# that is not encrypted is a choice of the person, explained in the installation manual, and the
# NAS installs anyway. The state file tells the launcher, which warns once and has the app Dischi
# say what an automatic key is worth on that machine.

set -euo pipefail

readonly TPM_CLASS=${NAS_TPM_CLASS:-/sys/class/tpm}

warn_only=false
state=''
while (($#)); do
  case $1 in
    --warn-only) warn_only=true ;;
    --state)
      [[ -n ${2:-} ]] || { printf 'error: --state wants a file\n' >&2; exit 2; }
      state=$2
      shift
      ;;
    *)
      printf 'error: unknown option: %s\n' "$1" >&2
      exit 2
      ;;
  esac
  shift
done

# Whether a block device lies on a LUKS container
on_luks() {
  lsblk --inverse --noheadings --raw --output FSTYPE -- "$1" 2>/dev/null | grep -x crypto_LUKS >/dev/null
}

# Whether the filesystem that holds a path is on LUKS. A btrfs source names its subvolume in brackets after the device.
encrypted() {
  local source
  source=$(findmnt --noheadings --output SOURCE --target "$1" 2>/dev/null) || return 1
  on_luks "${source%%\[*}"
}

missing=()
for path in / /etc /var/lib; do
  encrypted "$path" || missing+=("$path is not on a disk encrypted with LUKS")
done

# A swap partition must be on LUKS, a swap file on an encrypted filesystem
while read -r name kind || [[ -n ${name:-} ]]; do
  [[ -z ${name:-} || $name == /dev/zram* ]] && continue
  if [[ $kind == file ]]; then
    encrypted "$name" || missing+=("the swap file $name is not on an encrypted disk")
  else
    on_luks "$name" || missing+=("the swap $name is not encrypted")
  fi
done < <(swapon --noheadings --raw --show=NAME,TYPE 2>/dev/null || true)

tpm2=false
for version in "$TPM_CLASS"/tpm*/tpm_version_major; do
  if [[ -r $version && $(<"$version") == 2 ]]; then
    tpm2=true
  fi
done
system=encrypted
((${#missing[@]} == 0)) || system=plain
$tpm2 || missing+=('no TPM 2.0: a chip on the board or the one of the CPU, enabled in the firmware')

if [[ -n $state ]]; then
  install -d -m 0755 -- "$(dirname -- "$state")"
  printf 'system=%s\ntpm=%s\n' "$system" "$($tpm2 && echo present || echo missing)" >"$state"
fi

if ((${#missing[@]} == 0)); then
  echo '   system, /etc, /var/lib and swap encrypted with LUKS, TPM 2.0 present'
  exit 0
fi
printf '   missing: %s\n' "${missing[@]}"
if $warn_only; then
  echo '   going on without it: whoever takes the disks of this machine can read the NAS on them.'
  echo '   The installation manual explains what this means and how to encrypt the system.'
  exit 3
fi
cat >&2 <<'TEXT'
error: Debian is not installed on an encrypted disk with a TPM 2.0. Install Debian again with the
guided partitioning "use the entire disk and set up encrypted LVM" and enable the TPM in the
firmware: the installation manual shows how.
TEXT
exit 1
