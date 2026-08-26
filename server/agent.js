import { query } from '@anthropic-ai/claude-agent-sdk';
import { WORKSPACE, readMcp, saveSession, resolvePluginPaths, readSystemPrompt, readProviders } from './store.js';

const PERM_TIMEOUT_MS = 180_000;

/** Запрос-догонялка: шлюз вернул пустой финал после инструментов. */
const NUDGE_PROMPT = 'Продолжи. Дай финальный текстовый ответ на последний вопрос пользователя, следуя своему формату вывода (резюме → таблицы → разбор → итог с уверенностью). Не вызывай инструменты без необходимости.';


/** Tools that never require a permission prompt on top of settings-file rules. */
const SILENT_SAFE = new Set([
  'Read', 'Glob', 'Grep', 'WebSearch', 'TodoWrite',
  'NotebookRead', 'ListMcpResourcesTool', 'ReadMcpResourceTool',
]);

export class ChatConnection {
  constructor(ws) {
    this.ws = ws;
    this.busy = false;
    this.abort = null;
    this.sessionId = null;
    this.allowedThisSession = new Set();
    this.pendingPerms = new Map(); // toolUseID -> resolve
  }

  send(obj) {
    if (process.env.SPORTCHAT_DEBUG) console.log('[ws-out]', obj.t, obj.kind || obj.subtype || '');
    if (this.ws.readyState === 1) this.ws.send(JSON.stringify(obj));
  }

  /* ---------- incoming WS messages ---------- */

  handleMessage(msg) {
    switch (msg.t) {
      case 'chat':
        if (this.busy) return this.send({ t: 'busy' });
        this.run(msg).catch((e) => this.send({ t: 'error', message: String(e?.message || e) }));
        break;
      case 'stop':
        this.stop();
        break;
      case 'permission_response': {
        const resolve = this.pendingPerms.get(msg.id);
        if (resolve) {
          this.pendingPerms.delete(msg.id);
          resolve(msg);
        }
        break;
      }
      default:
        break;
    }
  }

  stop() {
    if (this.abort) this.abort.abort();
    for (const [id, resolve] of this.pendingPerms) {
      resolve({ action: 'deny' });
      this.pendingPerms.delete(id);
    }
  }

  close() {
    this.ws = null;
    if (this.busy) {
      // ход дорабатывает и сохранится в историю, даже если вкладку закрыли/обновили
      for (const [id, resolve] of this.pendingPerms) {
        resolve({ action: 'deny' });
        this.pendingPerms.delete(id);
      }
      return;
    }
    this.stop();
  }

  /* ---------- the agent run ---------- */

  async run({ text, sessionId, model, permissionMode, includeUserSettings, plugins }) {
    this.busy = true;
    this.abort = new AbortController();
    const isNew = !sessionId;

    try {
      const options = {
        cwd: WORKSPACE,
        // project + local: CLAUDE.md, .claude/settings.json, .claude/skills, .mcp.json
        settingSources: includeUserSettings ? ['user', 'project', 'local'] : ['project', 'local'],
        // штатный промпт Claude Code + профессиональная роль аналитика (SYSTEM_PROMPT.md)
        systemPrompt: { type: 'preset', preset: 'claude_code', append: readSystemPrompt() },
        includePartialMessages: true,
        permissionMode: permissionMode || 'default',
        abortController: this.abort,
        stderr: (data) => {
          const line = data.trim();
          if (line) this.send({ t: 'stderr', v: line.slice(0, 500) });
        },
        mcpServers: {}, // real servers come from workspace/.mcp.json via settingSources
        canUseTool: this.makePermissionHandler(),
      };
      // «Полный доступ» — эквивалент claude --dangerously-skip-permissions
      if (options.permissionMode === 'bypassPermissions') {
        options.allowDangerouslySkipPermissions = true;
      }
      // Локальные плагины, выбранные в панели «Плагины»
      const pluginPaths = resolvePluginPaths(Array.isArray(plugins) ? plugins : []);
      if (pluginPaths.length) options.plugins = pluginPaths;

      // Активный источник моделей: перекрываем base URL и ключ процесса CLI
      const { active, providers } = readProviders();
      if (active.provider && active.provider !== 'config') {
        const prov = providers[active.provider];
        if (prov?.baseURL && prov?.apiKey) {
          options.env = {
            ...process.env,
            ANTHROPIC_BASE_URL: prov.baseURL,
            ANTHROPIC_AUTH_TOKEN: prov.apiKey,
            ANTHROPIC_API_KEY: prov.apiKey,
          };
          if (active.model) options.model = active.model;
        } else {
          this.send({ t: 'stderr', v: `Источник «${active.provider}» не настроен (нет ключа) — используется конфиг workspace` });
        }
      } else if (model && model !== 'default') {
        // Алиасы (sonnet/opus/haiku) резолвит сам CLI через env-маппинги пользователя —
        // не навязываем их, иначе конфликт с текущим шлюзом (DeepSeek/OpenRouter/…).
        // Явные полные id (с «/» или deepseek-*) передаём как есть.
        if (model.includes('/') || /^deepseek-/i.test(model)) {
          options.model = model;
        }
      }
      if (sessionId) options.resume = sessionId;

      const turnStart = Date.now();
      // текст сообщения в логи НЕ пишем — это PII пользователя, только длину
      console.log(`[turn] старт: длина=${text.length} session=${sessionId || 'новый'} mode=${options.permissionMode}`);

      const first = await this.consume(text, options, false);

      // Некоторые шлюзы (OpenRouter) иногда завершают ход ПУСТЫМ финальным
      // сообщением после инструментов. Просим модель продолжить — один раз.
      const needNudge = first.result?.subtype === 'success'
        && !first.sawText && first.usedTools
        && !this.abort.signal.aborted;

      if (needNudge && this.sessionId) {
        console.log('[turn] пустой финал после инструментов — догенерация');
        this.send({ t: 'nudge' });
        await this.consume(NUDGE_PROMPT, { ...options, resume: this.sessionId }, true);
      }

      if (this.sessionId) {
        saveSession(this.sessionId, text.slice(0, 80), model && model !== 'default' ? model : null);
      }
      const secs = ((Date.now() - turnStart) / 1000).toFixed(1);
      console.log(`[turn] завершён за ${secs}с, текст=${first.sawText ? 'да' : 'НЕТ'}, инструменты=${first.usedTools ? 'да' : 'нет'}, subtype=${first.result?.subtype || '?'}`);
      this.send({ t: 'done', stopped: false });
    } catch (err) {
      const aborted = this.abort?.signal.aborted ||
        /abort/i.test(String(err?.name)) || /abort/i.test(String(err?.message));
      if (aborted) {
        if (this.sessionId) saveSession(this.sessionId, text.slice(0, 80), null);
        console.log('[turn] прерван пользователем');
        this.send({ t: 'done', stopped: true });
      } else {
        console.error('[turn] ОШИБКА:', sanitizeLog(err?.message?.slice(0, 300)));
        this.send({ t: 'error', message: cleanError(err) });
        this.send({ t: 'done', stopped: false, failed: true });
      }
    } finally {
      this.busy = false;
      this.abort = null;
    }
  }

  /**
   * Прогоняет один query() и пересылает все события в браузер.
   * Возвращает {sawText, usedTools, result} — для детекта пустого ответа.
   */
  async consume(promptText, options, nudged) {
    const state = { sawText: false, usedTools: false, result: null };
    const q = query({ prompt: promptText, options });

    for await (const m of q) {
      if (process.env.SPORTCHAT_DEBUG) console.log('[agent-msg]', m.type, m.subtype || '', m.error || '');
      switch (m.type) {
        case 'system':
          if (m.subtype === 'init') {
            this.sessionId = m.session_id;
            this.send({
              t: 'init',
              sessionId: m.session_id,
              version: m.claude_code_version,
              model: m.model,
              tools: m.tools || [],
              mcpServers: m.mcp_servers || [],
              skills: m.skills || [],
              slashCommands: m.slash_commands || [],
              plugins: m.plugins || [],
              permissionMode: m.permissionMode,
            });
          }
          break;

        case 'stream_event':
          if (this.handleStreamEvent(m) === 'text') state.sawText = true;
          break;

        case 'assistant':
          if (m.error) {
            this.send({ t: 'error', message: `Ошибка агента: ${m.error}` });
            break;
          }
          for (const block of m.message?.content || []) {
            if (block.type === 'text') {
              if (block.text?.trim()) state.sawText = true;
              this.send({ t: 'text_final', v: block.text });
            } else if (block.type === 'thinking') {
              this.send({ t: 'thinking_final' });
            } else if (block.type === 'tool_use') {
              state.usedTools = true;
              this.send({ t: 'tool_final', id: block.id, name: block.name, input: block.input ?? {} });
            }
          }
          break;

        case 'user': {
          const content = Array.isArray(m.message?.content) ? m.message.content : [];
          for (const block of content) {
            if (block.type === 'tool_result') {
              this.send({
                t: 'tool_result',
                id: block.tool_use_id,
                isError: !!block.is_error,
                preview: summarizeContent(block.content),
              });
            }
          }
          break;
        }

        case 'tool_progress':
          this.send({ t: 'tool_progress', id: m.tool_use_id, elapsed: m.elapsed_time_seconds });
          break;

        case 'result':
          state.result = m;
          this.send({
            t: 'result',
            subtype: m.subtype,
            isError: !!m.is_error,
            durationMs: m.duration_ms,
            numTurns: m.num_turns,
            costUsd: m.total_cost_usd ?? null,
            usage: m.usage ? { input: m.usage.input_tokens, output: m.usage.output_tokens } : null,
            errors: m.errors || [],
            nudged: !!nudged,
          });
          break;

        default:
          break;
      }
    }
    return state;
  }

  handleStreamEvent(m) {
    const ev = m.event;
    if (!ev) return;
    switch (ev.type) {
      case 'content_block_start': {
        const b = ev.content_block;
        if (b.type === 'tool_use') {
          this.send({ t: 'block_start', kind: 'tool', id: b.id, name: b.name, index: ev.index });
        } else if (b.type === 'text') {
          this.send({ t: 'block_start', kind: 'text', index: ev.index });
        } else if (b.type === 'thinking') {
          this.send({ t: 'block_start', kind: 'thinking', index: ev.index });
        }
        break;
      }
      case 'content_block_delta': {
        const d = ev.delta;
        const idx = ev.index;
        if (d.type === 'text_delta') {
          this.send({ t: 'text_delta', v: d.text, index: idx });
          return 'text';
        }
        if (d.type === 'thinking_delta') this.send({ t: 'thinking_delta', v: d.thinking, index: idx });
        else if (d.type === 'input_json_delta') this.send({ t: 'tool_input_delta', v: d.partial_json, index: idx });
        break;
      }
      case 'message_delta':
        if (ev.delta?.stop_reason) this.send({ t: 'stop_reason', reason: ev.delta.stop_reason });
        if (ev.usage?.output_tokens != null) this.send({ t: 'usage_out', tokens: ev.usage.output_tokens });
        break;
      default:
        break;
    }
  }

  /** canUseTool callback — routes prompts to the browser as approval cards. */
  makePermissionHandler() {
    return async (toolName, input, ctx) => {
      if (SILENT_SAFE.has(toolName) || this.allowedThisSession.has(toolName)) {
        return { behavior: 'allow', updatedInput: input };
      }
      const id = ctx?.toolUseID || `perm_${Math.random().toString(36).slice(2)}`;
      const decision = await new Promise((resolve) => {
        this.pendingPerms.set(id, resolve);
        this.send({ t: 'permission_request', id, tool: toolName, input });
        const timer = setTimeout(() => {
          if (this.pendingPerms.has(id)) {
            this.pendingPerms.delete(id);
            resolve({ action: 'timeout' });
          }
        }, PERM_TIMEOUT_MS);
        ctx?.signal?.addEventListener('abort', () => {
          clearTimeout(timer);
          if (this.pendingPerms.has(id)) {
            this.pendingPerms.delete(id);
            resolve({ action: 'aborted' });
          }
        }, { once: true });
      });

      if (decision.action === 'allow_always') {
        this.allowedThisSession.add(toolName);
        return { behavior: 'allow', updatedInput: input };
      }
      if (decision.action === 'allow_once') {
        return { behavior: 'allow', updatedInput: decision.updatedInput || input };
      }
      const reason = decision.action === 'timeout'
        ? 'SportChat: время на подтверждение истекло'
        : 'SportChat: действие отклонено пользователем';
      return { behavior: 'deny', message: reason, interrupt: false };
    };
  }
}

function summarizeContent(content) {
  let text = '';
  if (typeof content === 'string') text = content;
  else if (Array.isArray(content)) {
    text = content
      .map((b) => (b.type === 'text' ? b.text : b.type === 'image' ? '[изображение]' : `[${b.type}]`))
      .join('\n');
  } else if (content) text = JSON.stringify(content);
  text = text.trim();
  if (text.length > 4000) text = `${text.slice(0, 4000)}\n… (обрезано)`;
  return text || '(пусто)';
}

/** Маскируем ключи/токены/query-строки, прежде чем писать в логи. */
function sanitizeLog(s) {
  return String(s ?? '')
    .replace(/sk-or-v1-[A-Za-z0-9]+/g, 'sk-or-v1-***')
    .replace(/sk-[A-Za-z0-9]{8,}/g, 'sk-***')
    .replace(/(Bearer\s+)[A-Za-z0-9._-]+/gi, '$1***')
    .replace(/[?&][^\s"'<>]+/g, '?***');
}

function cleanError(err) {
  const raw = String(err?.message || err);
  if (/not authenticated|API key|login/i.test(raw)) {
    return 'Claude Code не авторизован. Запусти в терминале `claude` и войди в аккаунт.';
  }
  if (/ECONNREFUSED|fetch failed|network/i.test(raw)) {
    return 'Сетевая ошибка при обращении к API. Проверь подключение к интернету.';
  }
  if (/exited with code 1/i.test(raw)) {
    return 'Claude Code завершился с ошибкой: вероятно, модель не поддерживается текущим шлюзом или исчерпан баланс ключа. Проверь «источник моделей» на табло (например: DeepSeek-шлюз принимает только deepseek-v4-pro / deepseek-v4-flash).';
  }
  return raw.slice(0, 800);
}
