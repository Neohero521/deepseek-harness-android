'use strict';
/**
 * Agent loop — model + harness.
 *
 * Mirrors the DeepSeek Harness philosophy ("Agent = Model + Harness"): the
 * model produces intent, the harness gives it a real environment (tools) and
 * keeps it working until the task is done.
 *
 * Flow:
 *   user message -> LLM (streaming) ->
 *     [tool_calls] -> approve (unless auto) -> execute -> feed results back -> loop
 *     [text only] -> done
 */

const { ToolRegistry } = require('./tools');
const { LlmClient } = require('./llm');
const { McpManager } = require('./mcp');

const MAX_ITERATIONS = 20;
const MAX_TOOL_OUTPUT = 8000;
const MAX_EVENT_OUTPUT = 2000;

function truncate(s, n) {
  const str = String(s);
  return str.length > n ? str.slice(0, n) + `…(truncated ${str.length - n} chars)` : str;
}

class AgentSession {
  constructor({ config, events }) {
    this.config = config; // { apiKey, baseUrl, model, approvalMode, workDir, mcpServers }
    this.events = events; // { emit(ev) }  -> bridge
    this.llm = new LlmClient(config);
    this.mcps = new McpManager({ logger: console });
    this.tools = new ToolRegistry({ workDir: config.workDir, mcps: this.mcps });
    this.messages = [];
    this.running = false;
    this.pendingApprovals = new Map(); // callId -> resolve(bool)
    this.abortController = null;

    // connect MCP servers configured before startup
    if (Array.isArray(config.mcpServers) && config.mcpServers.length) {
      setImmediate(() => {
        this.mcps.configure(config.mcpServers).catch((err) => {
          this.events.emit({ type: 'error', message: `MCP configure failed: ${err.message}` });
        });
      });
    }
  }

  get busy() {
    return this.running;
  }

  reset() {
    this.messages = [];
    for (const resolve of this.pendingApprovals.values()) resolve(false);
    this.pendingApprovals.clear();
  }

  async send(userText) {
    if (this.running) throw new Error('agent is already running');
    this.running = true;
    this.abortController = new AbortController();
    this.messages.push({ role: 'user', content: userText });
    this.events.emit({ type: 'agent.started' });
    try {
      await this.runLoop();
      this.events.emit({ type: 'agent.finished' });
    } finally {
      this.running = false;
      this.abortController = null;
    }
  }

  stop() {
    if (this.abortController) this.abortController.abort();
  }

  approve(callId, approved) {
    const resolve = this.pendingApprovals.get(callId);
    if (!resolve) return false;
    this.pendingApprovals.delete(callId);
    resolve(!!approved);
    return true;
  }

  async runLoop() {
    for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
      const toolDefs = this.tools.definitions();
      let calls = null;
      let text = '';

      for await (const ev of this.llm.complete(this.messages, {
        tools: toolDefs,
        signal: this.abortController ? this.abortController.signal : undefined,
      })) {
        if (ev.type === 'delta') {
          text += ev.text;
          this.events.emit({ type: 'message.delta', text: ev.text });
        } else if (ev.type === 'tool_calls') {
          calls = ev.calls;
        } else if (ev.type === 'done') {
          text = ev.text;
        }
      }

      if (calls && calls.length) {
        // record the assistant turn that requested tool calls
        this.messages.push({
          role: 'assistant',
          content: text || null,
          tool_calls: calls.map((c) => ({
            id: c.id,
            type: 'function',
            function: { name: c.function.name, arguments: c.function.arguments },
          })),
        });
        this.events.emit({ type: 'message.done', text });

        const toolResults = [];
        for (const call of calls) {
          const { ok, output } = await this.executeToolCall(call);
          const payload = { ok, output: truncate(output, MAX_TOOL_OUTPUT) };
          toolResults.push({
            tool_call_id: call.id,
            role: 'tool',
            content: JSON.stringify(payload),
          });
          this.events.emit({ type: 'tool.result', callId: call.id, ok, output: truncate(output, MAX_EVENT_OUTPUT) });
        }
        this.messages.push(...toolResults);
        continue; // feed back to the model
      }

      this.events.emit({ type: 'message.done', text });
      return;
    }
    this.events.emit({ type: 'error', message: `exceeded ${MAX_ITERATIONS} tool iterations` });
  }

  async executeToolCall(call) {
    const name = call.function && call.function.name;
    if (!name) return { ok: false, output: 'tool call missing function name' };

    let args = {};
    try {
      args = JSON.parse(call.function.arguments || '{}');
      if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('not an object');
    } catch (err) {
      return { ok: false, output: `invalid tool arguments JSON: ${err.message}` };
    }

    const approved = await this.requestApproval(call, name, args);
    if (!approved) return { ok: false, output: 'tool call rejected by user' };

    try {
      const output = await this.tools.execute(name, args);
      return { ok: true, output: String(output) };
    } catch (err) {
      return { ok: false, output: `${name} failed: ${err.message}` };
    }
  }

  requestApproval(call, name, args) {
    if (this.config.approvalMode === 'auto') return Promise.resolve(true);
    return new Promise((resolve) => {
      const callId = call.id || `call_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
      call.id = callId;
      this.pendingApprovals.set(callId, resolve);
      this.events.emit({ type: 'tool.call', callId, tool: name, args });
    });
  }
}

module.exports = { AgentSession, truncate };
