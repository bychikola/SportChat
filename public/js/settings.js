/* Настройки движка: персона (CLAUDE.md), права (settings.json), движок */

import { $, esc, openModal, button } from './util.js';
import { api } from './api.js';

export function createSettings({ S, updateTablo, updateEngineInfo }) {
  const MODEL_LABELS = { default: 'модель окружения' };
  const modelLabel = () => MODEL_LABELS[S.model] || S.model;

  async function openSettings() {
    const wrap = document.createElement('div');
    wrap.innerHTML = `
      <div class="seg-tabs" style="margin:-18px -20px 4px; padding:0 20px;">
        <button class="seg-tab active" data-tab="persona">Персона</button>
        <button class="seg-tab" data-tab="perms">Права</button>
        <button class="seg-tab" data-tab="engine">Движок</button>
      </div>
      <div data-pane="persona">
        <div class="field">
          <label>Системный промпт — роль и методология аналитика (SYSTEM_PROMPT.md)</label>
          <textarea id="setSystemPrompt" class="editor-tall" spellcheck="false" style="min-height:380px"></textarea>
          <div class="hint">Добавляется к штатному системному промпту Claude Code при каждом
            сообщении: роль, порядок сбора данных, веса факторов, правила вероятностей и вывода.</div>
        </div>
        <div class="field">
          <label>Память проекта (CLAUDE.md)</label>
          <textarea id="setClaudeMd" spellcheck="false" style="min-height:140px"></textarea>
          <div class="hint">Рабочие конвенции и факты, которые стоит помнить между разборами.</div>
        </div>
      </div>
      <div data-pane="perms" hidden>
        <div class="field">
          <label>workspace/.claude/settings.json</label>
          <textarea id="setSettings" class="editor-tall" spellcheck="false"></textarea>
          <div class="hint">Формат разрешений Claude Code: <code>permissions.allow / permissions.deny</code>,
            правила вида <code>"Bash(git *)"</code>, <code>"Write"</code>, <code>"mcp__server__tool"</code>.</div>
        </div>
        <div class="form-error" id="setErr"></div>
      </div>
      <div data-pane="engine" hidden></div>`;

    const enginePane = wrap.querySelector('[data-pane="engine"]');
    const claudeTa = wrap.querySelector('#setClaudeMd');
    const systemTa = wrap.querySelector('#setSystemPrompt');
    const settingsTa = wrap.querySelector('#setSettings');

    try {
      const res = await fetch('/api/config/claude-md');
      claudeTa.value = await res.text();
    } catch { claudeTa.value = ''; }
    try {
      const sp = await fetch('/api/config/system-prompt');
      systemTa.value = await sp.text();
    } catch { systemTa.value = ''; }
    try {
      const res2 = await fetch('/api/config/settings');
      settingsTa.value = await res2.text();
    } catch { settingsTa.value = '{}'; }

    renderEnginePane(enginePane);

    // переключение вкладок
    wrap.querySelectorAll('.seg-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        wrap.querySelectorAll('.seg-tab').forEach((t) => t.classList.toggle('active', t === tab));
        ['persona', 'perms', 'engine'].forEach((n) => {
          wrap.querySelector(`[data-pane="${n}"]`).hidden = n !== tab.dataset.tab;
        });
      });
    });

    const savePersona = async () => {
      await api('/config/system-prompt', { method: 'PUT', body: { text: systemTa.value } });
      await api('/config/claude-md', { method: 'PUT', body: { text: claudeTa.value } });
      return true;
    };
    const savePerms = async () => {
      const err = wrap.querySelector('#setErr');
      err.classList.remove('show');
      try {
        await api('/config/settings', { method: 'PUT', body: { text: settingsTa.value } });
        return true;
      } catch (e) {
        err.textContent = e.message;
        err.classList.add('show');
        return false;
      }
    };

    const foot = [
      button('Сохранить', 'btn-primary notch-sm', async () => {
        const active = wrap.querySelector('.seg-tab.active')?.dataset.tab;
        try {
          const ok = active === 'perms' ? await savePerms() : await savePersona();
          if (ok) modal.close();
        } catch (e) {
          const err = wrap.querySelector('#setErr');
          err.textContent = e.message;
          err.classList.add('show');
        }
      }),
    ];

    const modal = openModal({
      title: 'Настройки движка',
      sub: 'реальный конфиг Claude Code рабочего пространства',
      wide: true,
      body: wrap,
      foot,
    });
  }

  function renderEnginePane(pane) {
    const meta = S.meta || {};
    pane.innerHTML = `
      <div class="engine-info">
        <div class="info-card"><div class="info-k">Claude Code</div><div class="info-v">${esc(S.init?.version || '…')}</div></div>
        <div class="info-card"><div class="info-k">Agent SDK</div><div class="info-v">${esc(meta.sdkVersion || '…')}</div></div>
        <div class="info-card"><div class="info-k">Модель сессии</div><div class="info-v">${esc(S.init?.model || 'определится при старте')}</div></div>
        <div class="info-card"><div class="info-k">Workspace</div><div class="info-v">${esc(meta.workspace || '')}</div></div>
      </div>

      <label class="check-row">
        <input type="checkbox" id="setIncludeUser" ${S.includeUser ? 'checked' : ''}>
        <span>
          <span class="cr-title">Подключать глобальный конфиг ~/.claude</span><br>
          <span class="cr-sub">Твои пользовательские MCP-серверы, плагины и настройки из домашней папки
          будут загружаться вместе с конфигом SportChat. По умолчанию выключено — чат живёт
          изолированно в workspace.</span>
        </span>
      </label>

      <div class="field-row">
        <div class="field">
          <label>Режим прав по умолчанию</label>
          <select id="setPermMode">
            <option value="default">Спрашивать — подтверждай опасные действия</option>
            <option value="acceptEdits">Авто-правки — редактирование файлов без вопросов</option>
            <option value="plan">Только план — исследование без изменений</option>
            <option value="bypassPermissions">Полный доступ — без подтверждений (--dangerously-skip-permissions)</option>
          </select>
        </div>
        <div class="field">
          <label>Модель по умолчанию</label>
          <input type="text" id="setModelHint" disabled value="${esc(modelLabel())}">
          <div class="hint">Меняется кликом по названию модели на табло сверху.</div>
        </div>
      </div>

      <div class="pane-note" style="border:none;padding:0;">
        Всё применяется к следующему сообщению — перезапускать не нужно.
        Конфиг лежит в <code>workspace/</code>: CLAUDE.md, .claude/settings.json,
        .claude/skills/, .mcp.json.
      </div>`;

    pane.querySelector('#setIncludeUser').addEventListener('change', (e) => {
      S.includeUser = e.target.checked;
      localStorage.setItem('sc_includeUser', S.includeUser ? '1' : '');
      $('#includeUser').checked = S.includeUser;
    });
    const permSel = pane.querySelector('#setPermMode');
    permSel.value = S.permMode;
    permSel.addEventListener('change', (e) => {
      if (e.target.value === 'bypassPermissions' && S.permMode !== 'bypassPermissions') {
        if (!confirm('РЕЖИМ ПОЛНОГО ДОСТУПА: агент будет выполнять любые действия без подтверждений. Включить?')) {
          e.target.value = S.permMode;
          return;
        }
      }
      S.permMode = e.target.value;
      const main = $('#permMode');
      main.value = S.permMode;
      main.classList.toggle('danger', S.permMode === 'bypassPermissions');
    });
  }

  return { openSettings };
}
