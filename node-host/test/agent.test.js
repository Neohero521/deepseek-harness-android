'use strict';
/**
 * Integration test for the Node agent host — runs on desktop Node (>=18).
 *
 * It spins up:
 *   - a mock OpenAI-compatible LLM server (SSE streaming, tool calls)
 *   - a real AgentSession + Bridge
 *
 * and drives the whole loop through the same HTTP protocol the Android app
 * uses, then asserts the observable events.
 *
 * Run:  node test/agent.test.js
 */

const http = require('http');
const path = require('path');
const os = require('os');
const fs = require('fs');
const assert = require('assert');

const { Bridge } = require('../src/bridge');
const { AgentSession } = require('../src/agent');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-host-test-'));

function sse(chunks) {
  return chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join('') + 'data: [DONE]\n\n';
}

/** A mock LLM that writes a file on the first turn, then answers in text. */
function startMockLlm() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (d) => (body += d));
      req.on('end', () => {
        const { messages } = JSON.parse(body);
        const last = messages[messages.length - 1];
        res.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
        });

        if (last.role === 'user') {
          // First turn: request one tool call (streamed in fragments).
          res.write(
            sse([
              { choices: [{ delta: { role: 'assistant' } }] },
              {
                choices: [
                  {
                    delta: {
                      tool_calls: [
                        { index: 0, id: 'call_mock1', type: 'function', function: { name: 'fs.write_file', arguments: '{"path":"greeting.txt","content":"hello from agent"}' } },
                      ],
                    },
                  },
                ],
              },
            ]),
          );
        } else if (last.role === 'tool') {
          // Second turn: plain text answer.
          res.write(
            sse([
              { choices: [{ delta: { role: 'assistant', content: '文件' } }] },
              { choices: [{ delta: { content: '已写好。' } }] },
            ]),
          );
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

/** Poll /events until any of `wanted` types appears (or error/timeout). */
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
  console.log('== dsh-android-node-host integration test ==');

  const mock = await startMockLlm();
  const mockPort = mock.address().port;
  const mockUrl = `http://127.0.0.1:${mockPort}`;

  const workDir = path.join(TMP, 'ws');
  fs.mkdirSync(workDir, { recursive: true });

  const config = {
    apiKey: 'test-key',
    baseUrl: mockUrl,
    model: 'test-model',
    approvalMode: 'manual',
    workDir,
  };

  const events = [];
  const bridge = new Bridge({ agent: null, port: 0, logger: { log() {}, error() {} } });
  const agent = new AgentSession({
    config,
    events: { emit: (ev) => bridge.emit(ev) },
  });
  bridge.agent = agent;
  await bridge.listen();
  const bridgeUrl = `http://127.0.0.1:${bridge.port}`;

  console.log(`workDir=${workDir}`);
  console.log(`bridge=${bridgeUrl} mock=${mockUrl}`);

  // --- 1. health + config ---
  let res = await fetch(`${bridgeUrl}/health`);
  assert.strictEqual((await res.json()).ok, true, 'health ok');
  res = await rpc(bridgeUrl, 'config.set', { apiKey: 'test-key', baseUrl: mockUrl, model: 'test-model' });
  assert.strictEqual(res.ok, true, 'config.set ok');
  res = await rpc(bridgeUrl, 'config.get', {});
  assert.strictEqual(res.result.config.apiKey, '***', 'apiKey masked');
  console.log('  [ok] health + config');

  // --- 2. chat.send drives a tool call that must be approved ---
  await rpc(bridgeUrl, 'chat.send', { text: '写一个问候文件' });
  await waitForTypes(bridgeUrl, events, ['tool.call']);
  await sleep(300); // let trailing events flush

  const types = events.map((e) => e.type);
  assert.ok(types.includes('agent.started'), `agent.started in ${types}`);
  assert.ok(types.includes('tool.call'), `tool.call in ${types}`);
  assert.ok(types.includes('message.done'), `message.done in ${types}`);

  const toolCall = events.find((e) => e.type === 'tool.call');
  assert.strictEqual(toolCall.tool, 'fs.write_file', 'tool name');
  assert.strictEqual(toolCall.args.path, 'greeting.txt', 'tool args path');

  // The tool must NOT have executed before approval.
  assert.ok(!fs.existsSync(path.join(workDir, 'greeting.txt')), 'file not written before approval');

  // --- 3. approve and see the result ---
  events.length = 0;
  res = await rpc(bridgeUrl, 'tool.approve', { callId: toolCall.callId, approved: true });
  assert.strictEqual(res.result.matched, true, 'approval matched');
  await waitForTypes(bridgeUrl, events, ['agent.finished']);
  await sleep(300);

  const types2 = events.map((e) => e.type);
  assert.ok(types2.includes('tool.result'), `tool.result in ${types2}`);
  assert.strictEqual(fs.readFileSync(path.join(workDir, 'greeting.txt'), 'utf8'), 'hello from agent', 'file written');
  console.log('  [ok] approval flow + fs.write_file executed');

  // --- 4. reject flow ---
  events.length = 0;
  await rpc(bridgeUrl, 'chat.send', { text: '再写一个文件' });
  await waitForTypes(bridgeUrl, events, ['tool.call']);
  await sleep(300);
  const toolCall2 = events.find((e) => e.type === 'tool.call');
  assert.ok(toolCall2, 'second tool.call');
  events.length = 0;
  await rpc(bridgeUrl, 'tool.approve', { callId: toolCall2.callId, approved: false });
  await waitForTypes(bridgeUrl, events, ['agent.finished']);
  const rejected = events.find((e) => e.type === 'tool.result');
  assert.ok(rejected && rejected.ok === false, 'rejected tool result is ok=false');
  console.log('  [ok] rejection flow');

  // --- 5. path escape is blocked ---
  let threw = false;
  try {
    await agent.tools.execute('fs.read_file', { path: '../../etc/passwd' });
  } catch {
    threw = true;
  }
  assert.ok(threw, 'path escape throws');
  console.log('  [ok] workspace confinement');

  // --- 6. auto approval mode ---
  config.approvalMode = 'auto';
  const eventsAuto = [];
  const bridgeAuto = new Bridge({ agent: null, port: 0, logger: { log() {}, error() {} } });
  const agentAuto = new AgentSession({ config, events: { emit: (ev) => bridgeAuto.emit(ev) } });
  bridgeAuto.agent = agentAuto;
  await bridgeAuto.listen();
  const bridgeAutoUrl = `http://127.0.0.1:${bridgeAuto.port}`;
  await rpc(bridgeAutoUrl, 'chat.send', { text: '写一个 auto.txt' });
  await waitForTypes(bridgeAutoUrl, eventsAuto, ['agent.finished']);
  await sleep(500);
  assert.ok(eventsAuto.some((e) => e.type === 'tool.call') === false, 'no approval event in auto mode');
  assert.ok(eventsAuto.some((e) => e.type === 'tool.result'), 'tool result in auto mode');
  assert.ok(fs.existsSync(path.join(workDir, 'greeting.txt')), 'auto-mode executed the tool');
  console.log('  [ok] auto approval mode');

  console.log('\nALL TESTS PASSED');
  mock.close();
  bridge.close();
  bridgeAuto.close();
  fs.rmSync(TMP, { recursive: true, force: true });
}

main().catch((err) => {
  console.error('\nTEST FAILED:', err);
  process.exit(1);
});
