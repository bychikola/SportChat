/* Мелкие общие помощники интерфейса */

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export function icon(name, cls = '') {
  return `<svg class="${cls}"><use href="#i-${name}"/></svg>`;
}

export const TOOL_ICONS = {
  Bash: 'term', Read: 'folder', Glob: 'folder', Grep: 'folder',
  Write: 'edit', Edit: 'edit', NotebookEdit: 'edit',
  WebSearch: 'bolt', WebFetch: 'bolt', Task: 'user', TodoWrite: 'check',
};

export const toolIcon = (name) => {
  if (!name) return 'bolt';
  if (name.startsWith('mcp__')) return 'plug';
  return TOOL_ICONS[name] || 'bolt';
};

export const INPUT_SUMMARY_KEYS = ['command', 'file_path', 'url', 'query', 'pattern', 'skill', 'topic', 'description', 'prompt'];

export function toolSummary(name, input) {
  if (!input || typeof input !== 'object') return '';
  for (const k of INPUT_SUMMARY_KEYS) {
    if (input[k] != null && input[k] !== '') {
      return String(input[k]).replace(/\s+/g, ' ').slice(0, 90);
    }
  }
  try {
    return JSON.stringify(input).slice(0, 90);
  } catch {
    return '';
  }
}

export function relTime(ts) {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'только что';
  if (m < 60) return `${m} мин`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} ч`;
  const d = Math.floor(h / 24);
  return `${d} дн`;
}

export const fmtCost = (usd) => `$${Number(usd || 0).toFixed(4)}`;
export const fmtInt = (n) => Number(n || 0).toLocaleString('ru-RU');

export function timeStr(d = new Date()) {
  return d.toTimeString().slice(0, 8);
}

/* ── тосты ── */
export function toast(message, kind = '', ms = 3800) {
  const box = $('#toasts');
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = message;
  box.appendChild(el);
  setTimeout(() => {
    el.classList.add('hide');
    setTimeout(() => el.remove(), 350);
  }, ms);
}

/* ── popup «Почему отклонили?» (Фаза 9.2) ── */
const REJECT_REASONS = [
  ['high_risk', 'Высокий риск'],
  ['disagree', 'Не согласен с анализом'],
  ['low_odds', 'Низкий коэффициент'],
  ['not_interested', 'Не интересует матч'],
  ['other', 'Другое'],
];

/** Оверлей с причинами отклонения. onPick(key, label) — по выбору. */
export function rejectReasons(onPick) {
  const ov = document.createElement('div');
  ov.className = 'overlay reason-overlay';
  ov.innerHTML = `
    <div class="modal reason-pop notch" role="dialog" aria-label="Причина отклонения">
      <div class="modal-head"><div><div class="modal-title">Почему отклонили?</div>
      <div class="modal-sub">поможет сделать прогнозы точнее</div></div></div>
      <div class="reason-list">
        ${REJECT_REASONS.map(([k, l]) => `<button class="reason-item" data-k="${k}">${l}</button>`).join('')}
      </div>
      <div class="reason-foot"><button class="reason-cancel btn-secondary notch-sm">Отмена</button></div>
    </div>`;
  const close = () => ov.remove();
  ov.addEventListener('mousedown', (e) => { if (e.target === ov) close(); });
  ov.querySelector('.reason-cancel').addEventListener('click', close);
  ov.querySelectorAll('.reason-item').forEach((b) => b.addEventListener('click', () => {
    close();
    const r = REJECT_REASONS.find(([k]) => k === b.dataset.k);
    onPick(r[0], r[1]);
  }));
  document.getElementById('modalRoot').appendChild(ov);
}

/* ── модалки ── */
export function openModal({ title, sub = '', wide = false, body, foot = [] }) {
  closeModal();
  const root = $('#modalRoot');
  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.innerHTML = `
    <div class="modal ${wide ? 'modal-lg' : ''} notch" role="dialog" aria-label="${esc(title)}">
      <div class="modal-head">
        <div>
          <div class="modal-title">${esc(title)}</div>
          ${sub ? `<div class="modal-sub">${esc(sub)}</div>` : ''}
        </div>
        <button class="modal-x" title="Закрыть">${icon('x')}</button>
      </div>
      <div class="modal-body"></div>
      ${foot.length ? '<div class="modal-foot"></div>' : ''}
    </div>`;
  overlay.querySelector('.modal-body').appendChild(body);
  const footRow = overlay.querySelector('.modal-foot');
  for (const b of foot) footRow.appendChild(b);
  const close = () => {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
  overlay.querySelector('.modal-x').addEventListener('click', close);
  root.appendChild(overlay);
  return { close, overlay };
}

export function closeModal() {
  $('#modalRoot').replaceChildren();
}

export function button(label, cls, onClick) {
  const b = document.createElement('button');
  b.className = cls;
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}
