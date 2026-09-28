/* Профиль пользователя: вход по email/телефону, карточка профиля.
 * Основа для Фаз B–G плана профилей; Telegram-вход подключается позже
 * (см. инструкцию в server/auth.js и PLAN-PROFILE.md). */

import { $, esc, toast, openModal } from './util.js';
import { api, authToken } from './api.js';

const TOKEN_KEY = 'sc_authToken';

export function createProfile() {
  let user = null;

  function saveToken(token) {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  }

  function initials(name) {
    return String(name || '?').trim().slice(0, 1).toUpperCase();
  }

  /* ── кнопка в табло ── */
  function renderHeaderBtn() {
    const btn = $('#profileBtn');
    if (!btn) return;
    if (user) {
      btn.innerHTML = `<span class="profile-ava" style="background:${avaGradient(user.avatarColor)}">${esc(initials(user.name))}</span>`;
      btn.title = `Профиль: ${user.name}`;
    } else {
      btn.innerHTML = '<span class="profile-ava profile-ava-empty">?</span>';
      btn.title = 'Войти в профиль';
    }
  }

  function avaGradient(color) {
    const map = {
      a: 'linear-gradient(160deg, #ffb454, #e8912b)',
      b: 'linear-gradient(160deg, #46d39a, #2ea87a)',
      c: 'linear-gradient(160deg, #7fb5ff, #4f86d8)',
      d: 'linear-gradient(160deg, #c792ff, #8b46d3)',
    };
    return map[color] || map.a;
  }

  /* ── модалка входа/регистрации ── */
  function openAuthModal() {
    const body = document.createElement('div');
    body.innerHTML = `
      <div class="field">
        <label>Вход или регистрация</label>
        <div class="auth-switch">
          <button class="evi-chip active" data-t="email">Email</button>
          <button class="evi-chip" data-t="phone">Телефон</button>
        </div>
      </div>
      <div class="field">
        <label id="authLoginLabel">Email</label>
        <input type="text" id="authLogin" autocomplete="username" placeholder="you@example.com">
      </div>
      <div class="field">
        <label>Пароль</label>
        <input type="password" id="authPass" autocomplete="current-password" placeholder="Минимум 6 символов">
      </div>
      <div class="field">
        <label>Имя (необязательно)</label>
        <input type="text" id="authName" placeholder="Как отображать в профиле">
      </div>
      <div class="auth-tabs">
        <button class="btn-primary notch-sm" id="authLoginBtn">Войти</button>
        <button class="btn-secondary" id="authRegBtn">Зарегистрироваться</button>
      </div>
      <div class="form-error" id="authErr"></div>
      <div class="hint">Вход через Telegram будет добавлен позже — кнопка появится здесь.</div>`;

    let type = 'email';
    const modal = openModal({ title: 'Профиль · вход', body });
    const err = body.querySelector('#authErr');
    const loginInput = body.querySelector('#authLogin');
    const loginLabel = body.querySelector('#authLoginLabel');

    body.querySelectorAll('.auth-switch .evi-chip').forEach((b) => {
      b.addEventListener('click', () => {
        type = b.dataset.t;
        body.querySelectorAll('.auth-switch .evi-chip').forEach((x) => x.classList.toggle('active', x === b));
        loginLabel.textContent = type === 'phone' ? 'Телефон' : 'Email';
        loginInput.placeholder = type === 'phone' ? '+79991234567' : 'you@example.com';
      });
    });

    const submit = async (register) => {
      err.classList.remove('show');
      try {
        const payload = register
          ? { type, login: loginInput.value, password: body.querySelector('#authPass').value, name: body.querySelector('#authName').value }
          : { login: loginInput.value, password: body.querySelector('#authPass').value };
        const j = await api(`/auth/${register ? 'register' : 'login'}`, { method: 'POST', body: payload });
        saveToken(j.token);
        user = j.user;
        modal.close();
        renderHeaderBtn();
        toast(`Привет, ${user.name}!`, 'ok', 2800);
        openProfileModal();
      } catch (e) {
        err.textContent = e.message;
        err.classList.add('show');
      }
    };
    body.querySelector('#authLoginBtn').addEventListener('click', () => submit(false));
    body.querySelector('#authRegBtn').addEventListener('click', () => submit(true));
    setTimeout(() => loginInput.focus(), 100);
  }

  /* ── модалка профиля ── */
  async function openProfileModal() {
    const body = document.createElement('div');
    body.innerHTML = '<div class="mm-loading">Загружаю профиль…</div>';
    let signalsStats = null;
    try {
      signalsStats = (await api('/signals')).stats;
    } catch { /* статистика не критична */ }

    const created = user.createdAt ? new Date(user.createdAt).toLocaleDateString('ru-RU') : '—';
    const acc = signalsStats?.accuracy;
    const footSave = document.createElement('button');
    footSave.className = 'btn-primary notch-sm';
    footSave.textContent = 'Сохранить имя';
    const footLogout = document.createElement('button');
    footLogout.className = 'btn-danger';
    footLogout.textContent = 'Выйти';
    const modal = openModal({ title: 'Профиль', foot: [footLogout, footSave], body });

    body.innerHTML = `
      <div class="profile-card notch">
        <span class="profile-ava profile-ava-big" style="background:${avaGradient(user.avatarColor)}">${esc(initials(user.name))}</span>
        <div class="profile-id">
          <b>${esc(user.name)}</b>
          <span class="mm-hint">${user.provider === 'phone' ? '📱' : '✉'} ${esc(user.login)}</span>
        </div>
        ${user.premium ? '<span class="st st-ok">PREMIUM</span>' : ''}
      </div>
      <div class="profile-stats">
        <div class="cap-card notch"><span class="cap-k">Сигналов</span><span class="cap-v">${signalsStats?.total ?? 0}</span></div>
        <div class="cap-card notch"><span class="cap-k">Завершено</span><span class="cap-v">${signalsStats?.settled ?? 0}</span></div>
        <div class="cap-card notch"><span class="cap-k">Точность</span><span class="cap-v">${acc != null ? acc + '%' : '—'}</span></div>
      </div>
      <div class="field">
        <label>Имя</label>
        <input type="text" id="profName" value="${esc(user.name)}">
      </div>
      <div class="field">
        <label>С нами с</label>
        <div class="hint">${created}</div>
      </div>
      <div class="hint">Вход через Telegram — скоро (кнопка появится в окне входа).</div>`;

    footSave.addEventListener('click', async () => {
      try {
        const j = await api('/auth/me', { method: 'PATCH', body: { name: body.querySelector('#profName').value } });
        user = j.user;
        renderHeaderBtn();
        modal.close();
        openProfileModal();
      } catch (e) { toast(e.message, 'err'); }
    });
    footLogout.addEventListener('click', async () => {
      try { await api('/auth/logout', { method: 'POST' }); } catch { /* сессия истекла */ }
      saveToken('');
      user = null;
      renderHeaderBtn();
      modal.close();
      toast('Вы вышли из профиля', 'ok', 2400);
    });
  }

  async function boot() {
    if (!authToken()) { renderHeaderBtn(); return; }
    try {
      const j = await api('/auth/me');
      user = j.user;
    } catch {
      saveToken(''); // токен истёк
    }
    renderHeaderBtn();
  }

  $('#profileBtn')?.addEventListener('click', () => {
    user ? openProfileModal() : openAuthModal();
  });

  boot();
  renderHeaderBtn();

  return { getUser: () => user };
}
