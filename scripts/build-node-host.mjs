#!/usr/bin/env node
/**
 * build-node-host.mjs
 *
 * Packages node-host/ (the in-app Node.js agent host) into
 * app/src/main/assets/nodejs-project so it ships inside the APK and is copied
 * to app storage at first launch.
 *
 * Usage:
 *   node scripts/build-node-host.mjs
 */

import { cpSync, rmSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'node-host');
const DEST = path.join(ROOT, 'app', 'src', 'main', 'assets', 'nodejs-project');

const COPY_ITEMS = ['src', 'package.json'];

function main() {
  for (const item of COPY_ITEMS) {
    if (!existsSync(path.join(SRC, item))) {
      throw new Error(`missing ${SRC}/${item}`);
    }
  }

  rmSync(DEST, { recursive: true, force: true });
  mkdirSync(DEST, { recursive: true });

  for (const item of COPY_ITEMS) {
    cpSync(path.join(SRC, item), path.join(DEST, item), { recursive: true });
  }

  const files = readdirSync(DEST, { recursive: true }).map((f) => path.join(DEST, f));
  const jsCount = files.filter((f) => f.endsWith('.js')).length;
  console.log(`[build-node-host] packaged ${jsCount} JS files + package.json -> ${path.relative(ROOT, DEST)}`);
}

try {
  main();
} catch (err) {
  console.error('[build-node-host] failed:', err.message);
  process.exit(1);
}
