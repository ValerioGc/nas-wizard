import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { userInfo } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fakeCommand, ROOT, run, workspace } from './helpers';

const SCRIPT = join(ROOT, 'system/packages/post_wizard/install.sh');
const STEPS = [
  'download_gateway',
  'download_ui',
  'install_gateway',
  'install_ui',
  'configure',
  'disks',
  'account',
  'certificate',
  'complete',
];

let temp: ReturnType<typeof workspace>;
let wizard = '';

beforeEach(() => {
  temp = workspace();
  wizard = fakeCommand(
    temp.path,
    'nas-wizard',
    `printf '%s | %s\\n' "$*" "$(cat "$WIZARD_TOKEN_PATH")" >> ${JSON.stringify(join(temp.path, 'calls'))}\necho 9.9.9`,
  );
});

afterEach(() => temp.remove());

function postWizard(
  extra: string[] = [],
  input = 'ghp_secret\nOwner\nlong enough\n',
  script = SCRIPT,
) {
  return run(script, {
    env: { NAS_WIZARD_PACKAGE: join(temp.path, 'package') },
    args: [
      '--user',
      'owner',
      '--language',
      'it',
      '--theme',
      'dark',
      '--name',
      'attic',
      '--wizard',
      wizard,
      '--work',
      join(temp.path, 'work'),
      ...extra,
    ],
    input,
  });
}

describe('post_wizard/install.sh', () => {
  it('announces every step in order, and simulates what installs', () => {
    const { code, stdout } = postWizard(['--simulate']);

    expect(code).toBe(0);
    const started = stdout
      .split('\n')
      .filter((line) => line.startsWith('@@step '))
      .map((line) => line.slice('@@step '.length));
    expect(started).toEqual(STEPS);
    expect(stdout).toContain('@@detail version 9.9.9');
    expect(stdout).toContain('@@detail simulated');
    expect(stdout.match(/@@done /g)).toHaveLength(STEPS.length);
  });

  it('prepares the chosen disks with the wizard once the launcher is there, none without a list', () => {
    const none = postWizard(['--simulate']);
    expect(none.stdout).toMatch(/@@step disks\n@@detail none\n@@done disks/);

    const list = join(temp.path, 'disks.json');
    writeFileSync(list, '[{"device":"sdb","identity":"x/y/1","encrypt":true}]');
    const simulated = postWizard(['--disks', list, '--simulate']);
    expect(simulated.code).toBe(0);
    expect(simulated.stdout).toMatch(/@@step disks\n@@detail simulated\n@@done disks/);

    const missing = postWizard(['--disks', join(temp.path, 'nothing.json'), '--simulate']);
    expect(missing.code).not.toBe(0);
    expect(missing.output).toContain('the list of the disks is not at');

    const script = readFileSync(SCRIPT, 'utf8');
    expect(script.indexOf('step disks prepare_disks')).toBeGreaterThan(
      script.indexOf('step configure configure'),
    );
    expect(script).toContain('"$wizard" disks "$disks"');
  });

  it('hands the token to the downloads in a file, never on a command line', () => {
    postWizard(['--simulate']);
    const calls = readFileSync(join(temp.path, 'calls'), 'utf8').split('\n').filter(Boolean);

    expect(calls).toEqual([
      `fetch gateway --into ${join(temp.path, 'work', 'gateway')} | ghp_secret`,
      `fetch ui --into ${join(temp.path, 'work', 'ui')} | ghp_secret`,
    ]);
  });

  it('in a simulation leaves the package and the manuals where they are', () => {
    mkdirSync(join(temp.path, 'package', 'packages'), { recursive: true });
    writeFileSync(join(temp.path, 'package', 'install.sh'), '');
    writeFileSync(
      wizard,
      `#!/usr/bin/env bash\nmkdir -p "$4"\n[[ $2 == ui ]] && echo pdf > "$4/nas_os_user_manual_0.1.20.pdf"\necho 9.9.9\n`,
    );
    const { code, stdout } = postWizard(['--simulate']);

    expect(code).toBe(0);
    expect(readdirSync(join(temp.path, 'package')).sort()).toEqual(['install.sh', 'packages']);
    expect(stdout).not.toContain('manual copied');
    expect(stdout).not.toContain('package emptied');
  });

  it('tidies up last, after the launcher is installed and configured, and never fails for it', () => {
    const source = readFileSync(SCRIPT, 'utf8');
    const tail = source.slice(source.indexOf('step download_gateway'));

    expect(tail.indexOf('clean_package')).toBeGreaterThan(tail.indexOf('step complete complete'));
    expect(source).toContain(
      `bash "$here/clean-package.sh" --user "$user" --package "$package" --installed "$installed"`,
    );
    expect(source).toContain("|| echo 'warning: the package the NAS was installed from stays");
  });

  it('starts again from the step it is told, for a retry', () => {
    const { stdout } = postWizard(['--simulate', '--from', 'install_ui']);

    expect(stdout).not.toContain('@@step download_gateway');
    expect(stdout).toContain('@@step install_ui');
    expect(stdout).toContain('@@done complete');
  });

  it('stops at the step that fails, with its status', () => {
    writeFileSync(wizard, '#!/usr/bin/env bash\necho "owner/ui refused the token" >&2\nexit 7\n');
    const { code, stdout, output } = postWizard(['--simulate']);

    expect(code).toBe(7);
    expect(stdout).toContain('@@step download_gateway');
    expect(stdout).not.toContain('@@done download_gateway');
    expect(output).toContain('refused the token');
  });

  it('refuses the removed wizard options for mTLS and device certificates', () => {
    for (const flag of ['--mtls', '--device', '--icon']) {
      const { code, output } = postWizard(['--simulate', flag]);
      expect(code, flag).toBe(2);
      expect(output).toContain(`unknown option: ${flag}`);
    }
  });

  it('refuses what is not a user, a language, a theme, a name or a step', () => {
    for (const [flag, value] of [
      ['--user', 'Root User'],
      ['--language', 'fr'],
      ['--theme', 'blue'],
      ['--name', 'the attic'],
      ['--name', '-attic'],
      ['--from', 'everything'],
    ]) {
      const { code, output } = postWizard(['--simulate', flag as string, value as string]);
      expect(code, flag).toBe(2);
      expect(output, flag).toContain('error:');
    }
  });

  it.skipIf(process.getuid?.() === 0)('installs nothing unless it runs as root', () => {
    const { code, output } = postWizard();

    expect(code).not.toBe(0);
    expect(output).toContain('it has to run as root');
  });
});

describe('pre_wizard/install.sh', () => {
  const PRE = join(ROOT, 'system/packages/pre_wizard/install.sh');

  it('configures the operating system, and asks for nothing', () => {
    fakeCommand(temp.path, 'dpkg-query', "printf 'install ok installed'");
    const { code, stdout } = run(PRE, {
      args: ['--dry-run'],
      env: { PATH: `${temp.path}:${process.env.PATH}` },
    });

    expect(code).toBe(0);
    expect(stdout).toContain('== Operating system');
    expect(stdout).toContain('system packages already installed');
    expect(stdout).toContain('[dry run] install');
  });

  it('refuses an option it does not know', () => {
    const { code, output } = run(PRE, { args: ['--everything'] });

    expect(code).toBe(2);
    expect(output).toContain('unknown option');
  });
});

describe('post_wizard/clean-package.sh', () => {
  const CLEAN = join(ROOT, 'system/packages/post_wizard/clean-package.sh');
  const owner = userInfo().username;

  function installedNas() {
    const parent = join(temp.path, 'home');
    const folder = join(parent, 'nas-wizard');
    mkdirSync(join(folder, 'packages', 'post_wizard'), { recursive: true });
    mkdirSync(join(folder, 'wizard', 'bin'), { recursive: true });
    writeFileSync(join(folder, 'install.sh'), '');
    writeFileSync(join(folder, 'packages', 'uninstall.sh'), '#!/usr/bin/env bash\n');
    writeFileSync(join(folder, 'nas_os_installation_manual_0.1.14.pdf'), 'old');
    for (const name of [
      'nas-wizard-0.1.14-linux-x64.tar.gz',
      'nas-wizard-0.1.14-linux-x64.tar.gz.sha256',
      'notes.txt',
    ]) {
      writeFileSync(join(parent, name), '');
    }
    const installed = join(temp.path, 'installed');
    mkdirSync(installed);
    writeFileSync(join(installed, 'nas_os_installation_manual_0.1.14.pdf'), 'installation');
    const work = join(temp.path, 'work');
    mkdirSync(join(work, 'ui'), { recursive: true });
    writeFileSync(join(work, 'ui', 'nas_os_user_manual_0.1.20.pdf'), 'user');
    const home = join(temp.path, 'user-home');
    mkdirSync(home);
    const updates = join(temp.path, 'updates');
    mkdirSync(join(updates, '0.1.15'), { recursive: true });
    return { parent, folder, installed, work, home, updates };
  }

  function clean(nas: ReturnType<typeof installedNas>, package_ = nas.folder, user = owner) {
    return run(CLEAN, {
      env: { NAS_PACKAGE_USER_HOME: nas.home, NAS_WIZARD_UPDATES: nas.updates },
      args: [
        '--user',
        user,
        '--package',
        package_,
        '--installed',
        nas.installed,
        '--work',
        nas.work,
      ],
    });
  }

  it('puts the manuals in the home of the user, in place of older ones', () => {
    const nas = installedNas();
    writeFileSync(join(nas.home, 'nas_os_user_manual_0.1.10.pdf'), 'older');
    const { code, stdout } = clean(nas);

    expect(code).toBe(0);
    expect(readdirSync(nas.home).sort()).toEqual([
      'nas_os_installation_manual_0.1.14.pdf',
      'nas_os_user_manual_0.1.20.pdf',
    ]);
    expect(readFileSync(join(nas.home, 'nas_os_user_manual_0.1.20.pdf'), 'utf8')).toBe('user');
    expect(stdout).toContain(`manual copied: ${join(nas.home, 'nas_os_user_manual_0.1.20.pdf')}`);
  });

  it('empties the unpacked package but for uninstall.sh, with its archive and a newer wizard', () => {
    const nas = installedNas();
    const { code, stdout } = clean(nas);

    expect(code).toBe(0);
    expect(readdirSync(nas.folder)).toEqual(['uninstall.sh']);
    expect(readFileSync(join(nas.folder, 'uninstall.sh'), 'utf8')).toBe('#!/usr/bin/env bash\n');
    expect(statSync(join(nas.folder, 'uninstall.sh')).mode & 0o777).toBe(0o755);
    expect(readdirSync(nas.parent).sort()).toEqual(['nas-wizard', 'notes.txt']);
    expect(existsSync(nas.updates)).toBe(false);
    expect(stdout).toContain(`package emptied: ${nas.folder} keeps only uninstall.sh`);
  });

  it('never empties the installed wizard, nor a folder that is not an unpacked package', () => {
    const nas = installedNas();
    mkdirSync(join(nas.installed, 'packages'));
    writeFileSync(join(nas.installed, 'install.sh'), '');
    writeFileSync(join(nas.installed, 'packages', 'uninstall.sh'), '');
    mkdirSync(join(nas.installed, 'wizard'));
    const installed = readdirSync(nas.installed).sort();

    expect(clean(nas, nas.installed).stdout).toContain('no unpacked package to empty');
    expect(readdirSync(nas.installed).sort()).toEqual(installed);

    rmSync(join(nas.folder, 'wizard'), { recursive: true });
    expect(clean(nas).stdout).toContain('no unpacked package to empty');
    expect(readdirSync(nas.folder)).toContain('install.sh');
    expect(readdirSync(nas.parent)).toContain('nas-wizard-0.1.14-linux-x64.tar.gz');

    expect(clean(nas, join(temp.path, 'gone')).code).toBe(0);
  });

  it('says so when the user has no home, and goes on', () => {
    const nas = installedNas();
    rmSync(nas.home, { recursive: true });
    const { code, stdout } = clean(nas);

    expect(code).toBe(0);
    expect(stdout).toContain(`warning: ${owner} has no home`);
    expect(readdirSync(nas.folder)).toEqual(['uninstall.sh']);
  });

  it('refuses what is not a user, or a missing folder', () => {
    const nas = installedNas();
    expect(clean(nas, nas.folder, 'Not A User').output).toContain('not a user name');
    expect(run(CLEAN, { args: ['--user', owner] }).output).toContain('name a folder each');
    expect(run(CLEAN, { args: ['--user'] }).output).toContain('--user needs a value');
    expect(run(CLEAN, { args: ['--other'] }).output).toContain('unknown option: --other');
    expect(readdirSync(nas.folder)).toContain('install.sh');
  });
});
