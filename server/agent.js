import { query } from '@anthropic-ai/claude-agent-sdk';
import { WORKSPACE, readMcp, saveSession, resolvePluginPaths, readSystemPrompt, readProviders } from './store.js';

const PERM_TIMEOUT_MS = 180_000;

/** Запрос-догонялка: шлюз вернул пустой финал после инструментов. */
const NUDGE_PROMPT = 'Продолжи. Дай финальный текстовый ответ на последний вопрос пользователя, следуя своему формату вывода (резюме → таблицы → разбор → итог с уверенностью). Не вызывай инструменты без необходимости.';

/** Текущие дата/время для промптов — модель сама время не знает. */
function nowLine() {
  const s = new Intl.DateTimeFormat('ru-RU', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow',
  }).format(new Date());
  return `Текущие дата и время: ${s} (московское). Время матчей в sstats — тоже московское.`;
}

/** Конвейер субагентов (вызываются главном агентом через Task).
 *  Время подставляется на каждый запуск — agents строятся в run(). */
function buildAgents() {
  const T = nowLine();
  return {
    pool: {
      description: 'Этап 1 конвейера прогнозов: собирает пул ПРЕДСТОЯЩИХ матчей под запрос (дата, лиги, команды) через sstats и отсекает начавшиеся/завершённые. Вызывать первым.',
      tools: ['mcp__sstats__sstats_search_matches', 'mcp__sstats__sstats_leagues', 'mcp__sstats__pari_matches'],
      prompt: `Ты — сборщик пула матчей для спортивного аналитика.
${T}
ЗАДАЧА: по запросу собрать пул матчей для анализа — только предстоящие.
ПРАВИЛА (нарушать нельзя):
1. Вызывай sstats_search_matches с upcoming: true (плюс date/from-to из запроса; если дата не указана — сегодня и завтра).
2. Сверяй время начала каждого матча с текущим: матчи, которые уже начались или завершились, в пул НЕ включай — даже если пользователь назвал эту дату.
3. Верни компактно: для каждого матча — id, «Хозяева — Гости», лига, время (МСК), статус, кэфы 1X2 и ТБ/ТМ 2.5 если есть. До 40 матчей, по времени.
4. Если подходящих матчей нет — верни «ПУЛ ПУСТ: <причина>» и одной строкой ближайшие альтернативы (другая дата/лига).
НИЧЕГО не анализируй и не рекомендуй — только пул.`,
    },
    scout: {
      description: 'Этап 2 конвейера: из пула выбирает достойные матчи и собирает факты — форма, кадры, мотивация, новости. Вызывать после pool.',
      tools: ['WebSearch', 'WebFetch', 'mcp__sstats__sstats_match_preview_stats', 'mcp__sstats__sstats_missing_players', 'mcp__sstats__sstats_get_match'],
      prompt: `Ты — скаут-аналитик SportChat.
${T}
Тебе дадут пул предстоящих матчей (id, команды, время, кэфы). ЗАДАЧА: отобрать достойные для прогноза (обычно 4–8) и собрать факты.
1. Отбор: топ-лиги и кэфы 1.15–3.5 в приоритете; кубки молодняка и товарки — только если пул беден.
2. По каждому выбранному: sstats_match_preview_stats (форма, забито/пропущено), sstats_missing_players (кадры); WebSearch — только по 1–2 ключевым матчам (новости, ротация, мотивация), не по всем.
3. Верни по каждому матчу: id, «Хозяева — Гости», время, кэф, 3–5 строк фактов (форма 5 матчей со счётами, пропускающие, мотивация). Без выводов и ставок — только факты.`,
    },
    markets: {
      description: 'Этап 3 конвейера: по шорт-листу анализирует ВСЕ рынки (тоталы, форы, обе забьют, угловые) и готовит заготовки ног. Вызывать после scout.',
      tools: ['mcp__sstats__sstats_match_preview_stats', 'mcp__sstats__sstats_match_odds', 'mcp__sstats__sstats_get_match', 'mcp__sstats__pari_matches', 'mcp__sstats__pari_match', 'mcp__sstats__pari_market_types', 'mcp__sstats__pari_odds_history'],
      prompt: `Ты — маркет-аналитик SportChat (рынки и линии).
${T}
Тебе дадут шорт-лист матчей с фактами формы. ЗАДАЧА: разобрать рынки, а не только победы.
1. sstats_match_odds для каждого матча: 1X2, тоталы 1.5/2.5/3.5, форы, обе забьют, индивидуальные тоталы, угловые (если есть).
2. По каждому матчу предложи 2–4 лучших варианта ног: рынок (по-русски), кэф, вероятность по фактам, value = P×K−1.
3. Используй разные типы рынков: двойной шанс, минусовая фора фаворита, индивидуальный тотал, ТБ/ТМ — по наилучшему value, а не по привычке к П1.
4. Верни таблицей: матч | id | рынок | кэф | P модели | value | комментарий ≤5 слов. Без итогового прогноза — только заготовки ног.`,
    },
    composer: {
      description: 'Этап 4 конвейера: собирает из данных конвейера готовый прогноз/экспресс в формате аналитика SportChat. Вызывать после markets.',
      tools: [],
      prompt: `Ты — составитель прогноза SportChat.
Тебе дадут: запрос пользователя, пул матчей (со временем и id), факты скаута и заготовки ног маркет-аналитика. ЗАДАЧА: собрать итоговый ответ по формату ниже.
1. СНАЧАЛА прогноз: одиночная ставка («Ставка: <рынок> @ <кэф>») или «ЭКСПРЕСС <итоговый кэф>x» со списком ног «<Матч> — <рынок по-русски> @ <кэф> — почему в 3–7 слов». Итог: произведение кэфов, вероятность захода одной цифрой, выплата с суммы пользователя, если он её назвал.
2. Затем одна компактная таблица обоснования. Без таблиц отсева. Риски — максимум одна строка.
3. Целевой кэф (если задан) собирай из заготовок маркет-аналитика; если точное значение недостижимо — ближайшее и одной строкой почему.
4. Никаких лекций о банке и предложенных сумм. Работай ТОЛЬКО с матчами из пула (id реальный); матч не из пула — не использовать.
5. Одиночная ставка — выведи служебную строку СИГНАЛ (формат: gameId=<id из пула> | матч=… | лига=… | рынок=<исходы|тоталы|угловые|обе забьют> | key=<1|X|2|tb15|tm15|tb25|tm25|tb35|tm35|btts_yes|btts_no> | ставка=… | кэф=… | уверенность=… | дата=…). Экспресс — без СИГНАЛа.`,
    },
    auditor: {
      description: 'Этап 5 конвейера: финальная проверка прогноза — все матчи предстоящие, арифметика, форматы. Отдаёт готовый текст. Вызывать последним.',
      tools: [],
      prompt: `Ты — аудитор прогнозов SportChat.
${T}
Тебе дадут черновик прогноза и данные конвейера (пул со временем матчей). ПРОВЕРЬ И ИСПРАВЬ САМ, молча:
1. Каждый матч в прогнозе есть в пуле и его время В БУДУЩЕМ. Завершённые, идущие или отсутствующие в пуле матчи — убрать или заменить заготовкой маркет-аналитика.
2. Арифметика: произведение кэфов, вероятность, выплата.
3. Рынки по-русски (Тотал больше/меньше, Обе забьют, Двойной шанс, Фора) — без Овер/Андер/BTTS.
4. Формат: прогноз в начале, одна таблица обоснования, риски одной строкой, никаких лекций о банке, никаких «★ Insight», нет блока Sources. СИГНАЛ — только для одиночной ставки и только с реальным gameId.
5. Если достойных предстоящих матчей нет — верни честную строку об этом и предложи другую дату/лигу.
Верни ТОЛЬКО финальный текст ответа для чата, без своих комментариев и пометок.`,
    },
  };
}


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
    // соединение могло закрыться/обновиться в середине хода — молча пропускаем,
    // иначе крэш процесса (падение после завершения turn)
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(obj));
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
        // + текущие дата/время: модель сама их не знает (баг «матчи уже завершились»)
        systemPrompt: { type: 'preset', preset: 'claude_code', append: `${readSystemPrompt()}\n\n${nowLine()}` },
        // конвейер субагентов: pool → scout → markets → composer → auditor
        agents: buildAgents(),
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

      // reasoning effort: высокий для всех прогонов (env поддерживается CLI)
      options.env = {
        ...(options.env ?? process.env),
        CLAUDE_CODE_EFFORT_LEVEL: 'high',
        MAX_THINKING_TOKENS: '31999',
      };

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
          // ВАЖНО: полное сообщение тоже уходит клиенту — по нему клиент
          // делает финальный markdown-рендер (reconcileFinal)
          this.send({ t: 'assistant', message: m.message });
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
