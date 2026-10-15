import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/** The root of the project, where the entry script of the package lives. */
export const ROOT = resolve(__dirname, '../../..');

/** Where the configuration of the operating system lives. */
export const OS_CONFIGURATION = join(ROOT, 'system/packages/os_configuration');

export interface Run {
  code: number;
  stdout: string;
  stderr: string;
  output: string;
}

export function run(
  script: string,
  options: { args?: string[]; env?: NodeJS.ProcessEnv; input?: string } = {},
): Run {
  const spawn = {
    encoding: 'utf8' as const,
    env: { ...process.env, ...options.env },
    input: options.input ?? '',
  };
  try {
    const stdout = execFileSync('bash', [script, ...(options.args ?? [])], spawn);
    return { code: 0, stdout, stderr: '', output: stdout };
  } catch (failure) {
    const error = failure as { status?: number; stdout?: string; stderr?: string };
    const stdout = error.stdout ?? '';
    const stderr = error.stderr ?? '';
    return { code: error.status ?? 1, stdout, stderr, output: stdout + stderr };
  }
}

export function workspace() {
  const path = mkdtempSync(join(tmpdir(), 'nas-wizard-scripts-'));
  return { path, remove: () => rmSync(path, { recursive: true, force: true }) };
}

export function fakeCommand(directory: string, name: string, body: string) {
  const path = join(directory, name);
  execFileSync(
    'bash',
    ['-c', `cat > ${JSON.stringify(path)} && chmod +x ${JSON.stringify(path)}`],
    {
      input: `#!/usr/bin/env bash\n${body}\n`,
      encoding: 'utf8',
    },
  );
  return path;
}

/** What the check of the security of a machine reads, as `fakeMachineSecurity` sets it up. */
export interface MachineSecurity {
  /** The device of the system, of /etc and of /var/lib, or a swap, that is not on LUKS. */
  plain?: string;
  /** What `swapon` lists: name and type on each line. */
  swap?: string;
  /** The major version of the TPM, none for a machine without one. */
  tpm?: string;
}

/**
 * The commands of a machine whose system is on `/dev/mapper/vg-root`, on LUKS unless `plain`
 * names it, with the swap and the TPM given: the environment the check needs.
 */
export function fakeMachineSecurity(
  directory: string,
  { plain = '', swap = '', tpm = '2' }: MachineSecurity = {},
): NodeJS.ProcessEnv {
  fakeCommand(directory, 'findmnt', 'echo /dev/mapper/vg-root');
  fakeCommand(
    directory,
    'lsblk',
    `if [[ -n ${JSON.stringify(plain)} && $* == *${JSON.stringify(plain)}* ]]; then printf 'ext4\\n'; else printf 'ext4\\nLVM2_member\\ncrypto_LUKS\\n\\n'; fi`,
  );
  fakeCommand(directory, 'swapon', `printf '%b' ${JSON.stringify(swap)}`);
  const tpmClass = join(directory, 'tpm');
  if (tpm) {
    mkdirSync(join(tpmClass, 'tpm0'), { recursive: true });
    writeFileSync(join(tpmClass, 'tpm0', 'tpm_version_major'), `${tpm}\n`);
  }
  return { NAS_TPM_CLASS: tpmClass };
}
