import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fakeCommand, OS_CONFIGURATION, run, workspace } from './helpers';

let temp: ReturnType<typeof workspace>;

beforeEach(() => {
  temp = workspace();
});

afterEach(() => temp.remove());

function systemPackages(args: string[], installed: string[]) {
  fakeCommand(
    temp.path,
    'dpkg-query',
    `case " ${installed.join(' ')} " in *" \${@: -1} "*) printf 'install ok installed' ;; *) exit 1 ;; esac`,
  );
  fakeCommand(temp.path, 'apt-get', `printf 'apt-get %s\\n' "$*"`);

  return run(join(OS_CONFIGURATION, 'install.sh'), {
    args,
    env: { PATH: `${temp.path}:${process.env.PATH}`, NAS_CONFIGURATION_DRM: outputs() },
  });
}

const state = () => join(temp.path, 'state');
/** The video outputs of the machine of the test: none until a test adds a card. */
const outputs = () => join(temp.path, 'drm');

function asRoot(script: string, installed: string[] = [], args: string[] = []) {
  const inventory = join(temp.path, 'dpkg');
  if (!existsSync(inventory)) {
    writeFileSync(inventory, ['bash', ...installed].join('\n') + '\n');
  }
  const root = join(temp.path, 'root');
  mkdirSync(join(root, 'etc'), { recursive: true });
  if (!existsSync(join(root, 'etc/hosts'))) {
    writeFileSync(join(root, 'etc/hosts'), '127.0.0.1 localhost\n127.0.1.1 debian\n');
    writeFileSync(join(root, 'etc/hostname'), 'debian\n');
  }
  fakeCommand(
    temp.path,
    'dpkg-query',
    `if (($# == 2)); then awk 'NF { print $0 "\\tinstalled" }' ${JSON.stringify(inventory)}; else grep -qxF -- "\${@: -1}" ${JSON.stringify(inventory)} && printf 'install ok installed'; fi`,
  );
  fakeCommand(
    temp.path,
    'apt-get',
    `printf 'apt-get %s\\n' "$*"
action=$1
if [[ $action == -s ]]; then
  # A package listed in needed is one a package that was already there depends on.
  for package in "$@"; do
    grep -qxF -- "$package" ${JSON.stringify(join(temp.path, 'needed'))} 2>/dev/null && printf 'Remv bash [5.2]\\n'
  done
  exit 0
fi
if [[ $action == install || $action == purge ]]; then
  while (($#)) && [[ $1 != -- ]]; do shift; done
  shift
  for package in "$@"; do
    if [[ $action == install ]]; then printf '%s\\n' "$package" >> ${JSON.stringify(inventory)};
    else grep -vxF -- "$package" ${JSON.stringify(inventory)} > ${JSON.stringify(inventory + '.new')} || true; mv ${JSON.stringify(inventory + '.new')} ${JSON.stringify(inventory)}; fi
  done
fi`,
  );
  fakeCommand(
    temp.path,
    'systemctl',
    `case $1 in
show) echo loaded ;;
is-enabled) echo disabled; exit 1 ;;
is-active) echo inactive; exit 3 ;;
*) printf 'systemctl %s\\n' "$*" ;;
esac`,
  );
  fakeCommand(temp.path, 'hostname', 'echo debian');
  fakeCommand(temp.path, 'hostnamectl', `printf 'hostnamectl %s\\n' "$*"`);
  fakeCommand(
    temp.path,
    'getent',
    'if [[ $1 == passwd ]]; then echo root:x:0:0:root:/root:/bin/bash; elif [[ $1 == group && $# == 1 ]]; then echo root:x:0:; else exit 2; fi',
  );
  fakeCommand(temp.path, 'apt-mark', 'exit 0');
  fakeCommand(temp.path, 'findmnt', 'exit 0');
  fakeCommand(
    temp.path,
    'nft',
    'if [[ $* == "list tables" ]]; then exit 0; elif [[ $1 == list ]]; then exit 1; elif [[ $1 == -f ]]; then cat >/dev/null; fi',
  );
  fakeCommand(temp.path, 'udevadm', `printf 'udevadm %s\\n' "$*"`);
  const env = {
    NAS_CONFIGURATION_STATE: state(),
    NAS_CONFIGURATION_ROOT: root,
    NAS_CONFIGURATION_DRM: outputs(),
    PATH: `${temp.path}:${process.env.PATH}`,
  };
  if (script !== 'scripts/uninstall.sh' && !existsSync(join(state(), 'original-ready'))) {
    const snapshot = run(join(OS_CONFIGURATION, 'scripts/uninstall.sh'), {
      args: ['--snapshot'],
      env,
    });
    if (snapshot.code !== 0) {
      throw new Error(snapshot.output);
    }
  }
  return run(join(OS_CONFIGURATION, script), { args, env });
}

describe('system-packages.sh', () => {
  it('names only the packages that are missing', () => {
    const { code, stdout } = systemPackages(['--dry-run'], ['polkitd']);

    expect(code).toBe(0);
    expect(stdout).toContain(
      '[dry run] apt-get install --no-install-recommends nftables network-manager wpasupplicant wireless-regdb parted e2fsprogs smartmontools cryptsetup',
    );
    expect(stdout).not.toContain('apt-get install polkitd');
  });

  it('has nothing to do when everything is there', () => {
    const { code, stdout } = systemPackages(
      ['--dry-run'],
      [
        'polkitd',
        'nftables',
        'network-manager',
        'wpasupplicant',
        'wireless-regdb',
        'parted',
        'e2fsprogs',
        'smartmontools',
        'cryptsetup',
        'cryptsetup',
      ],
    );

    expect(code).toBe(0);
    expect(stdout).toContain('already installed');
  });

  it.skipIf(process.getuid?.() === 0)('installs nothing unless it runs as root', () => {
    const { code, output } = systemPackages([], []);

    expect(code).not.toBe(0);
    expect(output).toContain('run this script as root');
    expect(output).not.toContain('apt-get install');
  });

  it('refuses an option it does not know', () => {
    const { code, output } = systemPackages(['--everything'], []);

    expect(code).not.toBe(0);
    expect(output).toContain('unknown option');
  });
});

describe('pre-existing system configuration', () => {
  it('keeps pre-existing packages and does not run a global autoremove or clean', () => {
    const installed = [
      'polkitd',
      'nftables',
      'network-manager',
      'wpasupplicant',
      'wireless-regdb',
      'parted',
      'e2fsprogs',
      'smartmontools',
      'cryptsetup',
      'cron',
      'bluez',
    ];
    const result = asRoot('scripts/system-packages.sh', installed);
    expect(result.code).toBe(0);
    expect(result.stdout).not.toContain('apt-get purge');
    expect(result.stdout).not.toContain('apt-get autoremove');
    expect(result.stdout).not.toContain('apt-get clean');
  });

  it('restores hostname and hosts exactly, and keeps the initial copy across another install', () => {
    expect(asRoot('install.sh', ['polkitd']).code).toBe(0);
    const root = join(temp.path, 'root');
    const initial = '127.0.0.1 localhost\n127.0.1.1 debian\n';
    writeFileSync(join(root, 'etc/hostname'), 'nas-valerio\n');
    writeFileSync(join(root, 'etc/hosts'), '127.0.1.1 nas-valerio\n');
    expect(asRoot('install.sh').code).toBe(0);
    const restored = asRoot('scripts/uninstall.sh', [], ['--restore']);
    expect(restored.code).toBe(0);
    expect(readFileSync(join(root, 'etc/hostname'), 'utf8')).toBe('debian\n');
    expect(readFileSync(join(root, 'etc/hosts'), 'utf8')).toBe(initial);
    expect(restored.stdout).toContain('hostnamectl --transient hostname debian');
    expect(existsSync(join(state(), 'original-ready'))).toBe(true);
  });

  it('refuses to invent an original configuration for an installation without a backup', () => {
    const root = join(temp.path, 'root');
    mkdirSync(join(root, 'etc/systemd/system'), { recursive: true });
    writeFileSync(join(root, 'etc/systemd/system/nas-os.service'), '[Service]\n');
    const result = run(join(OS_CONFIGURATION, 'scripts/uninstall.sh'), {
      args: ['--snapshot'],
      env: { NAS_CONFIGURATION_ROOT: root, NAS_CONFIGURATION_STATE: state() },
    });
    expect(result.code).not.toBe(0);
    expect(existsSync(join(state(), 'original-ready'))).toBe(false);
  });
});

describe('wifi.sh', () => {
  const root = (path: string) => join(temp.path, 'root', path);
  const net = () => join(temp.path, 'net');

  function check() {
    fakeCommand(temp.path, 'systemctl', `printf 'systemctl %s\\n' "$*"`);
    return run(join(OS_CONFIGURATION, 'files/wifi.sh'), {
      env: { NAS_WIFI_NET: net(), PATH: `${temp.path}:${process.env.PATH}` },
    });
  }

  it('keeps wpa_supplicant off, until the next boot, on a machine without a wireless card', () => {
    mkdirSync(join(net(), 'enp1s0'), { recursive: true });
    const { code, stdout } = check();

    expect(code).toBe(0);
    expect(stdout).toContain('systemctl mask --runtime wpa_supplicant.service');
    expect(stdout).toContain('systemctl stop --no-block wpa_supplicant.service');
    expect(stdout).not.toContain('unmask');
  });

  it('brings it back when a wireless card is there', () => {
    mkdirSync(join(net(), 'enp1s0'), { recursive: true });
    mkdirSync(join(net(), 'wlan0', 'wireless'), { recursive: true });
    const { code, stdout } = check();

    expect(code).toBe(0);
    expect(stdout).toContain('systemctl unmask --runtime wpa_supplicant.service');
    expect(stdout).toContain('systemctl start --no-block wpa_supplicant.service');
    expect(stdout).not.toContain('systemctl mask');
  });

  it('installs the check for every boot and every card that appears, and takes it away', () => {
    const { code, stdout } = asRoot('scripts/wifi.sh');

    expect(code).toBe(0);
    expect(stdout).toContain('systemctl enable nas-os-wifi.service');
    expect(stdout).toContain('systemctl restart nas-os-wifi.service');
    const unit = readFileSync(root('etc/systemd/system/nas-os-wifi.service'), 'utf8');
    expect(unit).toContain('ExecStart=/usr/local/lib/nas-os-configuration/wifi.sh');
    expect(unit).toContain('Before=NetworkManager.service wpa_supplicant.service');
    expect(readFileSync(root('etc/udev/rules.d/80-nas-os-wifi.rules'), 'utf8')).toContain(
      'ENV{DEVTYPE}=="wlan", RUN+="/usr/local/lib/nas-os-configuration/wifi.sh"',
    );
    expect(existsSync(root('usr/local/lib/nas-os-configuration/wifi.sh'))).toBe(true);

    const removed = asRoot('scripts/wifi.sh', [], ['--remove']);
    expect(removed.code).toBe(0);
    expect(removed.stdout).toContain('wireless check removed');
    expect(existsSync(root('etc/systemd/system/nas-os-wifi.service'))).toBe(false);
    expect(existsSync(root('etc/udev/rules.d/80-nas-os-wifi.rules'))).toBe(false);
    expect(existsSync(root('usr/local/lib/nas-os-configuration'))).toBe(false);

    const unknown = asRoot('scripts/wifi.sh', [], ['--everything']);
    expect(unknown.code).not.toBe(0);
    expect(asRoot('scripts/wifi.sh', [], ['--dry-run']).stdout).toContain('[dry run] install');
  });
});

describe('removing what the configuration installed', () => {
  it('writes down only the packages it installed', () => {
    const { code, stdout } = asRoot('install.sh', ['polkitd']);

    expect(code).toBe(0);
    expect(stdout).toContain(
      'apt-get install -q -y --no-install-recommends -o DPkg::Lock::Timeout=600 -- nftables network-manager wpasupplicant wireless-regdb parted e2fsprogs smartmontools cryptsetup',
    );
    expect(stdout).not.toContain('apt-get autoremove');
    expect(stdout).not.toContain('apt-get clean');
    expect(stdout).toContain('systemctl enable nas-os-base-firewall.service');
    expect(new Set(readFileSync(join(state(), 'packages'), 'utf8').trim().split('\n'))).toEqual(
      new Set([
        'nftables',
        'network-manager',
        'wpasupplicant',
        'wireless-regdb',
        'parted',
        'e2fsprogs',
        'smartmontools',
        'cryptsetup',
        'cryptsetup',
      ]),
    );
    expect(
      readFileSync(
        join(temp.path, 'root', 'etc/systemd/system/nas-os-base-firewall.service'),
        'utf8',
      ),
    ).toContain('ExecStart=/usr/local/lib/nas-os-configuration/base-firewall.sh');
  });

  it('removes those packages, once each, and nothing that is not a package name', () => {
    expect(asRoot('install.sh', ['polkitd']).code).toBe(0);
    writeFileSync(join(state(), 'packages'), 'nftables\nnftables\n; rm -rf /\nnetwork-manager\n');

    const { code, stdout } = asRoot('scripts/uninstall.sh');

    expect(code).toBe(0);
    expect(stdout).toContain(
      'apt-get purge -q -y -o DPkg::Lock::Timeout=600 -- network-manager nftables',
    );
    expect(stdout).not.toContain('rm -rf');
    expect(existsSync(state())).toBe(false);
  });

  it('keeps a package an upgrade made necessary to one that was already there', () => {
    expect(asRoot('install.sh', ['polkitd']).code).toBe(0);
    writeFileSync(join(temp.path, 'needed'), 'nftables\n');

    const { code, stdout } = asRoot('scripts/uninstall.sh');

    expect(code).toBe(0);
    expect(stdout).toContain('kept, now needed by the system: nftables');
    expect(stdout).toMatch(
      /apt-get purge -q -y -o DPkg::Lock::Timeout=600 -- (?!.*nftables).*network-manager/,
    );
  });

  it('unmounts and closes the encrypted disks it opened before removing packages', () => {
    expect(asRoot('install.sh', ['polkitd']).code).toBe(0);
    mkdirSync(join(temp.path, 'root/dev/mapper'), { recursive: true });
    writeFileSync(join(temp.path, 'root/dev/mapper/nas-luks-0f3a'), '');
    writeFileSync(join(temp.path, 'root/dev/mapper/cryptroot'), '');
    fakeCommand(temp.path, 'cryptsetup', `printf 'cryptsetup %s\\n' "$*"`);

    const { code, stdout } = asRoot('scripts/uninstall.sh');

    expect(code).toBe(0);
    expect(stdout).toContain('cryptsetup close -- nas-luks-0f3a');
    expect(stdout).not.toContain('cryptroot');
    expect(stdout.indexOf('cryptsetup close')).toBeLessThan(stdout.indexOf('apt-get purge'));
  });

  it('refuses removal without the original system state', () => {
    const { code, stdout } = asRoot('scripts/uninstall.sh');

    expect(code).not.toBe(0);
    expect(stdout).not.toContain('apt-get');
  });
});

describe('screen.sh', () => {
  const root = (path: string) => join(temp.path, 'root', path);

  it('prepares nothing on a machine with no video output', () => {
    const { code, stdout } = asRoot('scripts/screen.sh');

    expect(code).toBe(0);
    expect(stdout).toContain('no video output');
    expect(stdout).not.toContain('apt-get');
    expect(existsSync(root('etc/systemd/system/nas-os-screen.service'))).toBe(false);
  });

  it('installs cog and its OpenGL ES library alone, the units and the session', () => {
    mkdirSync(join(outputs(), 'card0'), { recursive: true });

    const { code, stdout } = asRoot('scripts/screen.sh');

    expect(code).toBe(0);
    expect(stdout).toContain(
      'apt-get install -q -y --no-install-recommends -o DPkg::Lock::Timeout=600 -- cog libgles2',
    );
    expect(stdout).not.toContain('systemctl enable nas-os-screen.service');
    expect(stdout).toContain('screen installed and off');
    expect(new Set(readFileSync(join(state(), 'packages'), 'utf8').trim().split('\n'))).toEqual(
      new Set(['cog', 'libgles2']),
    );
    const watcher = readFileSync(root('etc/systemd/system/nas-os-screen.service'), 'utf8');
    expect(watcher).toContain('ExecStart=/usr/local/lib/nas-wizard/wizard/bin/nas-wizard screen');
    const browser = readFileSync(root('etc/systemd/system/nas-os-screen-browser.service'), 'utf8');
    expect(browser).toContain('User=nas-screen');
    expect(browser).toContain('PAMName=nas-os-screen');
    expect(browser).toContain('--platform=drm');
    expect(browser).toContain(
      'ExecStopPost=-+/usr/bin/systemctl --no-block start getty@tty1.service',
    );
    expect(browser).toContain('PartOf=nas-os-screen.service');
    expect(browser).not.toContain('Restart=');
    expect(readFileSync(root('etc/pam.d/nas-os-screen'), 'utf8')).toContain('pam_systemd.so');
    expect(browser).toContain('ExecStart=/usr/bin/cog --platform=drm http://127.0.0.1:8081/');
    expect(browser).toContain('ReadWritePaths=-/run/user');
    expect(browser).not.toMatch(/^ProtectHome=/m);
  });

  it('leaves cog and libgles2 out of the packages it installed when they were there, and says what it would do', () => {
    mkdirSync(join(outputs(), 'card1'), { recursive: true });

    const dry = asRoot('scripts/screen.sh', ['cog', 'libgles2'], ['--dry-run']);
    expect(dry.code).toBe(0);
    expect(dry.stdout).not.toContain('apt-get install');
    expect(dry.stdout).toContain('[dry run] create nas-screen');

    expect(asRoot('scripts/screen.sh', ['cog', 'libgles2']).code).toBe(0);
    expect(existsSync(join(state(), 'packages'))).toBe(false);
  });

  it('takes the screen away, and refuses an option it does not know', () => {
    mkdirSync(join(outputs(), 'card0'), { recursive: true });
    expect(asRoot('scripts/screen.sh').code).toBe(0);

    const removed = asRoot('scripts/screen.sh', [], ['--remove']);
    expect(removed.code).toBe(0);
    expect(removed.stdout).toContain('screen removed');
    expect(existsSync(root('etc/systemd/system/nas-os-screen-browser.service'))).toBe(false);
    expect(existsSync(root('usr/local/share/nas-os-screen'))).toBe(false);

    const unknown = asRoot('scripts/screen.sh', [], ['--everything']);
    expect(unknown.code).not.toBe(0);
    expect(unknown.output).toContain('unknown option');
  });
});

describe('base firewall', () => {
  it('restores the saved HTTPS port at boot and on reload without keeping port 443 open', () => {
    const connection = join(temp.path, 'gateway.connection');
    writeFileSync(connection, '8443\n1\n');
    for (const args of [['--print'], ['--print-reload']]) {
      const result = run(join(OS_CONFIGURATION, 'files/base-firewall.sh'), {
        args,
        env: { NAS_GATEWAY_CONNECTION: connection },
      });
      expect(result.code).toBe(0);
      expect(result.stdout).toContain('8443');
      expect(result.stdout).toContain('tcp dport @nas_https accept');
      expect(result.stdout).not.toContain('tcp dport 443 accept');
    }
    writeFileSync(connection, '65536\n1\n');
    expect(
      run(join(OS_CONFIGURATION, 'files/base-firewall.sh'), {
        args: ['--print'],
        env: { NAS_GATEWAY_CONNECTION: connection },
      }).code,
    ).not.toBe(0);
  });
  it('starts with drop policies and limits exposed ports and application egress', () => {
    const { code, stdout } = run(join(OS_CONFIGURATION, 'files/base-firewall.sh'), {
      args: ['--print'],
    });

    expect(code).toBe(0);
    expect(stdout.match(/policy drop;/g)).toHaveLength(3);
    expect(stdout).toContain('tcp dport 80 accept');
    expect(stdout).toContain('tcp dport @nas_https accept');
    expect(stdout).toContain('tcp dport 22 accept');
    // The port of the screen: only its browser, before every other loopback packet.
    expect(stdout).toMatch(/oif lo tcp dport 8081 (meta skuid != \d+ )?reject/);
    expect(stdout.indexOf('tcp dport 8081')).toBeLessThan(stdout.indexOf('oif lo accept'));
    expect(stdout).toContain('socket cgroupv2 level 2 @nas_apps_out tcp dport { 80, 443 } accept');
    expect(stdout).not.toContain('socket cgroupv2 level 2 @nas_apps_out accept');
    expect(stdout).toContain('set nas_apps_smtp {');
    expect(stdout).toContain(
      'socket cgroupv2 level 2 @nas_apps_smtp tcp dport { 25, 465, 587 } accept',
    );
    // The shared folders: only from the local network, and only the ports the launcher puts in.
    expect(stdout).toContain('set nas_shares {');
    expect(stdout).toContain('ip saddr @local_v4 tcp dport @nas_shares accept');
    expect(stdout).toContain('ip6 saddr @local_v6 tcp dport @nas_shares accept');
    expect(stdout).not.toMatch(/saddr \S+ tcp dport 445/);
    // The network disks: out to 445 only towards the servers of the local network put in the sets.
    expect(stdout).toContain('set nas_smb_servers {\n    type ipv4_addr\n  }');
    expect(stdout).toContain('set nas_smb_servers6 {\n    type ipv6_addr\n  }');
    expect(stdout).toContain('ip daddr @local_v4 ip daddr @nas_smb_servers tcp dport 445 accept');
    expect(stdout).toContain(
      'ip6 daddr @local_v6 ip6 daddr @nas_smb_servers6 tcp dport 445 accept',
    );
    // The sync: in from the local network on the ports the launcher puts in, out only to it.
    expect(stdout).toContain('set nas_sync {');
    expect(stdout).toContain('set nas_apps_sync {');
    expect(stdout).toContain('ip saddr @local_v4 tcp dport 22000 tcp dport @nas_sync accept');
    expect(stdout).toContain('ip6 saddr @local_v6 tcp dport 22000 tcp dport @nas_sync accept');
    expect(stdout).toContain(
      'socket cgroupv2 level 2 @nas_apps_sync ip daddr @local_v4 udp dport { 22000, 21027 } accept',
    );
    expect(stdout).toContain(
      'socket cgroupv2 level 2 @nas_apps_sync ip daddr 255.255.255.255 udp dport 21027 accept',
    );
    expect(stdout).not.toMatch(/@nas_apps_sync (tcp|udp|meta)/);
    for (const [family, local] of [
      ['ip', 'local_v4'],
      ['ip6', 'local_v6'],
    ]) {
      expect(stdout).toContain(`${family} saddr @${local} udp dport @nas_sync accept`);
      expect(stdout).toContain(`@nas_apps_sync ${family} daddr @${local} tcp dport 22000 accept`);
    }
    expect(stdout).not.toContain('meta l4proto { tcp, udp } th dport @nas_sync');
    expect(stdout).not.toMatch(/tcp dport.*21027/);
    expect(stdout).not.toContain('39877');
  });

  it('keeps NAS Finder behind an empty set, open only to local IPv4', () => {
    for (const option of ['--print', '--print-reload']) {
      const { code, stdout } = run(join(OS_CONFIGURATION, 'files/base-firewall.sh'), {
        args: [option],
        env: { NAS_DISCOVERY_ENABLED: '1' },
      });

      expect(code).toBe(0);
      expect(stdout).toContain(
        'ip saddr @local_v4 udp dport @nas_discovery limit rate 10/second burst 20 packets accept',
      );
      expect(stdout).toContain(
        'ip daddr @local_v4 udp sport @nas_discovery limit rate 10/second burst 20 packets accept',
      );
      expect(stdout).not.toContain('39877');
      expect(stdout).not.toContain('tcp dport @nas_discovery');
      expect(stdout).not.toContain('ip6 saddr @local_v6 udp dport @nas_discovery');
      expect(stdout).toContain('tcp dport 22 accept');
      expect(stdout).toContain('tcp dport 80 accept');
      expect(stdout).toContain('tcp dport @nas_https accept');
    }
    const reload = run(join(OS_CONFIGURATION, 'files/base-firewall.sh'), {
      args: ['--print-reload'],
    });
    expect(reload.stdout).toContain('add set inet nas_base nas_discovery { type inet_service; }');
  });

  it('reloads chains without deleting the application cgroup set', () => {
    const { code, stdout } = run(join(OS_CONFIGURATION, 'files/base-firewall.sh'), {
      args: ['--print-reload'],
    });

    expect(code).toBe(0);
    expect(stdout).toContain('flush chain inet nas_base output');
    expect(stdout).toContain('add rule inet nas_base input tcp dport 80 accept');
    expect(stdout).toContain('add rule inet nas_base input tcp dport @nas_https accept');
    expect(stdout).toContain('socket cgroupv2 level 2 @nas_apps_out tcp dport { 80, 443 } accept');
    expect(stdout).not.toContain('delete table');
    expect(stdout.match(/^flush set .+$/gm)).toEqual(['flush set inet nas_base nas_https']);
    expect(stdout.indexOf('add set inet nas_base nas_apps_smtp')).toBeLessThan(
      stdout.indexOf('@nas_apps_smtp tcp dport'),
    );
    expect(stdout.indexOf('add set inet nas_base nas_shares')).toBeLessThan(
      stdout.indexOf('tcp dport @nas_shares'),
    );
    expect(stdout.indexOf('add set inet nas_base nas_smb_servers ')).toBeLessThan(
      stdout.indexOf('@nas_smb_servers tcp dport 445'),
    );
    expect(stdout.indexOf('add set inet nas_base nas_smb_servers6')).toBeLessThan(
      stdout.indexOf('@nas_smb_servers6 tcp dport 445'),
    );
    expect(stdout.indexOf('add set inet nas_base nas_sync')).toBeLessThan(
      stdout.indexOf('tcp dport @nas_sync'),
    );
    expect(stdout.indexOf('add set inet nas_base nas_apps_sync')).toBeLessThan(
      stdout.indexOf('@nas_apps_sync ip daddr'),
    );
  });

  it('removes the firewall files on uninstall', () => {
    expect(asRoot('install.sh', ['polkitd', 'nftables', 'network-manager']).code).toBe(0);
    const { code, stdout } = run(join(OS_CONFIGURATION, 'scripts/firewall.sh'), {
      args: ['--remove'],
      env: {
        NAS_CONFIGURATION_ROOT: join(temp.path, 'root'),
        PATH: `${temp.path}:${process.env.PATH}`,
      },
    });

    expect(code).toBe(0);
    expect(stdout).toContain('base firewall removed');
    expect(
      existsSync(join(temp.path, 'root', 'etc/systemd/system/nas-os-base-firewall.service')),
    ).toBe(false);
  });
});

describe('uninstall.sh', () => {
  it.skipIf(process.getuid?.() === 0)('touches nothing unless it runs as root', () => {
    const { code, output } = run(join(OS_CONFIGURATION, '..', 'uninstall.sh'), { args: ['--yes'] });

    expect(code).not.toBe(0);
    expect(output).toContain('it has to run as root');
  });

  it('undoes what the wizard did in the reverse order it did it', () => {
    const script = readFileSync(join(OS_CONFIGURATION, '..', 'uninstall.sh'), 'utf8');
    const order = [
      '$configuration/scripts/firewall.sh" --remove',
      'rm -f /etc/credstore.encrypted/nas-os.launcher-token',
      '$LAUNCHER_TOOLS/uninstall.sh" --purge',
      '$GATEWAY_TOOLS/uninstall.sh" --purge',
      '$configuration/scripts/screen.sh" --remove',
      '$configuration/scripts/wifi.sh" --remove',
      '$configuration/scripts/uninstall.sh"\n',
      'rm -rf -- "$WIZARD_HOME"',
    ].map((step) => script.indexOf(step));

    expect(order.every((position) => position > 0)).toBe(true);
    expect(order).toEqual([...order].sort((left, right) => left - right));
  });

  it('alone in the emptied package, takes the configuration of the system from the installed wizard', () => {
    const script = readFileSync(join(OS_CONFIGURATION, '..', 'uninstall.sh'), 'utf8');

    expect(script).toContain(
      'configuration=$here/os_configuration\n[[ -d $configuration ]] || configuration=$WIZARD_HOME/packages/os_configuration',
    );
    expect(script).not.toContain('$here/os_configuration/');
  });
});
