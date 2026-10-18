'use strict';
/**
 * Tool registry — the "everything is a plugin" core of the harness, kept
 * intentionally small so it runs inside Node.js on Android.
 *
 * Each tool plugin exposes:
 *   { name, description, parameters, async execute(args) -> string|object }
 */

const fsTools = require('./fs');
const shellTools = require('./shell');
const webTools = require('./web');

class ToolRegistry {
  constructor({ workDir }) {
    this.workDir = workDir;
    this.tools = new Map();
    for (const tool of [...fsTools({ workDir }), ...shellTools({ workDir }), ...webTools()]) {
      this.tools.set(tool.name, tool);
    }
  }

  /** OpenAI `tools` array for the LLM. */
  definitions() {
    return Array.from(this.tools.values()).map((t) => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters || { type: 'object', properties: {} },
      },
    }));
  }

  has(name) {
    return this.tools.has(name);
  }

  async execute(name, args) {
    const tool = this.tools.get(name);
    if (!tool) throw new Error(`unknown tool: ${name}`);
    const output = await tool.execute(args || {});
    return typeof output === 'string' ? output : JSON.stringify(output);
  }
}

module.exports = { ToolRegistry };
