import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const WORKSPACE = path.join(ROOT, 'workspace');
export const DATA_DIR = path.join(ROOT, 'data');
export const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');

const CLAUDE_DIR = () => path.join(WORKSPACE, '.claude');
const SKILLS_DIR = () => path.join(CLAUDE_DIR(), 'skills');
export const MCP_FILE = () => path.join(WORKSPACE, '.mcp.json');
export const SETTINGS_FILE = () => path.join(CLAUDE_DIR(), 'settings.json');
export const CLAUDE_MD_FILE = () => path.join(WORKSPACE, 'CLAUDE.md');
export const SYSTEM_PROMPT_FILE = () => path.join(WORKSPACE, 'SYSTEM_PROMPT.md');

export const DEFAULT_CLAUDE_MD = `# SportChat — рабочее пространство аналитика

Профессиональная роль и методология заданы системным промптом
(SYSTEM_PROMPT.md — редактируется в Настройках → Персона).
Здесь — правила работы с рабочим пространством:

- Заметки и выгрузки сохраняй в notes/ (markdown, дата в имени файла: ucl-2026-08-26.md).
- Отвечай на русском языке.
- Числа выравнивай в таблицах; избегай простыней текста.
- Факты, которые стоит помнить между разборами, добавляй сюда кратким списком.`;

export const DEFAULT_SYSTEM_PROMPT = `# РОЛЬ: главный аналитик спортивных событий SportChat

Ты — профессиональный спортивный аналитик высшего уровня. Работаешь как аналитический
отдел топового букмекера и скаутский штаб клуба одновременно: только данные, только
расчёты, ноль фантазии. Качество твоих разборов — на уровне отчётов Opta/StatsBomb
и предматчевых брифингов для тренерского штаба.

## ПРОФИЛЬ
- Виды спорта: футбол, хоккей, теннис, баскетбол, киберспорт (CS2 / Dota 2 / LoL).
- Задачи: предматчевый анализ, вероятностные модели, поиск ошибок в линии букмекера
  (value), постматчевые разборы, скаутские справки по игрокам и командам.
- Аудитория: опытный пользователь — нужны цифры и логика, а не эмоции и «верняки».

## МЕТОДОЛОГИЯ — обязательный порядок работы
1. СБОР ДАННЫХ. Перед любым разбором собери свежие факты через WebSearch/WebFetch:
   • форма: последние 5–10 матчей с счётами, соперниками и качеством оппозиции;
     домашние/выездные сплиты;
   • кадры: травмы, дисквалификации, ротация, усталость (плотность календаря, перелёты);
   • мотивация и турнирное положение: что нужно каждой стороне именно в этом матче;
   • очные встречи (H2H) за 3–5 лет с контекстом, а не просто счёта;
   • условия: стадион, покрытие, погода, судья (его статистика по карточкам/пенальти);
   • линия букмекеров: открывающая и текущая, движение.
   Указывай источник и дату по каждому блоку. Если данных нет — честно скажи
   и пометь соответствующую оценку как экспертную, а не фактическую.
2. МОДЕЛЬ. Переведи факторы в вероятности исходов в процентах. Базовые веса факторов:
   сила состава и текущая форма ≈ 40%, кадровые потери ≈ 20%, мотивация и контекст ≈ 15%,
   H2H и стилевое противостояние ≈ 10%, условия (дом/выезд, погода, усталость) ≈ 10%,
   прочее ≈ 5%. Веса адаптируй под вид спорта и конкретный матч — и объясняй, почему.
3. СРАВНЕНИЕ С ЛИНИЕЙ (если коэффициенты известны): fair odds = 100% / вероятность;
   value = P × K − 1. Показывай маржу букмекера и расхождения линии с твоей моделью.
4. ВЫВОД: сценарии развития матча, рекомендации, уровень уверенности
   (низкий / средний / высокий) и что изменит оценку (ключевые развилки).

## ПРАВИЛА ВЫВОДА
- Структура: 1) TL;DR в 3–5 строк → 2) таблицы данных → 3) разбор ключевых факторов →
  4) вероятности и сценарии → 5) итог с уверенностью.
- Вероятности взаимоисключающих исходов всегда в сумме дают 100%.
- Любые сравнения — таблицами. Ключевые выводы — жирным. Без воды и клише.
- Разделяй ФАКТЫ (со ссылкой на источник и датой) и ОЦЕНКИ (твой расчёт).
- Помни про дисперсию: один матч — шум; выводы формулируй через дистанцию и серии.
- Ставки: только value-подход; размер позиции ≤ 1–3% банка (flat); краткое напоминание
  о рисках. Слов «верняк», «гарантия», «100% железо» не существует.
- Просьба «дай гарантированный прогноз» → объясни миф о гарантированных исходах
  и дай вероятностную картину.
- Язык — русский, терминология профессионала (xG/xGA, PPDA, AST/TOV, CS%, K/D…);
  редкую метрику поясни одной фразой в скобках.

## ЖЁСТКИЕ ОГРАНИЧЕНИЯ
- Не выдумывай данные: не нашёл в источниках — так и скажи, что нужна проверка.
- Противоречия в источниках не замалчивай — показывай и объясняй, чему веришь и почему.
- Никаких «договорных» сюжетов и ссылок на «инсайды».
- 18+: ставки сопряжены с риском; при признаках проблемной игры рекомендуй паузу
  и самопроверку.`;

export const DEFAULT_SETTINGS = {
  // Модели OpenRouter: алиас "sonnet" → ox-alpha (как в глобальном конфиге пользователя).
  // Токен и BASE_URL наследуются из окружения (~/.claude/settings.json) — здесь не дублируются.
  model: 'sonnet',
  // MCP-серверы из workspace/.mcp.json подключать без интерактивного одобрения
  enableAllProjectMcpServers: true,
  env: {
    ANTHROPIC_DEFAULT_SONNET_MODEL: 'stealth/ox-alpha[1M]',
    ANTHROPIC_DEFAULT_SONNET_MODEL_NAME: 'stealth/ox-alpha',
    ANTHROPIC_DEFAULT_OPUS_MODEL: 'anthropic/claude-opus-4.8',
    ANTHROPIC_DEFAULT_HAIKU_MODEL: 'anthropic/claude-haiku-4.5',
    ANTHROPIC_MODEL: 'stealth/ox-alpha[1M]',
  },
  permissions: {
    allow: [
      'Read', 'Glob', 'Grep', 'WebSearch', 'WebFetch', 'TodoWrite',
      'NotebookRead', 'ListMcpResourcesTool', 'ReadMcpResourceTool',
    ],
    deny: [],
  },
};

export const EXAMPLE_SKILL = `---
name: match-report
description: Генерирует структурированный отчёт о матче — форма, H2H, потери, сценарии с вероятностями. Использовать при запросах "разбор матча", "отчёт о матче", "препаринг".
---

# Отчёт о матче

Собери данные через WebSearch и собери отчёт по структуре:

1. **Паспорт матча** — турнир, стадия, дата/время, стадион.
2. **Форма команд** — последние 5 матчей каждой стороны (В/Н/П), динамика.
3. **Очные встречи (H2H)** — таблица последних встреч с счётами.
4. **Кадровые потери** — травмы, дисквалификации, ротация.
5. **Тактический расклад** — схемы, ключевые противостояния, стиль игры.
6. **Статистика сезона** — xG, владение, удары, реализация моментов (таблица).
7. **Сценарии** — вероятности исходов (П1/Х/П2), тоталов и отдельных событий в %.
8. **Вывод** — итоговая рекомендация и уровень уверенности (низкий / средний / высокий).

В конце перечисли источники ссылками.
`;

function writeIfMissing(file, content) {
  if (!fs.existsSync(file)) fs.writeFileSync(file, content, 'utf8');
}

export function ensureWorkspace() {
  fs.mkdirSync(WORKSPACE, { recursive: true });
  fs.mkdirSync(SKILLS_DIR(), { recursive: true });
  fs.mkdirSync(DATA_DIR, { recursive: true });
  writeIfMissing(CLAUDE_MD_FILE(), DEFAULT_CLAUDE_MD);
  writeIfMissing(SYSTEM_PROMPT_FILE(), DEFAULT_SYSTEM_PROMPT);
  writeIfMissing(MCP_FILE(), JSON.stringify({ mcpServers: {} }, null, 2));
  writeIfMissing(SETTINGS_FILE(), JSON.stringify(DEFAULT_SETTINGS, null, 2));
  fs.mkdirSync(path.join(SKILLS_DIR(), 'match-report'), { recursive: true });
  writeIfMissing(path.join(SKILLS_DIR(), 'match-report', 'SKILL.md'), EXAMPLE_SKILL);
  writeIfMissing(SESSIONS_FILE, '[]');
}

/* ---------- sessions index ---------- */

export function readSessions() {
  try {
    return JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8'));
  } catch {
    return [];
  }
}

export function saveSession(sessionId, title, model) {
  const list = readSessions();
  const now = Date.now();
  const existing = list.find((s) => s.id === sessionId);
  if (existing) {
    existing.updatedAt = now;
    if (model) existing.model = model;
  } else {
    list.unshift({ id: sessionId, title: title || 'Разбор', model: model || null, createdAt: now, updatedAt: now });
  }
  fs.writeFileSync(SESSIONS_FILE, JSON.stringify(list, null, 2));
  return existing || list[0];
}

export function deleteSession(sessionId) {
  const list = readSessions().filter((s) => s.id !== sessionId);
  fs.writeFileSync(SESSIONS_FILE, JSON.stringify(list, null, 2));
}

export function touchSession(sessionId, patch) {
  const list = readSessions();
  const s = list.find((x) => x.id === sessionId);
  if (!s) return null;
  Object.assign(s, patch);
  fs.writeFileSync(SESSIONS_FILE, JSON.stringify(list, null, 2));
  return s;
}

/* ---------- mcp ---------- */

export function readMcp() {
  try {
    const raw = JSON.parse(fs.readFileSync(MCP_FILE(), 'utf8'));
    return raw.mcpServers && typeof raw.mcpServers === 'object' ? raw.mcpServers : {};
  } catch {
    return {};
  }
}

export function writeMcp(servers) {
  fs.writeFileSync(MCP_FILE(), JSON.stringify({ mcpServers: servers }, null, 2));
}

/** Normalize a UI-supplied server entry into a valid CLI config; returns {ok, value|error}. */
export function normalizeServer(entry) {
  if (!entry || typeof entry !== 'object') return { ok: false, error: 'Некорректное описание сервера' };
  const type = entry.type || 'stdio';
  if (type === 'http' || type === 'sse') {
    let url;
    try {
      url = new URL(String(entry.url || ''));
      if (!/^https?:$/.test(url.protocol)) throw new Error('bad protocol');
    } catch {
      return { ok: false, error: 'Некорректный URL (нужен http/https)' };
    }
    const value = { type, url: url.toString() };
    if (entry.headers && typeof entry.headers === 'object') value.headers = entry.headers;
    return { ok: true, value };
  }
  // stdio
  if (typeof entry.command !== 'string' || !entry.command.trim()) {
    return { ok: false, error: 'Для stdio-сервера нужна команда запуска' };
  }
  const value = { type: 'stdio', command: entry.command.trim() };
  if (Array.isArray(entry.args)) value.args = entry.args.map(String).filter(Boolean);
  else if (typeof entry.args === 'string' && entry.args.trim()) {
    // split respecting simple quotes
    value.args = entry.args.trim().match(/(?:[^\s"]+|"[^"]*")+/g)?.map((s) => s.replace(/^"|"$/g, '')) ?? [];
  }
  if (entry.env && typeof entry.env === 'object' && !Array.isArray(entry.env)) {
    const env = {};
    for (const [k, v] of Object.entries(entry.env)) env[k] = String(v);
    value.env = env;
  }
  return { ok: true, value };
}

/* ---------- skills ---------- */

export function readSkills() {
  const dir = SKILLS_DIR();
  const out = [];
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const file = path.join(dir, e.name, 'SKILL.md');
    if (!fs.existsSync(file)) continue;
    const content = fs.readFileSync(file, 'utf8');
    const fm = parseFrontmatter(content);
    out.push({
      name: fm.name || e.name,
      dir: e.name,
      description: fm.description || '',
      content,
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

function parseFrontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!m) return {};
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const idx = line.indexOf(':');
    if (idx > 0) meta[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return meta;
}

export function skillPath(name) {
  return path.join(SKILLS_DIR(), name, 'SKILL.md');
}

export function writeSkill(name, description, body, originalName = null) {
  const cleanName = String(name).toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);
  if (!cleanName) return { ok: false, error: 'Имя навыка: строчные латинские буквы, цифры и дефис' };
  const targetDir = path.join(SKILLS_DIR(), cleanName);
  if (originalName && originalName !== cleanName) {
    const oldDir = path.join(SKILLS_DIR(), originalName);
    if (fs.existsSync(oldDir)) fs.rmSync(oldDir, { recursive: true, force: true });
  }
  fs.mkdirSync(targetDir, { recursive: true });
  const file = `---\nname: ${cleanName}\ndescription: ${String(description || '').replace(/\n/g, ' ').slice(0, 400)}\n---\n\n${body || ''}`;
  fs.writeFileSync(skillPath(cleanName), file, 'utf8');
  return { ok: true, name: cleanName };
}

export function deleteSkill(name) {
  const dir = path.join(SKILLS_DIR(), path.basename(name));
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}

/* ---------- settings & claude.md ---------- */

export function readSettingsRaw() {
  try {
    return fs.readFileSync(SETTINGS_FILE(), 'utf8');
  } catch {
    return JSON.stringify(DEFAULT_SETTINGS, null, 2);
  }
}

export function writeSettingsRaw(text) {
  const parsed = JSON.parse(text); // throws on invalid JSON
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('settings.json должен быть объектом');
  }
  fs.writeFileSync(SETTINGS_FILE(), JSON.stringify(parsed, null, 2));
}

export function readClaudeMd() {
  try {
    return fs.readFileSync(CLAUDE_MD_FILE(), 'utf8');
  } catch {
    return DEFAULT_CLAUDE_MD;
  }
}

export function writeClaudeMd(text) {
  fs.writeFileSync(CLAUDE_MD_FILE(), String(text), 'utf8');
}

export function readSystemPrompt() {
  try {
    return fs.readFileSync(SYSTEM_PROMPT_FILE(), 'utf8');
  } catch {
    return DEFAULT_SYSTEM_PROMPT;
  }
}

export function writeSystemPrompt(text) {
  fs.writeFileSync(SYSTEM_PROMPT_FILE(), String(text), 'utf8');
}

/* ---------- plugins ---------- */

const PLUGINS_SELECTION_FILE = path.join(DATA_DIR, 'plugin-selection.json');
const USER_CLAUDE_DIR = () => path.join(os.homedir(), '.claude');
const PLUGINS_REGISTRY = () => path.join(USER_CLAUDE_DIR(), 'plugins', 'installed_plugins.json');

/** Все установленные плагины: key "name@marketplace" → installPath (приоритет scope=user). */
export function readInstalledPlugins() {
  try {
    const reg = JSON.parse(fs.readFileSync(PLUGINS_REGISTRY(), 'utf8'));
    const out = [];
    for (const [key, installs] of Object.entries(reg.plugins || {})) {
      const user = (installs || []).find((i) => i.scope === 'user') || (installs || [])[0];
      if (!user?.installPath) continue;
      const at = key.indexOf('@');
      out.push({
        key,
        name: key.slice(0, at),
        marketplace: key.slice(at + 1),
        path: user.installPath,
        exists: fs.existsSync(user.installPath),
      });
    }
    return out.sort((a, b) => a.key.localeCompare(b.key));
  } catch {
    return [];
  }
}

/** enabledPlugins из глобального ~/.claude/settings.json. */
export function readUserEnabledPlugins() {
  try {
    const s = JSON.parse(fs.readFileSync(path.join(USER_CLAUDE_DIR(), 'settings.json'), 'utf8'));
    return s.enabledPlugins && typeof s.enabledPlugins === 'object' ? s.enabledPlugins : {};
  } catch {
    return {};
  }
}

/** Выбор плагинов для SportChat (по умолчанию — как в глобальном конфиге). */
export function readPluginSelection() {
  try {
    const sel = JSON.parse(fs.readFileSync(PLUGINS_SELECTION_FILE, 'utf8'));
    if (Array.isArray(sel)) return sel;
  } catch { /* нет файла — берём глобальные */ }
  return Object.entries(readUserEnabledPlugins())
    .filter(([, on]) => on === true)
    .map(([k]) => k);
}

export function writePluginSelection(keys) {
  fs.writeFileSync(PLUGINS_SELECTION_FILE, JSON.stringify([...new Set(keys)], null, 2));
}

/** Пути установленных плагинов для SDK options.plugins. */
export function resolvePluginPaths(keys) {
  const installed = readInstalledPlugins();
  const byKey = new Map(installed.map((p) => [p.key, p]));
  return keys
    .map((k) => byKey.get(k))
    .filter((p) => p && p.exists)
    .map((p) => ({ type: 'local', path: p.path }));
}

/** Каталог магазина: все известные маркетплейсы и их плагины. */
export function readPluginStore() {
  const dir = path.join(USER_CLAUDE_DIR(), 'plugins', 'marketplaces');
  const out = [];
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const file = path.join(dir, e.name, '.claude-plugin', 'marketplace.json');
    if (!fs.existsSync(file)) continue;
    try {
      const j = JSON.parse(fs.readFileSync(file, 'utf8'));
      out.push({
        marketplace: j.name || e.name,
        dir: e.name,
        plugins: (j.plugins || []).map((p) => ({
          name: p.name,
          description: p.description || '',
          category: p.category || '',
          homepage: p.homepage || '',
        })),
      });
    } catch { /* битый каталог пропускаем */ }
  }
  return out;
}

/* ---------- transcript replay ---------- */

export function findTranscriptFile(sessionId) {
  const projectsRoot = path.join(os.homedir(), '.claude', 'projects');
  if (!fs.existsSync(projectsRoot)) return null;
  const enc = WORKSPACE.replace(/[^A-Za-z0-9]/g, '-');
  const candidates = [path.join(projectsRoot, enc, `${sessionId}.jsonl`)];
  candidates.push(...fs.readdirSync(projectsRoot)
    .filter((d) => d.endsWith('SportChat-workspace'))
    .map((d) => path.join(projectsRoot, d, `${sessionId}.jsonl`)));
  for (const f of candidates) {
    if (fs.existsSync(f)) return f;
  }
  return null;
}

/** Simplified transcript of a stored session for replay in the chat UI. */
export function readTranscript(sessionId) {
  const file = findTranscriptFile(sessionId);
  if (!file) return null;
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
  const items = [];
  let firstUserText = '';
  for (const line of lines) {
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    if (obj.isSidechain || obj.isMeta) continue;
    if (obj.type === 'summary') continue;
    if (obj.type !== 'user' && obj.type !== 'assistant') continue;
    const msg = obj.message;
    if (!msg) continue;
    const content = Array.isArray(msg.content)
      ? msg.content
      : (typeof msg.content === 'string' ? [{ type: 'text', text: msg.content }] : []);
    if (obj.type === 'user') {
      const texts = content.filter((b) => b.type === 'text').map((b) => b.text || '').join('\n').trim();
      const hasToolResult = content.some((b) => b.type === 'tool_result');
      if (texts && !hasToolResult) {
        items.push({ role: 'user', text: texts });
        if (!firstUserText) firstUserText = texts.slice(0, 80);
      }
      continue;
    }
    // assistant
    const text = content.filter((b) => b.type === 'text').map((b) => b.text || '').join('\n').trim();
    const tools = content.filter((b) => b.type === 'tool_use').map((b) => ({ id: b.id, name: b.name }));
    if (text || tools.length) {
      const last = items[items.length - 1];
      if (last && last.role === 'ai') {
        if (tools.length) last.tools.push(...tools);
        if (text) last.parts.push(text);
      } else {
        items.push({ role: 'ai', parts: text ? [text] : [], tools });
      }
    }
  }
  return {
    title: firstUserText || 'Разбор',
    items: items.map((it) => it.role === 'ai'
      ? { role: 'ai', text: it.parts.join('\n\n'), tools: it.tools }
      : it),
  };
}
