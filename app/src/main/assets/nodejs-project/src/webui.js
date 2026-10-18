'use strict';
/**
 * Lightweight in-app Web UI for the agent.
 *
 * A single self-contained HTML page served by the bridge at `/` (and `/web`).
 * It speaks the exact same JSON protocol as the native Kotlin UI:
 *   - POST /rpc   (chat.send, tool.approve, config.set, ...)
 *   - GET  /events (long-poll event stream)
 *
 * Render it in a WebView or any browser on the device: http://127.0.0.1:37777
 *
 * Design rationale (from the research survey in README): WebView is the
 * presentation layer only; all computation stays in the native shell and the
 * Node host, which the hybrid-app literature consistently recommends.
 */

const PAGE = `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<title>DeepSeek Harness</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, "PingFang SC", "Noto Sans SC", system-ui, sans-serif;
         background: #0e1116; color: #e8ebf2; height: 100vh; display: flex; flex-direction: column; }
  header { display: flex; align-items: center; gap: 10px; padding: 10px 14px;
           border-bottom: 1px solid #1e242e; flex-wrap: wrap; }
  header h1 { font-size: 15px; font-weight: 600; }
  #status { font-size: 12px; color: #9aa4b2; margin-left: auto; }
  #status.on { color: #7c5cff; }
  #settingsBtn { background: none; border: 1px solid #2a3240; color: #9aa4b2;
                 border-radius: 6px; padding: 4px 10px; font-size: 12px; cursor: pointer; }
  #settingsPanel { display: none; padding: 10px 14px; border-bottom: 1px solid #1e242e; gap: 8px; }
  #settingsPanel.open { display: flex; flex-wrap: wrap; }
  #settingsPanel input { background: #171b23; border: 1px solid #2a3240; color: #e8ebf2;
                         border-radius: 6px; padding: 7px 10px; font-size: 13px; flex: 1 1 220px; }
  #settingsPanel button { background: #7c5cff; color: #fff; border: 0; border-radius: 6px;
                          padding: 7px 14px; font-size: 13px; cursor: pointer; }
  main { flex: 1; overflow-y: auto; padding: 14px; display: flex; flex-direction: column; gap: 10px; }
  .row { display: flex; }
  .row.user { justify-content: flex-end; }
  .bubble { max-width: 82%; padding: 10px 14px; border-radius: 16px; font-size: 14px;
            line-height: 1.55; white-space: pre-wrap; word-break: break-word; }
  .row.user .bubble { background: rgba(124,92,255,.22); border-bottom-right-radius: 4px; }
  .row.assistant .bubble { background: #1e242e; border-bottom-left-radius: 4px; }
  .row.system { justify-content: center; }
  .row.system span { font-size: 12px; color: #9aa4b2; padding: 2px 0; }
  .cursor { display: inline-block; width: 8px; height: 14px; background: #7c5cff;
            vertical-align: -2px; margin-left: 3px; animation: blink 1s steps(1) infinite; }
  @keyframes blink { 50% { opacity: 0; } }
  .tool { background: #171b23; border: 1px solid #2a3240; border-radius: 12px; padding: 10px 12px; }
  .tool .t-name { color: #7c5cff; font-size: 13px; font-weight: 600; margin-bottom: 6px; }
  .tool pre { background: #0e1116; border-radius: 8px; padding: 8px; font-size: 12px;
              overflow-x: auto; max-height: 160px; color: #b9c2d0; }
  .tool .t-status { font-size: 12px; margin-top: 6px; }
  .tool .t-status.pending { color: #f5b14c; }
  .tool .t-status.ok { color: #7c5cff; }
  .tool .t-status.fail { color: #ff6b6b; }
  .tool .actions { display: flex; gap: 8px; margin-top: 8px; }
  .tool button { flex: 1; border: 0; border-radius: 8px; padding: 8px; font-size: 13px; cursor: pointer; }
  .tool .approve { background: #7c5cff; color: #fff; }
  .tool .reject { background: #1e242e; color: #9aa4b2; border: 1px solid #2a3240; }
  footer { display: flex; gap: 8px; padding: 10px 14px; border-top: 1px solid #1e242e; }
  #input { flex: 1; background: #171b23; border: 1px solid #2a3240; color: #e8ebf2;
           border-radius: 10px; padding: 10px 12px; font-size: 14px; resize: none; }
  #send { background: #7c5cff; color: #fff; border: 0; border-radius: 10px; padding: 0 18px;
          font-size: 14px; cursor: pointer; }
  #send:disabled { opacity: .4; cursor: default; }
</style>
</head>
<body>
<header>
  <h1>DeepSeek Harness</h1>
  <span id="status">connecting…</span>
  <button id="settingsBtn">设置</button>
</header>
<div id="settingsPanel">
  <input id="apiKey" type="password" placeholder="API Key">
  <input id="baseUrl" placeholder="Base URL">
  <input id="model" placeholder="模型（deepseek-chat）">
  <select id="approval">
    <option value="manual">每次批准</option>
    <option value="auto">自动执行</option>
  </select>
  <button id="saveConfig">保存</button>
</div>
<main id="messages"></main>
<footer>
  <textarea id="input" rows="1" placeholder="让 agent 干活…"></textarea>
  <button id="send">发送</button>
</footer>
<script>
'use strict';
const $ = (id) => document.getElementById(id);
const main = $('messages');

let lastAssistant = null;      // streaming bubble element
const toolEls = {};            // callId -> {statusEl, actionsEl}

function addRow(cls, node) {
  const row = document.createElement('div');
  row.className = 'row ' + cls;
  row.appendChild(node);
  main.appendChild(row);
  main.scrollTop = main.scrollHeight;
  return row;
}
function addSystem(text) {
  const span = document.createElement('span');
  span.textContent = text;
  addRow('system', span);
}
function addUser(text) {
  const b = document.createElement('div');
  b.className = 'bubble';
  b.textContent = text;
  addRow('user', b);
}
function addAssistant(text) {
  const b = document.createElement('div');
  b.className = 'bubble';
  b.textContent = text;
  const row = addRow('assistant', b);
  lastAssistant = { row, b };
  return b;
}

async function rpc(method, params) {
  const resp = await fetch('/rpc', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: Date.now(), method, params: params || {} }),
  });
  return resp.json();
}

function renderTool(ev) {
  if (toolEls[ev.callId]) return;
  const card = document.createElement('div');
  card.className = 'tool';
  const name = document.createElement('div');
  name.className = 't-name';
  name.textContent = '🛠 ' + ev.tool;
  const pre = document.createElement('pre');
  pre.textContent = JSON.stringify(ev.args, null, 2);
  const statusEl = document.createElement('div');
  statusEl.className = 't-status';
  card.append(name, pre, statusEl);
  const actions = document.createElement('div');
  actions.className = 'actions';
  const approve = document.createElement('button');
  approve.className = 'approve'; approve.textContent = '批准执行';
  approve.onclick = () => { rpc('tool.approve', { callId: ev.callId, approved: true }); setStatus(statusEl, actions, 'pending', '等待执行…'); };
  const reject = document.createElement('button');
  reject.className = 'reject'; reject.textContent = '拒绝';
  reject.onclick = () => { rpc('tool.approve', { callId: ev.callId, approved: false }); setStatus(statusEl, actions, 'fail', '已拒绝'); };
  actions.append(approve, reject);
  card.appendChild(actions);
  toolEls[ev.callId] = { statusEl, actions };
  setStatus(statusEl, actions, 'pending', '待批准');
  addRow('assistant', card);
}

function setStatus(statusEl, actions, kind, text) {
  statusEl.className = 't-status ' + kind;
  statusEl.textContent = text;
  if (actions) actions.style.display = 'none';
}

function handleEvent(ev) {
  switch (ev.type) {
    case 'agent.started': addSystem('Agent 开始执行任务'); break;
    case 'message.delta':
      if (!lastAssistant) addAssistant('');
      lastAssistant.b.textContent += ev.text;
      if (!lastAssistant.b.querySelector('.cursor')) {
        const c = document.createElement('span'); c.className = 'cursor';
        lastAssistant.b.appendChild(c);
      }
      main.scrollTop = main.scrollHeight;
      break;
    case 'message.done':
      if (lastAssistant) {
        const b = lastAssistant.b;
        const cursor = b.querySelector('.cursor'); if (cursor) cursor.remove();
        b.textContent = ev.text || b.textContent;
        lastAssistant = null;
      } else if (ev.text) addAssistant(ev.text);
      break;
    case 'tool.call': renderTool(ev); break;
    case 'tool.result': {
      const t = toolEls[ev.callId];
      if (t) {
        const kind = ev.ok ? 'ok' : 'fail';
        setStatus(t.statusEl, null, kind, (ev.ok ? '已完成' : '失败') + (ev.output ? '：' + ev.output.slice(0, 300) : ''));
      }
      break;
    }
    case 'agent.finished': addSystem('任务完成'); break;
    case 'error': addSystem('运行时错误：' + ev.message); break;
  }
}

async function eventLoop() {
  for (;;) {
    try {
      const resp = await fetch('/events');
      const batch = await resp.json();
      batch.forEach(handleEvent);
      $('status').className = 'on';
      $('status').textContent = 'runtime online';
    } catch (e) {
      $('status').className = '';
      $('status').textContent = 'runtime offline';
      await new Promise(r => setTimeout(r, 1500));
    }
  }
}

function send() {
  const text = $('input').value.trim();
  if (!text) return;
  $('input').value = '';
  addUser(text);
  lastAssistant = null;
  $('send').disabled = true;
  rpc('chat.send', { text }).then((res) => {
    $('send').disabled = false;
    if (!res.ok) addSystem('发送失败：' + (res.error || 'unknown'));
  }).catch(() => {
    $('send').disabled = false;
    addSystem('无法连接本地运行时');
  });
}

$('send').onclick = send;
$('input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
});
$('settingsBtn').onclick = () => $('settingsPanel').classList.toggle('open');
$('saveConfig').onclick = async () => {
  await rpc('config.set', {
    apiKey: $('apiKey').value.trim(),
    baseUrl: $('baseUrl').value.trim(),
    model: $('model').value.trim(),
    approvalMode: $('approval').value,
  });
  $('settingsPanel').classList.remove('open');
};
rpc('config.get', {}).then((res) => {
  const c = res.result && res.result.config;
  if (c) {
    $('baseUrl').value = c.baseUrl || '';
    $('model').value = c.model || '';
    $('approval').value = c.approvalMode || 'manual';
    if (c.apiKey) $('apiKey').placeholder = '已设置（输入可更换）';
  }
}).catch(() => {});
eventLoop();
</script>
</body>
</html>`;

module.exports = { PAGE };
