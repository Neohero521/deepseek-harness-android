'use strict';
/**
 * Shell tool — lets the agent run shell commands on the device.
 *
 * On Android the available command set is limited (toybox/mksh based
 * /system/bin/sh). This is the "real execution" escape hatch of the harness;
 * it is intentionally gated behind user approval in manual mode.
 */

const { spawn } = require('child_process');

const MAX_OUTPUT = 30000;

function makeShellTools({ workDir }) {
  return [
    {
      name: 'shell.run',
      description:
        'Run a shell command on the device and return its output. ' +
        'Working directory is the agent workspace. Note: Android ships a limited shell (toybox). ' +
        'Use for listing files, running scripts, or inspecting the environment.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'The shell command to run, e.g. "ls -la" or "python3 main.py".' },
          timeoutMs: { type: 'number', description: 'Timeout in milliseconds (default 30000, max 120000).' },
        },
        required: ['command'],
      },
      async execute(args) {
        const command = String(args.command || '').trim();
        if (!command) return 'empty command';
        const timeoutMs = Math.min(Number(args.timeoutMs) || 30000, 120000);

        return new Promise((resolve) => {
          let stdout = '';
          let stderr = '';
          let settled = false;

          const finish = (result) => {
            if (settled) return;
            settled = true;
            resolve(result);
          };

          let child;
          try {
            child = spawn('/system/bin/sh', ['-c', command], {
              cwd: workDir,
              env: {
                ...process.env,
                HOME: workDir,
                PATH: '/system/bin:/system/xbin:/vendor/bin:/sbin',
              },
            });
          } catch (err) {
            finish({ exitCode: -1, stdout: '', stderr: `spawn failed: ${err.message}` });
            return;
          }

          const timer = setTimeout(() => {
            try { child.kill('SIGKILL'); } catch { /* noop */ }
            finish({ exitCode: -1, stdout: stdout.slice(-MAX_OUTPUT), stderr: stderr + '\n[timed out]' });
          }, timeoutMs);

          child.stdout.on('data', (d) => {
            stdout += d;
            if (stdout.length > MAX_OUTPUT * 2) child.kill();
          });
          child.stderr.on('data', (d) => {
            stderr += d;
            if (stderr.length > MAX_OUTPUT) child.kill();
          });
          child.on('error', (err) => {
            clearTimeout(timer);
            finish({ exitCode: -1, stdout: stdout.slice(-MAX_OUTPUT), stderr: `spawn error: ${err.message}` });
          });
          child.on('close', (code) => {
            clearTimeout(timer);
            finish({
              exitCode: code === null ? -1 : code,
              stdout: stdout.slice(-MAX_OUTPUT),
              stderr: stderr.slice(-MAX_OUTPUT),
            });
          });
        });
      },
    },
  ];
}

module.exports = makeShellTools;
