'use strict';
/**
 * Filesystem tools, confined to the agent workspace.
 *
 * Paths given by the model are resolved relative to `workDir` and are
 * rejected when they escape it (no reading /etc or other app-private dirs
 * through the agent).
 */

const path = require('path');
const fs = require('fs');
const fsp = fs.promises;

const MAX_READ_BYTES = 1024 * 1024; // 1 MiB

function resolveInWorkspace(workDir, p) {
  const abs = path.resolve(workDir, p || '.');
  const rel = path.relative(workDir, abs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`path escapes workspace: ${p}`);
  }
  return abs;
}

function makeFsTools({ workDir }) {
  return [
    {
      name: 'fs.workspace_info',
      description: 'Returns the absolute path of the agent workspace. The agent works on files inside this directory.',
      parameters: { type: 'object', properties: {} },
      async execute() {
        return { workspace: workDir };
      },
    },
    {
      name: 'fs.list_dir',
      description: 'List entries in a directory inside the workspace.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Directory path relative to the workspace root. Use "." for the root.' },
        },
      },
      async execute(args) {
        const dir = resolveInWorkspace(workDir, args.path || '.');
        const entries = await fsp.readdir(dir, { withFileTypes: true });
        return entries.map((e) => ({ name: e.name, type: e.isDirectory() ? 'dir' : 'file' }));
      },
    },
    {
      name: 'fs.read_file',
      description: 'Read a text file from the workspace.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path relative to the workspace root.' },
        },
        required: ['path'],
      },
      async execute(args) {
        const file = resolveInWorkspace(workDir, args.path);
        const stat = await fsp.stat(file);
        if (stat.size > MAX_READ_BYTES) {
          throw new Error(`file too large to read (${stat.size} bytes > ${MAX_READ_BYTES})`);
        }
        return await fsp.readFile(file, 'utf8');
      },
    },
    {
      name: 'fs.write_file',
      description: 'Create or overwrite a text file inside the workspace. Creates parent directories as needed.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path relative to the workspace root.' },
          content: { type: 'string', description: 'Full file content.' },
        },
        required: ['path', 'content'],
      },
      async execute(args) {
        const file = resolveInWorkspace(workDir, args.path);
        await fsp.mkdir(path.dirname(file), { recursive: true });
        await fsp.writeFile(file, String(args.content ?? ''), 'utf8');
        return { wrote: file, bytes: Buffer.byteLength(String(args.content ?? '')) };
      },
    },
    {
      name: 'fs.delete_file',
      description: 'Delete a file or an empty directory inside the workspace.',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string', description: 'Path relative to the workspace root.' } },
        required: ['path'],
      },
      async execute(args) {
        const target = resolveInWorkspace(workDir, args.path);
        const stat = await fsp.lstat(target);
        if (stat.isDirectory()) {
          await fsp.rmdir(target);
        } else {
          await fsp.unlink(target);
        }
        return { deleted: target };
      },
    },
  ];
}

module.exports = makeFsTools;
module.exports.resolveInWorkspace = resolveInWorkspace;
