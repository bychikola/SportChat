/* Правая панель: эпизоды, MCP-серверы, навыки, консоль CLI */

import { $, $$, esc, icon, toolIcon, timeStr, openModal, closeModal } from './util.js';
import { api } from './api.js';

export function createRail({ S, toast, updateCaps }) {
  const episodeList = $('#episodeList');
  const epiMap = new Map(); // toolUseID -> el

  /* ══════════ вкладки ══════════ */
  function switchTab(name) {
    $$('.rtab').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
    $$('.rpane').forEach((p) => p.classList.toggle('active', p.dataset.pane === name));
    $$('.tbtn[data-open]').forEach((b) => b.classList.toggle('is-open', b.dataset.open === name && name !== 'episodes'));
    if (window.matchMedia('(max-width: 1359px)').matches) {
      document.body.classList.add('rail-open');
    }
  }
  $$('.rtab').forEach((b) => b.addEventListener('click', () => switchTab(b.dataset.tab)));

  /* ══════════ эпизоды ══════════ */
  function pushEpisode(t) {
    if (epiMap.size === 0) episodeList.replaceChildren();
    const el = document.createElement('div');
    el.className = 'epi running';
    el.innerHTML = `
      ${icon(toolIcon(t.name), 'tc-icon')}
      <span class="epi-name">${esc(shortTool(t.name))}</span>
      <span class="epi-sum">…</span>
      <span class="epi-time">${timeStr()}</span>`;
    episodeList.appendChild(el);
    epiMap.set(t.id, el);
    while (episodeList.children.length > 150) episodeList.firstChild.remove();
    return el;
  }

  function updateEpisode(t) {
    const el = epiMap.get(t.id) || t.el;
    if (!el) return;
    el.className = `epi ${t.status === 'ok' ? 'ok' : t.status === 'err' ? 'err' : t.status === 'wait' ? '' : 'running'}`;
    const sum = el.querySelector('.epi-sum');
    if (t.inputObj) sum.textContent = oneLine(toolSummarySafe(t.inputObj));
    else if (t.result) sum.textContent = oneLine(t.result).slice(0, 80);
  }

  const shortTool = (name) => (String(name || '').startsWith('mcp__')
    ? `MCP·${String(name).slice(5).replace(/__/g, '/')}`
    : String(name || ''));

  const toolSummarySafe = (input) => {
    for (const k of ['command', 'file_path', 'url', 'query', 'pattern', 'skill', 'topic', 'prompt']) {
      if (input?.[k]) return String(input[k]);
    }
    try { return JSON.stringify(input); } catch { return ''; }
  };
  const oneLine = (s) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 90);

  function clearEpisodes() {
    epiMap.clear();
    episodeList.innerHTML = '<div class="empty-note">Здесь появится каждое действие агента:<br>поиск, чтение файлов, вызовы MCP.</div>';
  }

  /* ══════════ MCP ══════════ */
  async function loadMcp() {
    const list = $('#mcpList');
    try {
      const servers = await api('/config/mcp');
      S.mcpServers = servers;
      if (!servers.length) {
        list.innerHTML = '<div class="empty-note">Серверов нет.<br>Подключи первый — например, filesystem или fetch.</div>';
      } else {
        list.replaceChildren(...servers.map(srvCard));
      }
    } catch (e) {
      toast(`MCP: ${e.message}`, 'err');
    }
    updateCaps();
  }

  function srvCard(srv) {
    const el = document.createElement('div');
    el.className = 'srv-card';
    const detail = srv.type === 'http' || srv.type === 'sse'
      ? esc(srv.url)
      : `${esc(srv.command)} ${(srv.args || []).map((a) => esc(a)).join(' ')}`;
    el.innerHTML = `
      <div class="srv-top">
        <span class="srv-name">${esc(srv.name)}</span>
        <span class="badge-type">${esc((srv.type || 'stdio').toUpperCase())}</span>
        <button class="card-x" title="Отключить">${icon('trash')}</button>
      </div>
      <div class="srv-detail">${detail}</div>`;
    el.querySelector('.card-x').addEventListener('click', async () => {
      if (!confirm(`Отключить MCP-сервер «${srv.name}»?`)) return;
      try {
        await api(`/config/mcp/${encodeURIComponent(srv.name)}`, { method: 'DELETE' });
        toast(`Сервер «${srv.name}» отключён`, 'ok');
        loadMcp();
      } catch (e) {
        toast(e.message, 'err');
      }
    });
    el.querySelector('.srv-top').addEventListener('click', (e) => {
      if (e.target.closest('.card-x')) return;
      openMcpModal(srv);
    });
    return el;
  }

  function openMcpModal(existing = null) {
    let type = existing?.type || 'stdio';
    const body = document.createElement('div');
    body.innerHTML = `
      <div class="field-row">
        <div class="field">
          <label>Имя сервера</label>
          <input type="text" id="mcpName" placeholder="fetch" value="${esc(existing?.name || '')}" ${existing?.name ? 'readonly title="Имя неизменно — так не создаётся дубликат"' : ''}>
        </div>
        <div class="field">
          <label>Тип</label>
          <select id="mcpType">
            <option value="stdio">stdio — локальный процесс</option>
            <option value="http">http — удалённый сервер</option>
            <option value="sse">sse — удалённый сервер (SSE)</option>
          </select>
        </div>
      </div>
      <div id="mcpDynamic"></div>
      <div class="form-error" id="mcpErr"></div>
      <div class="field"><div class="hint">Изменения записываются в <code>.mcp.json</code> рабочего пространства и вступают в силу со следующего сообщения агенту.</div></div>`;

    const dyn = body.querySelector('#mcpDynamic');
    const renderDyn = () => {
      if (type === 'stdio') {
        dyn.innerHTML = `
          <div class="field">
            <label>Команда запуска</label>
            <input type="text" id="mcpCmd" placeholder="npx -y @modelcontextprotocol/server-fetch">
          </div>
          <div class="field">
            <label>Переменные окружения (необязательно)</label>
            <textarea id="mcpEnv" rows="3" placeholder="API_KEY=xxx"></textarea>
          </div>`;
        dyn.querySelector('#mcpCmd').value = existing?.command || '';
        dyn.querySelector('#mcpEnv').value = Object.entries(existing?.env || {}).map(([k, v]) => `${k}=${v}`).join('\n');
      } else {
        dyn.innerHTML = `
          <div class="field">
            <label>URL</label>
            <input type="text" id="mcpUrl" placeholder="https://example.com/mcp">
          </div>
          <div class="field">
            <label>Заголовки JSON (необязательно)</label>
            <textarea id="mcpHeaders" rows="3" placeholder='{"Authorization": "Bearer …"}'></textarea>
          </div>`;
        dyn.querySelector('#mcpUrl').value = existing?.url || '';
        dyn.querySelector('#mcpHeaders').value = existing?.headers ? JSON.stringify(existing.headers, null, 2) : '';
      }
    };
    renderDyn();
    body.querySelector('#mcpType').value = type;
    body.querySelector('#mcpType').addEventListener('change', (e) => {
      type = e.target.value;
      existing = null; // при смене типа не смешиваем поля
      renderDyn();
    });

    const err = body.querySelector('#mcpErr');
    const save = async () => {
      const name = body.querySelector('#mcpName').value.trim();
      err.classList.remove('show');
      const payload = { type };
      try {
        if (type === 'stdio') {
          const parts = dyn.querySelector('#mcpCmd').value.trim().split(/\s+/);
          payload.command = parts[0];
          payload.args = parts.slice(1);
          const envRaw = dyn.querySelector('#mcpEnv').value.trim();
          if (envRaw) {
            payload.env = {};
            for (const line of envRaw.split('\n')) {
              const i = line.indexOf('=');
              if (i > 0) payload.env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
            }
          }
        } else {
          payload.url = dyn.querySelector('#mcpUrl').value.trim();
          const hRaw = dyn.querySelector('#mcpHeaders').value.trim();
          if (hRaw) payload.headers = JSON.parse(hRaw);
        }
        await api(`/config/mcp/${encodeURIComponent(name)}`, { method: 'PUT', body: payload });
        modal.close();
        toast(`Сервер «${name}» сохранён`, 'ok');
        loadMcp();
      } catch (e) {
        err.textContent = e.message;
        err.classList.add('show');
      }
    };

    const modal = openFormModal({
      title: existing ? `MCP · ${existing.name}` : 'Подключить MCP-сервер',
      body,
      onSave: save,
      saveLabel: existing ? 'Сохранить' : 'Подключить',
    });
  }

  $('#addMcpBtn').addEventListener('click', () => openMcpModal());

  /* ══════════ Skills ══════════ */
  async function loadSkills() {
    const list = $('#skillList');
    try {
      const skills = await api('/config/skills');
      S.skills = skills;
      list.replaceChildren(...skills.map(skillCard));
      if (!skills.length) list.innerHTML = '<div class="empty-note">Навыков нет — создай первый.</div>';
    } catch (e) {
      toast(`Skills: ${e.message}`, 'err');
    }
    updateCaps();
  }

  function skillCard(skill) {
    const el = document.createElement('div');
    el.className = 'skill-card';
    el.innerHTML = `
      <div class="skill-top">
        <span class="skill-name">${esc(skill.name)}</span>
        <button class="skill-edit" title="Редактировать">${icon('edit')}</button>
        <button class="card-x" title="Удалить">${icon('trash')}</button>
      </div>
      <div class="skill-desc">${esc(skill.description || 'без описания')}</div>`;
    el.querySelector('.skill-edit').addEventListener('click', () => openSkillModal(skill));
    el.querySelector('.card-x').addEventListener('click', async () => {
      if (!confirm(`Удалить навык «${skill.name}»?`)) return;
      try {
        await api(`/config/skills/${encodeURIComponent(skill.dir)}`, { method: 'DELETE' });
        toast(`Навык «${skill.name}» удалён`, 'ok');
        loadSkills();
      } catch (e) {
        toast(e.message, 'err');
      }
    });
    return el;
  }

  function openSkillModal(skill = null) {
    const raw = skill?.content || '';
    const fmMatch = /^---\n([\s\S]*?)\n---\n?/.exec(raw);
    const fm = {};
    for (const line of (fmMatch?.[1] || '').split('\n')) {
      const i = line.indexOf(':');
      if (i > 0) fm[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
    const bodyText = fmMatch ? raw.slice(fmMatch[0].length).replace(/^\n+/, '') : raw;

    const body = document.createElement('div');
    body.innerHTML = `
      <div class="field-row">
        <div class="field">
          <label>Имя (a-z, 0-9, дефис)</label>
          <input type="text" id="skName" placeholder="odds-analysis" value="${esc(skill?.name || '')}">
        </div>
        <div class="field">
          <label>Когда использовать (description)</label>
          <input type="text" id="skDesc" placeholder="Разбор коэффициентов…" value="${esc(fm.description || '')}">
        </div>
      </div>
      <div class="field">
        <label>Инструкции навыка (markdown, тело SKILL.md)</label>
        <textarea id="skBody" class="editor-tall" spellcheck="false"></textarea>
        <div class="hint">Claude подключит навык автоматически, когда описание совпадёт с запросом. Файл появится в <code>workspace/.claude/skills/</code>.</div>
      </div>
      <div class="form-error" id="skErr"></div>`;
    body.querySelector('#skBody').value = bodyText ||
      '# Что делать\n\n1. Шаг первый…\n2. Шаг второй…\n\nФормат вывода: …';

    const err = body.querySelector('#skErr');
    const save = async () => {
      err.classList.remove('show');
      try {
        await api('/config/skills', {
          method: 'POST',
          body: {
            name: body.querySelector('#skName').value.trim(),
            description: body.querySelector('#skDesc').value.trim(),
            content: body.querySelector('#skBody').value,
            originalName: skill?.dir || null,
          },
        });
        modal.close();
        toast('Навык сохранён — активен со следующего сообщения', 'ok');
        loadSkills();
      } catch (e) {
        err.textContent = e.message;
        err.classList.add('show');
      }
    };

    const modal = openFormModal({
      title: skill ? `Навык · ${skill.name}` : 'Новый навык',
      wide: true,
      body,
      onSave: save,
      saveLabel: 'Сохранить навык',
    });
  }

  $('#addSkillBtn').addEventListener('click', () => openSkillModal());

  /* ══════════ Плагины / магазин ══════════ */
  async function loadPlugins() {
    const list = $('#pluginList');
    try {
      const data = await api('/config/plugins');
      S.pluginSelection = data.selection || [];
      S.pluginsInstalled = data.installed || [];
      S.pluginsUserEnabled = data.userEnabled || {};
    } catch (e) {
      list.innerHTML = `<div class="empty-note">${esc(e.message)}</div>`;
      return;
    }
    let store = [];
    try {
      store = await api('/plugins/store');
    } catch { /* каталог недоступен */ }
    S.pluginStore = store;
    renderPluginList();
  }

  function renderPluginList() {
    const list = $('#pluginList');
    const q = ($('#pluginSearch')?.value || '').toLowerCase().trim();
    const installedByKey = new Map(S.pluginsInstalled.map((p) => [p.key, p]));
    const frag = document.createDocumentFragment();

    /* подключённые к агенту */
    const active = S.pluginsInstalled.filter((p) => S.pluginSelection.includes(p.key));
    if (active.length) {
      const h = document.createElement('div');
      h.className = 'plug-section';
      h.textContent = `Подключены к агенту · ${active.length}`;
      frag.appendChild(h);
      for (const p of active) frag.appendChild(plugCard(p, true));
    }

    /* установлены, но не подключены */
    const off = S.pluginsInstalled.filter((p) => !S.pluginSelection.includes(p.key));
    if (off.length) {
      const h = document.createElement('div');
      h.className = 'plug-section';
      h.textContent = `Установлены · ${off.length}`;
      frag.appendChild(h);
      for (const p of off) frag.appendChild(plugCard(p, false));
    }

    /* магазин */
    const catalog = [];
    for (const mp of S.pluginStore || []) {
      for (const p of mp.plugins || []) {
        catalog.push({ ...p, marketplace: mp.marketplace });
      }
    }
    const filtered = q
      ? catalog.filter((p) => `${p.name} ${p.description} ${p.category}`.toLowerCase().includes(q))
      : catalog;
    const h = document.createElement('div');
    h.className = 'plug-section';
    h.textContent = `Магазин · ${filtered.length}${q ? '' : ` (маркетплейсов: ${(S.pluginStore || []).length})`}`;
    frag.appendChild(h);

    if (!filtered.length) {
      const e = document.createElement('div');
      e.className = 'empty-note';
      e.textContent = q ? 'Ничего не найдено.' : 'Каталог пуст — добавь маркетплейс кнопкой «+ Маркет».';
      frag.appendChild(e);
    } else {
      const shown = filtered.slice(0, 60);
      for (const p of shown) frag.appendChild(storeCard(p, installedByKey.has(`${p.name}@${p.marketplace}`)));
      if (filtered.length > shown.length) {
        const e = document.createElement('div');
        e.className = 'empty-note';
        e.textContent = `…и ещё ${filtered.length - shown.length} — уточни поиск.`;
        frag.appendChild(e);
      }
    }

    list.replaceChildren(frag);
  }

  function plugCard(p, isConnected) {
    const el = document.createElement('div');
    el.className = 'plug-card';
    el.innerHTML = `
      <div class="plug-top">
        <span class="plug-name">${esc(p.name)}</span>
        <span class="plug-mp">@${esc(p.marketplace)}</span>
        <div class="plug-actions">
          <button class="${isConnected ? 'plug-on' : 'plug-off'}" title="Переключить подключение к агенту">
            ${isConnected ? 'вкл' : 'выкл'}
          </button>
        </div>
      </div>
      ${p.exists === false ? '<div class="plug-desc">⚠️ путь установки не найден</div>' : ''}`;
    el.querySelector('.plug-on, .plug-off').addEventListener('click', () => togglePlugin(p.key, !isConnected));
    return el;
  }

  function storeCard(p, installed) {
    const el = document.createElement('div');
    el.className = 'plug-card';
    el.innerHTML = `
      <div class="plug-top">
        <span class="plug-name">${esc(p.name)}</span>
        ${p.category ? `<span class="plug-mp">${esc(p.category)}</span>` : ''}
        <div class="plug-actions">
          <button class="btn-install" ${installed ? 'disabled' : ''}>${installed ? 'есть' : 'Установить'}</button>
        </div>
      </div>
      ${p.description ? `<div class="plug-desc">${esc(p.description)}</div>` : ''}`;
    el.querySelector('.btn-install')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      btn.textContent = '…';
      const cmd = `claude plugin install ${p.name}@${p.marketplace}`;
      cliLog(`❯ ${cmd}`, 'cmd');
      try {
        const res = await api('/cli/run', { method: 'POST', body: { command: cmd } });
        if (res.stdout?.trim()) cliLog(res.stdout.trimEnd());
        if (res.stderr?.trim()) cliLog(res.stderr.trimEnd(), res.ok ? '' : 'err');
        toast(installed ? '' : `Плагин «${p.name}» установлен`, res.ok ? 'ok' : 'err');
      } catch (err) {
        cliLog(String(err.message), 'err');
        toast(err.message, 'err');
      }
      loadPlugins();
    });
    return el;
  }

  async function togglePlugin(key, on) {
    const sel = new Set(S.pluginSelection);
    if (on) sel.add(key); else sel.delete(key);
    try {
      const res = await api('/config/plugins', { method: 'PUT', body: { selection: [...sel] } });
      S.pluginSelection = res.selection;
      toast(`${key}: ${on ? 'подключён' : 'отключён'} — вступит в силу со следующего сообщения`, 'ok');
      renderPluginList();
      updateCaps();
    } catch (e) {
      toast(e.message, 'err');
    }
  }

  $('#pluginSearch')?.addEventListener('input', renderPluginList);
  $('#refreshPlugins')?.addEventListener('click', () => loadPlugins());
  $('#addMarketplaceBtn')?.addEventListener('click', async () => {
    const repo = prompt('Маркетплейс: owner/repo или URL репозитория\nнапример: anthropics/claude-code');
    if (!repo) return;
    const cmd = `claude plugin marketplace add ${repo.trim()}`;
    cliLog(`❯ ${cmd}`, 'cmd');
    try {
      const res = await api('/cli/run', { method: 'POST', body: { command: cmd } });
      if (res.stdout?.trim()) cliLog(res.stdout.trimEnd());
      if (res.stderr?.trim()) cliLog(res.stderr.trimEnd(), res.ok ? '' : 'err');
      toast(res.ok ? 'Маркетплейс добавлен' : 'Не удалось добавить маркетплейс', res.ok ? 'ok' : 'err');
    } catch (e) {
      toast(e.message, 'err');
    }
    loadPlugins();
  });

  /* ══════════ Консоль CLI ══════════ */
  const cliOut = $('#cliOut');
  const cliInput = $('#cliInput');
  const history = [];
  let histPos = -1;

  function cliLog(line, cls = '') {
    if (cliOut.querySelector('.empty-note, .dim:only-child')) cliOut.replaceChildren();
    const div = document.createElement('div');
    div.className = `cli-line ${cls}`;
    div.textContent = line;
    cliOut.appendChild(div);
    while (cliOut.children.length > 400) cliOut.firstChild.remove();
    cliOut.scrollTop = cliOut.scrollHeight;
  }

  async function runCli(cmd) {
    if (!cmd.trim()) return;
    history.unshift(cmd);
    histPos = -1;
    cliLog(`❯ ${cmd}`, 'cmd');
    cliInput.value = '';
    try {
      const res = await api('/cli/run', { method: 'POST', body: { command: cmd } });
      if (res.stdout?.trim()) cliLog(res.stdout.trimEnd());
      if (res.stderr?.trim()) cliLog(res.stderr.trimEnd(), res.ok ? '' : 'err');
      if (!res.stdout?.trim() && !res.stderr?.trim()) cliLog('(нет вывода)', 'dim');
    } catch (e) {
      cliLog(String(e.message), 'err');
    }
  }

  $('#cliForm').addEventListener('submit', (e) => {
    e.preventDefault();
    switchTab('cli');
    runCli(cliInput.value);
  });
  cliInput.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      histPos = Math.min(histPos + 1, history.length - 1);
      if (history[histPos] != null) cliInput.value = history[histPos];
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      histPos = Math.max(histPos - 1, -1);
      cliInput.value = histPos === -1 ? '' : history[histPos];
    }
  });
  $$('.mono-chip[data-cmd]').forEach((b) => b.addEventListener('click', () => {
    switchTab('cli');
    runCli(b.dataset.cmd);
  }));

  /* ── помощник модалки с кнопкой сохранения ── */
  function openFormModal({ title, body, onSave, saveLabel, wide }) {
    const cancel = document.createElement('button');
    cancel.className = 'btn-secondary';
    cancel.textContent = 'Отмена';
    const ok = document.createElement('button');
    ok.className = 'btn-primary notch-sm';
    ok.textContent = saveLabel || 'Сохранить';
    const modal = openModal({ title, wide, body, foot: [cancel, ok] });
    cancel.addEventListener('click', modal.close);
    ok.addEventListener('click', () => { if (!ok.disabled) onSave(modal, ok); });
    setTimeout(() => body.querySelector('input, select, textarea')?.focus(), 60);
    return modal;
  }

  return {
    switchTab,
    pushEpisode,
    updateEpisode,
    clearEpisodes,
    loadMcp,
    loadSkills,
    loadPlugins,
    cliLog,
  };
}
