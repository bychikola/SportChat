/* Чат: сборка стрима, карточки инструментов, разрешения, история */

import { $, esc, icon, toolIcon, toolSummary, fmtCost, fmtInt, timeStr, toast } from './util.js';
import { api } from './api.js';
import { lpBegin, lpToolStart, lpToolDetail, lpToolEnd, lpText, lpDone, lpConfidenceFromWord, setConf } from './livepanel.js';
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

  // Прокрутка на КАЖДУЮ дельту = принудительная раскладка (layout) на каждый
  // токен — при длинном ходу главный поток встаёт. Троттлим до ~8 раз/сек.
  let scrollDirty = false;
  let scrollTimer = null;
  function requestScroll() {
    scrollDirty = true;
    if (scrollTimer) return;
    scrollTimer = setTimeout(() => {
      scrollTimer = null;
      if (scrollDirty) {
        scrollDirty = false;
        scrollDown();
      }
    }, 120);
  }

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
    const caret = document.createElement('span');
    caret.className = 'stream-caret';
    seg.appendChild(caret);
    c.bubble.appendChild(seg);
    const entry = { kind: 'text', seg, caret, buf: '' };
    pendingSegs.push(entry);
    if (index != null) c.segs.set(index, entry);
    return entry;
  }

  /**
   * Стрим-превью: один текстовый узел на дельту (O(1) на дельту).
   * НЕ перерисовываем markdown на каждом куске — при длинных ответах
   * это O(n²) и главный поток встаёт: страница «живая» (CSS-анимации),
   * но кнопки не нажимаются. Полный markdown рендерится один раз в финале.
   */
  const STREAM_PREVIEW_LIMIT = 40_000;

  function appendStreamText(entry, chunk) {
    entry.buf += chunk;
    if (entry.buf.length > STREAM_PREVIEW_LIMIT) return; // превью урезано, финал всё перерисует
    entry.seg.insertBefore(document.createTextNode(chunk), entry.caret);
    requestScroll();
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
    lpToolStart(id, name);
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
    // Порядок финальных блоков может отличаться от стрима (thinking часто
    // отсутствует в финальном content) — сопоставляем ПО ТИПУ, а не по индексу.
    const textBlocks = content.filter((b) => b.type === 'text');
    const toolBlocks = content.filter((b) => b.type === 'tool_use');
    let ti = 0;
    for (const entry of pendingSegs) {
      if (entry.kind === 'text') {
        const block = textBlocks[ti++];
        if (block) {
          entry.buf = block.text;
          // единственный полный markdown-рендер — на финальном тексте
          entry.seg.innerHTML = mdToHtml(block.text);
        }
      } else if (entry.kind === 'tool') {
        const block = toolBlocks.find((b) => b.id === entry.id);
        const t = cur?.tools.get(entry.id);
        if (block && t) {
          t.inputObj = block.input ?? {};
          showToolInput(t, JSON.stringify(t.inputObj, null, 2));
        }
      }
    }
    pendingSegs = [];
    cur?.bubble.querySelectorAll('.stream-caret').forEach((e) => e.remove());
    scrollDown();
  }

  /* ── решение по ставке из финального текста (СИГНАЛ / ЭКСПРЕСС) ── */
  const DECIDE_LOG = 'sc_signalDecisions';

  function logDecision(entry) {
    try {
      const arr = JSON.parse(localStorage.getItem(DECIDE_LOG) || '[]');
      arr.unshift({ ...entry, at: new Date().toISOString() });
      localStorage.setItem(DECIDE_LOG, JSON.stringify(arr.slice(0, 200)));
    } catch { /* приватный режим — журнал не критичен */ }
  }

  function decideBar({ acceptLabel, onAccept, skipLabel = 'Пропускаю' }) {
    const bar = document.createElement('div');
    bar.className = 'sig-actions';
    bar.innerHTML = `
      <button class="btn-primary notch-sm sig-accept">${esc(acceptLabel)}</button>
      <button class="btn-secondary notch-sm sig-skip">${esc(skipLabel)}</button>
      <div class="sig-status"></div>`;
    const [acc, skip, status] = ['sig-accept', 'sig-skip', 'sig-status'].map((c) => bar.querySelector(`.${c}`));
    const decide = (accepted, note) => {
      acc.disabled = skip.disabled = true;
      bar.closest('.signal-card').classList.add(accepted ? 'is-accepted' : 'is-declined');
      status.innerHTML = accepted ? `✓ ${note}` : `✗ ${note}`;
      status.hidden = false;
      scrollDown(true);
    };
    acc.addEventListener('click', async () => {
      acc.disabled = true;
      acc.textContent = 'Записываю…';
      try { await onAccept(); } catch (e) { acc.disabled = false; acc.textContent = acceptLabel; toast(e.message, 'err'); return; }
      decide(true, 'принято');
    });
    skip.addEventListener('click', () => decide(false, 'пропущено'));
    return { bar };
  }

  function extractSignal(cur) {
    const text = [...cur.bubble.querySelectorAll('.md')].map((el) => el.textContent).join('\n');
    const line = /СИГНАЛ:\s*([^\n]+)/.exec(text);
    if (!line) return;
    const fields = {};
    const re = /([a-zа-яё]+)\s*=\s*([^|]+)/gi;
    let p;
    while ((p = re.exec(line[1]))) {
      fields[p[1].trim().toLowerCase()] = p[2].trim();
    }
    if (!fields.gameid || !fields.key || !fields.pick) return;
    lpConfidenceFromWord(fields.уверенность);

    const row = (k, v, cls = '') => `<tr><th>${k}</th><td class="${cls}">${v}</td></tr>`;
    const conf = (fields.уверенность || '').toLowerCase();
    const confCls = conf.includes('высок') ? 'ok' : conf.includes('низк') ? 'warn' : 'run';
    const card = document.createElement('div');
    card.className = 'signal-card notch';
    card.innerHTML = `
      <div class="sig-head">${icon('bolt')} СИГНАЛ — решение по ставке</div>
      <table class="sig-table">
        ${row('Матч', esc(fields.матч || '—'))}
        ${fields.лига ? row('Лига', esc(fields.лига)) : ''}
        ${row('Рынок', esc(fields.рынок || '—'))}
        ${row('Ставка', esc(fields.pick), 'sig-bet')}
        ${fields.кэф ? row('Кэф', esc(fields.кэф), 'sig-odds') : ''}
        ${fields.уверенность ? row('Уверенность', `<span class="st st-${confCls}">${esc(fields.уверенность)}</span>`) : ''}
      </table>`;

    const { bar } = decideBar({
      acceptLabel: 'Принимаю ставку',
      onAccept: async () => {
        await api('/signals', { method: 'POST', body: {
          gameId: fields.gameid,
          match: fields.матч || '',
          league: fields.лига || '',
          market: fields.рынок || '',
          key: fields.key,
          pick: fields.pick,
          odds: fields.кэф || null,
          confidence: fields.уверенность || '',
          date: fields.дата || '',
        }});
        logDecision({ type: 'signal', match: fields.матч || '', market: fields.рынок || '', pick: fields.pick, odds: fields.кэф || null, accepted: true });
        toast('Сигнал принят — точность посчитается после матча', 'ok', 3600);
      },
    });
    bar.querySelector('.sig-skip').addEventListener('click', () => {
      logDecision({ type: 'signal', match: fields.матч || '', market: fields.рынок || '', pick: fields.pick, odds: fields.кэф || null, accepted: false });
    });
    card.appendChild(bar);
    cur.wrap.appendChild(card);
    scrollDown(true);
  }

  /* Экспресс: кастомная таблица ног вместо сырого markdown-списка */
  function extractExpress(cur) {
    for (const md of cur.bubble.querySelectorAll('.md')) {
      // заголовок может быть p/h2/h3/h4 и на любом уровне вложенности —
      // модель каждый раз оформляет по-своему
      const head = [...md.querySelectorAll('p, h2, h3, h4')]
        .find((el) => /экспресс\s+[\d.,]+\s*x/i.test(el.textContent || ''));
      // список ног: сразу после заголовка или в пределах 4 следующих блоков
      let legsOl = null;
      if (head) {
        let sib = head.nextElementSibling;
        for (let i = 0; sib && i < 4; i++) {
          if (/^(OL|UL)$/.test(sib.tagName)) { legsOl = sib; break; }
          sib = sib.nextElementSibling;
        }
      }
      // запасной путь: любой список, где большинство строк — «… @ кэф»
      if (!legsOl) {
        legsOl = [...md.querySelectorAll('ol, ul')].find((ol) => {
          const lis = [...ol.querySelectorAll(':scope > li')];
          return lis.length >= 2 && lis.filter((li) => /@\s*[\d.,]+/.test(li.textContent)).length >= 2 && /экспресс/i.test(md.textContent);
        });
      }
      if (!legsOl) continue;
      const legs = [...legsOl.querySelectorAll(':scope > li')].map((li) => {
        // «Матч с тире (время) — Рынок @ кэф — почему»: сегмент с «@» — это рынок,
        // всё до него — матч (тире внутри названий команд не трогаем)
        const parts = li.textContent.trim().split(/\s+—\s+/);
        const i = parts.findIndex((p) => /@\s*[\d.,]+/.test(p));
        if (i < 1) return null; // сегмент с кэфом не найден или рынок без матча
        const match = parts.slice(0, i).join(' — ').replace(/\s*\(\d{1,2}:\d{2}\)\s*$/, '');
        const [market, oddsRaw] = parts[i].split(/\s*@\s*/);
        const odds = parseFloat(String(oddsRaw || '').replace(',', '.'));
        if (!match || !market || !Number.isFinite(odds) || odds < 1) return null;
        return { match, market: market.trim(), odds };
      }).filter(Boolean);
      if (legs.length < 2) continue;

      const headOdds = parseFloat((/экспресс\s+([\d.,]+)\s*x/i.exec(head ? head.textContent : md.textContent) || [])[1]?.replace(',', '.') || 0);
      const odds = headOdds || legs.reduce((a, l) => a * l.odds, 1);
      const mdText = md.textContent;
      const prob = (/вероятност\w+\s+захода[^%]*?(\d+(?:[.,]\d+)?)\s*%/i.exec(mdText) || [])[1];
      if (prob) setConf(parseFloat(prob.replace(',', '.')), 'вероятность захода');

      const card = document.createElement('div');
      card.className = 'signal-card express notch';
      card.innerHTML = `
        <div class="sig-head">${icon('bolt')} ЭКСПРЕСС ${odds.toFixed(2)}x${prob ? ` · вероятность ~${esc(prob)}%` : ''} — решение</div>
        <table class="sig-table">
          <thead><tr><th>№</th><th>Матч</th><th>Рынок</th><th>Кэф</th></tr></thead>
          <tbody>
            ${legs.map((l, i) => `<tr><td>${i + 1}</td><td>${esc(l.match)}</td><td>${esc(l.market)}</td><td class="sig-odds">${l.odds}</td></tr>`).join('')}
          </tbody>
          <tfoot><tr><td colspan="3">Итоговый коэффициент</td><td class="sig-odds">${odds.toFixed(2)}</td></tr></tfoot>
        </table>`;

      const { bar } = decideBar({
        acceptLabel: 'Принимаю экспресс',
        onAccept: async () => {
          logDecision({ type: 'express', legs, odds, probability: prob || null, accepted: true });
          toast('Экспресс принят — запись в журнале решений', 'ok', 3600);
        },
      });
      bar.querySelector('.sig-skip').addEventListener('click', () => {
        logDecision({ type: 'express', legs, odds, probability: prob || null, accepted: false });
      });
      card.appendChild(bar);

      // сырой список ног уходит из текста — остаётся только карточка
      if (head) head.remove();
      legsOl.remove();
      cur.wrap.appendChild(card);
      scrollDown(true);
      break; // один экспресс на ответ
    }
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

    try { extractSignal(cur); } catch { /* некритично */ }
    try { extractExpress(cur); } catch { /* некритично */ }
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
        appendStreamText(entry, msg.v);
        lpText(entry.buf);
        break;
      }
      case 'thinking_delta': {
        let entry = msg.index != null ? cur?.segs.get(msg.index) : null;
        if (!entry || entry.kind !== 'thinking') {
          entry = [...pendingSegs].reverse().find((s) => s.kind === 'thinking') || pushThinkingSegment(msg.index);
        }
        // инкрементально, как ответ: перезапись всего буфера на каждую дельту — O(n²)
        entry.buf += msg.v;
        if (entry.buf.length <= 20_000) entry.textEl.appendChild(document.createTextNode(msg.v));
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
            lpToolDetail(t.id, t.inputObj);
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
        lpToolEnd(msg.id, !msg.isError);
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
    lpDone(stopped);
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
    lpBegin(text);
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
