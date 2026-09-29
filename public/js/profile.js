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
      <div class="auth-seg" role="tablist">
        <button data-m="login" class="active">Вход</button>
        <button data-m="register">Регистрация</button>
      </div>
      <div class="field">
        <label>Email или телефон</label>
        <input type="text" id="authLogin" autocomplete="username" placeholder="you@example.com · +79991234567">
      </div>
      <div class="field">
        <label>Пароль</label>
        <input type="password" id="authPass" autocomplete="current-password" placeholder="Минимум 6 символов">
      </div>
      <div class="field" id="authNameField" hidden>
        <label>Имя</label>
        <input type="text" id="authName" placeholder="Как отображать в профиле">
      </div>
      <button class="btn-primary notch-sm auth-submit" id="authSubmit">Войти</button>
      <div class="form-error" id="authErr"></div>
      <div class="hint auth-hint">Вход через Telegram — скоро.</div>`;

    let mode = 'login';
    const modal = openModal({ title: 'Профиль · вход', body });
    const err = body.querySelector('#authErr');
    const loginInput = body.querySelector('#authLogin');
    const nameField = body.querySelector('#authNameField');
    const submitBtn = body.querySelector('#authSubmit');

    body.querySelectorAll('.auth-seg button').forEach((b) => {
      b.addEventListener('click', () => {
        mode = b.dataset.m;
        body.querySelectorAll('.auth-seg button').forEach((x) => x.classList.toggle('active', x === b));
        nameField.hidden = mode !== 'register';
        submitBtn.textContent = mode === 'register' ? 'Создать аккаунт' : 'Войти';
      });
    });

    const submit = async () => {
      err.classList.remove('show');
      const busy = submitBtn.textContent;
      submitBtn.disabled = true;
      submitBtn.textContent = mode === 'register' ? 'Создаю…' : 'Вхожу…';
      try {
        const loginVal = loginInput.value.trim();
        const type = loginVal.includes('@') ? 'email' : 'phone';
        const payload = mode === 'register'
          ? { type, login: loginVal, password: body.querySelector('#authPass').value, name: body.querySelector('#authName').value }
          : { login: loginVal, password: body.querySelector('#authPass').value };
        const j = await api(`/auth/${mode}`, { method: 'POST', body: payload });
        saveToken(j.token);
        user = j.user;
        modal.close();
        renderHeaderBtn();
        toast(`Привет, ${user.name}!`, 'ok', 2800);
        openProfileModal();
      } catch (e) {
        err.textContent = e.message;
        err.classList.add('show');
        submitBtn.disabled = false;
        submitBtn.textContent = busy;
      }
    };
    submitBtn.addEventListener('click', submit);
    loginInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
    // клавиатура под ввод: «+» → телефонная, иначе — с @
    loginInput.addEventListener('input', () => {
      loginInput.inputMode = loginInput.value.startsWith('+') ? 'tel' : 'email';
    });
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

  const ready = boot();

  $('#profileBtn')?.addEventListener('click', async () => {
    await ready; // boot мог ещё не проверить токен — ждём, иначе гонка
    user ? openProfileModal() : openAuthModal();
  });

  renderHeaderBtn();

  return { getUser: () => user, open: async () => { await ready; user ? openProfileModal() : openAuthModal(); } };
}
