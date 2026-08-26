import express from 'express';
import fs from 'node:fs';
import { execFile } from 'node:child_process';
import {
  WORKSPACE, readSessions, deleteSession, readTranscript,
  readMcp, writeMcp, normalizeServer,
  readSkills, writeSkill, deleteSkill,
  readSettingsRaw, writeSettingsRaw, readClaudeMd, writeClaudeMd,
  readSystemPrompt, writeSystemPrompt,
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
