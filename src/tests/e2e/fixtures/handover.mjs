import { createServer } from 'node:http';

let legacy = true;
let finished = false;
const calls = { root: 0, login: 0 };
const ready = {
  phase: 'ready',
  steps: [{ id: 'handover', state: 'pending', detail: '' }],
  simulated: false,
  version: '9.9.9',
};

createServer(async (request, answer) => {
  const path = new URL(request.url, 'http://127.0.0.1:3013').pathname;
  const json = (body) => {
    answer.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    answer.end(JSON.stringify(body));
  };
  if (path === '/reset' && request.method === 'POST') {
    legacy = true;
    finished = false;
    calls.root = calls.login = 0;
    json({ ok: true });
    return;
  }
  if (path === '/switch' && request.method === 'POST') {
    legacy = false;
    json({ ok: true });
    return;
  }
  if (path === '/stats') {
    json(calls);
    return;
  }
  if (path === '/seed') {
    answer.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' });
    answer.end('<main data-testid="cache_seed">Old gateway</main>');
    return;
  }
  if (path === '/' || path === '/login') {
    calls[path === '/' ? 'root' : 'login']++;
    if (legacy) {
      answer.writeHead(308, {
        location: `https://localhost${path}`,
        'cache-control': 'max-age=31536000',
      });
      answer.end();
    } else if (path === '/') {
      answer.writeHead(307, { location: '/setup', 'cache-control': 'no-store' });
      answer.end();
    } else {
      answer.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-cache' });
      answer.end('<main data-testid="nas_login">Login</main>');
    }
    return;
  }
  if (path === '/api/wizard') {
    json(ready);
    return;
  }
  if (path === '/api/wizard/certificate') {
    json({ caPem: null });
    return;
  }
  if (path === '/api/wizard/finish' && request.method === 'POST') {
    finished = true;
    json({ ...ready, phase: 'done' });
    return;
  }
  if (path === '/health') {
    answer.writeHead(finished ? 200 : 503, { 'content-type': 'text/plain' });
    answer.end(finished ? 'ok' : 'wizard');
    return;
  }
  try {
    const response = await fetch(`http://127.0.0.1:5175${request.url}`);
    answer.writeHead(response.status, {
      'content-type': response.headers.get('content-type') ?? 'application/octet-stream',
      'cache-control': 'no-store',
    });
    answer.end(Buffer.from(await response.arrayBuffer()));
  } catch {
    answer.writeHead(503);
    answer.end('wizard unavailable');
  }
}).listen(3013, '127.0.0.1');
