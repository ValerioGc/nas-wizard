import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
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
