/* ============================================================
   ai.js — вкладка «Помощник» в Штабе.
   Фронт к ИИ-шлюзу nexus_ws/ai.ts (порт 8002).
   Ключи провайдеров живут на сервере, в браузер не попадают.
   История диалога — в localStorage этого устройства.
   ============================================================ */
(function () {
  'use strict';

  var LS_HISTORY = 'assistant_history_v1';
  var LS_GATEWAY = 'assistant_gateway_v1';
  var LS_SYSTEM  = 'assistant_system_v1';
  var LS_AUTO    = 'assistant_auto_v1';
  var MAX_MSGS   = 40;
  var AUTO_MAX   = 12;   // предохранитель: не больше 12 авто-шагов подряд

  var DEFAULT_SYSTEM =
    'Ты — Помощник Штаба, второй Архитектор. Отвечай по-русски, коротко и по делу. ' +
    'Без воды, без пересказа задания. Задача ясна — сразу решение. ' +
    'Проекты: digital-agency (Штаб), nexus_chat + nexus_ws (чат), window_calc (окна), ' +
    'ac_luxury_calc (кондиционеры), window_measure_pro (замер окон), nexus_snake. ' +
    'Сервер: Vivo Y17 -> Termux -> Ubuntu. Штаб :8000, Чат :8001, Шлюз ИИ :8002, Caddy :8443. ' +
    'Секреты в открытые репозитории не писать — только переменные окружения.';

  var history = [];
  var busy = false;
  var gateway = '';
  var els = {};
  var auto = false;        // авто-продолжение этапов («пинок»)
  var autoTimer = null;
  var autoSteps = 0;

  /* ---------- хранилище ---------- */

  function loadHistory() {
    try {
      var raw = localStorage.getItem(LS_HISTORY);
      history = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(history)) history = [];
    } catch (e) { history = []; }
  }

  function saveHistory() {
    try {
      if (history.length > MAX_MSGS) history = history.slice(-MAX_MSGS);
      localStorage.setItem(LS_HISTORY, JSON.stringify(history));
    } catch (e) { /* переполнение — не критично */ }
  }

  function systemPrompt() {
    try { return localStorage.getItem(LS_SYSTEM) || DEFAULT_SYSTEM; }
    catch (e) { return DEFAULT_SYSTEM; }
  }

  /* ---------- сеть ---------- */

  function candidates() {
    var out = [];
    var saved = null;
    try { saved = localStorage.getItem(LS_GATEWAY); } catch (e) {}
    if (saved) out.push(String(saved).replace(/\/+$/, ''));
    var loc = window.location;
    var host = loc.hostname || 'localhost';
    var http = loc.protocol === 'https:' ? 'https:' : 'http:';
    out.push(http + '//' + host + ':8002');
    out.push('https://' + host + ':8443');
    out.push('http://localhost:8002');
    var seen = {}, uniq = [];
    out.forEach(function (u) { if (u && !seen[u]) { seen[u] = 1; uniq.push(u); } });
    return uniq;
  }

  function fetchTimeout(url, opts, ms) {
    var ctrl = new AbortController();
    var t = setTimeout(function () { ctrl.abort(); }, ms || 12000);
    var o = Object.assign({}, opts || {}, { signal: ctrl.signal });
    return fetch(url, o).then(function (r) { clearTimeout(t); return r; },
      function (e) { clearTimeout(t); throw e; });
  }

  function setStatus(text, isError) {
    if (!els.status) return;
    els.status.textContent = text;
    els.status.style.color = isError ? '#ff8888' : '#7ee08a';
  }

  async function findGateway() {
    if (gateway) return gateway;
    var list = candidates();
    for (var i = 0; i < list.length; i++) {
      try {
        var r = await fetchTimeout(list[i] + '/ai/health', { method: 'GET' }, 6000);
        if (r.ok) {
          var j = await r.json().catch(function () { return {}; });
          gateway = list[i];
          var prov = (j.providers && j.providers.length) ? j.providers.join(', ') : 'ключей нет';
          setStatus('Шлюз: ' + gateway + ' · ' + prov);
          return gateway;
        }
      } catch (e) { /* пробуем следующий адрес */ }
    }
    setStatus('Шлюз не найден. Проверь, что ai.ts запущен на :8002.', true);
    return null;
  }

  /* ---------- рендер ---------- */

  function render() {
    if (!els.log) return;
    els.log.innerHTML = '';
    if (!history.length) {
      var hint = document.createElement('div');
      hint.style.cssText = 'color:#666; font-size:13px; text-align:center; padding:24px 12px; line-height:1.5;';
      hint.textContent = 'Пусто. Напиши задачу — Помощник ответит. Ключи и лимиты живут на сервере.';
      els.log.appendChild(hint);
      return;
    }
    history.forEach(function (m) {
      var row = document.createElement('div');
      var mine = m.role === 'user';
      row.style.cssText = 'margin-bottom:12px; display:flex; flex-direction:column; align-items:' +
        (mine ? 'flex-end' : 'flex-start') + ';';

      var bubble = document.createElement('div');
      bubble.style.cssText = 'max-width:88%; padding:10px 12px; border-radius:12px; font-size:14px; ' +
        'line-height:1.5; white-space:pre-wrap; word-break:break-word; ' +
        (mine
          ? 'background:#003a44; border:1px solid #00e5ff; color:#dffcff;'
          : 'background:#141414; border:1px solid #333; color:#e8e8e8;');
      bubble.textContent = m.content || '';
      row.appendChild(bubble);

      if (m.meta) {
        var meta = document.createElement('div');
        meta.style.cssText = 'font-size:10px; color:#666; margin-top:4px; font-family:monospace;';
        meta.textContent = m.meta;
        row.appendChild(meta);
      }
      els.log.appendChild(row);
    });
    els.log.scrollTop = els.log.scrollHeight;
  }

  function setBusy(v) {
    busy = v;
    if (els.send) {
      els.send.disabled = v;
      els.send.textContent = v ? '…' : '➤';
      els.send.style.opacity = v ? '0.5' : '1';
    }
    if (els.input) els.input.disabled = v;
  }

  /* ---------- авто-продолжение этапов («пинок») ---------- */

  function stageMarker(text) {
    var m = /\[ЭТАП\s*(\d+)\s*\/\s*(\d+)\]/i.exec(text || '');
    if (!m) return null;
    return { n: parseInt(m[1], 10), total: parseInt(m[2], 10) };
  }

  function setAuto(v) {
    auto = !!v;
    if (!auto && autoTimer) { clearTimeout(autoTimer); autoTimer = null; }
    if (auto) autoSteps = 0;
    if (els.autoBtn) {
      els.autoBtn.textContent = auto ? '⏸ Авто' : '▶ Авто';
      els.autoBtn.style.borderColor = auto ? '#7ee08a' : '#333';
      els.autoBtn.style.color = auto ? '#7ee08a' : '#aaa';
    }
    setStatus(auto ? 'Авто-режим включён' : 'Авто-режим выключен');
  }

  function maybeAuto(text) {
    if (!auto) return;
    if (/Готово,\s*Босс/i.test(text || '')) {
      setAuto(false);
      setStatus('Авто: задача закрыта', false);
      return;
    }
    var st = stageMarker(text);
    if (!st || st.n >= st.total) {
      setAuto(false);
      setStatus('Авто: этапов больше нет', false);
      return;
    }
    if (autoSteps >= AUTO_MAX) {
      setAuto(false);
      setStatus('Авто: стоп-лимит ' + AUTO_MAX + ' шагов', true);
      return;
    }
    autoSteps++;
    var next = 'продолжи этап ' + (st.n + 1) + ' из ' + st.total;
    setStatus('Авто: ' + next + ' (' + autoSteps + '/' + AUTO_MAX + ')');
    autoTimer = setTimeout(function () {
      if (!auto) return;
      if (els.input) els.input.value = next;
      send();
    }, 1500);
  }

  /* ---------- отправка ---------- */

  async function send() {
    if (busy) return;
    var text = (els.input && els.input.value || '').trim();
    if (!text) return;

    var gw = await findGateway();
    if (!gw) return;

    setBusy(true);
    history.push({ role: 'user', content: text });
    els.input.value = '';
    saveHistory();
    render();

    try {
      var payload = {
        messages: [{ role: 'system', content: systemPrompt() }].concat(history.slice(-MAX_MSGS)),
        temperature: 0.6
      };
      var r = await fetchTimeout(gw + '/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }, 95000);

      var j = await r.json().catch(function () { return {}; });
      if (!r.ok || !j.ok) throw new Error(j.error || ('HTTP ' + r.status));

      var meta = (j.provider || '?') + ' · ' + (j.model || '?') + ' · ' + (j.ms || 0) + ' мс';
      if (j.actions && j.actions.length) meta += ' · 🔧 ' + j.actions.length;
      history.push({
        role: 'assistant',
        content: j.text || '(пустой ответ)',
        meta: meta
      });
      setStatus('Шлюз: ' + gw + ' · ' + (j.provider || '?'));
      maybeAuto(j.text || '');
    } catch (e) {
      var msg = e && e.name === 'AbortError' ? 'таймаут 95 сек' : (e && e.message || 'сбой');
      history.push({ role: 'assistant', content: '⚠️ Ошибка: ' + msg, meta: 'error' });
      setStatus('Ошибка запроса: ' + msg, true);
    } finally {
      setBusy(false);
      saveHistory();
      render();
    }
  }

  /* ---------- настройки ---------- */

  function openSettings() {
    var cur = '';
    try { cur = localStorage.getItem(LS_GATEWAY) || ''; } catch (e) {}
    var val = window.prompt(
      'Адрес ИИ-шлюза (пусто — определять автоматически):\n' +
      'например http://192.168.1.5:8002 или https://имя.duckdns.org:8443',
      cur
    );
    if (val === null) return;
    try {
      if (val.trim()) localStorage.setItem(LS_GATEWAY, val.trim());
      else localStorage.removeItem(LS_GATEWAY);
    } catch (e) {}
    gateway = '';
    setStatus('Адрес шлюза обновлён, проверяю…');
    findGateway();
  }

  function editSystem() {
    var val = window.prompt('Характер Помощника (системный промпт):', systemPrompt());
    if (val === null) return;
    try {
      if (val.trim()) localStorage.setItem(LS_SYSTEM, val.trim());
      else localStorage.removeItem(LS_SYSTEM);
    } catch (e) {}
    setStatus('Характер сохранён');
  }

  function clearAll() {
    if (!window.confirm('Очистить историю диалога с Помощником?')) return;
    history = [];
    try { localStorage.removeItem(LS_HISTORY); } catch (e) {}
    render();
    setStatus('История очищена');
  }

  /* ---------- модалка ---------- */

  function build() {
    if (document.getElementById('assistantModal')) {
      els.modal = document.getElementById('assistantModal');
      return;
    }

    var overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.id = 'assistantModal';
    overlay.onclick = function (e) { if (e.target === overlay) close(); };

    var box = document.createElement('div');
    box.className = 'modal-content';
    box.style.cssText = 'max-width:94%; width:720px; height:82vh; display:flex; flex-direction:column; border-color:#00e5ff;';
    box.onclick = function (e) { e.stopPropagation(); };

    /* шапка */
    var head = document.createElement('div');
    head.className = 'modal-header';
    head.style.cssText = 'flex:0 0 auto;';

    var title = document.createElement('h2');
    title.style.cssText = 'color:#00e5ff; margin:0; font-size:16px;';
    title.textContent = '🤖 Помощник';
    head.appendChild(title);

    var tools = document.createElement('div');
    tools.style.cssText = 'display:flex; gap:8px; align-items:center;';

    function toolBtn(label, title2, fn, color) {
      var b = document.createElement('button');
      b.textContent = label;
      b.title = title2 || '';
      b.style.cssText = 'background:#1a1a1a; color:' + (color || '#aaa') +
        '; border:1px solid #333; border-radius:8px; padding:5px 9px; font-size:13px; cursor:pointer;';
      b.onclick = fn;
      return b;
    }

    var autoBtn = toolBtn('▶ Авто', 'Авто-продолжение этапов', function () { setAuto(!auto); }, '#7ee08a');
    els.autoBtn = autoBtn;
    tools.appendChild(autoBtn);

    tools.appendChild(toolBtn('⚙️', 'Адрес шлюза', openSettings));
    tools.appendChild(toolBtn('🧠', 'Характер Помощника', editSystem, '#ffd700'));
    tools.appendChild(toolBtn('🗑️', 'Очистить историю', clearAll, '#ff8888'));

    var closeBtn = document.createElement('button');
    closeBtn.className = 'modal-close';
    closeBtn.textContent = '✖';
    closeBtn.onclick = close;
    tools.appendChild(closeBtn);
    head.appendChild(tools);
    box.appendChild(head);

    /* статус */
    var status = document.createElement('div');
    status.style.cssText = 'flex:0 0 auto; font:11px monospace; color:#7ee08a; padding:4px 2px 8px 2px;';
    status.textContent = 'Шлюз: проверяю…';
    els.status = status;
    box.appendChild(status);

    /* лог */
    var log = document.createElement('div');
    log.style.cssText = 'flex:1 1 auto; min-height:0; overflow-y:auto; background:#0b0b0b; ' +
      'border:1px solid #222; border-radius:10px; padding:12px;';
    els.log = log;
    box.appendChild(log);

    /* ввод */
    var inputRow = document.createElement('div');
    inputRow.style.cssText = 'flex:0 0 auto; display:flex; gap:8px; margin-top:10px; align-items:flex-end;';

    var input = document.createElement('textarea');
    input.rows = 2;
    input.placeholder = 'Задача Помощнику… (Enter — отправить, Shift+Enter — новая строка)';
    input.style.cssText = 'flex:1 1 auto; resize:none; background:#141414; color:#eee; ' +
      'border:1px solid #333; border-radius:10px; padding:10px; font:14px inherit; outline:none;';
    input.onkeydown = function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
    };
    els.input = input;
    inputRow.appendChild(input);

    var sendBtn = document.createElement('button');
    sendBtn.textContent = '➤';
    sendBtn.style.cssText = 'flex:0 0 auto; width:48px; height:48px; background:#00e5ff; color:#000; ' +
      'border:none; border-radius:12px; font-size:20px; font-weight:bold; cursor:pointer;';
    sendBtn.onclick = send;
    els.send = sendBtn;
    inputRow.appendChild(sendBtn);

    box.appendChild(inputRow);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    els.modal = overlay;
  }

  function open() {
    build();
    els.modal.classList.add('active');
    render();
    findGateway();
    setTimeout(function () { if (els.input) els.input.focus(); }, 120);
  }

  function close() {
    if (auto) setAuto(false);   // закрыл окно — авто-цикл останавливаем
    if (els.modal) els.modal.classList.remove('active');
  }

  /* ---------- публичный API ---------- */

  window.openAssistant = open;
  window.closeAssistant = close;
  window.assistantSend = send;
  window.assistantAuto = setAuto;

  loadHistory();
  // app.html грузит скрипты уже внутри DOMContentLoaded, поэтому слушатель
  // на это событие мог бы не сработать — проверяем readyState.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { findGateway(); });
  } else {
    setTimeout(function () { findGateway(); }, 300);
  }

  console.log('[ai.js] Помощник готов. Шлюз ищется автоматически, ключи — на сервере.');
})();
