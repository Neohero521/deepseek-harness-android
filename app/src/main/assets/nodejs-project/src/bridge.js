'use strict';
/**
 * Bridge — the local HTTP/JSON channel between the Android UI and the
 * Node.js agent host.
 *
 *   Kotlin -> Node   POST /rpc    {id, method, params}
 *   Node   -> Kotlin GET  /events long-poll, returns a JSON array of events
 *   Health           GET  /health {ok:true}
 *
 * The fixed port (DSH_BRIDGE_PORT, default 37777) is chosen so the native
 * side can connect without any discovery round-trip.
 */

const http = require('http');
const { URL } = require('url');

const DEFAULT_PORT = 37777;
const EVENT_POLL_MS = 25000;
const MAX_BODY = 1024 * 1024;

class Bridge {
  constructor({ agent, port = DEFAULT_PORT, logger = console }) {
    this.agent = agent;
    this.port = port;
    this.logger = logger;
    this.queue = [];
    this.waiters = [];
    this.server = null;
  }

  emit(event) {
    this.queue.push(event);
    const waiters = this.waiters.splice(0);
    for (const resolve of waiters) resolve();
  }

  listen() {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        this.handle(req, res).catch((err) => {
          try {
            res.writeHead(500, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ error: err.message }));
          } catch { /* connection already closed */ }
        });
      });
      this.server.once('error', reject);
      this.server.listen(this.port, '127.0.0.1', () => {
        // port 0 means "pick a free port"; expose the actual one
        this.port = this.server.address().port;
        resolve();
      });
    });
  }

  close() {
    if (this.server) this.server.close();
    this.server = null;
  }

  async handle(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    const url = new URL(req.url, `http://127.0.0.1:${this.port}`);

    if (req.method === 'GET' && url.pathname === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, node: process.version, port: this.port }));
      return;
    }

    if (req.method === 'GET' && url.pathname === '/events') {
      await this.handleEvents(res);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/rpc') {
      await this.handleRpc(req, res);
      return;
    }

    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
  }

  async handleEvents(res) {
    res.writeHead(200, { 'content-type': 'application/json' });
    const deadline = Date.now() + EVENT_POLL_MS;
    while (this.queue.length === 0 && Date.now() < deadline) {
      await new Promise((resolve) => {
        this.waiters.push(resolve);
        setTimeout(resolve, 1000);
      });
    }
    const events = this.queue.splice(0);
    res.end(JSON.stringify(events));
  }

  async handleRpc(req, res) {
    let body = '';
    for await (const chunk of req) {
      body += chunk;
      if (body.length > MAX_BODY) break;
    }

    let msg;
    try {
      msg = JSON.parse(body);
    } catch {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'invalid JSON' }));
      return;
    }

    const { id, method, params = {} } = msg;
    try {
      const result = await this.dispatch(String(method || ''), params || {});
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ id: id ?? null, ok: true, result }));
    } catch (err) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ id: id ?? null, ok: false, error: err.message }));
    }
  }

  async dispatch(method, params) {
    const a = this.agent;
    switch (method) {
      case 'ping':
        return { pong: true, node: process.version, busy: a.busy };
      case 'config.set':
        // only the fields that are safe to change at runtime
        if (typeof params.apiKey === 'string') a.config.apiKey = params.apiKey;
        if (typeof params.baseUrl === 'string' && params.baseUrl.trim()) a.config.baseUrl = params.baseUrl.trim();
        if (typeof params.model === 'string' && params.model.trim()) a.config.model = params.model.trim();
        if (params.approvalMode === 'manual' || params.approvalMode === 'auto') {
          a.config.approvalMode = params.approvalMode;
        }
        return { ok: true, config: this.publicConfig() };
      case 'config.get':
        return { config: this.publicConfig() };
      case 'session.reset':
        a.reset();
        return { ok: true };
      case 'chat.send': {
        const text = String(params.text || '').trim();
        if (!text) throw new Error('empty message');
        if (a.busy) throw new Error('agent is already running');
        // fire and forget: agent events flow through /events
        setImmediate(() => {
          a.send(text).catch((err) => this.emit({ type: 'error', message: err.message }));
        });
        return { ok: true, started: true };
      }
      case 'tool.approve': {
        const matched = a.approve(String(params.callId || ''), !!params.approved);
        return { ok: true, matched };
      }
      case 'agent.stop':
        a.stop();
        return { ok: true };
      case 'mcp.configure': {
        const servers = Array.isArray(params.servers) ? params.servers : [];
        a.config.mcpServers = servers;
        // connect asynchronously; status is observable via mcp.status
        setImmediate(() => {
          a.mcps.configure(servers).catch((err) =>
            this.emit({ type: 'error', message: `MCP configure failed: ${err.message}` }),
          );
        });
        return { ok: true, connecting: servers.length };
      }
      case 'mcp.status':
        return { servers: a.mcps.status() };
      default:
        throw new Error(`unknown method: ${method}`);
    }
  }

  publicConfig() {
    const { apiKey, baseUrl, model, approvalMode, workDir, mcpServers } = this.agent.config;
    return {
      apiKey: apiKey ? '***' : '',
      baseUrl,
      model,
      approvalMode,
      workDir,
      mcpServers: Array.isArray(mcpServers) ? mcpServers : [],
    };
  }
}

module.exports = { Bridge, DEFAULT_PORT };
