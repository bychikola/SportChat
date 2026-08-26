/* Чат: сборка стрима, карточки инструментов, разрешения, история */

import { $, esc, icon, toolIcon, toolSummary, fmtCost, fmtInt, timeStr } from './util.js';
import { mdToHtml } from './md.js';

const PERM_TIMEOUT_MS = 180_000;

export function createChat({ S, ws, rail, setStatus, updateTablo, onSlash, getCommands }) {
  const messagesEl = $('#messages');
  const emptyState = $('#emptyState');
  const stageScroll = $('#stageScroll');
  let cur = null;          // контекст текущего прогона
  let pendingSegs = [];    // сегменты текущего assistant-сообщения

  /* ── утилиты прокрутки ── */
  const nearBottom = () =>
    stageScroll.scrollHeight - stageScroll.scrollTop - stageScroll.clientHeight < 140;
  const scrollDown = (force = false) => {
    if (force || nearBottom()) stageScroll.scrollTop = stageScroll.scrollHeight;
  };

  /* ── элементы сообщений ── */
  function addUserBubble(text) {
    const el = document.createElement('div');
    el.className = 'msg msg-user';
    el.innerHTML = `
      <div class="bubble-wrap">
        <div class="bubble">${mdToHtml(text)}</div>
        <div class="msg-time">${timeStr()}</div>
      </div>`;
    messagesEl.appendChild(el);
    emptyState.classList.add('hidden');
    scrollDown(true);
  }

  function addDivider(text) {
    const el = document.createElement('div');
    el.className = 'divider-line';
    el.textContent = text;
    messagesEl.appendChild(el);
  }

  /* ── воспроизведение ответа из истории ── */
  function addAiReplay(text, tools = []) {
    const el = document.createElement('div');
    el.className = 'msg msg-ai';
    el.innerHTML = `
      <div class="ava"><svg><use href="#i-bolt"/></svg></div>
      <div class="bubble-wrap">
        <div class="bubble"><div class="md">${mdToHtml(text)}</div></div>
      </div>`;
    const bubble = el.querySelector('.bubble');
    for (const t of tools || []) {
      const card = document.createElement('div');
      card.className = 'tool-card ok';
      card.innerHTML = `
        <button class="tc-head">
          ${icon(toolIcon(t.name), 'tc-icon')}
          <span class="tc-name">${esc(shortTool(t.name))}</span>
          <span class="tc-summary">эпизод из истории</span>
          <span class="st st-ok">готово</span>
          ${icon('chev', 'tc-chev')}
        </button>
        <div class="tc-body"><pre class="tc-pre">(инструмент выполнен в сохранённой сессии)</pre></div>`;
      card.querySelector('.tc-head').addEventListener('click', () => card.classList.toggle('open'));
      bubble.appendChild(card);
    }
    emptyState.classList.add('hidden');
    messagesEl.appendChild(el);
    scrollDown(true);
  }

  function ensureAssistant() {
    if (cur?.wrap) return cur;
    const el = document.createElement('div');
    el.className = 'msg msg-ai';
    el.innerHTML = `
      <div class="ava"><svg><use href="#i-bolt"/></svg></div>
      <div class="bubble-wrap">
        <div class="bubble"></div>
      </div>`;
    messagesEl.appendChild(el);
    cur = {
      el,
      wrap: el.querySelector('.bubble-wrap'),
      bubble: el.querySelector('.bubble'),
      tools: new Map(),       // toolUseID -> карточка
      segs: new Map(),        // index стрима -> сегмент
      textBuf: '',
      textEl: null,
      thinkBuf: '',
      thinkEl: null,
    };
    emptyState.classList.add('hidden');
    return cur;
  }

  /* ── текстовые сегменты (у каждого свой буфер) ── */
  function pushTextSegment(index = null) {
    const c = ensureAssistant();
    const seg = document.createElement('div');
    seg.className = 'md';
    c.bubble.appendChild(seg);
    const entry = { kind: 'text', seg, buf: '' };
    pendingSegs.push(entry);
    if (index != null) c.segs.set(index, entry);
    return entry;
  }

  function renderText(entry, throttled = true) {
    const paint = () => {
      entry.seg.innerHTML = `${mdToHtml(entry.buf)}<span class="stream-caret"></span>`;
      scrollDown();
    };
    if (throttled) {
      if (!renderText._raf) {
        renderText._raf = requestAnimationFrame(() => {
          renderText._raf = null;
          paint();
        });
      }
    } else {
      paint();
    }
  }

  /* ── мышление ── */
  function pushThinkingSegment(index = null) {
    const c = ensureAssistant();
    const block = document.createElement('div');
    block.className = 'thinking-block';
    block.innerHTML = `
      <button class="tb-toggle">Размышление ${icon('chev')}</button>
      <div class="tb-text"></div>`;
    block.querySelector('.tb-toggle').addEventListener('click', () => block.classList.toggle('open'));
    c.bubble.appendChild(block);
    const entry = { kind: 'thinking', block, textEl: block.querySelector('.tb-text'), buf: '' };
    pendingSegs.push(entry);
    if (index != null) c.segs.set(index, entry);
    return entry;
  }

  /* ── карточка инструмента ── */
  function toolCard(id, name) {
    const c = ensureAssistant();
    const card = document.createElement('div');
    card.className = 'tool-card running';
    card.innerHTML = `
      <button class="tc-head">
        ${icon(toolIcon(name), 'tc-icon')}
        <span class="tc-name">${esc(shortTool(name))}</span>
        <span class="tc-summary">…</span>
        <span class="st st-run">работа</span>
        ${icon('chev', 'tc-chev')}
      </button>
      <div class="tc-body">
        <div class="tc-label">Вход</div>
        <pre class="tc-pre" data-role="input"></pre>
        <div class="tc-label" data-role="res-label" hidden>Результат</div>
        <pre class="tc-pre" data-role="result" hidden></pre>
      </div>`;
    card.querySelector('.tc-head').addEventListener('click', () => card.classList.toggle('open'));
    c.bubble.appendChild(card);

    const t = { id, name, status: 'run', card, inputRaw: '', result: '' };
    c.tools.set(id, t);
    pendingSegs.push({ kind: 'tool', id });
    rail.pushEpisode(t);
    scrollDown();
    return t;
  }

  const shortTool = (name) => (name.startsWith('mcp__')
    ? `MCP · ${name.slice(5).replace(/__/g, ' / ')}`
    : name);

  function setToolStatus(t, status) {
    t.status = status;
    const chip = t.card.querySelector('.st');
    t.card.classList.remove('running', 'ok', 'err');
    if (status === 'ok') {
      t.card.classList.add('ok');
      chip.className = 'st st-ok';
      chip.textContent = 'готово';
    } else if (status === 'err') {
      t.card.classList.add('err');
      chip.className = 'st st-err';
      chip.textContent = 'ошибка';
    } else if (status === 'wait') {
      chip.className = 'st st-run';
      chip.textContent = 'ожидание';
    }
    rail.updateEpisode(t);
  }

  function showToolInput(t, pretty) {
    const pre = t.card.querySelector('[data-role="input"]');
    pre.textContent = pretty || '(пусто)';
    t.card.querySelector('.tc-summary').textContent = toolSummary(t.name, t.inputObj) || '…';
  }

  function showToolResult(t, preview, isError) {
    const label = t.card.querySelector('[data-role="res-label"]');
    const pre = t.card.querySelector('[data-role="result"]');
    label.hidden = false;
    pre.hidden = false;
    pre.textContent = preview;
    pre.classList.toggle('is-err', !!isError);
  }

  /* ── карточка разрешения ── */
  function addPermissionCard(req) {
    const host = cur?.bubble ?? messagesEl;
    const card = document.createElement('div');
    card.className = 'perm-card';
    card.innerHTML = `
      <div class="perm-head">${icon('shield')} Запрос разрешения</div>
      <div class="perm-tool">Инструмент: <b>${esc(shortTool(req.tool))}</b></div>
      <div class="perm-input">${esc(JSON.stringify(req.input, null, 2)).slice(0, 3000)}</div>
      <div class="perm-actions">
        <button class="btn-primary notch-sm" data-a="allow_once">Разрешить</button>
        <button class="btn-secondary" data-a="allow_always">Всегда для «${esc(shortTool(req.tool))}»</button>
        <button class="btn-danger" data-a="deny">Отклонить</button>
      </div>
      <div class="perm-timer" style="animation-duration:${PERM_TIMEOUT_MS}ms"></div>`;
    const answer = (action) => {
      card.querySelectorAll('button').forEach((b) => { b.disabled = true; });
      card.querySelector('.perm-timer')?.remove();
      ws.send({ t: 'permission_response', id: req.id, action });
      const note = card.querySelector('.perm-head');
      note.innerHTML = `${icon(action === 'deny' ? 'x' : 'check')}
        ${action === 'deny' ? 'Отклонено' : action === 'allow_always' ? 'Разрешено всегда (сессия)' : 'Разрешено'}`;
      setStatus('busy', 'ДУМАЕТ');
    };
    card.querySelectorAll('[data-a]').forEach((b) => b.addEventListener('click', () => answer(b.dataset.a)));
    host.appendChild(card);
    setStatus('wait', 'ОЖИДАНИЕ');
    scrollDown(true);
  }

  /* ── финализация assistant-сообщения ── */
  function reconcileFinal(content) {
    // сверяем накопленные стрим-сегменты с финальными блоками
    content.forEach((block, idx) => {
      const entry = pendingSegs[idx];
      if (!entry) return;
      if (block.type === 'text' && entry.kind === 'text') {
        entry.buf = block.text;
        renderText(entry, false);
        entry.seg.querySelector('.stream-caret')?.remove();
      } else if (block.type === 'tool_use' && entry.kind === 'tool') {
        const t = cur?.tools.get(block.id);
        if (t) {
          t.inputObj = block.input ?? {};
          showToolInput(t, JSON.stringify(t.inputObj, null, 2));
        }
      }
    });
    pendingSegs = [];
    cur?.bubble.querySelectorAll('.stream-caret').forEach((e) => e.remove());
    scrollDown();
  }

  function finishRunMeta(m) {
    if (!m || !cur) return;
    // при догенерации заменяем предыдущую мета-строку, а не копим
    if (m.nudged) {
      cur.wrap.querySelectorAll('.result-meta').forEach((el) => el.remove());
    } else {
      // модель иногда завершает ход после инструментов без текста — честно помечаем
      const hadText = [...cur.bubble.querySelectorAll('.md')].some((el) => el.textContent.trim());
      if (cur.tools.size > 0 && !hadText && !m.isError) {
        const note = document.createElement('div');
        note.className = 'result-meta';
        note.innerHTML = '<span>ℹ️ инструменты выполнены — текстового ответа модель не вернула</span>';
        cur.wrap.appendChild(note);
      }
    }
    S.cost += Number(m.costUsd || 0);
    S.turnsTotal = m.numTurns ?? 0;
    S.tokensIn += m.usage?.input || 0;
    S.tokensOut += m.usage?.output || 0;
    updateTablo();

    const meta = document.createElement('div');
    meta.className = 'result-meta';
    const secs = ((m.durationMs || 0) / 1000).toFixed(1);
    meta.innerHTML = `
      <span>${icon('clock')} <b>${secs} с</b></span>
      <span>ходов: <b>${m.numTurns}</b></span>
      <span>токены: <b>${fmtInt(S.tokensIn)}→${fmtInt(S.tokensOut)}</b></span>
      ${m.costUsd ? `<span>ответ: <b>${fmtCost(m.costUsd)}</b></span>` : ''}
      <span>сессия всего: <b>${fmtCost(S.cost)}</b></span>`;
    cur.wrap.appendChild(meta);
  }

  /* ── обработка событий агента ── */
  function handle(msg) {
    switch (msg.t) {
      case 'init': {
        S.sessionId = msg.sessionId;
        S.init = msg;
        onSessionStarted?.(msg);
        $('#ucSession').hidden = false;
        $('#ucSession').textContent = `сессия ${msg.sessionId.slice(0, 8)}…`;
        break;
      }
      case 'block_start': {
        ensureAssistant();
        if (msg.kind === 'text') pushTextSegment(msg.index);
        else if (msg.kind === 'thinking') pushThinkingSegment(msg.index);
        else if (msg.kind === 'tool') {
          toolCard(msg.id, msg.name);
          cur.segs.set(msg.index, { kind: 'tool', id: msg.id });
        }
        break;
      }
      case 'text_delta': {
        let entry = msg.index != null ? cur?.segs.get(msg.index) : null;
        if (!entry || entry.kind !== 'text') {
          // дельта без контекста — продолжаем последний текстовый сегмент
          entry = [...pendingSegs].reverse().find((s) => s.kind === 'text') || pushTextSegment(msg.index);
        }
        entry.buf += msg.v;
        renderText(entry);
        break;
      }
      case 'thinking_delta': {
        let entry = msg.index != null ? cur?.segs.get(msg.index) : null;
        if (!entry || entry.kind !== 'thinking') {
          entry = [...pendingSegs].reverse().find((s) => s.kind === 'thinking') || pushThinkingSegment(msg.index);
        }
        entry.buf += msg.v;
        entry.textEl.textContent = entry.buf;
        entry.textEl.scrollTop = entry.textEl.scrollHeight;
        break;
      }
      case 'tool_input_delta': {
        const entry = msg.index != null ? cur?.segs.get(msg.index) : null;
        const t = entry?.id ? cur.tools.get(entry.id) : null;
        if (t && t.status === 'run') {
          t.inputRaw += msg.v;
          try {
            t.inputObj = JSON.parse(t.inputRaw);
            t.card.querySelector('.tc-summary').textContent = toolSummary(t.name, t.inputObj) || '…';
          } catch { /* json ещё не собран */ }
        }
        break;
      }
      case 'text_final':
        // финал приходит пакетом в 'assistant' — здесь ничего не требуется
        break;
      case 'assistant': {
        const blocks = msg.message?.content || [];
        reconcileFinal(blocks);
        break;
      }
      case 'tool_result': {
        const t = cur?.tools.get(msg.id);
        if (t) {
          t.result = msg.preview || '';
          setToolStatus(t, msg.isError ? 'err' : 'ok');
          if (t.card.classList.contains('open')) showToolResult(t, t.result, msg.isError);
        }
        rail.updateEpisode(t || { id: msg.id, status: msg.isError ? 'err' : 'ok' });
        if (S.busy) setStatus('busy', 'ДУМАЕТ');
        break;
      }
      case 'permission_request':
        addPermissionCard(msg);
        break;
      case 'nudge': {
        const note = document.createElement('div');
        note.className = 'result-meta';
        note.innerHTML = '<span>⚠️ модель вернула пустой ответ — запрашиваю продолжение…</span>';
        cur?.wrap.appendChild(note);
        setStatus('busy', 'ДОГЕНЕРАЦИЯ');
        break;
      }
      case 'usage_out':
        S.liveOutTokens = Math.max(S.liveOutTokens || 0, msg.tokens || 0);
        updateTablo();
        break;
      case 'result':
        finishRunMeta(msg);
        for (const t of cur?.tools.values() || []) {
          if (t.status === 'run') setToolStatus(t, 'ok');
        }
        break;
      case 'error': {
        const err = document.createElement('div');
        err.className = 'error-card';
        err.innerHTML = `${icon('alert')}<div>${esc(msg.message)}</div>`;
        messagesEl.appendChild(err);
        scrollDown(true);
        break;
      }
      case 'done':
        endRun(msg.stopped);
        break;
      default:
        break;
    }
  }

  function beginRun() {
    cur = null;
    pendingSegs = [];
    S.liveOutTokens = 0;
  }

  function endRun(stopped) {
    S.busy = false;
    stopTurnTimer();
    $('#sendBtn').disabled = false;
    $('#stopBtn').hidden = true;
    document.querySelectorAll('.stream-caret').forEach((e) => e.remove());
    for (const t of cur?.tools.values() || []) {
      if (t.status === 'run') setToolStatus(t, 'ok');
    }
    if (stopped && cur) {
      const note = document.createElement('div');
      note.className = 'result-meta';
      note.innerHTML = '<span>⏹ прервано пользователем</span>';
      cur.wrap.appendChild(note);
    }
    setStatus('ready', 'ГОТОВ');
    scrollDown();
  }

  let onSessionStarted = null;
  const bindSessionStarted = (fn) => { onSessionStarted = fn; };

  /* ── живой таймер ответа ── */
  let timerInt = null;
  function startTurnTimer() {
    const el = $('#turnTimer');
    const t0 = Date.now();
    clearInterval(timerInt);
    const paint = () => {
      const s = Math.floor((Date.now() - t0) / 1000);
      el.textContent = `· ${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
    };
    el.hidden = false;
    paint();
    timerInt = setInterval(paint, 1000);
  }
  function stopTurnTimer() {
    clearInterval(timerInt);
    timerInt = null;
    const el = $('#turnTimer');
    if (el) {
      el.hidden = true;
      el.textContent = '';
    }
  }

  /* ── слэш-команды ── */
  function send(rawText) {
    const text = String(rawText ?? $('#input').value).trim();
    if (!text || S.busy) return;
    if (text.startsWith('/')) {
      hideCmdMenu();
      if (onSlash?.(text)) {
        $('#input').value = '';
        autoGrow();
        return;
      }
      // неизвестная команда — уходит агенту (CLI исполняет команды плагинов сам)
    }
    $('#input').value = '';
    autoGrow();
    addUserBubble(text);
    beginRun();
    S.busy = true;
    $('#sendBtn').disabled = true;
    $('#stopBtn').hidden = false;
    startTurnTimer();
    setStatus('busy', 'ДУМАЕТ');
    ws.send({
      t: 'chat',
      text,
      sessionId: S.sessionId,
      model: S.model !== 'default' ? S.model : null,
      permissionMode: S.permMode,
      includeUserSettings: S.includeUser,
      plugins: S.pluginSelection || [],
    });
  }

  function note(text) {
    const el = document.createElement('div');
    el.className = 'empty-note';
    el.style.padding = '10px 16px';
    el.innerHTML = text; // только наш статический текст
    messagesEl.appendChild(el);
    emptyState.classList.add('hidden');
    scrollDown(true);
  }

  /* ── меню команд над композером ── */
  const composerEl = $('#composer');
  let cmdMenu = null;
  let cmdSel = 0;

  function hideCmdMenu() {
    cmdMenu?.remove();
    cmdMenu = null;
  }

  function showCmdMenu() {
    const commands = getCommands?.() || [];
    const q = $('#input').value.trim().toLowerCase();
    const items = commands.filter((c) => c.cmd.startsWith(q) || q === '/');
    if (!items.length) return hideCmdMenu();
    if (!cmdMenu) {
      cmdMenu = document.createElement('div');
      cmdMenu.className = 'cmd-menu';
      composerEl.appendChild(cmdMenu);
    }
    cmdSel = Math.min(cmdSel, items.length - 1);
    cmdMenu.innerHTML = items.map((c, i) => `
      <button class="cmd-item ${i === cmdSel ? 'sel' : ''}" data-cmd="${esc(c.cmd)}">
        <span class="cmd-name">${esc(c.cmd)}</span>
        <span class="cmd-desc">${esc(c.desc)}</span>
      </button>`).join('');
    cmdMenu.querySelectorAll('.cmd-item').forEach((b) => {
      b.addEventListener('click', () => {
        hideCmdMenu();
        send(b.dataset.cmd);
      });
    });
  }

  $('#input').addEventListener('input', () => {
    const v = $('#input').value;
    if (v.startsWith('/') && !v.includes(' ')) {
      cmdSel = 0;
      showCmdMenu();
    } else {
      hideCmdMenu();
    }
  });

  /* ── авто-высота композера ── */
  const inputEl = $('#input');
  function autoGrow() {
    inputEl.style.height = 'auto';
    inputEl.style.height = `${Math.min(inputEl.scrollHeight, 180)}px`;
  }
  inputEl.addEventListener('input', autoGrow);
  inputEl.addEventListener('focus', () => $('#composer').classList.add('focused'));
  inputEl.addEventListener('blur', () => $('#composer').classList.remove('focused'));
  inputEl.addEventListener('keydown', (e) => {
    if (cmdMenu) {
      const items = cmdMenu.querySelectorAll('.cmd-item');
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        cmdSel = (cmdSel + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length;
        items.forEach((el, i) => el.classList.toggle('sel', i === cmdSel));
        items[cmdSel].scrollIntoView({ block: 'nearest' });
        return;
      }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
        e.preventDefault();
        const chosen = items[cmdSel]?.dataset.cmd;
        hideCmdMenu();
        if (chosen) send(chosen);
        return;
      }
      if (e.key === 'Escape') {
        hideCmdMenu();
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  });

  return {
    handle,
    send,
    note,
    bindSessionStarted,
    addUserBubble,
    addAiReplay,
    addDivider,
    clear() {
      messagesEl.replaceChildren();
      cur = null;
      pendingSegs = [];
      emptyState.classList.remove('hidden');
    },
    hideEmpty: () => emptyState.classList.add('hidden'),
    isBusy: () => S.busy,
    stopTurnTimer,
    scrollDown,
  };
}
