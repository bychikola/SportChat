/* Лента прогнозов (PLAN-REDESIGN Ф4): дата-табы, hero-плитки, таблица матчей,
 * карточка экспресса дня с решением пользователя. Данные — /api/feed (Фаза 3). */
import { $, esc, toast, rejectReasons } from './util.js';
import { api } from './api.js';
import { lpShowMatch, lpShowLive } from './livepanel.js';

const DAY_LABELS = ['ВС', 'ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ'];

const mskDate = (offset) => new Date(Date.now() + offset * 864e5).toLocaleDateString('sv-SE', { timeZone: 'Europe/Moscow' });
const ruDay = (d) => {
  const dt = new Date(`${d}T12:00:00`);
  return `${dt.getDate()} ${dt.toLocaleDateString('ru-RU', { month: 'short' }).replace('.', '')}`;
};
const todayLabel = () => DAY_LABELS[new Date().getDay()];

export function createFeed() {
  const view = $('#feedView');
  let date = mskDate(0);
  let data = null;
  let filter = 'all';
  let loading = false;

  const isOpen = () => document.body.classList.contains('feed-open');

  /* L2-фронт: блок «🔴 Live сейчас» — клик открывает live-модель в правой панели */
  async function loadLiveBlock() {
    const box = $('#feedLive');
    if (!box) return;
    try {
      const j = await api('/match/now/list');
      const games = (j.games || []).slice(0, 6);
      box.innerHTML = games.length ? games.map((g) => `
        <button class="feed-live-row notch" data-id="${g.id}">
          <span class="fl-min">${g.minute}'</span>
          <span class="fl-score live">${esc(g.score)}</span>
          <span class="fl-teams">${esc(g.home)} — ${esc(g.away)}<small>${esc(g.league)}</small></span>
          <svg><use href="#i-chev"/></svg>
        </button>`).join('') : '';
      box.querySelectorAll('.feed-live-row').forEach((el) => {
        el.addEventListener('click', () => {
          const g = games.find((x) => String(x.id) === el.dataset.id);
          if (g) lpShowLive(g.id, { home: g.home, away: g.away, league: g.league, stage: g.stage, score: g.score, minute: g.minute });
        });
      });
      // карусель крутится колёсиком мыши на десктопе
      if (!box.dataset.wheel) {
        box.dataset.wheel = '1';
        box.addEventListener('wheel', (e) => {
          if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
            e.preventDefault();
            box.scrollLeft += e.deltaY;
          }
        }, { passive: false });
      }
    } catch { /* live-блок не критичен */ }
  }

  function open() {
    view.hidden = false;
    document.body.classList.add('feed-open');
    document.body.classList.remove('events-open', 'side-open');
    if (!data) load();
    loadLiveBlock();
  }
  function close() {
    document.body.classList.remove('feed-open');
    view.hidden = true;
  }
  function toggle() { isOpen() ? close() : open(); }

  function renderDates() {
    const box = $('#feedDates');
    box.innerHTML = '';
    for (let off = -2; off <= 2; off++) {
      const d = mskDate(off);
      const b = document.createElement('button');
      b.className = 'feed-date' + (d === date ? ' active' : '');
      const isToday = d === mskDate(0);
      b.innerHTML = isToday
        ? 'Сегодня'
        : `${DAY_LABELS[new Date(`${d}T12:00:00`).getDay()]} · ${ruDay(d)}`;
      b.addEventListener('click', () => { date = d; data = null; renderDates(); load(); });
      box.appendChild(b);
    }
  }

  function renderHero() {
    const h = data?.hero || {};
    const tiles = [
      { icon: 'i-shield', cap: 'Bankers', val: h.bankers ?? 0, sub: 'Проверенные прогнозы', cls: 'green' },
      { icon: 'i-bolt', cap: 'Express', val: h.expressOdds ? `${h.expressOdds}x` : '—', sub: h.expressEv ? `EV +${h.expressEv}%` : 'Комбинированные ставки', cls: 'orange' },
      { icon: 'i-search', cap: 'AI Confidence', val: h.confidence ? `${h.confidence}%` : '—', sub: 'Уверенность модели', cls: 'sky' },
    ];
    $('#feedHero').innerHTML = tiles.map((t) => `
      <div class="hero-tile ${t.cls} notch">
        <div class="ht-icon"><svg><use href="#${t.icon}"/></svg></div>
        <div class="ht-body"><div class="ht-cap">${t.cap}</div><div class="ht-sub">${t.sub}</div></div>
        <div class="ht-val">${esc(t.val)}</div>
      </div>`).join('');
  }

  function decideCard(card, { acceptLabel, onAccept, acceptedNote, skipNote, allowAmount = false }) {
    const bar = document.createElement('div');
    bar.className = 'sig-actions';
    bar.innerHTML = `
      ${allowAmount ? `<label class="cp-amount" title="Сумма ставки (необязательно)"><input type="number" inputmode="numeric" min="0" step="50" placeholder="${esc(lastAmount())}"> ₽</label>` : ''}
      <button class="btn-primary notch-sm sig-accept">${esc(acceptLabel)}</button>
      <button class="btn-secondary notch-sm sig-skip">Пропускаю</button>
      <div class="sig-status" hidden></div>`;
    const [acc, skip, status] = ['sig-accept', 'sig-skip', 'sig-status'].map((c) => bar.querySelector(`.${c}`));
    const decide = (ok, note) => {
      acc.disabled = skip.disabled = true;
      card.classList.add(ok ? 'is-accepted' : 'is-declined');
      status.hidden = false;
      status.textContent = ok ? `✓ ${note}` : `✗ ${note}`;
    };
    acc.addEventListener('click', async () => {
      acc.disabled = true;
      acc.textContent = 'Записываю…';
      const amount = allowAmount ? (parseFloat(bar.querySelector('.cp-amount input')?.value) || null) : null;
      try { await onAccept(amount); } catch (e) { acc.disabled = false; acc.textContent = acceptLabel; toast(e.message, 'err'); return; }
      decide(true, acceptedNote);
    });
    skip.addEventListener('click', () => {
      // Фаза 9.2: причина отклонения → в журнал решений
      rejectReasons((key, label) => {
        decide(false, `пропущено · ${label.toLowerCase()}`);
        if (skipNote?.onSkip) skipNote.onSkip(key);
      });
    });
    card.appendChild(bar);
  }

  const lastAmount = () => localStorage.getItem('sc_lastAmount') || '500';

  function logDecision(entry) {
    try {
      const arr = JSON.parse(localStorage.getItem('sc_signalDecisions') || '[]');
      arr.unshift({ ...entry, at: new Date().toISOString() });
      localStorage.setItem('sc_signalDecisions', JSON.stringify(arr.slice(0, 200)));
    } catch { /* не критично */ }
  }

  function renderExpress() {
    const box = $('#feedExpress');
    const ex = data?.express;
    if (!ex) { box.innerHTML = ''; return; }
    const card = document.createElement('div');
    card.className = 'signal-card express feed-express-card notch';
    card.innerHTML = `
      <div class="sig-head">
        <svg><use href="#i-bolt"/></svg>
        ЭКСПРЕСС ${ex.odds}x — ${ruDay(data.date)}
        <span class="st st-run">${ex.legs.length} события</span>
      </div>
      <table class="sig-table">
        <thead><tr><th>Матч</th><th>Рынок</th><th>P</th><th>Кэф</th><th>Fair</th><th>Value</th></tr></thead>
        <tbody>
          ${ex.legs.map((l) => `<tr>
            <td>${esc(l.match)}</td><td>${esc(l.market)}</td>
            <td>${Math.round(l.p * 100)}%</td>
            <td class="sig-odds">${l.odds}</td>
            <td>${(1 / l.p).toFixed(2)}</td>
            <td class="sig-value ${l.value > 0.1 ? 'hot' : ''}">+${Math.round(l.value * 100)}%</td>
          </tr>`).join('')}
        </tbody>
        <tfoot>
          <tr>
            <td colspan="2">Коэффициент <b class="sig-odds">${ex.odds}x</b></td>
            <td>Fair <b class="sig-odds">${ex.fair}x</b></td>
            <td colspan="2">EV <b class="sig-odds">+${ex.ev}%</b></td>
            <td>P <b class="sig-odds">${ex.probability}%</b></td>
          </tr>
        </tfoot>
      </table>
      <div class="express-risk"><svg><use href="#i-alert"/></svg> ${esc(ex.risk)}</div>`;
    decideCard(card, {
      acceptLabel: 'Принимаю экспресс',
      allowAmount: true,
      onAccept: async (amount) => {
        if (amount) localStorage.setItem('sc_lastAmount', String(amount));
        await api('/predictions', { method: 'POST', body: {
          legs: ex.legs, odds: ex.odds, fair: ex.fair, ev: ex.ev, probability: ex.probability, risk: ex.risk, source: 'feed', amount,
        }});
        logDecision({ type: 'express', legs: ex.legs, odds: ex.odds, probability: ex.probability, accepted: true, amount, source: 'feed' });
        toast(amount ? `Купон принят на ${amount.toLocaleString('ru-RU')} ₽ — трекается в «Моих купонах»` : 'Экспресс принят — статус ног будет отслеживаться', 'ok', 3600);
      },
      acceptedNote: 'принято — в «Моих прогнозах»',
      skipNote: { onSkip: (key) => logDecision({ type: 'express', legs: ex.legs, odds: ex.odds, probability: ex.probability, accepted: false, reason: key, source: 'feed' }) },
    });
    box.innerHTML = '';
    box.appendChild(card);
  }

  function toChat(m) {
    const input = $('#input');
    input.value = `Разбери матч ${m.home} — ${m.away} (${m.league}, ${m.day} ${m.time}): форма, вероятности, лучший рынок и вердикт`;
    input.dispatchEvent(new Event('input'));
    close();
    document.body.classList.remove('side-open');
    input.focus();
  }

  function renderMatches() {
    const tbody = $('#feedBody');
    const cards = $('#feedCards');
    const list = (data?.matches || []).filter((m) =>
      filter === 'all' ? true : filter === 'express' ? m.value >= 8 : m.tag === filter);
    if (!list.length) {
      tbody.innerHTML = '';
      cards.innerHTML = '<div class="empty-note">В этой категории пока пусто.</div>';
      return;
    }
    tbody.innerHTML = list.map((m) => `
      <tr class="feed-row" data-id="${m.id}">
        <td class="ft-time">${esc(m.time)}<small>${esc(m.day)}</small></td>
        <td class="ft-match"><b>${esc(m.home)} — ${esc(m.away)}</b><small>${esc(m.league)}</small></td>
        <td class="ft-prob">${m.p1}%</td><td class="ft-prob">${m.px}%</td><td class="ft-prob">${m.p2}%</td>
        <td class="ft-market">${esc(m.market)}</td>
        <td class="sig-odds">${m.odds}</td>
        <td class="ft-fair">${m.fair}</td>
        <td><span class="value-badge ${m.value > 10 ? 'hot' : m.value > 0 ? 'ok' : 'flat'}">${m.value > 0 ? '+' : ''}${m.value}%</span></td>
        <td class="ft-conf">${m.confidence}%</td>
        <td class="ft-go"><svg><use href="#i-chev"/></svg></td>
      </tr>`).join('');
    cards.innerHTML = list.map((m) => `
      <button class="feed-card notch" data-id="${m.id}">
        <div class="fc-top"><span class="ft-time">${esc(m.time)}</span><span class="value-badge ${m.value > 10 ? 'hot' : m.value > 0 ? 'ok' : 'flat'}">${m.value > 0 ? '+' : ''}${m.value}%</span></div>
        <div class="fc-teams"><b>${esc(m.home)} — ${esc(m.away)}</b><small>${esc(m.league)}</small></div>
        <div class="fc-row"><span>${esc(m.market)} @ <b>${m.odds}</b></span><span>P ${Math.max(m.p1, m.px, m.p2)}% · conf ${m.confidence}%</span></div>
      </button>`).join('');
    for (const el of [...tbody.querySelectorAll('.feed-row'), ...cards.querySelectorAll('.feed-card')]) {
      el.addEventListener('click', () => {
        const m = list.find((x) => String(x.id) === el.dataset.id);
        if (!m) return;
        // Match Drawer (Фаза 9.1): детали в правой панели, разбор — по кнопке
        lpShowMatch(m, (match) => toChat(match));
      });
    }
  }

  function render() {
    renderHero();
    renderExpress();
    renderMatches();
  }

  async function load(refresh = false) {
    if (loading) return;
    loading = true;
    $('#feedBody').innerHTML = '';
    $('#feedCards').innerHTML = '<div class="empty-note">Собираю ленту: линия, форма команд, Poisson…</div>';
    $('#feedExpress').innerHTML = '';
    try {
      data = await api(`/feed?date=${date}${refresh ? '&refresh=1' : ''}`);
      render();
    } catch (e) {
      $('#feedCards').innerHTML = `<div class="empty-note">Не удалось собрать ленту: ${esc(e.message)}. Попробуй обновить.</div>`;
    } finally {
      loading = false;
    }
  }

  $('#feedFilters')?.addEventListener('click', (e) => {
    const b = e.target.closest('.feed-filter');
    if (!b) return;
    filter = b.dataset.f;
    $('#feedFilters').querySelectorAll('.feed-filter').forEach((x) => x.classList.toggle('active', x === b));
    renderMatches();
  });
  $('#feedRefresh')?.addEventListener('click', () => { data = null; load(true); });

  // отправка из композера при открытой ленте — возвращаемся в чат
  $('#sendBtn')?.addEventListener('click', () => { if (isOpen()) close(); }, true);
  $('#input')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && isOpen()) close();
  }, true);

  renderDates();

  return { open, close, toggle, isOpen };
}
