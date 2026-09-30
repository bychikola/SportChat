/* Статистика (PLAN-REDESIGN Фаза 6): показатели трекера сигналов + журнал
 * решений пользователя. Графики — чистый SVG, без библиотек. */
import { $, esc } from './util.js';
import { api } from './api.js';

const mskDay = (iso) => new Date(iso).toLocaleDateString('sv-SE', { timeZone: 'Europe/Moscow' });
const dayLabel = (sv) => {
  const dt = new Date(`${sv}T12:00:00`);
  return `${dt.getDate()}.${String(dt.getMonth() + 1).padStart(2, '0')}`;
};

export function createStats() {
  let loaded = false;

  const isOpen = () => document.body.classList.contains('stats-open');
  function open() {
    $('#statsView').hidden = false;
    document.body.classList.add('stats-open');
    document.body.classList.remove('feed-open', 'events-open', 'side-open');
    if (!loaded) load();
  }
  function close() {
    $('#statsView').hidden = true;
    document.body.classList.remove('stats-open');
  }
  function toggle() { isOpen() ? close() : open(); }

  /* ── горизонтальные бары: точность по рынкам ── */
  function marketBars(byMarket) {
    const rows = Object.entries(byMarket || {}).sort((a, b) => b[1].settled - a[1].settled).slice(0, 8);
    if (!rows.length) return '<div class="empty-note">Завершённых сигналов пока нет — точность посчитается после матчей.</div>';
    return `<div class="sbar-list">${rows.map(([m, v]) => `
      <div class="sbar-row">
        <span class="sbar-name">${esc(m)}</span>
        <div class="sbar-track"><i style="width:${clamp(v.accuracy || 0)}%"></i></div>
        <span class="sbar-val">${v.accuracy || 0}%<small>${v.won}/${v.settled}</small></span>
      </div>`).join('')}</div>`;
  }

  /* ── столбики: решения по дням (принято/пропущено) ── */
  function decisionBars(decisions) {
    const days = [];
    for (let i = 13; i >= 0; i--) {
      const sv = new Date(Date.now() - i * 864e5).toLocaleDateString('sv-SE', { timeZone: 'Europe/Moscow' });
      days.push({ sv, label: dayLabel(sv), ok: 0, skip: 0 });
    }
    const byDay = new Map(days.map((d) => [d.sv, d]));
    for (const d of decisions || []) {
      const day = byDay.get(mskDay(d.at));
      if (!day) continue;
      d.accepted ? day.ok++ : day.skip++;
    }
    const max = Math.max(3, ...days.map((d) => d.ok + d.skip));
    return `<div class="dbar-chart">${days.map((d) => {
      const hOk = Math.round(d.ok / max * 100);
      const hSkip = Math.round(d.skip / max * 100);
      return `<div class="dbar-col" title="${d.label}: принято ${d.ok}, пропущено ${d.skip}">
        <div class="dbar-stack"><i class="ok" style="height:${hOk}%"></i><i class="skip" style="height:${hSkip}%"></i></div>
        <small>${d.label}</small>
      </div>`;
    }).join('')}</div>
    <div class="dbar-legend"><span><i class="ok"></i>принято</span><span><i class="skip"></i>пропущено</span></div>`;
  }

  function hero(stats, decisions) {
    const accepted = (decisions || []).filter((d) => d.accepted).length;
    const skipped = (decisions || []).filter((d) => !d.accepted).length;
    const tiles = [
      { cap: 'Точность сигналов', val: stats.accuracy == null ? '—' : `${stats.accuracy}%`, sub: `${stats.won} зашло / ${stats.lost} мимо`, cls: 'green' },
      { cap: 'Сигналов', val: stats.total, sub: `в работе ${stats.pending}`, cls: 'orange' },
      { cap: 'Принято мной', val: accepted, sub: `пропущено ${skipped}`, cls: 'sky' },
    ];
    return tiles.map((t) => `
      <div class="hero-tile ${t.cls} notch">
        <div class="ht-body"><div class="ht-cap">${t.cap}</div><div class="ht-sub">${t.sub}</div></div>
        <div class="ht-val">${esc(t.val)}</div>
      </div>`).join('');
  }

  async function load() {
    const body = $('#statsBody');
    body.innerHTML = '<div class="empty-note">Считаю показатели…</div>';
    let stats = null;
    let decisions = [];
    try { stats = (await api('/signals')).stats; } catch { /* без трекера */ }
    try { decisions = JSON.parse(localStorage.getItem('sc_signalDecisions') || '[]'); } catch { /* приватный режим */ }
    if (!stats) {
      body.innerHTML = '<div class="empty-note">Трекер сигналов недоступен.</div>';
      return;
    }
    $('#statsHero').innerHTML = hero(stats, decisions);
    body.innerHTML = `
      <div class="stats-sec notch">
        <div class="stats-cap">Точность по рынкам</div>
        ${marketBars(stats.byMarket)}
      </div>
      <div class="stats-sec notch">
        <div class="stats-cap">Мои решения — 14 дней</div>
        ${decisionBars(decisions)}
      </div>`;
    loaded = true;
  }

  const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

  return { open, close, toggle, isOpen, load };
}
