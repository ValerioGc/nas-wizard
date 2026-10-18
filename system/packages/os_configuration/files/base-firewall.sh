#!/usr/bin/env bash
#
# Loads the base firewall in a dedicated nftables table.
# The output is also available with --print or --print-reload.
# It is installed by scripts/firewall.sh.

set -euo pipefail

readonly TABLE=nas_base
readonly GATEWAY_PORT=80
GATEWAY_TLS_PORT=443
readonly CONNECTION=${NAS_GATEWAY_CONNECTION:-/var/lib/nas-os-gateway/gateway.connection}
if [[ -f $CONNECTION ]]; then
  IFS= read -r GATEWAY_TLS_PORT <"$CONNECTION"
  [[ $GATEWAY_TLS_PORT =~ ^[1-9][0-9]{0,4}$ ]] && ((GATEWAY_TLS_PORT <= 65535)) || exit 1
fi
readonly GATEWAY_TLS_PORT
readonly SSH_PORT=22
readonly SCREEN_PORT=8081
readonly SCREEN_USER=nas-screen
readonly WEB_USERS=(root _apt nas-os)

fail() {
  printf 'base firewall not applied: %s\n' "$1" >&2
  exit 1
}

uids=()
for user in "${WEB_USERS[@]}"; do
  uid=$(id -u "$user" 2>/dev/null) && uids+=("$uid")
done
web_uids=$(IFS=,; printf '%s' "${uids[*]}")
if screen_uid=$(id -u "$SCREEN_USER" 2>/dev/null); then
  screen_rule="tcp dport $SCREEN_PORT meta skuid != $screen_uid reject"
else
  screen_rule="tcp dport $SCREEN_PORT reject"
fi

input_rules=(
  'iif lo accept'
  'ct state invalid drop'
  'ct state established,related accept'
  'meta l4proto { icmp, ipv6-icmp } accept'
  'udp sport 67 udp dport 68 accept'
  'udp sport 547 udp dport 546 accept'
  "tcp dport $GATEWAY_PORT accept"
  'tcp dport @nas_https accept'
  "ip saddr @local_v4 tcp dport $SSH_PORT accept"
  "ip6 saddr @local_v6 tcp dport $SSH_PORT accept"
  # The folders shared on the local network (SMB)
  'ip saddr @local_v4 tcp dport @nas_shares accept'
  'ip6 saddr @local_v6 tcp dport @nas_shares accept'
  # The sync with the computers of the local network 
  # Syncthing: TCP and UDP 22000, discovery on UDP 21027
  'ip saddr @local_v4 tcp dport 22000 tcp dport @nas_sync accept'
  'ip saddr @local_v4 udp dport @nas_sync accept'
  'ip6 saddr @local_v6 tcp dport 22000 tcp dport @nas_sync accept'
  'ip6 saddr @local_v6 udp dport @nas_sync accept'
  # Discovery of NAS Finder (UDP 39877), IPv4 only
  'ip saddr @local_v4 udp dport @nas_discovery limit rate 10/second burst 20 packets accept'
)
output_rules=(
  "oif lo $screen_rule"
  'oif lo accept'
  'ct state invalid drop'
  'ct state established,related accept'
  'meta l4proto { icmp, ipv6-icmp } accept'
  'udp dport { 67, 547 } accept'
  'meta l4proto { tcp, udp } th dport 53 accept'
  'udp dport 123 accept'
  "meta skuid { $web_uids } tcp dport { 80, 443 } accept"
  'socket cgroupv2 level 2 @nas_apps_out tcp dport { 80, 443 } accept'
  'socket cgroupv2 level 2 @nas_apps_smtp tcp dport { 25, 465, 587 } accept'
  # The network disks (SMB) the NAS mounts
  'ip daddr @local_v4 ip daddr @nas_smb_servers tcp dport 445 accept'
  'ip6 daddr @local_v6 ip6 daddr @nas_smb_servers6 tcp dport 445 accept'
  'socket cgroupv2 level 2 @nas_apps_sync ip daddr @local_v4 tcp dport 22000 accept'
  'socket cgroupv2 level 2 @nas_apps_sync ip daddr @local_v4 udp dport { 22000, 21027 } accept'
  'socket cgroupv2 level 2 @nas_apps_sync ip6 daddr @local_v6 tcp dport 22000 accept'
  'socket cgroupv2 level 2 @nas_apps_sync ip6 daddr @local_v6 udp dport { 22000, 21027 } accept'
  'socket cgroupv2 level 2 @nas_apps_sync ip daddr 255.255.255.255 udp dport 21027 accept'
  'socket cgroupv2 level 2 @nas_apps_sync ip6 daddr ff12::8384 udp dport 21027 accept'
  'ip daddr @local_v4 udp sport @nas_discovery limit rate 10/second burst 20 packets accept'
)

chain_rules() {
  printf '    %s\n' "$@"
}

reload_rules() {
  printf 'add set inet %s nas_https { type inet_service; }\n' "$TABLE"
  printf 'flush set inet %s nas_https\nadd element inet %s nas_https { %s }\n' "$TABLE" "$TABLE" "$GATEWAY_TLS_PORT"
  printf 'add set inet %s nas_apps_smtp { type cgroupsv2; }\n' "$TABLE"
  printf 'add set inet %s nas_shares { type inet_service; }\n' "$TABLE"
  printf 'add set inet %s nas_sync { type inet_service; }\n' "$TABLE"
  printf 'add set inet %s nas_apps_sync { type cgroupsv2; }\n' "$TABLE"
  printf 'add set inet %s nas_discovery { type inet_service; }\n' "$TABLE"
  printf 'add set inet %s nas_smb_servers { type ipv4_addr; }\n' "$TABLE"
  printf 'add set inet %s nas_smb_servers6 { type ipv6_addr; }\n' "$TABLE"
  printf 'flush chain inet %s input\n' "$TABLE"
  for rule in "${input_rules[@]}"; do
    printf 'add rule inet %s input %s\n' "$TABLE" "$rule"
  done
  printf 'flush chain inet %s output\n' "$TABLE"
  for rule in "${output_rules[@]}"; do
    printf 'add rule inet %s output %s\n' "$TABLE" "$rule"
  done
}

ruleset() {
  cat <<RULES
table inet $TABLE {
  set nas_https {
    type inet_service
    elements = { $GATEWAY_TLS_PORT }
  }
  set local_v4 {
    type ipv4_addr
    flags interval
    elements = { 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 169.254.0.0/16 }
  }

  set local_v6 {
    type ipv6_addr
    flags interval
    elements = { fc00::/7, fe80::/10 }
  }

  set nas_apps_out {
    type cgroupsv2
  }

  set nas_apps_smtp {
    type cgroupsv2
  }

  set nas_shares {
    type inet_service
  }

  set nas_sync {
    type inet_service
  }

  set nas_apps_sync {
    type cgroupsv2
  }

  set nas_discovery {
    type inet_service
  }

  set nas_smb_servers {
    type ipv4_addr
  }

  set nas_smb_servers6 {
    type ipv6_addr
  }

  chain input {
    type filter hook input priority filter - 10; policy drop;
$(chain_rules "${input_rules[@]}")
  }

  chain forward {
    type filter hook forward priority filter - 10; policy drop;
  }

  chain output {
    type filter hook output priority filter - 10; policy drop;
$(chain_rules "${output_rules[@]}")
  }
}
RULES
}

case ${1:-} in
  --print)
    ruleset
    ;;
  --print-reload)
    reload_rules
    ;;
  --remove)
    if nft list table inet "$TABLE" >/dev/null 2>&1; then
      nft delete table inet "$TABLE"
    fi
    echo 'base firewall removed'
    ;;
  '')
    command -v nft >/dev/null || fail 'nft is not installed'
    if nft list table inet "$TABLE" >/dev/null 2>&1; then
      reload_rules | nft -f - || fail 'nft refused the ruleset'
    else
      ruleset | nft -f - || fail 'nft refused the ruleset'
    fi
    printf 'base firewall applied: web allowed to uid %s\n' "$web_uids"
    ;;
  *)
    fail "unknown option: $1"
    ;;
esac
