/* Аутентификация пользователей: почта или телефон + пароль (scrypt).
 * Токен сессии (30 дней) хранится на клиенте в localStorage и ходит
 * в заголовке Authorization: Bearer.
 *
 * Хранилище: Supabase Postgres (server/db.js), если заданы SUPABASE_URL и
 * SUPABASE_SERVICE_ROLE_KEY; иначе — локальные JSON-файлы (data/*.json).
 * Схема БД: supabase/migrations/001_users.sql.
 *
 * ЗАГОТОВКА TELEGRAM (этап 5 основного плана):
 *   1. Бот у @BotFather → токен в data/telegram.json или env TELEGRAM_BOT_TOKEN.
 *   2. POST /auth/telegram: клиент присылает initData из Telegram.WebApp;
 *      сервер проверяет подпись HMAC-SHA256 (secret = HMAC_SHA256(botToken,
 *      'WebAppData')) по документации Telegram, извлекает user{id, name, username}.
 *   3. Найти/создать пользователя provider='telegram' (pass_hash = null) и
 *      выдать сессию через createSession() — профиль/сигналы уже поддерживают.
 * В схеме пользователя поле provider различает способ входа.
 */
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { db, isConfigured } from './db.js';

const router = express.Router();
const HERE = path.dirname(fileURLToPath(import.meta.url));
const USERS_FILE = path.join(HERE, '..', 'data', 'users.json');
const SESSIONS_FILE = path.join(HERE, '..', 'data', 'auth-sessions.json');
const SESSION_TTL_MS = 30 * 24 * 3600_000;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_RE = /^\+?\d{10,15}$/;

/* ── общие утилиты ─────────────────────────────────────────────── */

const hashPassword = (password, salt) =>
  crypto.scryptSync(String(password), salt, 64).toString('hex');

function publicUser(u) {
  return {
    id: u.id,
    provider: u.provider,
    login: u.login,
    name: u.name,
    avatarColor: u.avatar_color ?? u.avatarColor ?? 'a',
    createdAt: u.created_at ?? u.createdAt,
    premium: !!u.premium,
  };
}

/* ── хранилище: Supabase или локальные JSON ───────────────────── */

const useSupabase = isConfigured();

async function findUserByLogin(login) {
  if (useSupabase) {
    const { data, error } = await db().from('users').select('*').eq('login', login).maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  }
  const dbJson = readJson(USERS_FILE, { users: [] });
  return dbJson.users.find((u) => u.login === login) || null;
}

async function findUserById(id) {
  if (useSupabase) {
    const { data, error } = await db().from('users').select('*').eq('id', id).maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  }
  const dbJson = readJson(USERS_FILE, { users: [] });
  return dbJson.users.find((u) => u.id === id) || null;
}

async function insertUser({ provider, login, name, passHash, salt }) {
  const avatarColor = ['a', 'b', 'c', 'd'][crypto.randomInt(4)];
  if (useSupabase) {
    const { data, error } = await db()
      .from('users')
      .insert({ provider, login, name, pass_hash: passHash, salt, avatar_color: avatarColor })
      .select('*')
      .single();
    if (error) {
      if (error.code === '23505') throw new Error('Такой ' + (provider === 'email' ? 'email' : 'телефон') + ' уже зарегистрирован');
      throw new Error(error.message);
    }
    return data;
  }
  const dbJson = readJson(USERS_FILE, { users: [] });
  if (dbJson.users.some((u) => u.login === login)) {
    throw new Error('Такой ' + (provider === 'email' ? 'email' : 'телефон') + ' уже зарегистрирован');
  }
  const user = {
    id: crypto.randomUUID(), provider, login, name,
    passHash, salt, avatarColor,
    createdAt: new Date().toISOString(), premium: false,
  };
  dbJson.users.push(user);
  writeJson(USERS_FILE, dbJson);
  return user;
}

async function updateName(userId, name) {
  if (useSupabase) {
    const { data, error } = await db().from('users').update({ name }).eq('id', userId).select('*').single();
    if (error) throw new Error(error.message);
    return data;
  }
  const dbJson = readJson(USERS_FILE, { users: [] });
  const u = dbJson.users.find((x) => x.id === userId);
  if (!u) throw new Error('Пользователь не найден');
  u.name = name;
  writeJson(USERS_FILE, dbJson);
  return u;
}

async function createSession(token, userId) {
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  if (useSupabase) {
    const { error } = await db().from('auth_sessions').insert({ token, user_id: userId, expires_at: expiresAt });
    if (error) throw new Error(error.message);
    return;
  }
  const sessions = readJson(SESSIONS_FILE, { sessions: {} });
  sessions.sessions[token] = { userId, expiresAt };
  for (const [t, s] of Object.entries(sessions.sessions)) {
    if (new Date(s.expiresAt).getTime() < Date.now()) delete sessions.sessions[t];
  }
  writeJson(SESSIONS_FILE, sessions);
}

async function deleteSession(token) {
  if (useSupabase) {
    await db().from('auth_sessions').delete().eq('token', token);
    return;
  }
  const sessions = readJson(SESSIONS_FILE, { sessions: {} });
  delete sessions.sessions[token];
  writeJson(SESSIONS_FILE, sessions);
}

async function userByToken(token) {
  if (!token) return null;
  let userId;
  if (useSupabase) {
    const { data, error } = await db().from('auth_sessions').select('user_id, expires_at').eq('token', token).maybeSingle();
    if (error || !data) return null;
    if (new Date(data.expires_at).getTime() < Date.now()) return null;
    userId = data.user_id;
  } else {
    const sessions = readJson(SESSIONS_FILE, { sessions: {} });
    const s = sessions.sessions[token];
    if (!s || new Date(s.expiresAt).getTime() < Date.now()) return null;
    userId = s.userId;
  }
  return (await findUserById(userId)) || null;
}

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

/* ── middleware ───────────────────────────────────────────────── */

export async function authUser(req) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  return userByToken(token);
}

function normalizeLogin(type, login) {
  const v = String(login || '').trim();
  return type === 'phone' ? (v.startsWith('+') ? v : `+${v}`) : v.toLowerCase();
}

/* ── руты ─────────────────────────────────────────────────────── */

/** Регистрация: { type: 'email'|'phone', login, password, name? } */
router.post('/register', async (req, res) => {
  try {
    const type = req.body?.type === 'phone' ? 'phone' : 'email';
    const login = normalizeLogin(type, req.body?.login);
    const password = String(req.body?.password || '');
    const name = String(req.body?.name || '').trim().slice(0, 40) || login.split('@')[0] || login;

    if (type === 'email' && !EMAIL_RE.test(login)) return res.status(400).json({ error: 'Некорректный email' });
    if (type === 'phone' && !PHONE_RE.test(login)) return res.status(400).json({ error: 'Некорректный телефон (10–15 цифр, можно с +)' });
    if (password.length < 6) return res.status(400).json({ error: 'Пароль — минимум 6 символов' });

    if (await findUserByLogin(login)) {
      return res.status(409).json({ error: 'Такой ' + (type === 'email' ? 'email' : 'телефон') + ' уже зарегистрирован' });
    }
    const salt = crypto.randomBytes(16).toString('hex');
    const user = await insertUser({ provider: type, login, name, passHash: hashPassword(password, salt), salt });
    const token = crypto.randomBytes(32).toString('hex');
    await createSession(token, user.id);
    res.json({ ok: true, token, user: publicUser(user) });
  } catch (e) {
    res.status(e.message.includes('уже зарегистрирован') ? 409 : 500).json({ error: e.message });
  }
});

/** Вход: { login, password } — тип определяется автоматически */
router.post('/login', async (req, res) => {
  try {
    const raw = String(req.body?.login || '').trim();
    const login = raw.includes('@') ? raw.toLowerCase() : (raw.startsWith('+') ? raw : `+${raw}`).replace(/^\+\+/, '+');
    const password = String(req.body?.password || '');
    const user = await findUserByLogin(login) || (raw.toLowerCase() !== login ? await findUserByLogin(raw.toLowerCase()) : null);
    if (!user) return res.status(401).json({ error: 'Пользователь не найден' });
    const hash = hashPassword(password, user.salt ?? '');
    const ok = crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(user.pass_hash ?? user.passHash ?? ''));
    if (!ok) return res.status(401).json({ error: 'Неверный пароль' });
    const token = crypto.randomBytes(32).toString('hex');
    await createSession(token, user.id);
    res.json({ ok: true, token, user: publicUser(user) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/** Выход */
router.post('/logout', async (req, res) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (token) await deleteSession(token);
  res.json({ ok: true });
});

/** Текущий пользователь */
router.get('/me', async (req, res) => {
  const user = await authUser(req);
  if (!user) return res.status(401).json({ error: 'Не авторизован' });
  res.json({ ok: true, user: publicUser(user) });
});

/** Смена имени */
router.patch('/me', async (req, res) => {
  try {
    const user = await authUser(req);
    if (!user) return res.status(401).json({ error: 'Не авторизован' });
    const name = String(req.body?.name || '').trim().slice(0, 40);
    if (!name) return res.status(400).json({ error: 'Имя не может быть пустым' });
    const updated = await updateName(user.id, name);
    res.json({ ok: true, user: publicUser(updated) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ЗАГОТОВКА TELEGRAM — см. инструкцию в шапке файла.
router.post('/telegram', async (req, res) => {
  // 1) проверить подпись initData по токену бота
  // 2) найти/создать пользователя provider='telegram'
  // 3) issueSession → { token, user }
});
*/
router.post('/telegram', (req, res) => res.status(501).json({ error: 'Вход через Telegram пока не подключён — см. инструкцию в server/auth.js' }));

export default router;
