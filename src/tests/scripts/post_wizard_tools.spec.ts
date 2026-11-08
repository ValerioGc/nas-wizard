import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { userInfo } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fakeCommand, ROOT, run, workspace } from './helpers';

const TOOLS = join(ROOT, 'system/packages/post_wizard/tools');
const STATUS = join(TOOLS, 'nas-status.sh');
const RESTART = join(TOOLS, 'nas-restart.sh');

let temp: ReturnType<typeof workspace>;
let server: ChildProcess | undefined;
let ports = 0;

beforeEach(() => {
  temp = workspace();
});

afterEach(() => {
  server?.kill();
  server = undefined;
  temp.remove();
});

/** A port that answers 200 on /health, standing for the launcher and the gateway. */
function healthy() {
  const port = 41_000 + (process.pid % 9_000) + (ports += 1);
  server = spawn(process.execPath, [
    '-e',
    `require('node:http').createServer((_, answer) => answer.end('ok')).listen(${port})`,
  ]);
  execFileSync('bash', [
    '-c',
    `for i in {1..150}; do (exec 3<>/dev/tcp/127.0.0.1/${port}) 2>/dev/null && exit 0; sleep 0.1; done; exit 1`,
  ]);
  return port;
}

/** A free port, where nothing answers. */
function silent() {
  return 41_000 + (process.pid % 9_000) + (ports += 1);
}

/** Fakes of systemd and of the system, which record each call. */
function machine(options: { updating?: boolean; apps?: string; wizard?: boolean } = {}) {
  const calls = join(temp.path, 'calls');
  const state = join(temp.path, 'state');
  mkdirSync(state, { recursive: true });
  const log = (name: string) => `printf '${name} %s\\n' "$*" >> ${JSON.stringify(calls)}\n`;
  fakeCommand(
    temp.path,
    'systemctl',
    `${log('systemctl')}case "$*" in
       'show -p LoadState --value '*) echo loaded ;;
       'show -p ActiveState --value '*) echo active ;;
       'show -p SubState --value '*) echo running ;;
       'is-active --quiet nas-os-update.service') ${options.updating ? 'exit 0' : 'exit 3'} ;;
       'is-active --quiet nas-os-update-verify.service') exit 3 ;;
       'is-active --quiet nas-wizard.service') ${options.wizard ? 'exit 0' : 'exit 3'} ;;
       'is-active --quiet nas-os-base-firewall.service') exit 0 ;;
       'list-units --state=active'*) printf '%s' ${JSON.stringify(options.apps ?? '')} ;;
     esac
     exit 0`,
  );
  fakeCommand(temp.path, 'journalctl', `${log('journalctl')}exit 0`);
  fakeCommand(
    temp.path,
    'ip',
    `case "$*" in
       *address*) echo '2: eth0    inet 192.168.1.14/24 scope global eth0' ;;
       *route*) echo 'default via 192.168.1.1 dev eth0' ;;
     esac`,
  );
  const home = join(temp.path, 'home');
  mkdirSync(home, { recursive: true });
  const env = (launcher: number, gateway = launcher) => ({
    NAS_TOOLS_STATE: state,
    NAS_TOOLS_CONNECTION: join(temp.path, 'connection'),
    NAS_TOOLS_LAUNCHER_PORT: String(launcher),
    NAS_TOOLS_GATEWAY_PORT: String(gateway),
    NAS_TOOLS_PROBE_HOST: 'localhost',
    NAS_TOOLS_LAUNCHER_CHECK: join(temp.path, 'missing-check'),
    NAS_TOOLS_TRIES: '1',
    NAS_TOOLS_PAUSE: '0',
    HOME: home,
    SUDO_USER: '',
    PATH: `${temp.path}:${process.env.PATH}`,
  });
  return {
    state,
    home,
    env,
    calls: () => (existsSync(calls) ? readFileSync(calls, 'utf8') : ''),
  };
}

/** What neither tool may ever touch, so the console and SSH keep working. */
const DEBIAN =
  /systemctl (start|stop|restart|reload|enable|disable|mask)[^\n]*(ssh|getty|NetworkManager|networking|systemd-networkd|polkit)/;

describe('tools/nas-status.sh', () => {
  it('only reads, and finds nothing wrong on a NAS that answers', () => {
    const nas = machine();
    const port = healthy();
    writeFileSync(join(temp.path, 'connection'), `${port}\n`);
    const { code, stdout } = run(STATUS, { env: nas.env(port) });

    expect(stdout).toContain('[ok]   nas-os.service active (running)');
    expect(stdout).toContain(`[ok]   the launcher answers on 127.0.0.1:${port}`);
    expect(stdout).toContain(`[ok]   the HTTPS port ${port} accepts connections`);
    expect(stdout).toContain('[ok]   address eth0 192.168.1.14/24');
    expect(stdout).toContain('[ok]   no check after an update is pending');
    if (process.getuid?.() !== 0) {
      expect(stdout).toContain('Run it with sudo to see everything.');
      expect(code).toBe(0);
    }
    expect(nas.calls()).not.toMatch(/systemctl (start|stop|restart|reload|enable|disable|reset)/);
  });

  it('says what does not answer, and how to restart it', () => {
    const nas = machine();
    const { code, stdout } = run(STATUS, { env: nas.env(silent()) });

    expect(code).not.toBe(0);
    expect(stdout).toMatch(/\[KO\] {3}the launcher does not answer on 127\.0\.0\.1:\d+/);
    expect(stdout).toMatch(/\[KO\] {3}the gateway does not answer on port \d+/);
    expect(stdout).toContain('sudo ~/nas-tools/nas-restart.sh');
  });

  it('tells about a pending check after an update, and how to turn it off', () => {
    const nas = machine();
    mkdirSync(join(nas.state, 'update-verify'));
    writeFileSync(join(nas.state, 'update-verify', 'pending'), 'phase=installed\n');
    writeFileSync(join(nas.state, 'launcher-update.status'), 'restarting launcher\n');
    const { stdout } = run(STATUS, { env: nas.env(silent()) });

    expect(stdout).toContain('last status restarting launcher');
    expect(stdout).toContain('a check after the update is pending');
    expect(stdout).toContain('sudo systemctl disable nas-os-update-verify.service');
  });

  it('adds the logs on request, and saves the report in the home, readable only there', () => {
    const nas = machine();
    const { stdout } = run(STATUS, { env: nas.env(silent()), args: ['--logs', '5', '--save'] });

    expect(nas.calls()).toContain('journalctl -b -u nas-os --no-pager -q -n 5');
    const reports = readdirSync(nas.home).filter((name) => name.startsWith('nas-report-'));
    expect(reports).toHaveLength(1);
    const report = join(nas.home, reports[0]!);
    expect(statSync(report).mode & 0o777).toBe(0o600);
    expect(readFileSync(report, 'utf8')).toContain('== Services of the NAS');
    expect(stdout).toContain(`Report written to ${report}`);
  });

  it('refuses an option it does not know', () => {
    expect(run(STATUS, { args: ['--other'] }).code).toBe(2);
  });
});

describe('tools.sh', () => {
  const TOOLS_SCRIPT = join(ROOT, 'system/packages/post_wizard/tools.sh');
  const owner = userInfo().username;

  function tools(args: string[], home = join(temp.path, 'admin')) {
    return run(TOOLS_SCRIPT, {
      args,
      env: { NAS_TOOLS_HOME: home, NAS_TOOLS_RECORD: join(temp.path, 'state', 'nas-tools') },
    });
  }

  it('copies the tools into ~/nas-tools, executable, and writes the folder down', () => {
    const home = join(temp.path, 'admin');
    mkdirSync(join(home, 'nas-tools'), { recursive: true });
    writeFileSync(join(home, 'nas-tools', 'nas-status.sh'), 'old');
    const { code, stdout } = tools(['--install', owner]);

    expect(code).toBe(0);
    const folder = join(home, 'nas-tools');
    expect(readdirSync(folder).sort()).toEqual(['README.txt', 'nas-restart.sh', 'nas-status.sh']);
    expect(readFileSync(join(folder, 'nas-status.sh'), 'utf8')).toBe(readFileSync(STATUS, 'utf8'));
    expect(statSync(join(folder, 'nas-restart.sh')).mode & 0o777).toBe(0o755);
    expect(statSync(join(folder, 'README.txt')).mode & 0o777).toBe(0o644);
    expect(stdout).toContain(`tool copied: ${join(folder, 'nas-restart.sh')}`);
    expect(readFileSync(join(temp.path, 'state', 'nas-tools'), 'utf8')).toBe(`${folder}\n`);

    tools(['--install', owner]);
    expect(readFileSync(join(temp.path, 'state', 'nas-tools'), 'utf8')).toBe(`${folder}\n`);
  });

  it('takes away only its own files on removal, and keeps the rest of the folder', () => {
    const home = join(temp.path, 'admin');
    mkdirSync(home);
    tools(['--install', owner]);
    writeFileSync(join(home, 'nas-tools', 'notes.txt'), 'mine');
    const { code, stdout } = tools(['--remove']);

    expect(code).toBe(0);
    expect(readdirSync(join(home, 'nas-tools'))).toEqual(['notes.txt']);
    expect(stdout).toContain('keeps the other files there');
    expect(existsSync(join(temp.path, 'state', 'nas-tools'))).toBe(false);

    rmSync(join(home, 'nas-tools', 'notes.txt'));
    tools(['--install', owner]);
    tools(['--remove']);
    expect(existsSync(join(home, 'nas-tools'))).toBe(false);
  });

  it('never copies through a link, and never fails for a missing home', () => {
    const home = join(temp.path, 'admin');
    const elsewhere = join(temp.path, 'elsewhere');
    mkdirSync(home);
    mkdirSync(elsewhere);
    symlinkSync(elsewhere, join(home, 'nas-tools'));

    const linked = tools(['--install', owner]);
    expect(linked.code).toBe(0);
    expect(readdirSync(elsewhere)).toEqual([]);
    expect(linked.stdout).toContain('warning: the tools could not be copied');

    const homeless = tools(['--install', owner], join(temp.path, 'gone'));
    expect(homeless.code).toBe(0);
    expect(homeless.stdout).toContain('has no home');
    expect(tools(['--remove']).stdout).toContain('no console tools to remove');
  });

  it('refuses what is not a user, or an option it does not know', () => {
    expect(tools(['--install', 'Not A User']).output).toContain('not a user name');
    expect(tools(['--other']).code).toBe(2);
  });
});

describe('tools/nas-restart.sh', () => {
  it('restarts the launcher and the gateway, and checks that they answer', () => {
    const nas = machine();
    const port = healthy();
    const { code, stdout } = run(RESTART, { env: nas.env(port) });

    expect(code).toBe(0);
    expect(nas.calls()).toContain('systemctl restart nas-os.service nas-os-gateway.service\n');
    expect(stdout).toContain('[ok]   the launcher answers');
    expect(stdout).toContain('The NAS answers again.');
    expect(nas.calls()).not.toMatch(DEBIAN);
    expect(nas.calls()).not.toContain('nas-os-base-firewall');
  });

  it('says so when the NAS still does not answer', () => {
    const nas = machine();
    const { code, output } = run(RESTART, { env: nas.env(silent()) });

    expect(code).toBe(1);
    expect(output).toContain('[KO]   the launcher does not answer');
    expect(output).toContain('nas-status.sh --logs');
  });

  it('loads the base firewall again with a reload, never with a restart', () => {
    const nas = machine();
    run(RESTART, { env: nas.env(healthy()), args: ['--firewall'] });

    expect(nas.calls()).toContain('systemctl reload nas-os-base-firewall.service');
    expect(nas.calls()).not.toMatch(/systemctl (re)?start[^\n]*nas-os-base-firewall/);
  });

  it('restarts the running applications on request', () => {
    const nas = machine({ apps: 'nas-app@photos.service loaded active running x\n' });
    run(RESTART, { env: nas.env(healthy()), args: ['--apps'] });

    expect(nas.calls()).toContain('systemctl restart nas-app@photos.service');
  });

  it('refuses while an update runs or waits for its check, unless forced', () => {
    const updating = machine({ updating: true });
    const refused = run(RESTART, { env: updating.env(silent()) });
    expect(refused.code).toBe(1);
    expect(refused.output).toContain('an update of the NAS is running');
    expect(updating.calls()).not.toContain('systemctl restart');

    const pending = machine();
    mkdirSync(join(pending.state, 'update-verify'), { recursive: true });
    writeFileSync(join(pending.state, 'update-verify', 'pending'), 'phase=installed\n');
    expect(run(RESTART, { env: pending.env(silent()) }).output).toContain('add --force');

    const forced = run(RESTART, { env: pending.env(healthy()), args: ['--force'] });
    expect(forced.code).toBe(0);
  });

  it('never starts the gateway while the wizard holds its port, unless forced', () => {
    const nas = machine({ wizard: true });
    const refused = run(RESTART, { env: nas.env(silent()) });

    expect(refused.code).toBe(1);
    expect(refused.output).toContain('the wizard is configuring the NAS');
    expect(nas.calls()).not.toContain('systemctl restart');
    expect(run(STATUS, { env: nas.env(silent()) }).stdout).toContain('The wizard is running');
  });

  it('needs root, and refuses an option it does not know', () => {
    if (process.getuid?.() !== 0) {
      const { code, output } = run(RESTART, { env: { NAS_TOOLS_STATE: '' } });
      expect(code).toBe(1);
      expect(output).toContain('it has to run as root');
    }
    expect(run(RESTART, { args: ['--other'] }).code).toBe(2);
  });
});
