/* Тест авторизации: регистрация, вход, me, patch, дубликат, телефон */
(async () => {
  const BASE = 'http://127.0.0.1:3777';
  const j = async (r) => r.json();

  // вход по email
  const login = await j(await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: 'test@sportchat.local', password: 'secret123' }),
  }));
  console.log('login:', login.ok ? 'ok' : login.error, '| имя:', login.user?.name);
  const auth = { Authorization: `Bearer ${login.token}` };

  const me = await j(await fetch(`${BASE}/api/auth/me`, { headers: auth }));
  console.log('me:', me.user?.name, '|', me.user?.provider);

  const patch = await j(await fetch(`${BASE}/api/auth/me`, {
    method: 'PATCH', headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Тестер Про' }),
  }));
  console.log('patch:', patch.user?.name);

  // неверный пароль
  const bad = await j(await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: 'test@sportchat.local', password: 'wrong' }),
  }));
  console.log('bad login:', bad.error);

  // дубликат регистрации
  const dup = await j(await fetch(`${BASE}/api/auth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'email', login: 'test@sportchat.local', password: 'secret123' }),
  }));
  console.log('duplicate:', dup.error);

  // телефон
  const phone = await j(await fetch(`${BASE}/api/auth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'phone', login: '79991234567', password: 'secret123', name: 'Юзер Телефон' }),
  }));
  console.log('phone:', phone.ok ? 'ok' : phone.error, '|', phone.user?.login, phone.user?.provider);

  // telegram-заготовка
  const tg = await j(await fetch(`${BASE}/api/auth/telegram`, { method: 'POST' }));
  console.log('telegram stub:', tg.error?.slice(0, 40));

  // logout и me без токена
  await fetch(`${BASE}/api/auth/logout`, { method: 'POST', headers: auth });
  const meAfter = await j(await fetch(`${BASE}/api/auth/me`, { headers: auth }));
  console.log('me after logout:', meAfter.error);
})();
