#!/usr/bin/env bash
#
# wpa_supplicant only on a machine with a wireless card. Run by nas-os-wifi.service at every boot,
# before NetworkManager, and by udev when a wireless card appears later (a USB key, a driver slow
# to load). Without a card the service stays masked until the next boot, in /run only. The package
# stays installed and nothing is written on the disk. With one it is unmasked and started, and
# NetworkManager finds it. Installed by scripts/wifi.sh.

set -euo pipefail

export PATH=${PATH:-/usr/sbin:/usr/bin:/sbin:/bin}
readonly NET=${NAS_WIFI_NET:-/sys/class/net}
readonly UNIT=wpa_supplicant.service

shopt -s nullglob
cards=("$NET"/*/wireless "$NET"/*/phy80211)

if ((${#cards[@]} > 0)); then
  systemctl unmask --runtime "$UNIT"
  systemctl start --no-block "$UNIT" || true
  echo "a wireless card is there: $UNIT available"
else
  systemctl mask --runtime "$UNIT"
  systemctl stop --no-block "$UNIT" || true
  echo "no wireless card: $UNIT off until one appears"
fi
