// Assembles the release package, the only one the user downloads: the entry script at its root,
// what runs before and after the wizard, the wizard (binary and built interface) and the
// installation manual. The wizard downloads the gateway and the launcher by itself, and copies
// the user manual from the package of the launcher next to the installation manual.
// Run after `npm run build`, `cargo build --release` and `npm run manual:build`.

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

// The name the entry script looks for when it asks for a newer wizard.
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

// Only this release and the one before it stay in the folder.
for (const name of pruneAssets(assets, version, ['nas-wizard-', 'nas_os_installation_manual_'])) {
  console.log(`Removed ${name}`);
}
