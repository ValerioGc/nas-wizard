import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  fakeCommand,
  fakeMachineSecurity,
  OS_CONFIGURATION,
  ROOT,
  run,
  workspace,
  type MachineSecurity,
} from './helpers';

const scripts = [
  join(ROOT, 'install.sh'),
  join(ROOT, 'system/packages/uninstall.sh'),
  join(ROOT, 'system/packages/pre_wizard/install.sh'),
  join(ROOT, 'system/packages/pre_wizard/check-security.sh'),
  join(ROOT, 'system/packages/post_wizard/install.sh'),
  join(ROOT, 'system/packages/post_wizard/clean-package.sh'),
  ...[
    'install.sh',
    'scripts/system-packages.sh',
    'scripts/firewall.sh',
    'files/base-firewall.sh',
    'scripts/uninstall.sh',
  ].map((name) => join(OS_CONFIGURATION, name)),
];

let temp: ReturnType<typeof workspace>;

beforeEach(() => {
  temp = workspace();
});

afterEach(() => temp.remove());

/**
 * The entry script on a machine that says it is `system`, with the packages it needs present and,
 * unless `security` says otherwise, the system on LUKS and a TPM 2.0.
 */
function entry(
  args: string[],
  system = 'ID=debian\nVERSION_ID="13"\n',
  env: NodeJS.ProcessEnv = {},
  security: MachineSecurity = {},
) {
  const release = join(temp.path, 'os-release');
  writeFileSync(release, system);
  fakeCommand(temp.path, 'dpkg-query', "printf 'install ok installed'");
  const machine = fakeMachineSecurity(temp.path, security);
  return run(join(ROOT, 'install.sh'), {
    args,
    env: {
      NAS_OS_RELEASE: release,
      PATH: `${temp.path}:${process.env.PATH}`,
      ...machine,
      ...env,
    },
  });
}

describe('the scripts of the package', () => {
  it.each(scripts)('%s parses, stops on an unset variable and explains itself', (script) => {
    expect(() => execFileSync('bash', ['-n', script])).not.toThrow();
    const source = readFileSync(script, 'utf8');
    const lines = source.split('\n');

    expect(source).toMatch(/^set -[eu]*u[eo]*/m);
    expect(lines[0]).toBe('#!/usr/bin/env bash');
    expect(lines.slice(1, 12).filter((line) => line.startsWith('#')).length).toBeGreaterThan(3);
  });
});

describe('install.sh', () => {
  it('configures the system, then installs the wizard as a unit on port 80', () => {
    const { code, stdout } = entry(['--dry-run']);

    expect(code).toBe(0);
    expect(stdout).toContain('Dry run: no change will be applied.');
    expect(stdout).toContain('system packages already installed');
    expect(stdout).toContain('[dry run] install');
    expect(stdout).toContain('self-update --into');
    expect(stdout).toContain(
      '/usr/local/lib/nas-wizard, write /etc/systemd/system/nas-wizard.service',
    );
    expect(stdout).not.toContain('LoadCredential');
    for (const line of [
      'ExecStart=/usr/local/lib/nas-wizard/wizard/bin/nas-wizard',
      'StateDirectory=nas-wizard',
      'Environment=WIZARD_MODE=real',
      'Environment=WIZARD_ADDRESS=0.0.0.0',
      'Environment=WIZARD_PORT=80',
      'Environment=WIZARD_SCREEN_PORT=8081',
      'Environment=WIZARD_UI_DIR=/usr/local/lib/nas-wizard/wizard/ui',
      `Environment="NAS_WIZARD_PACKAGE=${ROOT}"`,
      'Environment=TOKIO_WORKER_THREADS=2 MALLOC_ARENA_MAX=2',
      'WantedBy=multi-user.target',
    ]) {
      expect(stdout).toContain(line);
    }
  });

  it('names the folder the user unpacked even when a newer wizard runs in its place', () => {
    const { code, stdout } = entry(['--dry-run'], undefined, {
      NAS_WIZARD_ORIGIN: '/home/nas/nas-wizard',
    });
    const source = readFileSync(join(ROOT, 'install.sh'), 'utf8');

    expect(code).toBe(0);
    expect(stdout).toContain('Environment="NAS_WIZARD_PACKAGE=/home/nas/nas-wizard"');
    expect(source).toContain(
      'exec env NAS_WIZARD_UPDATED=1 NAS_WIZARD_ORIGIN="$here" bash "$newer/install.sh" "$@"',
    );
  });

  it('installs the configuration of the system with the wizard, for the uninstall.sh left alone', () => {
    const source = readFileSync(join(ROOT, 'install.sh'), 'utf8');

    expect(source).toContain(
      'cp -a "$packages/os_configuration" "$staging/packages/os_configuration"',
    );
  });

  it('updates a configured NAS: the system again and the files, without a search or a start', () => {
    const { code, stdout } = entry(['--update', '--dry-run']);

    expect(code).toBe(0);
    expect(stdout).toContain('system packages already installed');
    expect(stdout).toContain('no search for a newer one: the launcher chose this wizard');
    expect(stdout).not.toContain('self-update --into');
    expect(stdout).toContain('Environment="NAS_WIZARD_PACKAGE=/usr/local/lib/nas-wizard"');

    const source = readFileSync(join(ROOT, 'install.sh'), 'utf8');
    const update = source.slice(source.indexOf('if $update; then\n  echo "   the wizard'));
    expect(update.indexOf('exit 0')).toBeLessThan(update.indexOf('systemctl enable'));
  });

  it('does not report a configured NAS when the wizard failed and an old gateway is active', () => {
    const source = readFileSync(join(ROOT, 'install.sh'), 'utf8');
    const finish = source.slice(source.indexOf('# An old gateway still running'));
    const script = join(temp.path, 'finish.sh');
    writeFileSync(
      script,
      `set -euo pipefail
UNIT=nas-wizard
address=10.0.2.15
say() { echo "== $1"; }
fail() { echo "error: $1" >&2; exit 1; }
${finish}`,
    );
    fakeCommand(
      temp.path,
      'systemctl',
      `
if [[ $* == *--property=Result* ]]; then echo exit-code;
elif [[ $* == *--property=ExecMainStatus* ]]; then echo 1;
else exit 0; fi`,
    );
    fakeCommand(temp.path, 'journalctl', 'echo "Address already in use"');
    const result = run(script, { env: { PATH: `${temp.path}:${process.env.PATH}` } });
    expect(result.code).toBe(1);
    expect(result.output).toContain('Address already in use');
    expect(result.output).toContain('the wizard failed');
    expect(result.output).not.toContain('the NAS is configured');
  });

  it('stops a running gateway before starting the wizard on its port', () => {
    const source = readFileSync(join(ROOT, 'install.sh'), 'utf8');
    const start = source.slice(
      source.indexOf('if systemctl is-active --quiet nas-os-gateway; then'),
      source.indexOf('\naddress=$(hostname'),
    );
    const script = join(temp.path, 'start.sh');
    writeFileSync(script, `set -euo pipefail\nUNIT=nas-wizard\n${start}`);
    fakeCommand(temp.path, 'systemctl', `echo "$*" >> "${join(temp.path, 'calls')}"`);
    const result = run(script, { env: { PATH: `${temp.path}:${process.env.PATH}` } });
    expect(result.code).toBe(0);
    expect(readFileSync(join(temp.path, 'calls'), 'utf8').split('\n').filter(Boolean)).toEqual([
      'is-active --quiet nas-os-gateway',
      'stop nas-os-gateway',
      'start nas-wizard',
    ]);
  });

  it.each([
    ['80', 'http://10.0.2.15/setup'],
    ['8080', 'http://10.0.2.15:8080/setup'],
  ])('prints the setup URL for port %s', (port, url) => {
    const source = readFileSync(join(ROOT, 'install.sh'), 'utf8');
    const message = source.slice(
      source.indexOf('\naddress=$(hostname'),
      source.indexOf('\njournalctl --unit='),
    );
    const script = join(temp.path, 'message.sh');
    writeFileSync(
      script,
      `set -euo pipefail\nPORT=${port}\nINSTALLED=/wizard\nUNIT=nas-wizard\n${message}`,
    );
    fakeCommand(temp.path, 'hostname', 'echo 10.0.2.15');
    const result = run(script, { env: { PATH: `${temp.path}:${process.env.PATH}` } });

    expect(result.code).toBe(0);
    expect(result.stdout).toContain(`Configuration page ${url}, from a browser`);
  });

  it('asks for nothing: the token is given in the wizard', () => {
    const { stdout } = entry(['--dry-run']);

    expect(stdout).not.toMatch(/token/i);
    expect(stdout).toContain('== Operating system');
  });

  it('only warns on a machine without LUKS or TPM 2.0, and installs anyway', () => {
    const { code, stdout } = entry(['--dry-run'], undefined, {}, { plain: 'vg-root', tpm: '' });

    expect(code).toBe(0);
    expect(stdout).toContain('== Security of the machine');
    expect(stdout).toContain('/ is not on a disk encrypted with LUKS');
    expect(stdout).toContain('no TPM 2.0');
    expect(stdout).toContain('installation manual');
    expect(stdout).toContain('== Operating system');
  });

  it('still takes --development, which is no longer needed', () => {
    const { code, stdout } = entry(['--development', '--dry-run'], undefined, {}, { tpm: '' });

    expect(code).toBe(0);
    expect(stdout).toContain('--development is no longer needed');
    expect(stdout).toContain('== Operating system');
  });

  it('writes the state of the security for the launcher and drops the old mark', () => {
    const source = readFileSync(join(ROOT, 'install.sh'), 'utf8');
    const block = source.slice(
      source.indexOf('check=(--warn-only)'),
      source.indexOf('\nif $dry_run; then\n  "$packages/pre_wizard/install.sh"'),
    );
    const state = join(temp.path, 'state', 'security');
    const old = join(temp.path, 'state', 'security-development');
    const script = join(temp.path, 'state.sh');
    mkdirSync(join(temp.path, 'state'), { recursive: true });
    mkdirSync(join(temp.path, 'packages', 'pre_wizard'), { recursive: true });
    writeFileSync(old, 'installed in development mode');
    fakeCommand(
      temp.path,
      'packages/pre_wizard/check-security.sh',
      'printf "%s\\n" "$@" > "$(dirname "$0")/arguments"; exit 3',
    );
    writeFileSync(
      script,
      `set -euo pipefail\ndry_run=false\npackages=${temp.path}/packages\nSECURITY_STATE=${state}\nOLD_DEVELOPMENT_MARK=${old}\nfail() { echo "$1" >&2; exit 1; }\n${block}`,
    );

    expect(run(script).code).toBe(0);
    expect(readFileSync(join(temp.path, 'packages/pre_wizard/arguments'), 'utf8')).toBe(
      `--warn-only\n--state\n${state}\n`,
    );
    expect(existsSync(old)).toBe(false);
  });

  it('runs on Debian 13 only', () => {
    const { code, output } = entry(['--dry-run'], 'ID=ubuntu\nVERSION_ID="24.04"\n');

    expect(code).not.toBe(0);
    expect(output).toContain("not on 'ubuntu 24.04'");
  });

  it('refuses an option it does not know', () => {
    const { code, output } = entry(['--wipe-everything']);

    expect(code).not.toBe(0);
    expect(output).toContain('unknown option');
  });

  it.skipIf(process.getuid?.() === 0)('touches nothing unless it runs as root', () => {
    const { code, output } = entry([]);

    expect(code).not.toBe(0);
    expect(output).toContain('it has to run as root');
  });
});
