'use strict';
/**
 * Integration test for the MCP plugin protocol.
 *
 * Spins up the mock MCP server (stdio), connects through the bridge
 * (`mcp.configure`), and drives the agent loop end to end with an
 * OpenAI-compatible mock LLM that calls an MCP tool.
 *
 * Run:  node test/mcp.test.js
 */

const http = require('http');
const path = require('path');
const os = require('os');
const fs = require('fs');
const assert = require('assert');

const { Bridge } = require('../src/bridge');
const { AgentSession } = require('../src/agent');

const MOCK_SERVER = path.join(__dirname, 'mock-mcp-server.js');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-mcp-test-'));

function sse(chunks) {
  return chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join('') + 'data: [DONE]\n\n';
}

/** Mock LLM: calls mcp.mock.echo on the first user turn, then answers. */
function startMockLlm() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (d) => (body += d));
      req.on('end', () => {
        const { messages } = JSON.parse(body);
        const last = messages[messages.length - 1];
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
        if (last.role === 'user') {
          res.write(
            sse([
              { choices: [{ delta: { role: 'assistant' } }] },
              {
                choices: [
                  {
                    delta: {
                      tool_calls: [
                        {
                          index: 0,
                          id: 'call_mcp1',
                          type: 'function',
                          function: { name: 'mcp.mock.echo', arguments: '{"text":"hello mcp"}' },
                        },
                      ],
                    },
                  },
                ],
              },
            ]),
          );
        } else if (last.role === 'tool') {
          res.write(sse([{ choices: [{ delta: { role: 'assistant', content: 'MCP 工具已调用：' + last.content } }] }]));
        } else {
          res.write(sse([{ choices: [{ delta: { role: 'assistant', content: 'ok' } }] }]));
        }
        res.end();
      });
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForTypes(bridgeUrl, events, wanted, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const resp = await fetch(`${bridgeUrl}/events`);
    const batch = await resp.json();
    events.push(...batch);
    const types = events.map((e) => e.type);
    if (types.some((t) => wanted.includes(t) || t === 'error')) return;
    await sleep(200);
  }
  throw new Error(`timeout waiting for ${wanted}; got ${events.map((e) => e.type).join(',')}`);
}

async function rpc(bridgeUrl, method, params) {
  const resp = await fetch(`${bridgeUrl}/rpc`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: 1, method, params }),
  });
  return resp.json();
}

async function main() {
  console.log('== MCP plugin protocol test ==');

  const mock = await startMockLlm();
  const workDir = path.join(TMP, 'ws');
  fs.mkdirSync(workDir, { recursive: true });

  const config = {
    apiKey: 'test-key',
    baseUrl: `http://127.0.0.1:${mock.address().port}`,
    model: 'test-model',
    approvalMode: 'auto', // keep this test focused on MCP, not approvals
    workDir,
    mcpServers: [],
  };

  const events = [];
  const bridge = new Bridge({ agent: null, port: 0, logger: { log() {}, error() {} } });
  const agent = new AgentSession({ config, events: { emit: (ev) => bridge.emit(ev) } });
  bridge.agent = agent;
  await bridge.listen();
  const bridgeUrl = `http://127.0.0.1:${bridge.port}`;

  // --- 1. configure an MCP server through the bridge ---
  let res = await rpc(bridgeUrl, 'mcp.configure', {
    servers: [{ name: 'mock', command: process.execPath, args: [MOCK_SERVER] }],
  });
  assert.strictEqual(res.ok, true, 'mcp.configure ok');
  await sleep(800); // async connect

  res = await rpc(bridgeUrl, 'mcp.status', {});
  const status = res.result.servers;
  assert.strictEqual(status.length, 1, 'one server configured');
  assert.strictEqual(status[0].name, 'mock', 'server name');
  assert.strictEqual(status[0].connected, true, 'server connected');
  assert.strictEqual(status[0].tools, 2, 'two tools discovered');
  console.log('  [ok] mcp.configure + mcp.status (echo, add)');

  // --- 2. tool registry exposes MCP tools ---
  const defs = agent.tools.definitions();
  assert.ok(defs.some((d) => d.function.name === 'mcp.mock.echo'), 'mcp.mock.echo in definitions');
  assert.ok(agent.tools.has('mcp.mock.add'), 'mcp.mock.add owned');
  console.log('  [ok] MCP tools merged into registry');

  // --- 3. agent loop calls the MCP tool end to end ---
  await rpc(bridgeUrl, 'chat.send', { text: '用 echo 工具' });
  await waitForTypes(bridgeUrl, events, ['agent.finished']);
  await sleep(300);

  const types = events.map((e) => e.type);
  // approvalMode=auto → no tool.call card; the result event proves execution
  assert.ok(types.includes('tool.result'), `tool.result in ${types}`);
  const toolResult = events.find((e) => e.type === 'tool.result');
  assert.ok(toolResult && toolResult.ok === true, 'tool.result ok');
  assert.strictEqual(toolResult.output, 'echo: hello mcp', 'echo output');
  console.log('  [ok] agent loop executed MCP tool (auto mode)');

  // --- 4. reconnect with a bad server reports failure, good one recovers ---
  res = await rpc(bridgeUrl, 'mcp.configure', {
    servers: [
      { name: 'mock', command: process.execPath, args: [MOCK_SERVER] },
      { name: 'broken', command: '/bin/false', args: [] }, // exits immediately
    ],
  });
  await sleep(800);
  res = await rpc(bridgeUrl, 'mcp.status', {});
  const byName = Object.fromEntries(res.result.servers.map((s) => [s.name, s]));
  assert.strictEqual(byName.mock.connected, true, 'mock still connected');
  assert.strictEqual(byName.broken.connected, false, 'broken server reported down');
  console.log('  [ok] per-server failure isolation');

  console.log('\nALL MCP TESTS PASSED');
  mock.close();
  bridge.close();
  fs.rmSync(TMP, { recursive: true, force: true });
}

main().catch((err) => {
  console.error('\nTEST FAILED:', err);
  process.exit(1);
});
