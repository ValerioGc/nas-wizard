# Operating system configuration

Run on Debian 13 before the wizard installs the gateway and launcher. The package's root
`install.sh` invokes this step automatically.

```bash
sudo ./install.sh
./install.sh --dry-run
```

| Existing script              | Purpose                                                      |
| ---------------------------- | ------------------------------------------------------------ |
| `install.sh`                 | Saves the original state, then prepares the operating system |
| `scripts/system-packages.sh` | Installs missing NAS dependencies                            |
| `scripts/screen.sh`          | Prepares an optional directly connected display              |
| `scripts/wifi.sh`            | Disables wpa_supplicant while no wireless adapter exists     |
| `scripts/firewall.sh`        | Installs or removes the NAS firewall                         |
| `scripts/uninstall.sh`       | Saves, checks and restores the original system configuration |

## Original system state

Before any installation changes, `scripts/uninstall.sh --snapshot` saves the original hostname,
`/etc/hosts`, `/etc/machine-info`, resolver configuration, network configuration directories,
Samba configuration and account databases. It also records the original installed packages,
APT automatic/manual marks, system users and groups, network/Samba service states, NAS storage
mount points and the RTC wake alarm when available.
ClamAV configuration and its service overrides are saved too. Samba/ClamAV data, cache and log
directories are recorded without copying their contents: removal deletes these directories only
if they were absent before installation. Existing package data and shared system logs are preserved.

The archive is stored in `/var/lib/nas-os-configuration/original`, accessible only to root.
`original-ready` is written only after capture completes. Updates and repeated installations
reuse this initial archive; they never replace it with the already configured NAS state.

An installation that predates this backup cannot reconstruct its original configuration.
Installation updates, exact reset and removal refuse to invent a baseline. Recover a VM snapshot
or the original Debian configuration first; do not manually create the ready marker or capture
an already configured NAS as its original state.

## Packages

The NAS installs only missing dependencies, without recommended packages:

| Package               | Purpose                                           |
| --------------------- | ------------------------------------------------- |
| `polkitd`             | Authorizes the launcher's specific system actions |
| `nftables`            | Applies NAS firewall tables                       |
| `network-manager`     | Discovers and joins wireless networks             |
| `wpasupplicant`       | Connects to wireless networks                     |
| `wireless-regdb`      | Supplies wireless regulatory data                 |
| `parted`, `e2fsprogs` | Initializes explicitly selected data disks        |
| `smartmontools`       | Reads disk health                                 |
| `cryptsetup`          | Encrypts the data disks with LUKS2                |

Pre-existing packages, including cron, Bluetooth and modem support, are preserved. The installers
record packages and dependencies added by the NAS, including partial failed installations.
They do not run a global `autoremove` or clear the machine's package cache. APT index refresh
errors stop installation before downloads are attempted against stale indexes.

Removal simulates its purge first and refuses to remove any package present before the NAS.
Only recorded NAS additions are purged; original APT marks are restored.
Debian package upgrades remain allowed. Restoration returns the saved configuration and service
states, but does not downgrade pre-existing packages to their original versions.

## Wireless networking and display

The wireless helper is installed as `nas-os-wifi.service` and an adapter udev rule. Without a
wireless adapter it masks `wpa_supplicant.service` only for the current boot. Restoration returns
the service to its recorded state rather than assuming it was previously enabled.

A machine with a video output can use `cog` on a directly connected display. The watcher
`nas-os-screen.service` remains disabled until explicitly enabled. The browser runs as
`nas-screen` and accesses the loopback display port 8081. Removal deletes that user only when
it did not exist before the NAS.

## Firewall

`nas_base` supplies the NAS input, output and forwarding policy. It permits the gateway/wizard
web ports, local SSH, established traffic, loopback, DHCP, DNS, NTP and ICMP. Outbound HTTP/HTTPS
is allowed for root, APT, the launcher and authorized application cgroups. Application grants
control SMTP and sync access. Dynamic sets control shared folders, sync and NAS discovery.

`nas_launcher` is the separate allowed-address filter. Firewall removal deletes both NAS tables
before any package purge can remove `nft`. Inspection or deletion errors are failures, not proof
that no filter exists. Other nftables tables are left intact.

The base service loads its own rules and does not activate the distribution's independent
`nftables.service`.

## Reset and removal

The settings reset keeps the wizard and its required operating-system support. It stops the NAS
services, storage timer and storage udev trigger, removes the allowed-address filter and wireless helper, clears dynamic grants,
removes NAS application packages, restores the original hostname/network/Samba configuration
and service states, and removes NAS account/application data, binaries and service units for the
launcher and gateway. It also removes stale NAS sockets, lock files and downloaded wizard updates.
Only mount points introduced by
the NAS are unmounted; data files are not deleted. Both NAS firewall tables are removed, leaving
the original firewall policy in place. The wizard is enabled for subsequent boots. When a new
installation is confirmed, the existing post-wizard installer prepares NAS operating-system
support and the base firewall again before downloading the gateway.

Restoration never stops the network services (networking, NetworkManager, systemd-networkd,
systemd-resolved, dhcpcd, wpa_supplicant): stopping them would cut the SSH session the removal runs
in. Their original configuration files come back at once and take over at the next start of the
machine. Every step prints what it does; an unmount that takes longer than 30 seconds (a network
disk whose server is gone) detaches the disk instead of waiting.

The complete `../uninstall.sh` additionally removes the wizard, display, wireless helper and NAS
system packages. It restores the original service states and removes only users/groups created
by the NAS. The initial backup is deleted only after successful restoration.

Both reset and complete removal delete the Linux terminal user created by the wizard, including
its home. The Debian administrator `nas` is explicitly excluded from user removal. Other users
recorded before installation are preserved too.

The NAS name and IP address may change back during restoration. Reopen setup using the restored
address if the browser loses its connection. A failed operation retains the original archive
and reports failure; it must not print that the machine was restored successfully.

Starting the wizard after a reset does not reactivate NetworkManager if it was originally stopped
or absent. An explicit Wi-Fi scan or connection request prepares network support through the
existing package and wireless helpers. This allows wireless setup without changing the restored
network merely because the wizard started.
