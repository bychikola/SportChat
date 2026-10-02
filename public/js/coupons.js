/* «Мои купоны» (PLAN-COUPONS К2): ставки пользователя в реальном времени —
 * live-счёт/минута, досрочный расчёт, цвета статусов как в БК.
 * Данные: /api/predictions (экспрессы) + /api/signals (одиночные). Поллинг 20с. */
import { $, esc, icon } from './util.js';
import { api } from './api.js';

const COUPON_STATUS = {
  pending: ['В РАБОТЕ', 'run'],
  live: ['ИДЁТ', 'live'],
  won: ['СЫГРАЛО', 'ok'],
  lost: ['НЕ ЗАШЛО', 'err'],
  void: ['ВОЗВРАТ', 'void'],
};
const LEG_STATUS = {
  pending: ['ожидает', 'void'],
  live: ['идёт', 'live'],
  won: ['зашло', 'ok'],
  lost: ['не зашло', 'err'],
  void: ['возврат', 'void'],
};

export function createCoupons() {
  let filter = 'all';
  let timer = null;

  const isOpen = () => document.body.classList.contains('coupons-open');
  function open() {
    $('#couponsView').hidden = false;
    document.body.classList.add('coupons-open');
    document.body.classList.remove('feed-open', 'events-open', 'stats-open', 'side-open');
    load();
    startPolling();
  }
  function close() {
    $('#couponsView').hidden = true;
    document.body.classList.remove('coupons-open');
    stopPolling();
  }
  function toggle() { isOpen() ? close() : open(); }
  function startPolling() {
    stopPolling();
    timer = setInterval(() => {
      if (document.visibilityState === 'visible' && isOpen()) load(true);
    }, 20_000);
  }
  function stopPolling() { if (timer) { clearInterval(timer); timer = null; } }

  const fmtMoney = (n) => `${Number(n).toLocaleString('ru-RU')} ₽`;

  function legRow(l, type) {
    const st = l.status || 'pending';
    const live = st === 'live' && l.live;
    const presumed = l.presumed === 'won' ? ' <b class="cp-presumed ok">✓ рассчитано досрочно</b>'
      : l.presumed === 'lost' ? ' <b class="cp-presumed err">✗ рассчитано досрочно</b>' : '';
    const score = live
      ? `<span class="cp-score live">${esc(l.live.score)}<small>${l.live.minute ? `· ${l.live.minute}'` : ''}</small></span>`
      : l.status === 'won' || l.status === 'lost' || l.status === 'void'
        ? `<span class="cp-score">${esc(l.score || 'финал')}</span>`
        : '<span class="cp-score">—</span>';
    const [label, cls] = LEG_STATUS[l.presumed === 'won' ? 'won' : l.presumed === 'lost' ? 'lost' : st] || LEG_STATUS.pending;
    return `
      <div class="cp-leg ${cls}">
        <svg><use href="#${st === 'won' ? 'i-check' : st === 'lost' ? 'i-x' : st === 'live' ? 'i-bolt' : 'i-clock'}"/></svg>
        <span class="cp-leg-match">${esc(l.match)}<small>${esc(l.market)}</small></span>
        ${type === 'express' ? score : score}
        <span class="cp-leg-odds">${l.odds}</span>
        <span class="cp-leg-st"><span class="st st-${cls}">${label}</span>${presumed}</span>
      </div>`;
  }

  function couponCard(c) {
    const [label, cls] = COUPON_STATUS[c.status] || COUPON_STATUS.pending;
    const payout = c.amount && c.status === 'won' ? fmtMoney(c.amount * c.odds) : null;
    const lostNote = c.status === 'lost' && c.amount ? 'возврат 0 ₽' : '';
    return `
      <div class="coupon-card st-${cls} notch">
        <div class="cp-head">
          <svg><use href="#i-ticket"/></svg>
          <b>${c.type === 'express' ? 'ЭКСПРЕСС' : 'ОДИНОЧНАЯ'} · ${esc(c.id ? c.id.slice(0, 18) : '')}</b>
          <span class="st st-${cls} ${c.status === 'live' ? 'cp-live-pulse' : ''}">${label}</span>
        </div>
        <div class="cp-body">
          ${c.legs.map((l) => legRow(l, c.type)).join('')}
        </div>
        <div class="cp-foot">
          <span>Кэф <b>${c.odds}x</b></span>
          ${c.amount ? `<span>Сумма <b>${fmtMoney(c.amount)}</b></span>` : ''}
          ${payout ? `<span class="cp-payout ok">Выплата <b>${payout}</b></span>` : ''}
          ${lostNote ? `<span class="cp-payout err">${lostNote}</span>` : ''}
          <span class="cp-date">${esc((c.createdAt || '').slice(0, 10))}</span>
        </div>
      </div>`;
  }

  function render(payload) {
    const { expressCoupons, singleCoupons } = payload;
    const all = [
      ...expressCoupons.map((p) => ({ ...p, type: 'express' })),
      ...singleCoupons.map((s) => ({
        id: s.id.slice(0, 8), type: 'single', status: s.status, odds: s.odds,
        amount: s.amount, createdAt: s.createdAt,
        legs: [{ gameId: s.gameId, match: s.match, market: s.market || s.pick, key: s.key,
                 odds: s.odds, status: s.status, score: s.result?.score, live: s.live }],
      })),
    ].sort((a, b) => {
      const rank = { live: 0, pending: 1, won: 2, void: 3, lost: 4 };
      return (rank[a.status] ?? 9) - (rank[b.status] ?? 9) ||
             new Date(b.createdAt) - new Date(a.createdAt);
    });
    const liveN = all.filter((c) => c.status === 'live' || c.status === 'pending').length;
    const lc = $('#cpLiveCount');
    if (lc) lc.textContent = liveN ? String(liveN) : '';

    const list = all.filter((c) => filter === 'all'
      ? true
      : filter === 'active' ? c.status === 'live' || c.status === 'pending'
      : ['won', 'lost', 'void'].includes(c.status));

    $('#couponsList').innerHTML = list.length
      ? list.map(couponCard).join('')
      : '<div class="empty-note">Купонов пока нет. Принимай прогнозы в чате или ленте — они появятся здесь и будут отслеживаться в реальном времени.</div>';
  }

  async function load(silent = false) {
    if (!silent) $('#couponsList').innerHTML = '<div class="empty-note">Загружаю купоны…</div>';
    try {
      const [preds, sigs] = await Promise.all([
        api('/predictions'),
        api('/signals'),
      ]);
      render({ expressCoupons: preds.predictions || [], singleCoupons: sigs.signals || [] });
    } catch (e) {
      $('#couponsList').innerHTML = `<div class="empty-note">Не удалось загрузить купоны: ${esc(e.message)}</div>`;
    }
  }

  document.querySelector('#couponsView .cp-filters')?.addEventListener('click', (e) => {
    const b = e.target.closest('.feed-filter');
    if (!b) return;
    filter = b.dataset.f;
    document.querySelectorAll('#couponsView .cp-filters .feed-filter')
      .forEach((x) => x.classList.toggle('active', x === b));
    load(true);
  });
  $('#couponsRefresh')?.addEventListener('click', () => load());

  // К4: мгновенное обновление по WS-пушу (без ожидания поллинга)
  window.addEventListener('bet-update', () => { if (isOpen()) load(true); });

  return { open, close, toggle, isOpen, load };
}
