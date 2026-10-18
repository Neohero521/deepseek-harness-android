#!/usr/bin/env node
/**
 * fetch-nodejs-mobile.mjs
 *
 * Downloads the prebuilt Node.js runtime for Android (nodejs-mobile) into
 * app/libnode/ so the APK can link libnode.so.
 *
 * Usage:
 *   node scripts/fetch-nodejs-mobile.mjs [version]
 *
 * The pinned version matches the README and the CMake configuration.
 * Requires network access to github.com.
 */

import { execFileSync } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdirSync, existsSync, rmSync, readdirSync, statSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DEST = path.join(ROOT, 'app', 'libnode');

const VERSION = process.argv[2] || 'v18.20.4';
const URL = `https://github.com/nodejs-mobile/nodejs-mobile/releases/download/${VERSION}/nodejs-mobile-${VERSION}-android.zip`;

const ABIS = ['arm64-v8a', 'armeabi-v7a', 'x86_64'];

async function download(url, dest) {
  const resp = await fetch(url, { redirect: 'follow' });
  if (!resp.ok) throw new Error(`download failed: ${resp.status} ${resp.statusText} (${url})`);
  await pipeline(Readable.fromWeb(resp.body), createWriteStream(dest));
}

function unzip(zipPath, destDir) {
  // Prefer system unzip; fall back to Python's zipfile.
  try {
    execFileSync('unzip', ['-q', '-o', zipPath, '-d', destDir]);
    return;
  } catch {
    /* fall through */
  }
  execFileSync('python3', ['-c', `
import sys, zipfile
z = zipfile.ZipFile(sys.argv[1])
z.extractall(sys.argv[2])
`, zipPath, destDir]);
}

function alreadyPresent() {
  return ABIS.every((abi) =>
    existsSync(path.join(DEST, 'bin', abi, 'libnode.so')) && existsSync(path.join(DEST, 'include', 'node', 'node.h')),
  );
}

async function main() {
  if (alreadyPresent()) {
    console.log('[fetch-nodejs-mobile] libnode already present — nothing to do.');
    return;
  }

  console.log(`[fetch-nodejs-mobile] downloading ${URL}`);
  const tmpZip = path.join(ROOT, '.tmp-nodejs-mobile.zip');
  await download(URL, tmpZip);
  console.log(`[fetch-nodejs-mobile] downloaded ${(statSync(tmpZip).size / 1024 / 1024).toFixed(1)} MB`);

  rmSync(DEST, { recursive: true, force: true });
  mkdirSync(DEST, { recursive: true });
  unzip(tmpZip, DEST);
  rmSync(tmpZip, { force: true });

  const soFiles = readdirSync(path.join(DEST, 'bin'), { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(path.join(DEST, 'bin', e.name, 'libnode.so')))
    .map((e) => e.name);
  console.log(`[fetch-nodejs-mobile] done. ABIs: ${soFiles.join(', ')}`);
  console.log(`[fetch-nodejs-mobile] headers: ${existsSync(path.join(DEST, 'include', 'node', 'node.h')) ? 'ok' : 'MISSING'}`);
}

main().catch((err) => {
  console.error('[fetch-nodejs-mobile] failed:', err.message);
  process.exit(1);
});
