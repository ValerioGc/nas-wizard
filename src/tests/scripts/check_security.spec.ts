import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  fakeCommand,
  fakeMachineSecurity,
  ROOT,
  run,
  workspace,
  type MachineSecurity,
} from './helpers';

const CHECK = join(ROOT, 'system/packages/pre_wizard/check-security.sh');

let temp: ReturnType<typeof workspace>;

beforeEach(() => {
  temp = workspace();
});

afterEach(() => temp.remove());

function check(machine: MachineSecurity = {}, args: string[] = []) {
  const env = fakeMachineSecurity(temp.path, machine);
  return run(CHECK, { args, env: { ...env, PATH: `${temp.path}:${process.env.PATH}` } });
}

describe('check-security.sh', () => {
  it('accepts a system on LUKS with a TPM 2.0', () => {
    const result = check({ swap: '/dev/mapper/vg-swap partition\n/dev/zram0 partition\n' });

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('encrypted with LUKS, TPM 2.0 present');
  });

  it('reads the whole device ancestry after finding LUKS without a broken pipe', () => {
    const env = fakeMachineSecurity(temp.path);
    fakeCommand(temp.path, 'lsblk', "printf 'crypto_LUKS\\n'; printf 'ext4\\n%.0s' {1..32768}");
    const result = run(CHECK, { env: { ...env, PATH: `${temp.path}:${process.env.PATH}` } });

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('encrypted with LUKS, TPM 2.0 present');
  });

  it('stops on a system that is not encrypted and says how to go on', () => {
    const result = check({ plain: 'vg-root' });

    expect(result.code).toBe(1);
    expect(result.stdout).toContain('/ is not on a disk encrypted with LUKS');
    expect(result.stdout).toContain('/var/lib is not on a disk encrypted with LUKS');
    expect(result.stderr).toContain('encrypted LVM');
    expect(result.stderr).toContain('./install.sh --development');
  });

  it('wants every swap encrypted, a swap file on an encrypted disk', () => {
    const result = check({
      plain: 'sdb2',
      swap: '/dev/sdb2 partition\n/swapfile file\n',
    });

    expect(result.code).toBe(1);
    expect(result.stdout).toContain('the swap /dev/sdb2 is not encrypted');
    expect(result.stdout).not.toContain('/swapfile');
  });

  it.each([
    ['none', ''],
    ['a TPM 1.2', '1'],
  ])('wants a TPM 2.0, not %s', (_, tpm) => {
    const result = check({ tpm });

    expect(result.code).toBe(1);
    expect(result.stdout).toContain('no TPM 2.0');
  });

  it('only warns when asked, and says so with its exit', () => {
    const missing = check({ plain: 'vg-root', tpm: '' }, ['--warn-only']);
    expect(missing.code).toBe(3);
    expect(missing.stdout).toContain('going on without it');
    expect(missing.stderr).toBe('');

    expect(check({}, ['--warn-only']).code).toBe(0);
    expect(check({}, ['--everything']).code).toBe(2);
  });
});
