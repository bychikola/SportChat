/* Live-панель «Активный разбор» (PLAN-REDESIGN Фаза 5):
 * источники данных → действия агента с таймингами → сводка стрима → уверенность.
 * Наполняется из chat.js (tool-события, стрим, финал). */
import { $, esc } from './util.js';
import { api } from './api.js';

let active = false;
let startedAt = 0;
let seenSources = new Set();   // источник -> строка-чеклист
const toolRows = new Map();    // toolUseID -> { row, sourceKey, t0, name }
let summaryTimer = null;
let summaryPending = '';

const SOURCE_MAP = [
  [/sstats_match_preview_stats/i, 'Форма (10 матчей)'],
  [/sstats_search_matches/i, 'Пул матчей'],
  [/sstats_get_match|sstats_text_summary/i, 'Статистика команд'],
  [/sstats_match_odds|pari_matches|pari_match\b/i, 'Рынок (коэффициенты)'],
  [/pari_odds_history/i, 'Движение линии'],
  [/sstats_injuries|sstats_missing_players/i, 'Кадры и травмы'],
  [/sstats_season_table/i, 'Турнирная таблица'],
  [/sstats_leagues|pari_leagues|pari_countries/i, 'Справочник лиг'],
  [/WebSearch/i, 'Новости'],
  [/WebFetch/i, 'Веб-источник'],
];

const AGENT_NAMES = {
  pool: 'Сбор пула матчей',
  scout: 'Анализ формы и новостей',
  markets: 'Сравнение коэффициентов',
  composer: 'Формирование прогноза',
  auditor: 'Финальная проверка',
};

function humanTool(name) {
  if (/^Task$/i.test(name)) return 'Запуск агента';
  if (/WebSearch/i.test(name)) return 'Поиск в интернете';
  if (/WebFetch/i.test(name)) return 'Чтение веб-источника';
  if (/Bash/i.test(name)) return 'Команда';
  if (/^Read$/i.test(name)) return 'Чтение файла';
  if (/^Write$|^Edit$/i.test(name)) return 'Запись файла';
  const m = /sstats_([a-z_]+)/i.exec(name);
  if (m) return 'SStats · ' + m[1].replace(/_/g, ' ');
  const p = /pari_([a-z_]+)/i.exec(name);
  if (p) return 'Pari · ' + p[1].replace(/_/g, ' ');
  return name;
}

const sourceKeyFor = (name) => (SOURCE_MAP.find(([re]) => re.test(name)) || [])[1] || null;

function addSource(title, running) {
  const key = title;
  if (seenSources.has(key)) return seenSources.get(key);
  const list = $('#lpSourceList');
  if (!list) return null;
  list.querySelector('.lp-empty')?.remove();
  const row = document.createElement('div');
  row.className = 'lp-source';
  row.innerHTML = `<svg class="lp-check"><use href="#${running ? 'i-clock' : 'i-check'}"/></svg><span>${esc(title)}</span>`;
  list.appendChild(row);
  seenSources.set(key, row);
  return row;
}

function sourceDone(key, ok) {
  const row = key && seenSources.get(key);
  if (!row || !ok) return;
  const svg = row.querySelector('svg');
  if (svg) svg.innerHTML = '<use href="#i-check"/>';
  row.classList.add('done');
}

function addAction(title) {
  const list = $('#lpActionList');
  if (!list) return null;
  list.querySelector('.lp-empty')?.remove();
  const row = document.createElement('div');
  row.className = 'lp-action';
  row.innerHTML = `<svg><use href="#i-bolt"/></svg><span>${esc(title)}</span><b class="lp-dur">…</b>`;
  list.appendChild(row);
  while (list.children.length > 9) list.firstChild.remove();
  return row;
}

/** Старт хода: открыть панель, сбросить состояние. */
export function lpBegin(query = '') {
  const panel = $('#livePanel');
  if (!panel) return;
  document.body.classList.add('live-open');
  panel.hidden = false;
  active = true;
  startedAt = Date.now();
  seenSources = new Set();
  toolRows.clear();
  lpResetToRun();
  stopLiveTimer();
  $('#lpSourceList').innerHTML = '<div class="lp-empty">Собираю источники…</div>';
  $('#lpActionList').innerHTML = '<div class="lp-empty">Жду первые действия…</div>';
  $('#lpSummary').textContent = 'Думаю…';
  setConf(null);
  const match = $('#lpMatch');
  match.hidden = false;
  match.innerHTML = `
    <span class="lp-q">«${esc(query.trim().slice(0, 140))}${query.length > 140 ? '…' : ''}»</span>
    <small>${new Date().toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow' })} · московское время</small>`;
  const live = panel.querySelector('.lp-head .st');
  if (live) { live.className = 'st st-run'; live.textContent = 'LIVE'; }
}

/** Начало инструмента. */
export function lpToolStart(id, name) {
  if (!active) return;
  const t0 = Date.now();
  const action = addAction(humanTool(name));
  toolRows.set(id, { row: action, sourceKey: sourceKeyFor(name), t0, name });
  const src = sourceKeyFor(name);
  if (src) addSource(src, true);
}

/** Детали инструмента (агент из Task input). */
export function lpToolDetail(id, input) {
  const rec = toolRows.get(id);
  if (!rec || !input) return;
  if (/^Task$/i.test(rec.name) && input.subagent_type) {
    const title = AGENT_NAMES[input.subagent_type] || `Агент · ${input.subagent_type}`;
    rec.row.querySelector('span').textContent = title;
    rec.sourceKey = null; // Task — не источник данных
    if (rec.row) rec.row.dataset.agent = input.subagent_type;
  }
}

/** Конец инструмента. */
export function lpToolEnd(id, ok) {
  const rec = toolRows.get(id);
  if (!rec) return;
  const dur = ((Date.now() - rec.t0) / 1000).toFixed(1) + 'с';
  const durEl = rec.row?.querySelector('.lp-dur');
  if (durEl) {
    durEl.textContent = dur;
    durEl.style.color = ok ? 'var(--go)' : 'var(--live)';
  }
  sourceDone(rec.sourceKey, ok);
  toolRows.delete(id);
}

/** Сводка из стрима (throttle 500мс, хвост 380 символов). */
export function lpText(buf) {
  if (!active || !buf) return;
  summaryPending = buf;
  if (summaryTimer) return;
  summaryTimer = setTimeout(() => {
    summaryTimer = null;
    const el = $('#lpSummary');
    if (el) el.textContent = summaryPending.replace(/\s+/g, ' ').trim().slice(-380);
  }, 500);
}

/** Уверенность: число 0–100 и подпись. */
export function setConf(pct, label = '') {
  const bar = $('#lpConfBar');
  const val = $('#lpConfVal');
  if (!bar || !val) return;
  if (pct == null) { bar.style.width = '0%'; val.textContent = '—'; return; }
  const v = clamp(Math.round(pct), 0, 100);
  bar.style.width = v + '%';
  val.textContent = label ? `${v}% · ${label}` : `${v}%`;
}
const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

/** Уверенность из СИГНАЛа (словами) / экспресса (вероятность). */
export function lpConfidenceFromWord(word) {
  const w = String(word || '').toLowerCase();
  const map = { 'высок': 85, 'средн': 65, 'низк': 40 };
  for (const [k, v] of Object.entries(map)) if (w.includes(k)) { setConf(v, word); return; }
  setConf(null);
}

/** Завершение хода. */
export function lpDone(stopped = false) {
  if (!active) return;
  active = false;
  const total = ((Date.now() - startedAt) / 1000).toFixed(1);
  const live = $('#livePanel .lp-head .st');
  if (live) { live.className = 'st st-ok'; live.textContent = stopped ? 'ПРЕРВАНО' : `ГОТОВО · ${total}с`; }
}

/** ── Match Drawer (Фаза 9.1): детали матча из ленты без запуска агента ── */
export function lpShowMatch(m, onAnalyze) {
  const panel = $('#livePanel');
  if (!panel) return;
  document.body.classList.add('live-open');
  panel.hidden = false;
  active = false;
  seenSources = new Set();
  toolRows.clear();

  const live = panel.querySelector('.lp-head .st');
  if (live) { live.className = 'st st-ok'; live.textContent = 'ИЗ ЛЕНТЫ'; }

  const match = $('#lpMatch');
  match.hidden = false;
  match.innerHTML = `
    <span class="lp-q">${esc(m.home)} — ${esc(m.away)}</span>
    <small>${esc(m.league)} · ${esc(m.day)} ${esc(m.time)} · МСК</small>`;

  // секции хода не относятся к статичным деталям
  $('#lpSources').style.display = 'none';
  $('#lpActions').style.display = 'none';

  const bestP = Math.max(m.p1, m.px, m.p2);
  $('#lpSummary').innerHTML = `
    <table class="sig-table">
      <tr><th>P1 / X / P2</th><td class="sig-odds">${m.p1}% · ${m.px}% · ${m.p2}%</td></tr>
      <tr><th>Лучший рынок</th><td>${esc(m.market)}</td></tr>
      <tr><th>Кэф</th><td class="sig-odds">${m.odds}</td></tr>
      <tr><th>Fair</th><td class="sig-odds">${m.fair}</td></tr>
      <tr><th>Value</th><td class="sig-odds" style="color:${m.value > 0 ? 'var(--go)' : 'var(--faint)'}">${m.value > 0 ? '+' : ''}${m.value}%</td></tr>
      <tr><th>Вероятность</th><td class="sig-odds">${bestP}%</td></tr>
      <tr><th>Confidence</th><td class="sig-odds" style="color:var(--sky)">${m.confidence}%</td></tr>
    </table>
    <div class="lp-note">${m.tag === 'banker' ? '🛡️ Banker — повышенная надёжность по модели.' : '🤖 AI-анализ: значение из Poisson-модели ленты.'}</div>`;

  const bar = $('#lpConfBar');
  if (bar) bar.style.width = clamp(m.confidence, 0, 100) + '%';
  const val = $('#lpConfVal');
  if (val) val.textContent = m.confidence + '%';

  let btn = $('#lpAnalyzeBtn');
  if (!btn) {
    btn = document.createElement('button');
    btn.id = 'lpAnalyzeBtn';
    btn.className = 'btn-primary notch-sm lp-analyze';
    panel.appendChild(btn);
  }
  btn.hidden = false;
  btn.textContent = 'Разобрать в чате';
  btn.onclick = () => { if (onAnalyze) onAnalyze(m); };
}

/* ── Live Prediction Engine (PLAN-LIVE L2): drawer с моделью момента ── */
let liveTimer = null;
function stopLiveTimer() { if (liveTimer) { clearInterval(liveTimer); liveTimer = null; } }

function liveChart(hist) {
  if (!hist || hist.length < 2) return '<div class="lp-empty">График появится после второго снапшота модели (15–20 секунд).</div>';
  const W = 300, H = 92;
  const keys = [['p1', 'П1', 'var(--flut)'], ['p2', 'П2', 'var(--sky)'], ['tb25', 'ТБ 2.5', 'var(--go)']];
  const all = hist.flatMap((h) => [h.p1, h.p2, h.tb25]);
  const min = Math.min(...all) - 0.02, max = Math.max(...all) + 0.02;
  const x = (i) => i * (W / Math.max(1, hist.length - 1));
  const y = (v) => H - 8 - ((v - min) / (max - min || 1)) * (H - 18);
  const lines = keys.map(([k, , color]) => {
    const pts = hist.map((h, i) => `${x(i).toFixed(1)},${y(h[k]).toFixed(1)}`).join(' ');
    const dots = hist.length <= 14 ? hist.map((h, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(h[k]).toFixed(1)}" r="2.2" fill="${color}"/>`).join('') : '';
    return `<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round"/>${dots}`;
  }).join('');
  const legend = keys.map(([k, label, color]) => `<span><i style="background:${color}"></i>${label}</span>`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" class="lp-chart" preserveAspectRatio="none">${lines}</svg><div class="lp-legend">${legend}</div>`;
}

export function lpShowLive(id, pre) {
  const panel = $('#livePanel');
  if (!panel) return;
  document.body.classList.add('live-open');
  panel.hidden = false;
  active = false;
  seenSources = new Set();
  toolRows.clear();
  lpResetToRun();
  stopLiveTimer();

  const st = panel.querySelector('.lp-head .st');
  if (st) { st.className = 'st st-run cp-live-pulse'; st.textContent = 'LIVE'; }
  const match = $('#lpMatch');
  match.hidden = false;
  match.innerHTML = pre
    ? `<span class="lp-q">${esc(pre.home)} — ${esc(pre.away)}</span><small>${esc(pre.league)} · ${esc(pre.stage)} · ${esc(pre.score)} · ${pre.minute}'</small>`
    : 'Загружаю матч…';
  $('#lpSources').style.display = 'none';
  $('#lpActions').style.display = 'none';
  $('#lpSummary').innerHTML = '<div class="lp-empty">Считаю модель момента: счёт, остаток времени, интенсивность…</div>';
  setConf(null);

  const btn = $('#lpAnalyzeBtn') || (() => {
    const b = document.createElement('button');
    b.id = 'lpAnalyzeBtn';
    b.className = 'btn-primary notch-sm lp-analyze';
    panel.appendChild(b);
    return b;
  })();
  btn.hidden = false;
  btn.textContent = 'Разобрать матч в чате';
  btn.onclick = () => {
    const input = document.getElementById('input');
    input.value = `Живой разбор матча: ${pre ? `${pre.home} — ${pre.away}` : 'id ' + id} (идёт ${pre ? pre.minute : '?'}-я минута, счёт ${pre ? pre.score : '?'}). Проанализируй статистику момента и дай вердикт по исходам и тоталу.`;
    input.dispatchEvent(new Event('input'));
    document.body.classList.remove('live-open');
    panel.hidden = true;
    stopLiveTimer();
    input.focus();
  };

  const load = async () => {
    try {
      const d = await api(`/match/${id}/live`);
      if (d.match) {
        match.innerHTML = `<span class="lp-q">${esc(d.match.home)} — ${esc(d.match.away)}</span><small>${esc(d.match.league)} · ${esc(d.match.stage)} · счёт ${esc(d.match.score)} · ${d.match.minute}' · начало ${esc(d.match.start || '—')}</small>`;
      }
      const valueRows = (d.value || []).map((v) =>
        `<tr><td>${esc(v.name)}</td><td class="sig-odds">${v.odds}</td><td class="${v.value > 0 ? 'ok' : 'err'}">${v.value > 0 ? '+' : ''}${v.value}%</td></tr>`).join('');
      const scen = (d.scenarios || []).map((s) => `<div class="lp-scen">${esc(s)}</div>`).join('');
      $('#lpSummary').innerHTML = `
        ${liveChart(d.history)}
        <table class="sig-table">
          <tr><th>П1 сейчас</th><td class="sig-odds">${d.model.p1}%</td></tr>
          <tr><th>Ничья</th><td class="sig-odds">${d.model.px}%</td></tr>
          <tr><th>П2 сейчас</th><td class="sig-odds">${d.model.p2}%</td></tr>
          <tr><th>Тотал больше 2.5</th><td class="sig-odds">${d.model.tb25}%</td></tr>
        </table>
        ${d.pressure ? `<div class="lp-note">Удары: ${esc(d.pressure.shots)}</div>` : ''}
        ${valueRows ? `<table class="sig-table"><thead><tr><th>Live-value (Pari/линия)</th><th>Кэф</th><th>Value</th></tr></thead><tbody>${valueRows}</tbody></table>` : ''}
        ${scen}`;
      setConf(d.confidence, 'уверенность модели');
    } catch (e) {
      $('#lpSummary').innerHTML = `<div class="lp-empty">Live-модель недоступна: ${esc(String(e?.message || e).slice(0, 120))}</div>`;
    }
  };
  load();
  liveTimer = setInterval(load, 15_000); // график растёт по минутам
}

/** Вернуть панель в режим хода (сброс матч-режима). */
export function lpResetToRun() {
  $('#lpSources').style.display = '';
  $('#lpActions').style.display = '';
  $('#lpAnalyzeBtn')?.remove();
  const btn = $('#lpAnalyzeBtn');
  if (btn) btn.hidden = true;
}
