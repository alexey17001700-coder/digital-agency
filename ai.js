/* ============================================================
   ai.js — панель «Помощник» в Штабе (второй Архитектор).
   Панель стоит РЯДОМ с чатом, а не поверх него: диалог Босса
   с Архитектором остаётся видимым и не перекрывается.
   На широком экране панель справа, на телефоне — снизу
   (см. .chat-split в style.css).
   Фронт к ИИ-шлюзу nexus_ws/ai.ts (порт 8002).
   Ключи провайдеров живут на сервере, в браузер не попадают.
   История диалога — в localStorage этого устройства.
   ============================================================ */
(function () {
  'use strict';

  var LS_HISTORY = 'assistant_history_v1';
  var LS_GATEWAY = 'assistant_gateway_v1';
  var LS_SYSTEM  = 'assistant_system_v1';
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
  var gwFails = false;      // шлюз уже не ответил — не долбим его каждую секунду
  var gwFailTime = 0;
  var els = {};
  var auto = false;        // авто-продолжение этапов («пинок»)
  var autoTimer = null;
  var autoSteps = 0;
  var built = false;

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
    if (els.status) {
      els.status.textContent = text;
      els.status.style.color = isError ? '#ff8888' : '#7ee08a';
    }
    var hint = document.getElementById('assistantHint');
    if (hint && isError) hint.textContent = 'нет связи со шлюзом';
  }

  async function findGateway() {
    if (gateway) return gateway;
    if (gwFails && (Date.now() - gwFailTime) < 20000) return null;
    var list = candidates();
    for (var i = 0; i < list.length; i++) {
      try {
        var r = await fetchTimeout(list[i] + '/ai/health', { method: 'GET' }, 3000);
        if (r.ok) {
          var j = await r.json().catch(function () { return {}; });
          gateway = list[i];
          gwFails = false;
          var prov = (j.providers && j.providers.length) ? j.providers.join(', ') : 'ключей нет';
          setStatus('шлюз ок · ' + prov);
          return gateway;
        }
      } catch (e) { /* пробуем следующий адрес */ }
    }
    gwFails = true;
    gwFailTime = Date.now();
    setStatus('шлюз не найден (:8002)', true);
    return null;
  }

  /* ---------- панель ---------- */

  function panelOn() {
    var sp = document.getElementById('chatSplit');
    return !!(sp && sp.classList.contains('split-on'));
  }

  function setPanel(on) {
    var sp = document.getElementById('chatSplit');
    if (!sp) return false;
    sp.classList.toggle('split-on', !!on);
    return !!on;
  }

  /* ---------- рендер ---------- */

  function render() {
    if (!els.log) return;
    els.log.innerHTML = '';
    if (!history.length) {
      var hint = document.createElement('div');
      hint.style.cssText = 'color:#666; font-size:12px; text-align:center; padding:20px 10px; line-height:1.5;';
      hint.textContent = 'Пусто. Напиши задачу — Помощник ответит. Ключи и лимиты живут на сервере.';
      els.log.appendChild(hint);
      return;
    }
    history.forEach(function (m) {
      var row = document.createElement('div');
      var mine = m.role === 'user';
      row.style.cssText = 'margin-bottom:10px; display:flex; flex-direction:column; align-items:' +
        (mine ? 'flex-end' : 'flex-start') + ';';

      var bubble = document.createElement('div');
      bubble.style.cssText = 'max-width:92%; padding:8px 11px; border-radius:12px; font-size:13px; ' +
        'line-height:1.5; white-space:pre-wrap; word-break:break-word; ' +
        (mine
          ? 'background:#003a44; border:1px solid #00e5ff; color:#dffcff;'
          : 'background:#141414; border:1px solid #333; color:#e8e8e8;');
      bubble.textContent = m.content || '';
      row.appendChild(bubble);

      if (m.meta) {
        var meta = document.createElement('div');
        meta.style.cssText = 'font-size:10px; color:#666; margin-top:3px; font-family:monospace;';
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
      els.autoBtn.style.color = auto ? '#7ee08a' : '#aaa';
    }
    setStatus(auto ? 'авто-режим включён' : 'авто-режим выключен');
  }

  function maybeAuto(text) {
    if (!auto) return;
    if (/Готово,\s*Босс/i.test(text || '')) {
      setAuto(false);
      setStatus('авто: задача закрыта');
      return;
    }
    var st = stageMarker(text);
    if (!st || st.n >= st.total) {
      setAuto(false);
      setStatus('авто: этапов больше нет');
      return;
    }
    if (autoSteps >= AUTO_MAX) {
      setAuto(false);
      setStatus('авто: стоп-лимит ' + AUTO_MAX + ' шагов', true);
      return;
    }
    autoSteps++;
    var next = 'продолжи этап ' + (st.n + 1) + ' из ' + st.total;
    setStatus('авто: ' + next + ' (' + autoSteps + '/' + AUTO_MAX + ')');
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

    setStatus('ищу шлюз…');
    var gw = await findGateway();
    if (!gw) {
      history.push({
        role: 'assistant',
        content: '⚠️ Шлюз ИИ :8002 не отвечает — отправлять некуда.\n\n' +
          'На сервере (Termux) запусти:\n' +
          'cd ~/nexus_ws && deno run --allow-net --allow-env --allow-read ai.ts\n\n' +
          'Проверка: curl http://localhost:8002/ai/health',
        meta: 'нет связи со шлюзом'
      });
      saveHistory();
      render();
      return;
    }

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
      setStatus('шлюз ок · ' + (j.provider || '?'));
      maybeAuto(j.text || '');
    } catch (e) {
      var msg = e && e.name === 'AbortError' ? 'таймаут 95 сек' : (e && e.message || 'сбой');
      history.push({ role: 'assistant', content: '⚠️ Ошибка: ' + msg, meta: 'error' });
      setStatus('ошибка запроса: ' + msg, true);
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
    setStatus('адрес шлюза обновлён, проверяю…');
    findGateway();
  }

  function editSystem() {
    var val = window.prompt('Характер Помощника (системный промпт):', systemPrompt());
    if (val === null) return;
    try {
      if (val.trim()) localStorage.setItem(LS_SYSTEM, val.trim());
      else localStorage.removeItem(LS_SYSTEM);
    } catch (e) {}
    setStatus('характер сохранён');
  }

  function clearAll() {
    if (!window.confirm('Очистить историю диалога с Помощником?')) return;
    history = [];
    try { localStorage.removeItem(LS_HISTORY); } catch (e) {}
    render();
    setStatus('история очищена');
  }

  /* ---------- сборка панели ---------- */

  function build() {
    if (built && els.log && document.body.contains(els.log)) return;
    var body = document.getElementById('assistantBody');
    if (!body) return;   // разметки панели нет — собирать нечего
    body.innerHTML = '';

    /* строка инструментов */
    var bar = document.createElement('div');
    bar.className = 'assistant-bar';

    function toolBtn(label, title, fn, color) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'assistant-tool';
      b.textContent = label;
      b.title = title || '';
      if (color) b.style.color = color;
      b.onclick = fn;
      return b;
    }

    var autoBtn = toolBtn('▶ Авто', 'Авто-продолжение этапов', function () { setAuto(!auto); }, '#7ee08a');
    els.autoBtn = autoBtn;
    bar.appendChild(autoBtn);
    bar.appendChild(toolBtn('⚙️', 'Адрес ИИ-шлюза', openSettings));
    bar.appendChild(toolBtn('🧠', 'Характер Помощника', editSystem, '#ffd700'));
    bar.appendChild(toolBtn('🗑️', 'Очистить историю', clearAll, '#ff8888'));

    var status = document.createElement('span');
    status.className = 'assistant-status';
    status.textContent = 'шлюз: проверяю…';
    els.status = status;
    bar.appendChild(status);
    body.appendChild(bar);

    /* лента диалога */
    var log = document.createElement('div');
    log.className = 'assistant-log';
    els.log = log;
    body.appendChild(log);

    /* ввод */
    var row = document.createElement('div');
    row.className = 'assistant-input-row';

    var input = document.createElement('textarea');
    input.rows = 1;
    input.className = 'assistant-input';
    input.placeholder = 'Задача Помощнику… (Enter — отправить)';
    input.onkeydown = function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
    };
    els.input = input;
    row.appendChild(input);

    var sendBtn = document.createElement('button');
    sendBtn.type = 'button';
    sendBtn.className = 'assistant-send';
    sendBtn.textContent = '➤';
    sendBtn.onclick = send;
    els.send = sendBtn;
    row.appendChild(sendBtn);

    body.appendChild(row);
    built = true;
  }

  /* ---------- открыть / закрыть ---------- */

  function open() {
    build();
    var on = setPanel(!panelOn());
    if (on) {
      render();
      findGateway();
      setTimeout(function () { if (els.input) els.input.focus(); }, 150);
    } else if (auto) {
      setAuto(false);   // свернул панель — авто-цикл останавливаем
    }
  }

  function close() {
    if (auto) setAuto(false);
    setPanel(false);
  }

  /* Задача Помощнику от Архитектора (мост из chat.js).
     Панель открывается сама, чтобы Босс видел, что происходит. */
  function ask(text) {
    if (!text) return;
    setPanel(true);
    build();
    if (els.input) els.input.value = String(text);
    send();
  }

  /* ---------- публичный API ---------- */

  window.openAssistant = open;
  window.closeAssistant = close;
  window.closeAssistantPanel = close;
  window.assistantSend = send;
  window.assistantAuto = setAuto;
  window.assistantAsk = ask;

  loadHistory();
  // app.html грузит скрипты уже внутри DOMContentLoaded, поэтому слушатель
  // на это событие мог бы не сработать — проверяем readyState.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { build(); });
  } else {
    setTimeout(function () { build(); }, 300);
  }

  console.log('[ai.js] Панель Помощника готова. Шлюз ищется автоматически, ключи — на сервере.');
})();
