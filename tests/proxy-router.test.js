'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRouter, parseEnvInput } = require('../proxy-router');
async function listen(server) {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${server.address().port}`;
}
async function fixture(t, handlers) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'panel-router-'));
  const servers = handlers.map(fn => http.createServer(async (req, res) => {
    const chunks = []; for await (const c of req) chunks.push(c);
    fn(req, res, Buffer.concat(chunks).toString());
  }));
  const urls = await Promise.all(servers.map(listen));
  const captures = [];
  const router = createRouter({ dir, port: 4322, record: (...args) => captures.push(args) });
  const proxy = http.createServer(router.handle);
  const url = await listen(proxy);
  t.after(async () => {
    for (const server of [...servers, proxy]) { server.closeAllConnections(); await new Promise(r => server.close(r)); }
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const accounts = urls.map((url, i) => ({ id: `a${i}`, name: `Account ${i}`, url, token: `secret-${i}`, authType: 'bearer', enabled: true, modelMap: {} }));
  const send = (data = { model: 'claude-sonnet', messages: [] }, options = {}) => fetch(url + '/v1/messages', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer client-credential', 'x-api-key': 'old-client-key', ...options.headers }, body: JSON.stringify(data), signal: options.signal });
  return { dir, router, accounts, send, captures, url };
}
const reply = (req, res, raw) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ id: req.headers.authorization, model: JSON.parse(raw).model, apiKey: req.headers['x-api-key'] || null })); };
test('manual switching applies to the next request, preserves hidden tokens and maps models', async t => {
  const f = await fixture(t, [reply, reply]);
  f.accounts[0].modelMap = { sonnet: 'gateway-sonnet' };
  f.router.save({ mode: 'manual', selected: 'a0', accounts: f.accounts });
  let result = await (await f.send()).json();
  assert.equal(result.id, 'Bearer secret-0'); assert.equal(result.apiKey, null); assert.equal(result.model, 'gateway-sonnet');
  const publicConfig = f.router.status();
  assert.ok(!JSON.stringify(publicConfig).includes('secret-'));
  f.router.save({ ...publicConfig, selected: 'a1' });
  result = await (await f.send()).json(); assert.equal(result.id, 'Bearer secret-1');
  assert.equal(fs.statSync(path.join(f.dir, 'panel-proxy.json')).mode & 0o777, 0o600);
  const restored = createRouter({ dir: f.dir, port: 4322 }); assert.equal(restored.status().selected, 'a1');
  assert.equal(f.captures[0][3].toString().includes('gateway-sonnet'), true);
  assert.equal(f.captures[0][9], 'Account 0');
});
test('rate limit fails over, honors cooldown, and reset clears it', async t => {
  let first = 0;
  const f = await fixture(t, [(req, res) => { first++; res.writeHead(429, { 'retry-after': '120' }); res.end('limited'); }, reply]);
  f.router.save({ mode: 'failover', accounts: f.accounts });
  assert.equal((await (await f.send()).json()).id, 'Bearer secret-1');
  assert.equal((await (await f.send()).json()).id, 'Bearer secret-1'); assert.equal(first, 1);
  assert.ok(f.router.status().accounts[0].cooldownUntil > Date.now() + 100000);
  f.router.reset(); await f.send(); assert.equal(first, 2);
});
test('manual mode returns upstream errors without trying another account', async t => {
  let second = 0;
  const f = await fixture(t, [(req, res) => { res.writeHead(429); res.end('limited'); }, (req, res) => { second++; res.end('unexpected'); }]);
  f.router.save({ mode: 'manual', selected: 'a0', accounts: f.accounts });
  const response = await f.send(); assert.equal(response.status, 429); assert.equal(await response.text(), 'limited'); assert.equal(second, 0);
});
test('round robin distributes requests and API key replaces client auth', async t => {
  const handler = (req, res) => res.end(JSON.stringify({ bearer: req.headers.authorization || null, apiKey: req.headers['x-api-key'] }));
  const f = await fixture(t, [handler, reply]); f.accounts[0].authType = 'api-key';
  f.router.save({ mode: 'round-robin', accounts: f.accounts });
  assert.deepEqual(await (await f.send()).json(), { bearer: null, apiKey: 'secret-0' });
  assert.equal((await (await f.send()).json()).id, 'Bearer secret-1');
  assert.deepEqual(await (await f.send()).json(), { bearer: null, apiKey: 'secret-0' });
});
test('streams deliver immediately and remain on the original account during a switch', async t => {
  let finish;
  const f = await fixture(t, [(req, res) => { res.writeHead(200, { 'content-type': 'text/event-stream' }); res.write('data: {"type":"message_start"}\n\n'); finish = () => res.end('data: {"type":"message_stop"}\n\n'); }, reply]);
  f.router.save({ mode: 'manual', selected: 'a0', accounts: f.accounts });
  const response = await f.send(); const reader = response.body.getReader();
  assert.match(new TextDecoder().decode((await reader.read()).value), /message_start/);
  f.router.save({ ...f.router.status(), selected: 'a1' }); finish();
  assert.match(new TextDecoder().decode((await reader.read()).value), /message_stop/);
  assert.equal((await (await f.send()).json()).id, 'Bearer secret-1');
});
test('setup backs up settings, preserves other keys and imports the old env', async t => {
  const f = await fixture(t, [reply]);
  const original = { permissions: { allow: ['Read'] }, model: 'custom', env: { OTHER_FLAG: 'keep', ANTHROPIC_BASE_URL: 'https://example.org', ANTHROPIC_AUTH_TOKEN: 'old-secret', ANTHROPIC_API_KEY: 'obsolete' } };
  fs.writeFileSync(path.join(f.dir, 'settings.json'), JSON.stringify(original));
  f.router.save({ mode: 'manual', selected: 'a0', accounts: f.accounts });
  const result = f.router.setup();
  assert.deepEqual(JSON.parse(fs.readFileSync(result.backup)), original);
  const current = JSON.parse(fs.readFileSync(path.join(f.dir, 'settings.json')));
  assert.deepEqual(current.permissions, original.permissions); assert.equal(current.model, 'custom'); assert.equal(current.env.OTHER_FLAG, 'keep');
  assert.equal(current.env.ANTHROPIC_BASE_URL, 'http://127.0.0.1:4322'); assert.equal(current.env.ANTHROPIC_API_KEY, undefined);
  assert.equal(f.router.status().accounts.length, 2); assert.ok(!JSON.stringify(f.router.status()).includes('old-secret'));
  const again = f.router.setup(); assert.equal(f.router.status().accounts.length, 2); assert.equal(again.alreadyConfigured, true); assert.equal(again.backup, null);
});
test('invalid config is rejected atomically and disabled accounts are never selected', async t => {
  const f = await fixture(t, [reply]);
  f.router.save({ mode: 'manual', selected: 'a0', accounts: f.accounts });
  assert.throws(() => f.router.save({ mode: 'manual', selected: 'a0', accounts: [{ ...f.accounts[0], url: 'http://localhost:4322' }] }));
  assert.throws(() => f.router.save({ mode: 'failover', accounts: [{ ...f.accounts[0], modelMap: [] }] }));
  assert.equal(f.router.status().accounts[0].url, f.accounts[0].url);
  f.router.save({ mode: 'failover', accounts: [{ ...f.accounts[0], enabled: false }] });
  assert.equal((await f.send()).status, 503);
});
test('ordinary request errors are not retried; cross-origin requests are blocked', async t => {
  let second = 0;
  const f = await fixture(t, [(req, res) => { res.writeHead(400); res.end('invalid request'); }, (req, res) => { second++; res.end(); }]);
  f.router.save({ mode: 'failover', accounts: f.accounts });
  assert.equal((await f.send()).status, 400); assert.equal(second, 0);
  assert.equal((await f.send(undefined, { headers: { origin: 'https://foreign.example' } })).status, 403);
});
test('connection errors fail over and do not leak credentials in errors', async t => {
  const f = await fixture(t, [reply]);
  const unused = http.createServer(); const deadURL = await listen(unused); await new Promise(r => unused.close(r));
  f.router.save({ mode: 'failover', accounts: [{ ...f.accounts[0], id: 'dead', url: deadURL }, ...f.accounts] });
  assert.equal((await (await f.send()).json()).id, 'Bearer secret-0');
  f.router.save({ mode: 'manual', selected: 'dead', accounts: [{ ...f.accounts[0], id: 'dead', url: deadURL }] });
  const response = await f.send(); assert.equal(response.status, 502); assert.ok(!(await response.text()).includes('secret-0'));
});

test('exhausted credits (402) trigger automatic failover', async t => {
  const f = await fixture(t, [(req, res) => { res.writeHead(402); res.end('credits exhausted'); }, reply]);
  f.router.save({ mode: 'failover', accounts: f.accounts });
  assert.equal((await (await f.send()).json()).id, 'Bearer secret-1');
  assert.equal(f.router.status().accounts[0].lastStatus, 402);
});

test('one click imports the current account from an empty state and connects Claude', async t => {
  const f = await fixture(t, [reply]);
  const original = { env: { ANTHROPIC_BASE_URL: f.accounts[0].url, ANTHROPIC_AUTH_TOKEN: 'initial-secret', ANTHROPIC_DEFAULT_SONNET_MODEL: 'mapped-sonnet', KEEP: 'keep' }, permissions: { allow: ['Read'] } };
  fs.writeFileSync(path.join(f.dir, 'settings.json'), JSON.stringify(original));
  assert.equal(f.router.status().accounts.length, 0);
  assert.equal(f.router.status().connection.canImport, true);
  const result = f.router.setup();
  const status = f.router.status();
  assert.equal(status.accounts.length, 1); assert.equal(status.selected, status.accounts[0].id);
  assert.equal(status.connection.connected, true); assert.equal(status.accounts[0].modelMap.sonnet, 'mapped-sonnet');
  assert.deepEqual(JSON.parse(fs.readFileSync(result.backup)), original);
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.dir, 'settings.json'))).env.KEEP, 'keep');
  assert.ok(!JSON.stringify(status).includes('initial-secret'));
  assert.equal(f.router.setup().alreadyConfigured, true); assert.equal(f.router.status().accounts.length, 1);
});
test('one click imports official API key without an explicit base URL', async t => {
  const f = await fixture(t, []);
  fs.writeFileSync(path.join(f.dir, 'settings.json'), JSON.stringify({ env: { ANTHROPIC_API_KEY: 'official-key' } }));
  f.router.setup(); const status = f.router.status();
  assert.equal(status.accounts[0].url, 'https://api.anthropic.com'); assert.equal(status.accounts[0].authType, 'api-key'); assert.equal(status.connection.connected, true);
});
test('setup without an API account leaves settings untouched, import deduplicates', async t => {
  const f = await fixture(t, [reply]);
  const file = path.join(f.dir, 'settings.json'); fs.writeFileSync(file, '{"permissions":{"allow":["Read"]}}');
  const original = fs.readFileSync(file, 'utf8'); assert.throws(() => f.router.setup()); assert.equal(fs.readFileSync(file, 'utf8'), original);
  fs.writeFileSync(file, JSON.stringify({ env: { ANTHROPIC_BASE_URL: f.accounts[0].url, ANTHROPIC_AUTH_TOKEN: 'same-token' } }));
  f.router.importSettings(); f.router.importSettings(); assert.equal(f.router.status().accounts.length, 1);
});

test('env parser supports full settings, env fragments and bare env with empty API key', () => {
  const env = { ANTHROPIC_BASE_URL: 'http://127.0.0.1:8790', ANTHROPIC_AUTH_TOKEN: 'ferry', ANTHROPIC_API_KEY: '', CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY: '1', CLAUDE_CODE_AUTO_MODE_SERVER: '0' };
  for (const raw of [JSON.stringify({ env, permissions: {} }), '"env":' + JSON.stringify(env) + ',', JSON.stringify(env)]) {
    const parsed = parseEnvInput(raw); assert.deepEqual(parsed.env, env); assert.equal(parsed.token, 'ferry'); assert.equal(parsed.authType, 'bearer');
  }
  assert.throws(() => parseEnvInput('{broken secret-token'), error => !error.message.includes('secret-token'));
  assert.throws(() => parseEnvInput({ ANTHROPIC_AUTH_TOKEN: 'key', BAD: {} }));
});
test('full env persists securely, applies on selection and restores prior values when switching', async t => {
  const f = await fixture(t, [reply, reply]);
  const initial = { env: { EXISTING: 'preserve', CLAUDE_CODE_AUTO_MODE_SERVER: 'original' }, permissions: { allow: ['Read'] } };
  const file = path.join(f.dir, 'settings.json'); fs.writeFileSync(file, JSON.stringify(initial));
  const extra = { ANTHROPIC_BASE_URL: f.accounts[0].url, ANTHROPIC_AUTH_TOKEN: 'ferry', ANTHROPIC_API_KEY: '', CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY: '1', CLAUDE_CODE_AUTO_MODE_SERVER: '0', CUSTOM_SECRET: 'hidden-custom-secret' };
  f.router.save({ mode: 'manual', selected: 'a0', accounts: [{ id: 'a0', name: 'Ferry', env: extra }, f.accounts[1]] });
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.dir, 'panel-proxy.json'))).accounts[0].env, extra);
  f.router.setup(); let settings = JSON.parse(fs.readFileSync(file));
  assert.equal(settings.env.CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY, '1'); assert.equal(settings.env.CLAUDE_CODE_AUTO_MODE_SERVER, '0');
  assert.equal(settings.env.EXISTING, 'preserve'); assert.equal(settings.env.ANTHROPIC_BASE_URL, 'http://127.0.0.1:4322');
  assert.equal(settings.env.CUSTOM_SECRET, 'hidden-custom-secret');
  const publicStatus = f.router.status(); assert.ok(!JSON.stringify(publicStatus).includes('hidden-custom-secret')); assert.ok(!JSON.stringify(publicStatus).includes('ferry'));
  assert.deepEqual(publicStatus.accounts[0].clientEnvKeys, ['CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY', 'CLAUDE_CODE_AUTO_MODE_SERVER', 'CUSTOM_SECRET']);
  const switched = f.router.save({ ...publicStatus, selected: 'a1' }); assert.equal(switched.restartRequired, true);
  settings = JSON.parse(fs.readFileSync(file)); assert.equal(settings.env.CLAUDE_CODE_AUTO_MODE_SERVER, 'original'); assert.equal(settings.env.CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY, undefined); assert.equal(settings.env.CUSTOM_SECRET, undefined);
  assert.equal(settings.env.EXISTING, 'preserve'); assert.deepEqual(settings.permissions, initial.permissions);
  const back = f.router.save({ ...f.router.status(), selected: 'a0' }); assert.equal(back.restartRequired, true);
  assert.equal(JSON.parse(fs.readFileSync(file)).env.CLAUDE_CODE_AUTO_MODE_SERVER, '0');
  assert.equal(f.router.save(f.router.status()).restartRequired, false);
});
test('editing a pasted account retains extra env and updates its credentials', async t => {
  const f = await fixture(t, [reply]);
  f.router.save({ mode: 'manual', selected: 'a0', accounts: [{ id: 'a0', name: 'Account', env: { ANTHROPIC_BASE_URL: f.accounts[0].url, ANTHROPIC_AUTH_TOKEN: 'old-token', FLAG: true } }] });
  const status = f.router.status(); status.accounts[0].token = 'new-token';
  f.router.save(status);
  const stored = JSON.parse(fs.readFileSync(path.join(f.dir, 'panel-proxy.json'))).accounts[0]; assert.equal(stored.env.FLAG, 'true'); assert.equal(stored.env.ANTHROPIC_AUTH_TOKEN, 'new-token');
  assert.equal((await (await f.send()).json()).id, 'Bearer new-token');
});
