'use strict';
/**
 * Tool registry — the "everything is a plugin" core of the harness, kept
 * intentionally small so it runs inside Node.js on Android.
 *
 * Each tool plugin exposes:
 *   { name, description, parameters, async execute(args) -> string|object }
 *
 * MCP servers (see ../mcp) register their tools dynamically as
 * `mcp.<server>.<tool>` entries.
 */

const fsTools = require('./fs');
const shellTools = require('./shell');
const webTools = require('./web');

class ToolRegistry {
  constructor({ workDir, mcps = null }) {
    this.workDir = workDir;
    this.mcps = mcps; // McpManager or null
    this.tools = new Map();
    for (const tool of [...fsTools({ workDir }), ...shellTools({ workDir }), ...webTools()]) {
      this.tools.set(tool.name, tool);
    }
  }

  /** OpenAI `tools` array for the LLM. */
  definitions() {
    const defs = Array.from(this.tools.values()).map((t) => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters || { type: 'object', properties: {} },
      },
    }));
    if (this.mcps) defs.push(...this.mcps.definitions());
    return defs;
  }

  has(name) {
    if (this.tools.has(name)) return true;
    return !!this.mcps && this.mcps.owns(name);
  }

  async execute(name, args) {
    if (this.mcps && this.mcps.owns(name)) {
      const output = await this.mcps.call(name, args || {});
      return typeof output === 'string' ? output : JSON.stringify(output);
    }
    const tool = this.tools.get(name);
    if (!tool) throw new Error(`unknown tool: ${name}`);
    const output = await tool.execute(args || {});
    return typeof output === 'string' ? output : JSON.stringify(output);
  }
}

module.exports = { ToolRegistry };
