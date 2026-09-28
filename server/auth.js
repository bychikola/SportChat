/* Аутентификация пользователей: почта или телефон + пароль (scrypt).
 * Токен сессии (30 дней) хранится на клиенте в localStorage и ходит
 * в заголовке Authorization: Bearer.
 *
 * ЗАГОТОВКА TELEGRAM (Фаза B+, этап 5 основного плана):
 *   1. Создать бота у @BotFather, положить токен в data/telegram.json
 *      {"token":"123:ABC"} или env TELEGRAM_BOT_TOKEN.
 *   2. Реализовать POST /auth/telegram: клиент присылает initData из
 *      Telegram.WebApp; сервер проверяет подпись HMAC-SHA256 (secret =
 *      HMAC_SHA256(botToken, 'WebAppData')) по алгоритму из документации
 *      Telegram, извлекает user{id,first_name,username,photo_url}.
 *   3. Найти/создать пользователя с provider='telegram' и выдать сессию
 *      через issueSession() — всё остальное (профиль, сигналы, XP) уже работает.
 * В схеме пользователя поле provider уже различает способ входа.
 */
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const router = express.Router();
const HERE = path.dirname(fileURLToPath(import.meta.url));
const USERS_FILE = path.join(HERE, '..', 'data', 'users.json');
const SESSIONS_FILE = path.join(HERE, '..', 'data', 'auth-sessions.json');
const SESSION_TTL_MS = 30 * 24 * 3600_000;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_RE = /^\+?\d{10,15}$/;

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}
function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

const hashPassword = (password, salt) =>
  crypto.scryptSync(String(password), salt, 64).toString('hex');

function publicUser(u) {
  return {
    id: u.id,
    provider: u.provider,
    login: u.login,
    name: u.name,
    avatarColor: u.avatarColor,
    createdAt: u.createdAt,
    premium: !!u.premium,
  };
}

function issueSession(userId) {
  const sessions = readJson(SESSIONS_FILE, { sessions: {} });
  const token = crypto.randomBytes(32).toString('hex');
  sessions.sessions[token] = { userId, expiresAt: Date.now() + SESSION_TTL_MS };
  // подчищаем просроченные
  for (const [t, s] of Object.entries(sessions.sessions)) {
    if (s.expiresAt < Date.now()) delete sessions.sessions[t];
  }
  writeJson(SESSIONS_FILE, sessions);
  return token;
}

function userByToken(token) {
  if (!token) return null;
  const sessions = readJson(SESSIONS_FILE, { sessions: {} });
  const s = sessions.sessions[token];
  if (!s || s.expiresAt < Date.now()) return null;
  const users = readJson(USERS_FILE, { users: [] });
  return users.users.find((u) => u.id === s.userId) || null;
}

function authUser(req) {
  const header = req.headers.authorization || '';
  return userByToken(header.startsWith('Bearer ') ? header.slice(7) : null);
}

function normalizeLogin(type, login) {
  const v = String(login || '').trim();
  return type === 'phone' ? (v.startsWith('+') ? v : `+${v}`) : v.toLowerCase();
}

/** Регистрация: { type: 'email'|'phone', login, password, name? } */
router.post('/register', (req, res) => {
  const type = req.body?.type === 'phone' ? 'phone' : 'email';
  const login = normalizeLogin(type, req.body?.login);
  const password = String(req.body?.password || '');
  const name = String(req.body?.name || '').trim().slice(0, 40) || login.split('@')[0] || login;

  if (type === 'email' && !EMAIL_RE.test(login)) return res.status(400).json({ error: 'Некорректный email' });
  if (type === 'phone' && !PHONE_RE.test(login)) return res.status(400).json({ error: 'Некорректный телефон (10–15 цифр, можно с +)' });
  if (password.length < 6) return res.status(400).json({ error: 'Пароль — минимум 6 символов' });

  const db = readJson(USERS_FILE, { users: [] });
  if (db.users.some((u) => u.login === login)) {
    return res.status(409).json({ error: 'Такой ' + (type === 'email' ? 'email' : 'телефон') + ' уже зарегистрирован' });
  }
  const salt = crypto.randomBytes(16).toString('hex');
  const user = {
    id: crypto.randomUUID(),
    provider: type,
    login,
    name,
    salt,
    passHash: hashPassword(password, salt),
    avatarColor: ['a', 'b', 'c', 'd'][crypto.randomInt(4)],
    createdAt: new Date().toISOString(),
    premium: false,
  };
  db.users.push(user);
  writeJson(USERS_FILE, db);
  const token = issueSession(user.id);
  res.json({ ok: true, token, user: publicUser(user) });
});

/** Вход: { login, password } — тип определяется автоматически */
router.post('/login', (req, res) => {
  const raw = String(req.body?.login || '').trim();
  const login = raw.includes('@') ? raw.toLowerCase() : (raw.startsWith('+') ? raw : `+${raw}`).replace(/^\+\+/, '+');
  const password = String(req.body?.password || '');
  const db = readJson(USERS_FILE, { users: [] });
  const user = db.users.find((u) => u.login === login) ||
    db.users.find((u) => u.login === raw.toLowerCase());
  if (!user) return res.status(401).json({ error: 'Пользователь не найден' });
  const hash = hashPassword(password, user.salt);
  const ok = crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(user.passHash));
  if (!ok) return res.status(401).json({ error: 'Неверный пароль' });
  const token = issueSession(user.id);
  res.json({ ok: true, token, user: publicUser(user) });
});

/** Выход */
router.post('/logout', (req, res) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (token) {
    const sessions = readJson(SESSIONS_FILE, { sessions: {} });
    delete sessions.sessions[token];
    writeJson(SESSIONS_FILE, sessions);
  }
  res.json({ ok: true });
});

/** Текущий пользователь */
router.get('/me', (req, res) => {
  const user = authUser(req);
  if (!user) return res.status(401).json({ error: 'Не авторизован' });
  res.json({ ok: true, user: publicUser(user) });
});

/** Смена имени */
router.patch('/me', (req, res) => {
  const user = authUser(req);
  if (!user) return res.status(401).json({ error: 'Не авторизован' });
  const name = String(req.body?.name || '').trim().slice(0, 40);
  if (!name) return res.status(400).json({ error: 'Имя не может быть пустым' });
  const db = readJson(USERS_FILE, { users: [] });
  const u = db.users.find((x) => x.id === user.id);
  if (!u) return res.status(404).json({ error: 'Пользователь не найден' });
  u.name = name;
  writeJson(USERS_FILE, db);
  res.json({ ok: true, user: publicUser(u) });
});

/* ЗАГОТОВКА TELEGRAM — см. инструкцию в шапке файла.
router.post('/telegram', (req, res) => {
  // 1) взять initData из тела, проверить HMAC по токену бота
  // 2) найти/создать пользователя provider='telegram'
  // 3) issueSession(user.id) → { token, user }
  res.status(501).json({ error: 'Вход через Telegram пока не подключён' });
});
*/
router.post('/telegram', (req, res) => res.status(501).json({ error: 'Вход через Telegram пока не подключён — см. инструкцию в server/auth.js' }));

export default router;
