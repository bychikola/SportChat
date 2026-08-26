import express from 'express';
import fs from 'node:fs';
import { execFile } from 'node:child_process';
import {
  WORKSPACE, readSessions, deleteSession, readTranscript,
  readMcp, writeMcp, normalizeServer,
  readSkills, writeSkill, deleteSkill,
  readSettingsRaw, writeSettingsRaw, readClaudeMd, writeClaudeMd,
  readSystemPrompt, writeSystemPrompt,
  readProviders, writeProviders,
  readInstalledPlugins, readUserEnabledPlugins, readPluginSelection,
  writePluginSelection, readPluginStore,
} from './store.js';

const router = express.Router();

/* ---------- meta & sessions ---------- */

router.get('/meta', (req, res) => {
  res.json({
    workspace: WORKSPACE,
    sdkVersion: JSON.parse(fs.readFileSync(new URL('../node_modules/@anthropic-ai/claude-agent-sdk/package.json', import.meta.url), 'utf8')).version,
  });
});

router.get('/sessions', (req, res) => {
  res.json(readSessions());
});

router.delete('/sessions/:id', (req, res) => {
  deleteSession(req.params.id);
  res.json({ ok: true });
});

router.get('/sessions/:id/transcript', (req, res) => {
  const data = readTranscript(req.params.id);
  if (!data) return res.status(404).json({ error: 'История сессии не найдена' });
  res.json(data);
});

/* ---------- MCP servers ---------- */

router.get('/config/mcp', (req, res) => {
  const servers = readMcp();
  res.json(Object.entries(servers).map(([name, cfg]) => ({ name, ...cfg })));
});

router.put('/config/mcp/:name', (req, res) => {
  const name = String(req.params.name || '').trim();
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(name)) {
    return res.status(400).json({ error: 'Имя сервера: латиница, цифры, дефис, до 64 символов' });
  }
  const norm = normalizeServer(req.body);
  if (!norm.ok) return res.status(400).json({ error: norm.error });
  const servers = readMcp();
  servers[name] = norm.value;
  writeMcp(servers);
  res.json({ ok: true, name, value: norm.value });
});

router.delete('/config/mcp/:name', (req, res) => {
  const servers = readMcp();
  if (!(req.params.name in servers)) return res.status(404).json({ error: 'Сервер не найден' });
  delete servers[req.params.name];
  writeMcp(servers);
  res.json({ ok: true });
});

/* ---------- Skills ---------- */

router.get('/config/skills', (req, res) => res.json(readSkills()));

router.post('/config/skills', (req, res) => {
  const { name, description, content, originalName } = req.body || {};
  const result = writeSkill(name, description, content, originalName || null);
  if (!result.ok) return res.status(400).json({ error: result.error });
  res.json({ ok: true, name: result.name });
});

router.delete('/config/skills/:dir', (req, res) => {
  deleteSkill(req.params.dir);
  res.json({ ok: true });
});

/* ---------- Plugins ---------- */

router.get('/config/plugins', (req, res) => {
  res.json({
    installed: readInstalledPlugins(),
    userEnabled: readUserEnabledPlugins(),
    selection: readPluginSelection(),
  });
});

router.put('/config/plugins', (req, res) => {
  const sel = req.body?.selection;
  if (!Array.isArray(sel)) return res.status(400).json({ error: 'Нужен массив selection' });
  const valid = new Set(readInstalledPlugins().map((p) => p.key));
  writePluginSelection(sel.filter((k) => valid.has(k)));
  res.json({ ok: true, selection: readPluginSelection() });
});

router.get('/plugins/store', (req, res) => {
  res.json(readPluginStore());
});

/* ---------- Providers (источники моделей) ---------- */

const BUILTIN_PROVIDERS = {
  openrouter: {
    type: 'openrouter', label: 'OpenRouter',
    baseURL: 'https://openrouter.ai/api', apiKey: '',
  },
  deepseek: {
    type: 'deepseek', label: 'DeepSeek',
    baseURL: 'https://api.deepseek.com/anthropic', apiKey: '',
  },
};

function ensureBuiltins(data) {
  for (const [key, def] of Object.entries(BUILTIN_PROVIDERS)) {
    if (!data.providers[key]) data.providers[key] = { ...def };
  }
  return data;
}

/** Маскируем ключи — наружу отдаём только признак наличия и хвост. */
function sanitize(data) {
  const providers = {};
  for (const [key, p] of Object.entries(data.providers)) {
    providers[key] = {
      type: p.type || 'custom',
      label: p.label || key,
      baseURL: p.baseURL || '',
      hasKey: !!p.apiKey,
      keyHint: p.apiKey ? `…${p.apiKey.slice(-4)}` : '',
      models: Array.isArray(p.models) ? p.models : [],
    };
  }
  return { active: data.active, providers };
}

router.get('/providers', (req, res) => {
  res.json(sanitize(ensureBuiltins(readProviders())));
});

router.put('/providers/:key', (req, res) => {
  const key = String(req.params.key || '').trim();
  if (!/^[a-z0-9][a-z0-9_-]{0,40}$/i.test(key)) {
    return res.status(400).json({ error: 'Недопустимое имя источника' });
  }
  const data = ensureBuiltins(readProviders());
  const prev = data.providers[key] || {};
  const b = req.body || {};
  const next = {
    type: b.type || prev.type || (key === 'openrouter' ? 'openrouter' : key === 'deepseek' ? 'deepseek' : 'custom'),
    label: b.label || prev.label || key,
    baseURL: typeof b.baseURL === 'string' && b.baseURL.trim() ? b.baseURL.trim().replace(/\/+$/, '') : prev.baseURL || '',
    apiKey: typeof b.apiKey === 'string' ? b.apiKey.trim() : prev.apiKey || '',
    models: Array.isArray(b.models) ? b.models.map(String).slice(0, 200) : prev.models || [],
  };
  if (!next.baseURL && next.type !== 'openrouter' && next.type !== 'deepseek') {
    return res.status(400).json({ error: 'Нужен baseURL источника' });
  }
  data.providers[key] = next;
  writeProviders(data);
  res.json({ ok: true, providers: sanitize(data).providers });
});

router.delete('/providers/:key', (req, res) => {
  const key = req.params.key;
  if (key in BUILTIN_PROVIDERS) return res.status(400).json({ error: 'Встроенный источник нельзя удалить' });
  const data = ensureBuiltins(readProviders());
  delete data.providers[key];
  if (data.active.provider === key) data.active = { provider: 'config', model: '' };
  writeProviders(data);
  res.json({ ok: true });
});

router.put('/providers-active', (req, res) => {
  const { provider, model } = req.body || {};
  if (provider !== 'config') {
    const data = ensureBuiltins(readProviders());
    if (!data.providers[provider]) return res.status(404).json({ error: 'Источник не найден' });
    data.active = { provider, model: String(model || '').slice(0, 200) };
    writeProviders(data);
  } else {
    const data = readProviders();
    data.active = { provider: 'config', model: '' };
    writeProviders(data);
  }
  res.json({ ok: true, active: readProviders().active });
});

/** Живой список моделей из API источника. */
router.post('/providers/:key/models', async (req, res) => {
  const data = ensureBuiltins(readProviders());
  const prov = data.providers[req.params.key];
  if (!prov) return res.status(404).json({ error: 'Источник не найден' });
  if (!prov.apiKey && prov.type !== 'openrouter') {
    return res.status(400).json({ error: 'Сначала сохрани API-ключ источника' });
  }
  try {
    const models = await fetchModelList(prov);
    if (!models.length) {
      return res.status(502).json({ error: 'Источник не вернул список моделей — добавь модели вручную в JSON' });
    }
    res.json({ models });
  } catch (e) {
    res.status(502).json({ error: `Не удалось получить список: ${e.message}` });
  }
});

/** Разбор произвольного источника из JSON. */
router.post('/providers-custom', (req, res) => {
  let cfg;
  try {
    cfg = typeof req.body?.json === 'string' ? JSON.parse(req.body.json) : req.body?.json;
  } catch {
    return res.status(400).json({ error: 'Некорректный JSON' });
  }
  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) {
    return res.status(400).json({ error: 'JSON должен быть объектом' });
  }
  if (typeof cfg.baseURL !== 'string' || !cfg.baseURL.trim()) {
    return res.status(400).json({ error: 'В JSON нужно поле "baseURL"' });
  }
  let slug = String(cfg.name || 'custom')
    .toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'custom';
  const data = ensureBuiltins(readProviders());
  let key = slug;
  let i = 2;
  while (data.providers[key]) key = `${slug}-${i++}`;
  data.providers[key] = {
    type: 'custom',
    label: String(cfg.label || cfg.name || key).slice(0, 60),
    baseURL: cfg.baseURL.trim().replace(/\/+$/, ''),
    apiKey: String(cfg.apiKey || ''),
    models: Array.isArray(cfg.models) ? cfg.models.map(String).slice(0, 200) : [],
  };
  writeProviders(data);
  res.json({ ok: true, key, providers: sanitize(data).providers });
});

async function fetchModelList(prov) {
  const headers = {};
  if (prov.apiKey) headers.Authorization = `Bearer ${prov.apiKey}`;
  const urls = [];
  if (prov.type === 'openrouter') {
    urls.push('https://openrouter.ai/api/v1/models');
  } else if (prov.type === 'deepseek') {
    urls.push('https://api.deepseek.com/models');
  } else {
    const base = String(prov.baseURL || '').replace(/\/+$/, '');
    urls.push(`${base}/v1/models`, `${base}/models`);
  }
  for (const url of urls) {
    try {
      const r = await fetch(url, { headers, signal: AbortSignal.timeout(15_000) });
      if (!r.ok) continue;
      const j = await r.json();
      const arr = Array.isArray(j) ? j : j.data || j.models || [];
      const models = arr
        .map((m) => (typeof m === 'string' ? { id: m } : { id: m.id || m.name, name: m.name || m.id }))
        .filter((m) => m.id)
        .sort((a, b) => a.id.localeCompare(b.id));
      if (models.length) return models;
    } catch { /* пробуем следующий вариант URL */ }
  }
  if (prov.type === 'deepseek' && !prov.apiKey) {
    return [{ id: 'deepseek-chat' }, { id: 'deepseek-reasoner' }];
  }
  return (prov.models || []).map((id) => ({ id }));
}

/* ---------- CLAUDE.md & settings.json ---------- */

router.get('/config/claude-md', (req, res) => res.type('text/plain').send(readClaudeMd()));
router.put('/config/claude-md', (req, res) => {
  try {
    writeClaudeMd(req.body?.text ?? '');
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) });
  }
});

router.get('/config/system-prompt', (req, res) => res.type('text/plain').send(readSystemPrompt()));
router.put('/config/system-prompt', (req, res) => {
  try {
    writeSystemPrompt(req.body?.text ?? '');
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) });
  }
});

router.get('/config/settings', (req, res) => res.type('text/plain').send(readSettingsRaw()));
router.put('/config/settings', (req, res) => {
  try {
    writeSettingsRaw(req.body?.text ?? '{}');
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: `Некорректный JSON: ${e.message}` });
  }
});

/* ---------- CLI console (non-interactive claude commands) ---------- */

const CLI_FORBIDDEN = /[;&|`$><%^!\r\n"]/;

/** Tokenize a validated command line into argv (quote-aware, no shell involved afterwards). */
function tokenize(cmdLine) {
  const tokens = [];
  const re = /(?:[^\s"]+|"[^"]*")+/g;
  for (const match of cmdLine.match(re) || []) {
    tokens.push(match.replace(/^"|"$/g, ''));
  }
  return tokens;
}

router.post('/cli/run', (req, res) => {
  const cmd = String(req.body?.command || '').trim().replace(/\s+/g, ' ');
  if (!cmd) return res.status(400).json({ error: 'Пустая команда' });
  if (!/^claude(\s|$)/.test(cmd)) {
    return res.status(400).json({ error: 'Разрешены только команды, начинающиеся с "claude" — например: claude mcp list' });
  }
  if (CLI_FORBIDDEN.test(cmd)) {
    return res.status(400).json({ error: 'Кавычки, цепочки команд и спецсимволы запрещены' });
  }
  const [, ...args] = tokenize(cmd);
  // windowsShim: on Windows `claude` is usually claude.cmd — needs shell to launch,
  // but every argument was individually validated above (no metacharacters allowed).
  execFile('claude', args, {
    cwd: WORKSPACE,
    timeout: 90_000,
    maxBuffer: 1024 * 512,
    shell: process.platform === 'win32',
    windowsHide: true,
  }, (err, stdout, stderr) => {
    res.json({
      ok: !err,
      code: err && typeof err.code === 'number' ? err.code : err ? 1 : 0,
      stdout: (stdout || '').slice(-20_000),
      stderr: (stderr || '').slice(-8_000),
    });
  });
});

export default router;
