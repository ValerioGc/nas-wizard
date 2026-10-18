// Assembles the release package for the NAS wizard.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pruneAssets } from './prune_assets.mjs';

const root = join(import.meta.dirname, '..', '..');
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const assets = join(root, 'release-assets');
const staging = join(assets, 'package');
const binary = join(root, 'backend', 'target', 'release', 'nas-wizard');
const ui = join(root, 'dist');

const archive = `nas-wizard-${version}-linux-x64.tar.gz`;

for (const required of [binary, ui]) {
  if (!existsSync(required)) {
    throw new Error(`${required} is missing: build it before packaging.`);
  }
}
const manual = `nas_os_installation_manual_${version}.pdf`;
if (!existsSync(join(assets, manual))) {
  throw new Error(`${manual} is missing: run npm run manual:build first.`);
}

rmSync(staging, { recursive: true, force: true });
cpSync(join(root, 'install.sh'), join(staging, 'install.sh'));
cpSync(join(root, 'system', 'packages'), join(staging, 'packages'), { recursive: true });
cpSync(binary, join(staging, 'wizard', 'bin', 'nas-wizard'));
cpSync(ui, join(staging, 'wizard', 'ui'), { recursive: true });
cpSync(join(assets, manual), join(staging, manual));

execFileSync('tar', ['--owner=0', '--group=0', '-czf', join(assets, archive), '-C', staging, '.'], {
  stdio: 'inherit',
});
rmSync(staging, { recursive: true, force: true });

const digest = createHash('sha256')
  .update(readFileSync(join(assets, archive)))
  .digest('hex');
writeFileSync(join(assets, `${archive}.sha256`), `${digest}  ${archive}\n`);

console.log(`Release package written to ${join(assets, archive)}.`);

for (const name of pruneAssets(assets, version, ['nas-wizard-', 'nas_os_installation_manual_'])) {
  console.log(`Removed ${name}`);
}
