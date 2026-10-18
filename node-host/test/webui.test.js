'use strict';
/**
 * Web UI smoke test: the page is served, exposes the bridge API surface,
 * and the bridge regression (ping) still works.
 *
 * Run: node test/webui.test.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Bridge } = require('../src/bridge');
const { AgentSession } = require('../src/agent');

(async () => {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-webui-'));
  const bridge = new Bridge({ agent: null, port: 0, logger: { log() {}, error() {} } });
  const agent = new AgentSession({
    config: {
      apiKey: 'test-key',
      baseUrl: 'http://127.0.0.1:1',
      model: 'mock',
      approvalMode: 'manual',
      workDir,
      mcpServers: [],
    },
    events: { emit: (e) => bridge.emit(e) },
  });
  bridge.agent = agent;
  await bridge.listen();
  const base = `http://127.0.0.1:${bridge.port}`;

  // 1. Page is served at / and /web
  for (const p of ['/', '/web']) {
    const page = await (await fetch(base + p)).text();
    assert(page.includes('/rpc'), `${p} should reference /rpc`);
    assert(page.includes('/events'), `${p} should reference /events`);
    assert(page.includes('tool.approve'), `${p} should expose tool approval`);
    assert(page.includes('chat.send'), `${p} should expose chat.send`);
    assert(!page.includes('innerHTML'), `${p} must not use innerHTML (XSS guard)`);
  }

  // 2. Health still works
  const health = await (await fetch(base + '/health')).json();
  assert.strictEqual(health.ok, true, 'health check should pass');

  // 3. Bridge regression: ping
  const ping = await (
    await fetch(base + '/rpc', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 1, method: 'ping', params: {} }),
    })
  ).json();
  assert.strictEqual(ping.ok, true, 'ping should be ok');
  assert.strictEqual(ping.result.busy, false, 'agent should not be busy');

  bridge.close();
  fs.rmSync(workDir, { recursive: true, force: true });
  console.log('webui.test.js: ALL TESTS PASSED');
})().catch((err) => {
  console.error('webui.test.js FAILED:', err.message);
  process.exit(1);
});
