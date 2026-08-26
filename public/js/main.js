/* SportChat · сборка приложения */

import { $, $$, esc, icon, relTime, fmtCost, fmtInt, toast } from './util.js';
import { api, connectWs } from './api.js';
import { createChat } from './chat.js';
import { createRail } from './rail.js';
import { createSettings } from './settings.js';

/* ── состояние ── */
const S = {
  ws: null,
  sessionId: null,
  busy: false,
  model: localStorage.getItem('sc_model') || 'sonnet',
  permMode: localStorage.getItem('sc_permMode') || 'default',
  includeUser: localStorage.getItem('sc_includeUser') === '1',
  cost: 0,
  tokensIn: 0,
  tokensOut: 0,
  liveOutTokens: 0,
  turnsTotal: 0,
  init: null,
  meta: null,
  mcpServers: [],
  skills: [],
};

const led = $('#led');
const statusLabel = $('#statusLabel');

function setStatus(kind, label) {
  led.className = `led ${
    kind === 'busy' ? 'led-busy'
      : kind === 'tool' ? 'led-tool'
        : kind === 'wait' ? 'led-wait'
          : 'led-ready'}`;
  statusLabel.textContent = label;
}

function updateTablo() {
  $('#mTokens').textContent = S.liveOutTokens > 0
    ? `↑ ${fmtInt(S.liveOutTokens)}`
    : fmtInt(S.tokensOut);
  $('#mCost').textContent = fmtCost(S.cost);
  $('#mTurns').textContent = fmtInt(S.turnsTotal);
}

function plural(n, one, few, many) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

function updateEngineInfo() {
  const v = S.init?.version ? `v${S.init.version}` : '';
  $('#ccVersion').textContent = v;
  $('#capEngine').textContent = `Claude Code${S.init?.version ? ` ${S.init.version}` : ''}`;
  const n = S.mcpServers.length;
  $('#capMcp').textContent = n === 0 ? 'нет серверов' : `${n} ${plural(n, 'сервер', 'сервера', 'серверов')}`;
  $('#capSkills').textContent = String(S.skills.length);
  const pCount = (S.pluginSelection || []).length;
  $('#sbCounts').textContent = `mcp:${n} · skills:${S.skills.length}${pCount ? ` · plugins:${pCount}` : ''}`;
}

/* ── модули ── */
let chat;

function updateCaps() {
  updateEngineInfo();
}
const rail = createRail({ S, toast, updateCaps });

const settings = createSettings({ S, updateTablo, updateEngineInfo });

/* ── WebSocket ── */
const wsApi = connectWs({
  onMessage(msg) {
    if (msg.t === 'stderr') {
      rail.cliLog(`[agent] ${msg.v}`, 'dim');
      return;
    }
    if (msg.t === 'busy') {
      toast('Агент уже отвечает — дождись завершения', 'warn');
      return;
    }
    if (msg.t === 'done') loadSessions();
    chat.handle(msg);
  },
  onState(connected) {
    const el = $('#sbConn');
    el.innerHTML = connected
      ? '<span class="sb-led sb-led-ok"></span> подключено'
      : '<span class="sb-led sb-led-off"></span> соединение потеряно';
    if (!connected && S.busy) {
      setStatus('ready', 'ГОТОВ');
    }
  },
});
S.ws = wsApi;

chat = createChat({
  S,
  ws: wsApi,
  rail,
  setStatus,
  updateTablo,
  onSlash,
  getCommands: () => SLASH_COMMANDS,
});

chat.bindSessionStarted((init) => {
  // реальная модель и версия от CLI
  $('#modelBtn').textContent = shortModel(init.model);
  updateEngineInfo();
  loadSessions();
});

function shortModel(m) {
  if (!m || m === 'default') return 'по умолчанию';
  return String(m).replace(/-\d{8}$/g, '');
}

/* ══════════ слэш-команды ══════════ */
const SLASH_COMMANDS = [
  { cmd: '/plugin', desc: 'магазин плагинов Claude Code', run: () => rail.switchTab('plugins') },
  { cmd: '/reload-plugins', desc: 'перечитать плагины', run: async () => {
    await rail.loadPlugins();
    toast('Плагины перечитаны — применятся к следующему сообщению', 'ok');
  } },
  { cmd: '/reload-skills', desc: 'перечитать навыки', run: async () => {
    await rail.loadSkills();
    toast('Навыки перечитаны — активны со следующего сообщения', 'ok');
  } },
  { cmd: '/mcp', desc: 'панель MCP-серверов', run: () => rail.switchTab('mcp') },
  { cmd: '/skills', desc: 'панель навыков', run: () => rail.switchTab('skills') },
  { cmd: '/model', desc: 'выбор модели', run: () => {
    renderModelMenu();
    modelMenu.hidden = false;
  } },
  { cmd: '/clear', desc: 'новый разбор', run: () => newChat() },
  { cmd: '/help', desc: 'список команд', run: () => {
    chat.note(`<b style="color:var(--flut)">Команды SportChat</b><br>${
      SLASH_COMMANDS.map((c) => `<span style="font-family:var(--f-mono);color:var(--flut)">${c.cmd}</span> — ${c.desc}`).join('<br>')
    }<br><br>Команды плагинов (например <span style="font-family:var(--f-mono)">/remember</span>) отправляй как обычное сообщение — их исполняет Claude Code.`);
  } },
];

function onSlash(text) {
  const [name] = text.split(/\s+/, 1);
  const cmd = SLASH_COMMANDS.find((c) => c.cmd === name.toLowerCase());
  if (!cmd) return false;
  cmd.run();
  return true;
}

/* ══════════ табло: выбор модели ══════════ */
const MODELS = [
  { v: 'sonnet', label: 'ox-alpha', hint: 'OpenRouter · основной' },
  { v: 'default', label: 'по умолчанию', hint: 'ANTHROPIC_MODEL' },
  { v: 'opus', label: 'opus 4.8', hint: 'глубокий анализ' },
  { v: 'haiku', label: 'haiku 4.5', hint: 'быстрые ответы' },
];
const modelBtn = $('#modelBtn');
const modelMenu = $('#modelMenu');

function renderModelMenu() {
  modelMenu.innerHTML = `
    ${MODELS.map((m) => `
      <button data-v="${m.v}" class="${S.model === m.v ? 'active' : ''}">
        <span>${m.label}</span><span style="color:var(--faint);font-size:10px">${m.hint}</span>
      </button>`).join('')}
    <div class="mm-custom">
      <input type="text" placeholder="свой id модели" id="modelCustom">
      <button class="btn-run" id="modelCustomGo">OK</button>
    </div>`;
  modelMenu.querySelectorAll('button[data-v]').forEach((b) => {
    b.addEventListener('click', () => setModel(b.dataset.v));
  });
  modelMenu.querySelector('#modelCustomGo').addEventListener('click', () => {
    const v = modelMenu.querySelector('#modelCustom').value.trim();
    if (v) setModel(v);
  });
  modelMenu.querySelector('#modelCustom').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const v = e.target.value.trim();
      if (v) setModel(v);
    }
  });
}
function setModel(v) {
  S.model = v;
  localStorage.setItem('sc_model', v);
  modelBtn.textContent = MODELS.find((m) => m.v === v)?.label || v;
  modelMenu.hidden = true;
  toast(`Модель: ${MODELS.find((m) => m.v === v)?.label || v} — применится к следующему сообщению`, '', 2600);
}
modelBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  renderModelMenu();
  modelMenu.hidden = !modelMenu.hidden;
});
document.addEventListener('click', (e) => {
  if (!modelMenu.hidden && !modelMenu.contains(e.target)) modelMenu.hidden = true;
});

/* ══════════ композер и режимы ══════════ */
$('#sendBtn').addEventListener('click', () => chat.send());
$('#stopBtn').addEventListener('click', () => {
  wsApi.send({ t: 'stop' });
  toast('Прерываю…', 'warn', 1800);
});

const permSel = $('#permMode');
permSel.value = S.permMode;
permSel.classList.toggle('danger', S.permMode === 'bypassPermissions');
permSel.addEventListener('change', () => {
  if (permSel.value === 'bypassPermissions' && S.permMode !== 'bypassPermissions') {
    const ok = confirm('РЕЖИМ ПОЛНОГО ДОСТУПА (аналог claude --dangerously-skip-permissions):\nагент будет выполнять любые действия — запись файлов, команды — без подтверждений.\n\nВключить?');
    if (!ok) {
      permSel.value = S.permMode;
      return;
    }
    toast('Полный доступ включён — агент действует без подтверждений', 'warn', 5000);
  }
  S.permMode = permSel.value;
  permSel.classList.toggle('danger', S.permMode === 'bypassPermissions');
  localStorage.setItem('sc_permMode', S.permMode);
});
const includeUserCb = $('#includeUser');
includeUserCb.checked = S.includeUser;
includeUserCb.addEventListener('change', () => {
  S.includeUser = includeUserCb.checked;
  localStorage.setItem('sc_includeUser', S.includeUser ? '1' : '');
});

/* ══════════ подсказки-чипсы ══════════ */
$$('.chip[data-prompt]').forEach((chip) => {
  chip.addEventListener('click', () => {
    const input = $('#input');
    input.value = chip.dataset.prompt;
    input.focus();
    input.dispatchEvent(new Event('input'));
  });
});

/* ══════════ история сессий ══════════ */
async function loadSessions() {
  try {
    const sessions = await api('/sessions');
    const list = $('#sessionList');
    if (!sessions.length) {
      list.innerHTML = '<div class="empty-note">Пока пусто. Начни первый разбор.</div>';
      return;
    }
    list.replaceChildren(...sessions.map(renderSession));
  } catch { /* сервер мог перезапуститься */ }
}

function renderSession(sess) {
  const el = document.createElement('div');
  el.className = `sess-item ${sess.id === S.sessionId ? 'active' : ''}`;
  el.innerHTML = `
    <div class="sess-title">${esc(sess.title)}</div>
    <div class="sess-meta">
      <span>${relTime(sess.updatedAt)}</span>
      ${sess.model ? `<span>${esc(sess.model)}</span>` : ''}
    </div>
    <button class="sess-del" title="Удалить из истории">${icon('trash')}</button>`;
  el.addEventListener('click', async (e) => {
    if (e.target.closest('.sess-del')) return;
    await openSession(sess);
  });
  el.querySelector('.sess-del').addEventListener('click', async () => {
    if (!confirm(`Удалить «${sess.title}» из истории?`)) return;
    try {
      await api(`/sessions/${sess.id}`, { method: 'DELETE' });
      if (S.sessionId === sess.id) newChat();
      loadSessions();
    } catch (err) {
      toast(err.message, 'err');
    }
  });
  return el;
}

async function openSession(sess) {
  if (S.busy) {
    toast('Дождись окончания текущего ответа', 'warn');
    return;
  }
  try {
    const tr = await api(`/sessions/${sess.id}/transcript`);
    S.sessionId = sess.id;
    chat.clear();
    chat.hideEmpty();
    chat.addDivider(`ИСТОРИЯ ЗАГРУЖЕНА · ${tr.items.length} РЕПЛИК`);
    for (const item of tr.items) {
      if (item.role === 'user') chat.addUserBubble(item.text);
      else chat.addAiReplay(item.text, item.tools || []);
    }
    $('#ucSession').hidden = false;
    $('#ucSession').textContent = `сессия ${sess.id.slice(0, 8)}…`;
    document.body.classList.remove('side-open');
    loadSessions();
    chat.scrollDown(true);
    toast(`Разбор «${sess.title.slice(0, 40)}» продолжается — контекст у агента`, 'ok');
  } catch (e) {
    toast(e.message, 'err');
  }
}

$('#refreshSessions').addEventListener('click', loadSessions);

/* ══════════ новый разбор ══════════ */
function newChat() {
  if (S.busy) wsApi.send({ t: 'stop' });
  S.sessionId = null;
  S.cost = 0;
  S.tokensIn = 0;
  S.tokensOut = 0;
  S.liveOutTokens = 0;
  S.turnsTotal = 0;
  S.init = null;
  chat.clear();
  rail.clearEpisodes();
  $('#ucSession').hidden = true;
  updateTablo();
  setStatus('ready', 'ГОТОВ');
  document.body.classList.remove('side-open');
  loadSessions();
}
$('#newChatBtn').addEventListener('click', newChat);

/* ══════════ хедер / рейл ══════════ */
$$('.tbtn[data-open]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const target = btn.dataset.open;
    if (target === 'settings') settings.openSettings();
    else rail.switchTab(target);
  });
});
$('#railToggle').addEventListener('click', () => document.body.classList.toggle('rail-open'));

// кнопка сайдбара на узких экранах: тап по бренду открывает историю
$('.brand').addEventListener('click', () => {
  if (window.matchMedia('(max-width: 1023px)').matches) {
    document.body.classList.toggle('side-open');
  }
});

/* ══════════ старт ══════════ */
(async function boot() {
  try {
    S.meta = await api('/meta');
    $('#wsPath').textContent = `…\\${S.meta.workspace.split('\\').slice(-2).join('\\')}`;
    $('#wsPath').title = S.meta.workspace;
    $('#sbWs').textContent = S.meta.workspace;
  } catch { /* ignore */ }

  await Promise.all([rail.loadMcp(), rail.loadSkills(), rail.loadPlugins()]);
  loadSessions();

  modelBtn.textContent = MODELS.find((m) => m.v === S.model)?.label || S.model;
  updateTablo();
  updateEngineInfo();
  setStatus('ready', 'ГОТОВ');

  // автостарт сессии не нужен — ждём первый вопрос
  $('#input').focus();
})();

// отладочный доступ
window.SC = { S, get chat() { return chat; }, get rail() { return rail; } };
