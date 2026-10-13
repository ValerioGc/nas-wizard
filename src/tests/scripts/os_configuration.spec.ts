import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
  fakeCommand(
    temp.path,
    'dpkg-query',
    `case " ${installed.join(' ')} " in *" \${@: -1} "*) printf 'install ok installed' ;; *) exit 1 ;; esac`,
  );
  fakeCommand(temp.path, 'apt-get', `printf 'apt-get %s\\n' "$*"`);
  fakeCommand(temp.path, 'systemctl', `printf 'systemctl %s\\n' "$*"`);
  fakeCommand(temp.path, 'udevadm', `printf 'udevadm %s\\n' "$*"`);
  return run(join(OS_CONFIGURATION, script), {
    args,
    env: {
      NAS_CONFIGURATION_STATE: state(),
      NAS_CONFIGURATION_ROOT: join(temp.path, 'root'),
      NAS_CONFIGURATION_DRM: outputs(),
      PATH: `${temp.path}:${process.env.PATH}`,
    },
  });
}

describe('system-packages.sh', () => {
  it('names only the packages that are missing', () => {
    const { code, stdout } = systemPackages(['--dry-run'], ['polkitd']);

    expect(code).toBe(0);
    expect(stdout).toContain(
      '[dry run] apt-get install --no-install-recommends nftables network-manager wpasupplicant wireless-regdb parted e2fsprogs smartmontools',
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
      ],
    );

    expect(code).toBe(0);
    expect(stdout).toContain('already installed');
  });

  it.skipIf(process.getuid?.() === 0)('installs nothing unless it runs as root', () => {
    const { code, output } = systemPackages([], []);

    expect(code).not.toBe(0);
    expect(output).toContain('it has to run as root');
    expect(output).not.toContain('apt-get install');
  });

  it('refuses an option it does not know', () => {
    const { code, output } = systemPackages(['--everything'], []);

    expect(code).not.toBe(0);
    expect(output).toContain('unknown option');
  });
});

describe('what a NAS has no use for', () => {
  const all = [
    'polkitd',
    'nftables',
    'network-manager',
    'wpasupplicant',
    'wireless-regdb',
    'parted',
    'e2fsprogs',
    'smartmontools',
  ];

  /** apt-get, whose simulated purge takes away the packages named and `extra`. */
  function apt(extra = '') {
    fakeCommand(
      temp.path,
      'apt-get',
      `if [[ $1 == -s ]]; then
  shift; while [[ $1 != -- ]]; do shift; done; shift
  for name in "$@" ${extra}; do printf 'Purg %s [1.0]\\n' "$name"; done
else
  printf 'apt-get %s\\n' "$*"
fi`,
    );
  }

  /** The jobs of cron on the machine: the files named, and whether a package installed each. */
  function cron(jobs: Record<string, boolean> = {}) {
    const root = join(temp.path, 'cron');
    for (const [path, packaged] of Object.entries(jobs)) {
      mkdirSync(join(root, path, '..'), { recursive: true });
      writeFileSync(join(root, path), packaged ? 'packaged' : 'by hand');
    }
    return root;
  }

  function packages(installed: string[], cronRoot = cron()) {
    // `-S` names the package of a file: those written "packaged" have one.
    fakeCommand(
      temp.path,
      'dpkg-query',
      `if [[ $1 == -S ]]; then grep -qx packaged "${'$'}{NAS_CRON_ROOT}$2"; exit; fi
case " ${installed.join(' ')} " in *" \${@: -1} "*) printf 'install ok installed' ;; *) exit 1 ;; esac`,
    );
    return run(join(OS_CONFIGURATION, 'scripts/system-packages.sh'), {
      env: {
        NAS_CONFIGURATION_STATE: state(),
        NAS_CRON_ROOT: cronRoot,
        PATH: `${temp.path}:${process.env.PATH}`,
      },
    });
  }

  it('purges ModemManager and BlueZ when nothing else goes with them, then cleans up', () => {
    apt();
    const { code, stdout } = packages([...all, 'modemmanager', 'bluez']);

    expect(code).toBe(0);
    expect(stdout).toContain(
      'apt-get purge -q -y -o DPkg::Lock::Timeout=600 -- modemmanager bluez',
    );
    expect(stdout).toContain('removed, a NAS has no use for them: modemmanager bluez');
    expect(stdout).not.toContain('apt-get install');
    expect(stdout).toContain('apt-get autoremove --purge');
    expect(stdout).toContain('apt-get clean');
  });

  it('keeps them when removing them would take a desktop away too', () => {
    apt('gnome-bluetooth');
    const { code, stdout } = packages([...all, 'bluez']);

    expect(code).toBe(0);
    expect(stdout).toContain('kept bluez: removing them would take away other packages too');
    expect(stdout).not.toContain('apt-get purge');
  });

  it('purges cron, whose work the timers of systemd do, unless it has jobs of its own', () => {
    apt();
    const idle = packages([...all, 'cron'], cron({ 'etc/cron.daily/dpkg': true }));
    expect(idle.stdout).toContain('apt-get purge -q -y -o DPkg::Lock::Timeout=600 -- cron');
    expect(idle.stdout).toContain('removed, a NAS has no use for them: cron');

    const jobSets: Array<Record<string, boolean>> = [
      { 'var/spool/cron/crontabs/valerio': false },
      { 'etc/cron.d/backup-by-hand': false },
      { 'etc/cron.weekly/report': false },
    ];
    for (const jobs of jobSets) {
      const busy = packages([...all, 'cron'], cron(jobs));
      expect(busy.stdout, Object.keys(jobs)[0]).toContain('kept cron: it has jobs of its own');
      expect(busy.stdout).not.toContain('apt-get purge');
      rmSync(join(temp.path, 'cron'), { recursive: true, force: true });
    }
  });

  it('weighs each package alone: one a desktop needs does not keep the others', () => {
    fakeCommand(
      temp.path,
      'apt-get',
      `if [[ $1 == -s ]]; then
  printf 'Purg %s [1.0]\\n' "${'$'}{@: -1}"
  if [[ ${'$'}{@: -1} == bluez ]]; then printf 'Purg gnome-bluetooth [1.0]\\n'; fi
else
  printf 'apt-get %s\\n' "$*"
fi`,
    );
    const { code, stdout } = packages([...all, 'modemmanager', 'bluez', 'cron']);

    expect(code).toBe(0);
    expect(stdout).toContain('kept bluez: removing them would take away other packages too');
    expect(stdout).toContain('apt-get purge -q -y -o DPkg::Lock::Timeout=600 -- modemmanager cron');
  });

  it('keeps a package whose purge apt cannot even simulate', () => {
    fakeCommand(
      temp.path,
      'apt-get',
      `if [[ $1 == -s ]]; then exit 100; fi
printf 'apt-get %s\\n' "$*"`,
    );
    const { code, stdout } = packages([...all, 'cron']);

    expect(code).toBe(0);
    expect(stdout).toContain('kept cron: removing them would take away other packages too');
    expect(stdout).not.toContain('apt-get purge');
  });

  it('says what it would remove in a dry run, and removes nothing', () => {
    apt();
    fakeCommand(
      temp.path,
      'dpkg-query',
      `case " ${[...all, 'modemmanager'].join(' ')} " in *" \${@: -1} "*) printf 'install ok installed' ;; *) exit 1 ;; esac`,
    );
    const { code, stdout } = run(join(OS_CONFIGURATION, 'scripts/system-packages.sh'), {
      args: ['--dry-run'],
      env: { PATH: `${temp.path}:${process.env.PATH}` },
    });

    expect(code).toBe(0);
    expect(stdout).toContain('[dry run] apt-get purge modemmanager');
    expect(stdout).not.toContain('apt-get purge -q');
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
      'apt-get install -q -y --no-install-recommends -o DPkg::Lock::Timeout=600 -- nftables network-manager wpasupplicant wireless-regdb parted e2fsprogs smartmontools',
    );
    expect(stdout).toContain('apt-get autoremove --purge -q -y -o DPkg::Lock::Timeout=600');
    expect(stdout).toContain('apt-get clean');
    expect(stdout).toContain('systemctl enable nas-os-base-firewall.service');
    expect(readFileSync(join(state(), 'packages'), 'utf8')).toBe(
      'nftables\nnetwork-manager\nwpasupplicant\nwireless-regdb\nparted\ne2fsprogs\nsmartmontools\n',
    );
    expect(
      readFileSync(
        join(temp.path, 'root', 'etc/systemd/system/nas-os-base-firewall.service'),
        'utf8',
      ),
    ).toContain('ExecStart=/usr/local/lib/nas-os-configuration/base-firewall.sh');
  });

  it('removes those packages, once each, and nothing that is not a package name', () => {
    mkdirSync(state());
    writeFileSync(join(state(), 'packages'), 'nftables\nnftables\n; rm -rf /\nnetwork-manager\n');

    const { code, stdout } = asRoot('scripts/uninstall.sh');

    expect(code).toBe(0);
    expect(stdout).toContain('apt-get purge -q -y --autoremove -- network-manager nftables');
    expect(stdout).not.toContain('rm -rf');
    expect(existsSync(state())).toBe(false);
  });

  it('removes nothing when it installed nothing', () => {
    const { code, stdout } = asRoot('scripts/uninstall.sh');

    expect(code).toBe(0);
    expect(stdout).toContain('nothing to remove');
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
    expect(readFileSync(join(state(), 'packages'), 'utf8')).toBe('cog\nlibgles2\n');
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
  it('starts with drop policies and limits exposed ports and application egress', () => {
    const { code, stdout } = run(join(OS_CONFIGURATION, 'files/base-firewall.sh'), {
      args: ['--print'],
    });

    expect(code).toBe(0);
    expect(stdout.match(/policy drop;/g)).toHaveLength(3);
    expect(stdout).toContain('tcp dport 80 accept');
    expect(stdout).toContain('tcp dport 443 accept');
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
    expect(stdout).not.toContain('dport 445');
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
      expect(stdout).toContain('tcp dport 443 accept');
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
    expect(stdout).toContain('add rule inet nas_base input tcp dport 443 accept');
    expect(stdout).toContain('socket cgroupv2 level 2 @nas_apps_out tcp dport { 80, 443 } accept');
    expect(stdout).not.toContain('delete table');
    expect(stdout).not.toContain('flush set');
    expect(stdout.indexOf('add set inet nas_base nas_apps_smtp')).toBeLessThan(
      stdout.indexOf('@nas_apps_smtp tcp dport'),
    );
    expect(stdout.indexOf('add set inet nas_base nas_shares')).toBeLessThan(
      stdout.indexOf('tcp dport @nas_shares'),
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
      'launcher-token.sh" --clear',
      '$LAUNCHER_TOOLS/uninstall.sh" --purge',
      '$GATEWAY_TOOLS/uninstall.sh" --purge',
      '$configuration/scripts/screen.sh" --remove',
      '$configuration/scripts/firewall.sh" --remove',
      '$configuration/scripts/wifi.sh" --remove',
      '$configuration/scripts/uninstall.sh"',
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
