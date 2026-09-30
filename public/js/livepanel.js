/* Live-панель «Активный разбор» (PLAN-REDESIGN Фаза 5):
 * источники данных → действия агента с таймингами → сводка стрима → уверенность.
 * Наполняется из chat.js (tool-события, стрим, финал). */
import { $, esc } from './util.js';

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
