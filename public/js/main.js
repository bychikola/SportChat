/* SportChat · сборка приложения */

import { $, $$, esc, icon, relTime, fmtCost, fmtInt, toast, openModal } from './util.js';
import { api, connectWs } from './api.js';
import { createChat } from './chat.js';
import { createRail } from './rail.js';
import { createSettings } from './settings.js';

/* ── состояние ── */
const S = {
  ws: null,
  sessionId: null,
  busy: false,
  model: localStorage.getItem('sc_model') || 'deepseek-v4-flash',
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
    try {
      chat.handle(msg);
    } catch (e) {
      console.error('[ws-handle]', msg.t, e);
      rail.cliLog(`[client] ошибка обработки ${msg.t}: ${e.message}`, 'err');
    }
  },
  onState(connected) {
    const el = $('#sbConn');
    el.innerHTML = connected
      ? '<span class="sb-led sb-led-ok"></span> подключено'
      : '<span class="sb-led sb-led-off"></span> соединение потеряно';
    if (!connected && S.busy) {
      chat?.stopTurnTimer?.();
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
  // реальная модель от CLI — только когда работаем от конфига workspace
  const act = S.providersData?.active;
  if (!act || act.provider === 'config') $('#modelBtn').textContent = shortModel(init.model);
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

/* ══════════ табло: выбор источника и модели ══════════ */
const MODELS = [
  { v: 'deepseek-v4-flash', label: 'deepseek-v4-flash', hint: 'DeepSeek · основной' },
  { v: 'deepseek-v4-pro', label: 'deepseek-v4-pro', hint: 'глубокий анализ' },
  { v: 'deepseek-v4-flash-vision-exp', label: 'deepseek-v4-flash-vision', hint: 'визуал' },
  { v: 'default', label: 'по умолчанию', hint: 'модель окружения' },
];
const modelBtn = $('#modelBtn');
const modelMenu = $('#modelMenu');
let modelCache = new Map(); // providerKey -> [{id,name}]

async function renderModelMenu() {
  modelMenu.innerHTML = '<div class="mm-loading">Загружаю источники…</div>';
  modelMenu.hidden = false;
  let data;
  try {
    data = await api('/providers');
  } catch (e) {
    modelMenu.innerHTML = `<div class="mm-loading">${esc(e.message)}</div>`;
    return;
  }
  S.providersData = data;
  if (!data.active.provider) data.active = { provider: 'config', model: '' };
  const act = data.active;

  const provRows = [
    `<button class="mm-prov ${act.provider === 'config' ? 'active' : ''}" data-p="config">
       <span class="mm-dot mm-dot-ok"></span><span>Конфиг workspace</span>
       <span class="mm-hint">${esc(data.env?.baseHost || 'env')} · ${esc(data.env?.model || 'env')}</span>
     </button>`,
    ...Object.entries(data.providers).map(([key, p]) => `
      <button class="mm-prov ${act.provider === key ? 'active' : ''}" data-p="${esc(key)}">
        <span class="mm-dot ${p.hasKey ? 'mm-dot-ok' : 'mm-dot-no'}" title="${p.hasKey ? `ключ ${esc(p.keyHint)}` : 'ключ не задан'}"></span>
        <span>${esc(p.label)}</span>
        <span class="mm-hint">${esc(p.type)}${p.hasKey ? '' : ' · нет ключа'}</span>
        ${p.type === 'custom' ? `<span class="mm-x" data-del="${esc(key)}" title="Удалить источник">×</span>` : ''}
      </button>`),
    `<button class="mm-prov mm-add" data-p="__add"><span>＋ Свой источник (JSON)</span></button>`,
  ].join('');

  let modelsHtml = '';
  if (act.provider === 'config') {
    const env = data.env || {};
    modelsHtml = `
      <div class="mm-hintblock">Шлюз окружения: <b style="color:var(--chalk)">${esc(env.baseHost || '…')}</b>${env.model ? ` · модель: <b style="color:var(--chalk)">${esc(env.model)}</b>` : ''}</div>
      ${MODELS.map((m) => `
        <button data-v="${m.v}" class="${S.model === m.v ? 'active' : ''}">
          <span>${m.label}</span><span class="mm-hint">${m.hint}</span>
        </button>`).join('')}
      <div class="mm-custom">
        <input type="text" placeholder="свой id модели" id="modelCustom">
        <button class="btn-run" id="modelCustomGo">OK</button>
      </div>`;
  } else {
    const prov = data.providers[act.provider];
    if (prov && !prov.hasKey && prov.type !== 'openrouter') {
      modelsHtml = `
        <div class="mm-keyrow">
          <input type="password" id="mmKey" placeholder="API-ключ ${esc(prov.label)}">
          <button class="btn-run" id="mmKeySave">Сохранить</button>
        </div>
        <div class="mm-hintblock">Ключ хранится на сервере (data/providers.json) и не попадает в git.</div>`;
    } else {
      modelsHtml = `
        <div class="mm-searchrow">
          <input type="text" id="mmSearch" placeholder="Поиск модели…">
          <button class="btn-run" id="mmRefresh" title="Обновить список">⟳</button>
        </div>
        <div class="mm-list" id="mmList"><div class="mm-loading">Загружаю модели…</div></div>
        <div class="mm-custom">
          <input type="text" placeholder="или введи id вручную" id="modelCustom">
          <button class="btn-run" id="modelCustomGo">OK</button>
        </div>`;
    }
  }

  modelMenu.innerHTML = `
    <div class="mm-sec">Источник</div>
    ${provRows}
    <div class="mm-sec">Модель ${act.provider !== 'config' ? `· ${esc(data.providers[act.provider]?.label || act.provider)}` : ''}</div>
    ${modelsHtml}`;

  wireModelMenu(data);
  if (act.provider !== 'config' && (!data.providers[act.provider] || data.providers[act.provider].hasKey || data.providers[act.provider].type === 'openrouter')) {
    loadProviderModels(act.provider, act.model);
  }
}

async function loadProviderModels(key, selectedId) {
  const list = modelMenu.querySelector('#mmList');
  if (!list) return;
  if (!modelCache.has(key)) {
    try {
      const r = await api(`/providers/${encodeURIComponent(key)}/models`, { method: 'POST' });
      modelCache.set(key, r.models);
    } catch (e) {
      list.innerHTML = `<div class="mm-loading">${esc(e.message)}</div>`;
      return;
    }
  }
  paintModelList(key, selectedId, '');
}

function paintModelList(key, selectedId, query) {
  const list = modelMenu.querySelector('#mmList');
  if (!list) return;
  const all = modelCache.get(key) || [];
  const q = query.trim().toLowerCase();
  const items = q ? all.filter((m) => `${m.id} ${m.name || ''}`.toLowerCase().includes(q)) : all;
  if (!items.length) {
    list.innerHTML = `<div class="mm-loading">${q ? 'Не найдено' : 'Список пуст'}</div>`;
    return;
  }
  list.innerHTML = items.slice(0, 300).map((m) => `
    <button data-v="${esc(m.id)}" class="${m.id === selectedId ? 'active' : ''}">
      <span>${esc(m.id)}</span>${m.name && m.name !== m.id ? `<span class="mm-hint">${esc(m.name).slice(0, 42)}</span>` : ''}
    </button>`).join('');
  list.querySelectorAll('button[data-v]').forEach((b) =>
    b.addEventListener('click', () => selectModel(key, b.dataset.v)));
}

async function wireModelMenu(data) {
  const act = data.active;
  modelMenu.querySelectorAll('.mm-prov').forEach((b) => {
    b.addEventListener('click', async (e) => {
      if (e.target.dataset.del) {
        if (!confirm(`Удалить источник «${e.target.dataset.del}»?`)) return;
        try {
          await api(`/providers/${encodeURIComponent(e.target.dataset.del)}`, { method: 'DELETE' });
          toast('Источник удалён', 'ok');
        } catch (err) { toast(err.message, 'err'); }
        renderModelMenu();
        return;
      }
      const p = b.dataset.p;
      if (p === '__add') return openCustomProviderModal();
      if (p === act.provider) return;
      try {
        await api('/providers-active', { method: 'PUT', body: { provider: p, model: '' } });
        S.activeProvider = p;
        if (p === 'config') updateTabloModelLabel();
        else modelBtn.textContent = `${p} · …`;
        renderModelMenu();
      } catch (err) { toast(err.message, 'err'); }
    });
  });

  // конфиг-модели (алиасы)
  modelMenu.querySelectorAll('button[data-v]').forEach((b) => {
    if (b.closest('.mm-list')) return;
    b.addEventListener('click', () => selectModel('config', b.dataset.v));
  });

  const customInput = modelMenu.querySelector('#modelCustom');
  modelMenu.querySelector('#modelCustomGo')?.addEventListener('click', () => {
    const v = customInput?.value.trim();
    if (v) selectModel(act.provider, v);
  });
  customInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); const v = e.target.value.trim(); if (v) selectModel(act.provider, v); }
  });

  // ключ встроенного источника
  modelMenu.querySelector('#mmKeySave')?.addEventListener('click', async () => {
    const keyVal = modelMenu.querySelector('#mmKey')?.value.trim();
    if (!keyVal) return;
    try {
      await api(`/providers/${encodeURIComponent(act.provider)}`, { method: 'PUT', body: { apiKey: keyVal } });
      toast('Ключ сохранён на сервере', 'ok');
      modelCache.delete(act.provider);
      renderModelMenu();
    } catch (err) { toast(err.message, 'err'); }
  });

  // поиск и обновление списка
  modelMenu.querySelector('#mmSearch')?.addEventListener('input', (e) => paintModelList(act.provider, act.model, e.target.value));
  modelMenu.querySelector('#mmRefresh')?.addEventListener('click', () => {
    modelCache.delete(act.provider);
    loadProviderModels(act.provider, act.model);
  });
}

async function selectModel(provider, model) {
  try {
    await api('/providers-active', { method: 'PUT', body: { provider, model } });
    S.activeProvider = provider;
    S.activeModel = model;
    if (S.providersData) S.providersData.active = { provider, model };
    if (provider === 'config') {
      S.model = model;
      localStorage.setItem('sc_model', model);
    }
    const label = updateTabloModelLabel();
    modelMenu.hidden = true;
    toast(`Модель: ${label} — применится к следующему сообщению`, '', 2600);
  } catch (e) {
    toast(e.message, 'err');
  }
}

/** Подпись на табло: выбранная модель для конфига или «модель · источник». */
function updateTabloModelLabel() {
  const act = S.providersData?.active || { provider: 'config', model: '' };
  if (act.provider && act.provider !== 'config') {
    modelBtn.textContent = `${act.model || '…'} · ${S.providersData?.providers?.[act.provider]?.label || act.provider}`;
    return modelBtn.textContent;
  }
  const label = MODELS.find((m) => m.v === S.model)?.label || S.model;
  modelBtn.textContent = label;
  return label;
}

function openCustomProviderModal() {
  const body = document.createElement('div');
  body.innerHTML = `
    <div class="field">
      <label>Описание источника в JSON</label>
      <textarea id="cpJson" class="editor-tall" spellcheck="false" style="min-height:220px">{
  "name": "my-gateway",
  "baseURL": "https://api.example.com",
  "apiKey": "",
  "models": ["model-id-1", "model-id-2"]
}</textarea>
      <div class="hint">Anthropic-совместимый шлюз: <code>baseURL</code> — корень API (Claude Code добавит /v1/messages).
      Поля <code>models</code> необязательно — если пусто, сервер попробует <code>GET baseURL/v1/models</code>.
      Примеры baseURL: OpenRouter <code>https://openrouter.ai/api</code>, DeepSeek <code>https://api.deepseek.com/anthropic</code>.</div>
    </div>
    <div class="form-error" id="cpErr"></div>`;
  const cancel = mkBtn2('Отмена', 'btn-secondary', () => modal.close());
  const ok = mkBtn2('Добавить', 'btn-primary notch-sm', async () => {
    const err = body.querySelector('#cpErr');
    err.classList.remove('show');
    try {
      await api('/providers-custom', { method: 'POST', body: { json: body.querySelector('#cpJson').value } });
      modal.close();
      toast('Источник добавлен', 'ok');
      renderModelMenu();
    } catch (e) {
      err.textContent = e.message;
      err.classList.add('show');
    }
  });
  const modal = openModal({ title: 'Свой источник моделей', body, foot: [cancel, ok] });
}

function mkBtn2(label, cls, onClick) {
  const b = document.createElement('button');
  b.className = cls;
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

modelBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  if (modelMenu.hidden) renderModelMenu();
  else modelMenu.hidden = true;
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
let permBootDone = false; // Chrome при перезагрузке восстанавливает форму и кидает change — игнорируем
setTimeout(() => { permBootDone = true; }, 800);
permSel.addEventListener('change', () => {
  if (!permBootDone) {
    permSel.value = S.permMode;
    return;
  }
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

  // активный источник моделей с сервера
  try {
    S.providersData = await api('/providers');
    if (S.providersData.active?.provider && S.providersData.active.provider !== 'config') {
      S.activeProvider = S.providersData.active.provider;
    }
  } catch { /* меню подтянет при открытии */ }
  // миграция: устаревшие выборы (sonnet/ox-alpha/…) больше не существуют
  if (S.model !== 'default' && !MODELS.some((m) => m.v === S.model)) {
    S.model = 'deepseek-v4-flash';
    localStorage.setItem('sc_model', S.model);
  }
  updateTabloModelLabel();
  updateTablo();
  updateEngineInfo();
  setStatus('ready', 'ГОТОВ');

  // автостарт сессии не нужен — ждём первый вопрос
  $('#input').focus();
})();

// отладочный доступ
window.SC = { S, get chat() { return chat; }, get rail() { return rail; } };
