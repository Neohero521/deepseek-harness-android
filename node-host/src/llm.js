'use strict';
/**
 * dsh-android-node-host — LLM client (OpenAI-compatible chat completions).
 *
 * Works with any OpenAI-compatible endpoint. DeepSeek's API is OpenAI
 * compatible by default (https://api.deepseek.com/v1).
 *
 * Compatible with Node.js 18+ (nodejs-mobile ships libnode v18.20.4, which
 * has a stable global fetch).
 */

const DEFAULT_BASE_URL = 'https://api.deepseek.com/v1';
const DEFAULT_MODEL = 'deepseek-chat';

class LlmClient {
  constructor(config) {
    this.config = config;
  }

  get baseUrl() {
    return String(this.config.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
  }

  get model() {
    return this.config.model || DEFAULT_MODEL;
  }

  get apiKey() {
    return this.config.apiKey || '';
  }

  /**
   * Stream a chat completion.
   *
   * @param {Array<object>} messages OpenAI-style message array.
   * @param {object} [options]
   * @param {Array<object>} [options.tools] OpenAI tool definitions.
   * @param {AbortSignal} [options.signal]
   * @yields {object} events:
   *   {type:'delta', text}                 streaming content chunk
   *   {type:'tool_calls', calls}           final accumulated tool calls
   *   {type:'done', text}                  end of the response
   */
  async *complete(messages, { tools, signal } = {}) {
    const body = {
      model: this.model,
      messages,
      stream: true,
    };
    if (Array.isArray(tools) && tools.length) {
      body.tools = tools;
      body.tool_choice = 'auto';
    }

    const resp = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
      signal,
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`LLM API error ${resp.status}: ${text.slice(0, 400)}`);
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    let text = '';
    let toolCalls = [];

    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });

        let idx;
        while ((idx = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, idx).trim();
          buf = buf.slice(idx + 1);
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (!data || data === '[DONE]') continue;
          let json;
          try {
            json = JSON.parse(data);
          } catch {
            continue; // ignore keep-alive / partial frames
          }
          const delta = (json.choices && json.choices[0] && json.choices[0].delta) || {};
          if (delta.content) {
            text += delta.content;
            yield { type: 'delta', text: delta.content };
          }
          if (Array.isArray(delta.tool_calls)) {
            for (const tc of delta.tool_calls) {
              const index = tc.index || 0;
              while (toolCalls.length <= index) {
                toolCalls.push({ id: '', type: 'function', function: { name: '', arguments: '' } });
              }
              const target = toolCalls[index];
              if (tc.id) target.id = tc.id;
              if (tc.function) {
                if (tc.function.name) target.function.name += tc.function.name;
                if (tc.function.arguments) target.function.arguments += tc.function.arguments;
              }
            }
          }
        }
      }
    } finally {
      try { reader.releaseLock(); } catch { /* noop */ }
    }

    if (toolCalls.length) {
      yield { type: 'tool_calls', calls: toolCalls };
    }
    yield { type: 'done', text };
  }
}

module.exports = { LlmClient, DEFAULT_BASE_URL, DEFAULT_MODEL };
