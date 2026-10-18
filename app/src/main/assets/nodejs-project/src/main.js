'use strict';
/**
 * dsh-android-node-host entry point.
 *
 * Environment:
 *   DSH_WORKDIR   agent workspace directory (defaults to $HOME/workspace)
 *   DSH_PORT      bridge port (default 37777)
 *   DSH_API_KEY   initial API key (normally set later from the app settings)
 */

const path = require('path');
const fs = require('fs');
const { Bridge, DEFAULT_PORT } = require('./bridge');
const { AgentSession } = require('./agent');

// Android cannot inject env vars into the app process, so the native side
// passes configuration through argv.
const argv = process.argv.slice(2);
function arg(name, fallback) {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
}

const WORKDIR = arg('--workdir', process.env.DSH_WORKDIR || path.join(process.env.HOME || process.cwd(), 'workspace'));
const PORT = Number(arg('--port', process.env.DSH_PORT || DEFAULT_PORT));
const API_KEY = arg('--api-key', process.env.DSH_API_KEY || '');

fs.mkdirSync(WORKDIR, { recursive: true });

const config = {
  apiKey: API_KEY,
  baseUrl: 'https://api.deepseek.com/v1',
  model: 'deepseek-chat',
  approvalMode: 'manual', // manual | auto
  workDir: WORKDIR,
};

async function main() {
  const bridge = new Bridge({ agent: null, port: PORT, logger: console });
  const agent = new AgentSession({
    config,
    events: {
      emit: (ev) => {
        try {
          bridge.emit(ev);
        } catch (err) {
          console.error('[dsh-host] emit failed', err);
        }
      },
    },
  });
  bridge.agent = agent;

  await bridge.listen();
  console.log(`[dsh-host] ready port=${PORT} workdir=${WORKDIR} node=${process.version}`);
  console.log(`[dsh-host] llm=${config.baseUrl} model=${config.model} approval=${config.approvalMode}`);

  // Also write the port file so the native side can double-check.
  try {
    fs.writeFileSync(path.join(WORKDIR, '.dsh-port'), String(PORT));
  } catch { /* non-fatal */ }

  process.on('SIGTERM', () => {
    bridge.close();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error('[dsh-host] fatal', err);
  process.exit(1);
});
