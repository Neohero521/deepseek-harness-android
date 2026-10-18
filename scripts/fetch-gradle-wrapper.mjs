#!/usr/bin/env node
/**
 * fetch-gradle-wrapper.mjs
 *
 * Restores gradle/wrapper/gradle-wrapper.jar (binary files are not pushed
 * through the plain-text GitHub push path used by this repo's deployment).
 *
 * Usage:
 *   node scripts/fetch-gradle-wrapper.mjs
 */

import { createWriteStream, existsSync, statSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DEST = path.join(ROOT, 'gradle', 'wrapper', 'gradle-wrapper.jar');

const URL = 'https://raw.githubusercontent.com/gradle/gradle/v8.9.0/gradle/wrapper/gradle-wrapper.jar';

async function main() {
  if (existsSync(DEST) && statSync(DEST).size > 10000) {
    console.log('[fetch-gradle-wrapper] wrapper jar already present — nothing to do.');
    return;
  }
  console.log('[fetch-gradle-wrapper] downloading gradle-wrapper.jar (v8.9.0)');
  const resp = await fetch(URL, { redirect: 'follow' });
  if (!resp.ok) throw new Error(`download failed: ${resp.status} ${resp.statusText}`);
  await pipeline(Readable.fromWeb(resp.body), createWriteStream(DEST));
  console.log(`[fetch-gradle-wrapper] done (${(statSync(DEST).size / 1024).toFixed(1)} KB)`);
}

main().catch((err) => {
  console.error('[fetch-gradle-wrapper] failed:', err.message);
  process.exit(1);
});
