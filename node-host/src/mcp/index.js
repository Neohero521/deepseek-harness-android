'use strict';
/**
 * Minimal MCP (Model Context Protocol) client.
 *
 * Implements the two transports that matter on Android:
 *   - stdio: spawn a local MCP server process, newline-delimited JSON-RPC
 *     (MCP 2025-03-26 / 2024-11-05 style, as used by @modelcontextprotocol/sdk)
 *   - streamable HTTP: POST JSON-RPC to a remote endpoint, session header
 *     carried across calls (2025-03-26)
 *
 * Zero dependencies on purpose — runs inside nodejs-mobile (Node 18).
 */

const { spawn } = require('child_process');
const { EventEmitter } = require('events');

const MCP_PROTOCOL_VERSION = '2025-03-26';
const DEFAULT_TIMEOUT_MS = 30000;

class McpError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

class StdioTransport extends EventEmitter {
  constructor(config) {
    super();
    this.config = config;
    this.child = null;
    this.buffer = '';
    this.pending = new Map(); // id -> {resolve, reject, timer}
    this.nextId = 1;
    this.initialized = false;
  }

  async connect() {
    const { command, args = [], cwd, env } = this.config;
    if (!command) throw new McpError(-32600, 'MCP server missing command');

    this.child = spawn(command, args, {
      cwd: cwd || undefined,
      env: env ? { ...process.env, ...env } : process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', (chunk) => this._onData(chunk));
    this.child.stderr.on('data', (chunk) => {
      const text = String(chunk).trim();
      if (text) this.emit('log', `[${this.config.name}] stderr: ${text.slice(0, 500)}`);
    });
    // A child that exits early raises EPIPE on stdin writes; swallow it and
    // let the exit/error handlers reject any in-flight requests.
    this.child.stdin.on('error', () => { /* handled via exit */ });
    this.child.on('error', (err) => this._failAll(new McpError(-32000, `spawn failed: ${err.message}`)));
    this.child.on('exit', (code) => {
      this._failAll(new McpError(-32000, `process exited with code ${code}`));
      this.emit('exit', code);
    });
  }

  _onData(chunk) {
    this.buffer += chunk;
    let idx;
    while ((idx = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, idx).trim();
      this.buffer = this.buffer.slice(idx + 1);
      if (!line) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        this.emit('log', `[${this.config.name}] non-JSON stdout line ignored`);
        continue;
      }
      this._dispatch(msg);
    }
  }

  _dispatch(msg) {
    if (msg.id !== undefined && msg.id !== null) {
      const pending = this.pending.get(msg.id);
      if (!pending) return;
      this.pending.delete(msg.id);
      clearTimeout(pending.timer);
      if (msg.error) {
        pending.reject(new McpError(msg.error.code, msg.error.message || 'MCP error'));
      } else {
        pending.resolve(msg.result);
      }
    } else {
      // server -> client notification
      this.emit('notification', msg);
    }
  }

  _failAll(err) {
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(err);
    }
    this.pending.clear();
  }

  request(method, params) {
    if (!this.child) return Promise.reject(new McpError(-32000, 'not connected'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new McpError(-32001, `MCP request ${method} timed out`));
      }, DEFAULT_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
      const payload = { jsonrpc: '2.0', id, method, params: params || {} };
      try {
        this.child.stdin.write(JSON.stringify(payload) + '\n');
      } catch (err) {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(new McpError(-32000, `write failed: ${err.message}`));
      }
    });
  }

  notify(method, params) {
    if (!this.child) return;
    const payload = { jsonrpc: '2.0', method, params: params || {} };
    this.child.stdin.write(JSON.stringify(payload) + '\n');
  }

  close() {
    this._failAll(new McpError(-32000, 'client closed'));
    if (this.child && this.child.exitCode === null) {
      try { this.child.kill(); } catch { /* noop */ }
    }
    this.child = null;
  }
}

class HttpTransport extends EventEmitter {
  constructor(config) {
    super();
    this.config = config; // {url, headers}
    this.sessionId = null;
    this.nextId = 1;
    this.pending = new Map();
    this.initialized = false;
  }

  async connect() {
    if (!this.config.url) throw new McpError(-32600, 'MCP server missing url');
    // validate reachability lazily on first request
  }

  async _post(payload, { isNotification = false } = {}) {
    const url = this.config.url;
    const headers = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...(this.config.headers || {}),
    };
    if (this.sessionId) headers['Mcp-Session-Id'] = this.sessionId;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      if (resp.headers.has('mcp-session-id')) {
        this.sessionId = resp.headers.get('mcp-session-id');
      }
      const text = await resp.text();
      if (!resp.ok) throw new McpError(resp.status, `HTTP ${resp.status}: ${text.slice(0, 300)}`);
      if (isNotification) return null;

      // Some servers respond with SSE even for JSON requests; handle both.
      if (text.startsWith('data:')) {
        const lines = text.split('\n').filter((l) => l.startsWith('data:'));
        for (const line of lines) {
          const data = line.slice(5).trim();
          if (!data || data === '[DONE]') continue;
          const msg = JSON.parse(data);
          return msg.result !== undefined ? msg.result : msg;
        }
        return null;
      }
      const msg = JSON.parse(text);
      if (msg.error) throw new McpError(msg.error.code, msg.error.message || 'MCP error');
      return msg.result;
    } finally {
      clearTimeout(timer);
    }
  }

  async request(method, params) {
    const id = this.nextId++;
    return this._post({ jsonrpc: '2.0', id, method, params: params || {} });
  }

  async notify(method, params) {
    await this._post({ jsonrpc: '2.0', method, params: params || {} }, { isNotification: true });
  }

  close() {
    this.sessionId = null;
  }
}

/** One connected MCP server (either transport). */
class McpServer {
  constructor(name, config) {
    this.name = name;
    this.config = config;
    this.transport = config.url ? new HttpTransport(config) : new StdioTransport(config);
    this.tools = [];
    this.connected = false;
    this.serverInfo = null;
  }

  async connect() {
    await this.transport.connect();
    const init = await this.transport.request('initialize', {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: { tools: {} },
      clientInfo: { name: 'dsh-android', version: '0.1.0' },
    });
    this.serverInfo = init.serverInfo || null;
    // use the negotiated version when the server offers one
    this.transport.notify('notifications/initialized', {});
    this.connected = true;
    await this.refreshTools();
  }

  async refreshTools() {
    const res = await this.transport.request('tools/list', {});
    this.tools = Array.isArray(res.tools) ? res.tools : [];
    return this.tools;
  }

  async callTool(name, args) {
    const res = await this.transport.request('tools/call', { name, arguments: args || {} });
    const parts = Array.isArray(res.content)
      ? res.content.map((c) => (c.type === 'text' ? c.text : JSON.stringify(c))).join('\n')
      : JSON.stringify(res);
    if (res.isError) throw new McpError(-32000, parts.slice(0, 2000));
    return parts;
  }

  close() {
    this.connected = false;
    this.transport.close();
  }
}

/** Manages a set of configured MCP servers and exposes their tools. */
class McpManager {
  constructor({ logger = console } = {}) {
    this.servers = [];
    this.logger = logger;
  }

  /** (Re)configure: connect to the given server list, disconnect the rest. */
  async configure(configs) {
    const wanted = Array.isArray(configs) ? configs : [];
    const wantedNames = new Set(wanted.map((c) => c.name).filter(Boolean));

    // drop servers no longer configured
    for (const server of this.servers) {
      if (!wantedNames.has(server.name)) {
        try { server.close(); } catch { /* noop */ }
      }
    }
    this.servers = this.servers.filter((s) => wantedNames.has(s.name));

    // connect new / changed ones
    for (const cfg of wanted) {
      if (!cfg.name) continue;
      const existing = this.servers.find((s) => s.name === cfg.name);
      const same = existing && JSON.stringify(existing.config) === JSON.stringify(cfg);
      if (existing && same) continue;
      if (existing) {
        try { existing.close(); } catch { /* noop */ }
        this.servers = this.servers.filter((s) => s.name !== cfg.name);
      }
      const server = new McpServer(cfg.name, cfg);
      try {
        await server.connect();
        this.servers.push(server);
        this.logger.log(`[mcp] connected ${cfg.name} (${server.tools.length} tools)`);
      } catch (err) {
        this.logger.error(`[mcp] failed to connect ${cfg.name}: ${err.message}`);
        // keep a record so the status shows the failure
        this.servers.push(server);
      }
    }
  }

  /** All tools from all connected servers, prefixed `mcp.<server>.<tool>`. */
  definitions() {
    const defs = [];
    for (const server of this.servers) {
      if (!server.connected) continue;
      for (const tool of server.tools) {
        defs.push({
          type: 'function',
          function: {
            name: `mcp.${server.name}.${tool.name}`,
            description: `[MCP:${server.name}] ${tool.description || tool.name}`.slice(0, 1024),
            parameters: tool.inputSchema || { type: 'object', properties: {} },
          },
        });
      }
    }
    return defs;
  }

  /** true when the tool name maps to a connected MCP tool. */
  owns(name) {
    if (!name.startsWith('mcp.')) return false;
    const parts = name.split('.');
    if (parts.length < 3) return false;
    const server = this.servers.find((s) => s.name === parts[1]);
    return !!server && server.connected;
  }

  async call(name, args) {
    const parts = name.split('.');
    const server = this.servers.find((s) => s.name === parts[1]);
    if (!server || !server.connected) throw new McpError(-32602, `MCP server not connected: ${parts[1]}`);
    const toolName = parts.slice(2).join('.');
    return server.callTool(toolName, args);
  }

  status() {
    return this.servers.map((s) => ({
      name: s.name,
      connected: s.connected,
      tools: s.connected ? s.tools.length : 0,
      serverInfo: s.serverInfo,
      error: s.connected ? null : 'connection failed',
    }));
  }

  closeAll() {
    for (const s of this.servers) {
      try { s.close(); } catch { /* noop */ }
    }
    this.servers = [];
  }
}

module.exports = { McpManager, McpServer, McpError };
