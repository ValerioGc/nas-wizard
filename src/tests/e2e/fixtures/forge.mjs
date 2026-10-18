import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const port = Number(process.argv[2] ?? 3012);
const version = '9.9.9';
const staging = mkdtempSync(join(tmpdir(), 'nas-wizard-forge-'));

function release(repository, asset) {
  const root = join(staging, asset.replace('.tar.gz', ''));
  mkdirSync(join(root, 'packages'), { recursive: true });
  writeFileSync(join(root, 'packages', 'README.md'), `${repository} ${version}\n`);
  const archive = join(staging, asset);
  execFileSync('tar', ['--create', '--gzip', '--file', archive, '--directory', root, '.']);
  const body = readFileSync(archive);
  const checksum = `${createHash('sha256').update(body).digest('hex')}  ${asset}\n`;
  return { repository, asset, body, checksum };
}

const releases = [
  release('example/nas-gateway', `nas-gateway-${version}-linux-x64.tar.gz`),
  release('example/nas-launcher', `nas-os-${version}-linux-x64.tar.gz`),
];

createServer((request, answer) => {
  const { url, headers } = request;
  if (headers.authorization === 'Bearer refused') {
    answer.writeHead(401, { 'content-type': 'application/json' });
    answer.end('{"message":"Bad credentials"}');
    return;
  }

  const latest = releases.find(({ repository }) => url === `/repos/${repository}/releases/latest`);
  if (latest) {
    answer.writeHead(200, { 'content-type': 'application/json' });
    answer.end(
      JSON.stringify({
        tag_name: `v${version}`,
        assets: [
          { name: latest.asset, url: `http://127.0.0.1:${port}/assets/${latest.asset}` },
          {
            name: `${latest.asset}.sha256`,
            url: `http://127.0.0.1:${port}/assets/${latest.asset}.sha256`,
          },
        ],
      }),
    );
    return;
  }

  const asset = releases.find(({ asset }) => url === `/assets/${asset}`);
  if (asset) {
    answer.writeHead(200, { 'content-type': 'application/octet-stream' });
    answer.end(asset.body);
    return;
  }
  const sums = releases.find(({ asset }) => url === `/assets/${asset}.sha256`);
  if (sums) {
    answer.writeHead(200, { 'content-type': 'text/plain' });
    answer.end(sums.checksum);
    return;
  }

  answer.writeHead(404, { 'content-type': 'application/json' });
  answer.end('{"message":"Not Found"}');
}).listen(port, '127.0.0.1');
