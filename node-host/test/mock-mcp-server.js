'use strict';
/**
 * Mock MCP server over stdio (newline-delimited JSON-RPC), used by
 * test/mcp.test.js. Provides two tools:
 *   - echo  (returns the input text)
 *   - add   (adds two numbers)
 *
 * Run as:  node test/mock-mcp-server.js
 */

const readline = require('readline');

const TOOLS = [
  {
    name: 'echo',
    description: 'Echoes the given text back.',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string' } },
      required: ['text'],
    },
  },
  {
    name: 'add',
    description: 'Adds two numbers.',
    inputSchema: {
      type: 'object',
      properties: { a: { type: 'number' }, b: { type: 'number' } },
      required: ['a', 'b'],
    },
  },
];

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  if (!line.trim()) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }

  if (msg.method === 'initialize') {
    send({
      jsonrpc: '2.0',
      id: msg.id,
      result: {
        protocolVersion: msg.params.protocolVersion,
        capabilities: { tools: {} },
        serverInfo: { name: 'mock-mcp-server', version: '1.0.0' },
      },
    });
    return;
  }
  if (msg.method === 'notifications/initialized') {
    return; // no response to notifications
  }
  if (msg.method === 'tools/list') {
    send({ jsonrpc: '2.0', id: msg.id, result: { tools: TOOLS } });
    return;
  }
  if (msg.method === 'tools/call') {
    const { name, arguments: args = {} } = msg.params;
    let content;
    if (name === 'echo') {
      content = [{ type: 'text', text: `echo: ${String(args.text ?? '')}` }];
    } else if (name === 'add') {
      const a = Number(args.a);
      const b = Number(args.b);
      if (Number.isNaN(a) || Number.isNaN(b)) {
        send({
          jsonrpc: '2.0',
          id: msg.id,
          result: { content: [{ type: 'text', text: 'invalid numbers' }], isError: true },
        });
        return;
      }
      content = [{ type: 'text', text: String(a + b) }];
    } else {
      send({
        jsonrpc: '2.0',
        id: msg.id,
        error: { code: -32602, message: `unknown tool: ${name}` },
      });
      return;
    }
    send({ jsonrpc: '2.0', id: msg.id, result: { content } });
    return;
  }

  send({
    jsonrpc: '2.0',
    id: msg.id,
    error: { code: -32601, message: `method not found: ${msg.method}` },
  });
});

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}
