#!/usr/bin/env bash
#
# Checks that the machine keeps the data of the NAS for itself when a disk is taken away: the root
# filesystem on LUKS, /etc and /var/lib on an encrypted disk too (the keys of the data disks will
# live there, and a folder on another unencrypted partition would leave them readable), every swap
# encrypted, and a TPM 2.0 on the board or in the CPU. It changes nothing.
#
#   check-security.sh               # exits 1 when something is missing
#   check-security.sh --warn-only   # says what is missing and exits 3, 0 when nothing is
#
# The entry script runs it before it changes anything on the machine. A NAS already configured
# (--update) and the development mode (--development) only get the warning.

set -euo pipefail

readonly TPM_CLASS=${NAS_TPM_CLASS:-/sys/class/tpm}

warn_only=false
case ${1:-} in
  --warn-only) warn_only=true ;;
  '') ;;
  *)
    printf 'error: unknown option: %s\n' "$1" >&2
    exit 2
    ;;
esac

# Whether a block device lies on a LUKS container: one of the devices under it is one.
on_luks() {
  # Reads the whole output: grep -q may cause SIGPIPE and a false negative under pipefail.
  lsblk --inverse --noheadings --raw --output FSTYPE -- "$1" 2>/dev/null | grep -x crypto_LUKS >/dev/null
}

# Whether the filesystem that holds a path is on LUKS. A btrfs source names its subvolume in
# brackets after the device.
encrypted() {
  local source
  source=$(findmnt --noheadings --output SOURCE --target "$1" 2>/dev/null) || return 1
  on_luks "${source%%\[*}"
}

missing=()
for path in / /etc /var/lib; do
  encrypted "$path" || missing+=("$path is not on a disk encrypted with LUKS")
done

# A swap partition must be on LUKS, a swap file on an encrypted filesystem; zram stays in memory.
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
$tpm2 || missing+=('no TPM 2.0: a chip on the board or the one of the CPU, enabled in the firmware')

if ((${#missing[@]} == 0)); then
  echo '   system, /etc, /var/lib and swap encrypted with LUKS, TPM 2.0 present'
  exit 0
fi
printf '   missing: %s\n' "${missing[@]}"
if $warn_only; then
  echo '   going on without it: whoever takes a disk of this machine can read the NAS on it'
  exit 3
fi
cat >&2 <<'TEXT'
error: the NAS needs Debian installed on an encrypted disk and a TPM 2.0. Install Debian again with
the guided partitioning "use the entire disk and set up encrypted LVM", enable the TPM in the
firmware, then run this script again: the installation manual shows how. To try the NAS on a
machine without them, run ./install.sh --development.
TEXT
exit 1
