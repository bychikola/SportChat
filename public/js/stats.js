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

  /* ── мои прогнозы (Фаза 9.3): принятые экспрессы со статусом ног ── */
  const STATUS = {
    pending: ['в работе', 'run'],
    won: ['зашло', 'ok'],
    lost: ['мимо', 'err'],
    void: ['возврат', ''],
  };
  function myPredictions(list) {
    if (!list || !list.length) return '<div class="empty-note">Принятых экспрессов пока нет — нажми «Принимаю» на карточке в ленте.</div>';
    return `<div class="myp-list">${list.map((p) => `
      <div class="myp-card notch">
        <div class="myp-head">
          <b>${esc(p.id)}</b>
          <span class="st st-${STATUS[p.status]?.[1] || 'run'}">${STATUS[p.status]?.[0] || p.status}</span>
          <span class="myp-odds">${p.odds}x</span>
        </div>
        ${p.legs.map((l) => `
          <div class="myp-leg">
            <svg><use href="#${l.status === 'won' ? 'i-check' : l.status === 'lost' ? 'i-x' : 'i-clock'}"/></svg>
            <span class="myp-leg-match">${esc(l.match)}</span>
            <span class="myp-leg-market">${esc(l.market)}</span>
            <span class="myp-leg-score">${esc(l.score || '—')}</span>
          </div>`).join('')}
        <div class="myp-foot">
          <span>Fair ${p.fair ?? '—'}x</span><span>EV +${p.ev ?? 0}%</span><span>P ${p.probability ?? '—'}%</span>
        </div>
      </div>`).join('')}</div>`;
  }

  async function load() {
    const body = $('#statsBody');
    body.innerHTML = '<div class="empty-note">Считаю показатели…</div>';
    let stats = null;
    let decisions = [];
    let predictions = null;
    let signalsList = [];
    try {
      const sigs = await api('/signals');
      stats = sigs.stats;
      signalsList = sigs.signals || [];
    } catch { /* без трекера */ }
    try { predictions = (await api('/predictions')).predictions; } catch { /* без моих прогнозов */ }
    try { decisions = JSON.parse(localStorage.getItem('sc_signalDecisions') || '[]'); } catch { /* приватный режим */ }
    if (!stats) {
      body.innerHTML = '<div class="empty-note">Трекер сигналов недоступен.</div>';
      return;
    }
    $('#statsHero').innerHTML = hero(stats, decisions);
    body.innerHTML = `
      <div class="stats-sec notch">
        <div class="stats-cap">📊 AI Track Record — история ведётся сервером, без правок задним числом</div>
        ${trackRecord(predictions, signalsList)}
      </div>
      <div class="stats-sec notch">
        <div class="stats-cap">Мои прогнозы</div>
        ${myPredictions(predictions)}
      </div>
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

  /* ── L4: Track Record — Win Rate / ROI по рынкам + банкролл ── */
  function trackRecord(preds, sigs) {
    const rows = new Map(); // рынок → {n, won, pnl (flat 1 ед)}
    const add = (market, status, odds) => {
      if (status !== 'won' && status !== 'lost') return;
      const r = rows.get(market) || { n: 0, won: 0, pnl: 0 };
      r.n++;
      if (status === 'won') { r.won++; r.pnl += (Number(odds) || 1) - 1; }
      else r.pnl -= 1;
      rows.set(market, r);
    };
    for (const p of preds || []) for (const l of p.legs || []) add(l.market || 'прочее', l.status, l.odds);
    for (const s of sigs || []) add(s.market || 'прочее', s.status, s.odds);
    if (!rows.size) return '<div class="empty-note">Рассчитанных прогнозов пока нет — таблица появится после первых матчей.</div>';
    const table = [...rows.entries()].sort((a, b) => b[1].n - a[1].n).map(([m, r]) => {
      const wr = Math.round(r.won / r.n * 100);
      const roi = Math.round(r.pnl / r.n * 100);
      return `<tr><td>${esc(m)}</td><td>${r.n}</td><td>${wr}%</td><td class="${roi >= 0 ? 'ok' : 'err'}">${roi >= 0 ? '+' : ''}${roi}%</td></tr>`;
    }).join('');
    return `
      <table class="sig-table track-table">
        <thead><tr><th>Рынок</th><th>Прогнозов</th><th>Win Rate</th><th>ROI</th></tr></thead>
        <tbody>${table}</tbody>
      </table>
      <div class="bankroll-block">
        <div class="bankroll-cap">Кривая банкролла (по купонам с суммой)</div>
        ${bankrollLine(preds)}
      </div>`;
  }

  function bankrollLine(preds) {
    const pts = (preds || [])
      .filter((p) => p.amount && p.status !== 'pending' && p.status !== 'live')
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    if (pts.length < 2) return '<div class="empty-note">Для кривой банкролла нужно минимум 2 рассчитанных купона с указанной суммой.</div>';
    let bank = 0;
    const xs = [0], ys = [0];
    for (const p of pts) {
      bank -= p.amount;
      if (p.status === 'won') bank += p.amount * p.odds;
      if (p.status === 'void') bank += p.amount;
      xs.push(xs.length);
      ys.push(Math.round(bank));
    }
    const min = Math.min(0, ...ys), max = Math.max(1, ...ys);
    const W = 560, H = 110, pad = 4;
    const px = (i) => pad + i * ((W - pad * 2) / (ys.length - 1));
    const py = (v) => H - pad - ((v - min) / (max - min || 1)) * (H - pad * 2);
    const poly = ys.map((v, i) => `${px(i)},${py(v).toFixed(1)}`).join(' ');
    const last = ys[ys.length - 1];
    const zeroY = py(0).toFixed(1);
    return `
      <svg viewBox="0 0 ${W} ${H}" class="bankroll-svg" preserveAspectRatio="none">
        <line x1="${pad}" y1="${zeroY}" x2="${W - pad}" y2="${zeroY}" stroke="rgba(237,243,234,.15)" stroke-dasharray="4 4"/>
        <polyline points="${poly}" fill="none" stroke="var(--go)" stroke-width="2.5" stroke-linejoin="round" ${last < 0 ? 'style="stroke:var(--danger)"' : ''}/>
      </svg>
      <div class="bankroll-val ${last >= 0 ? 'ok' : 'err'}">${last >= 0 ? '+' : ''}${last.toLocaleString('ru-RU')} ₽</div>`;
  }

  const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

  return { open, close, toggle, isOpen, load };
}
