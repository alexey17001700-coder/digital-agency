/* ============================================================
   АВТОПИЛОТ ШТАБА — «ДАЛЬШЕ» ПО МЕТКЕ В ЧАТЕ
   Работает ЛОКАЛЬНО: следит за самим чатом на экране.
   Никаких запросов в GitHub — интернет не нужен вообще.

   Как работает:
   1. Архитектор, закончив шаг, пишет в ответе метку [NEXT: шаг N].
   2. Скрипт видит метку прямо в чате, убирает её из текста
      (чтобы не мешала) и сам отправляет «дальше».
   3. Одну и ту же метку дважды не отработает — даже после
      перезагрузки страницы (подпись метки хранится локально).
   ============================================================ */
(function () {
    const POLL_MS = 1500;                 // как часто смотрим в чат
    const LS_ON = 'shtabAutopilotOn';     // вкл/выкл
    const LS_DONE = 'shtabAutopilotDone'; // уже отработанные метки
    const MARKER_RE = /\[\[?NEXT(?::\s*([^\]\[]*))?\]\]?/i;

    let timer = null;
    let waiting = 0;

    function isOn() { return localStorage.getItem(LS_ON) !== 'off'; }

    function doneList() {
        try { return JSON.parse(localStorage.getItem(LS_DONE)) || []; } catch (e) { return []; }
    }
    function markDone(sig) {
        const list = doneList();
        list.push(sig);
        while (list.length > 60) list.shift();
        try { localStorage.setItem(LS_DONE, JSON.stringify(list)); } catch (e) {}
    }

    function setBtn() {
        const b = document.getElementById('autopilotBtn');
        if (!b) return;
        if (isOn()) { b.innerText = '🤖 Автопилот: ВКЛ'; b.classList.add('active'); }
        else { b.innerText = '🤖 Автопилот: ВЫКЛ'; b.classList.remove('active'); }
    }

    function toggle() {
        localStorage.setItem(LS_ON, isOn() ? 'off' : 'on');
        setBtn();
        log(isOn() ? 'Автопилот включён — слежу за чатом' : 'Автопилот выключен');
    }

    function log(msg) {
        const el = document.getElementById('autopilotLog');
        if (!el) return;
        const d = document.createElement('div');
        d.className = 'autopilot-line';
        d.innerText = new Date().toLocaleTimeString() + ' · ' + msg;
        el.appendChild(d);
        el.scrollTop = el.scrollHeight;
        while (el.children.length > 30) el.removeChild(el.firstChild);
    }

    // Убираем метку из текста на экране — Боссу она не нужна.
    function stripMarker(el) {
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
        const nodes = [];
        while (walker.nextNode()) nodes.push(walker.currentNode);
        nodes.forEach(n => {
            if (MARKER_RE.test(n.nodeValue)) n.nodeValue = n.nodeValue.replace(MARKER_RE, '').replace(/\s{2,}/g, ' ').trim();
        });
    }

    function scan() {
        if (!isOn()) return;
        const box = document.getElementById('chatContainer');
        if (!box) return;
        const msgs = box.querySelectorAll('.chat-msg');
        if (!msgs.length) return;

        const chatId = (typeof currentChatId !== 'undefined' && currentChatId) ? currentChatId : 'chat';
        const done = doneList();

        // Смотрим только последние сообщения — метка всегда в свежем ответе.
        for (let i = Math.max(0, msgs.length - 6); i < msgs.length; i++) {
            const el = msgs[i];
            if (!el.classList.contains('msg-director')) continue;
            const txt = el.innerText || '';
            const m = txt.match(MARKER_RE);
            if (!m) continue;

            const sig = chatId + '#' + i + '#' + m[0].toLowerCase();
            if (done.indexOf(sig) !== -1) continue;

            markDone(sig);
            stripMarker(el);
            const step = (m[1] || '').trim();
            log('Метка поймана' + (step ? ' (' + step + ')' : '') + ' → отправляю «дальше»');
            fire();
            return;
        }
    }

    function fire() {
        // Архитектор ещё печатает — ждём, пока закончит.
        if (typeof isGenerating !== 'undefined' && isGenerating) {
            waiting++;
            if (waiting > 80) { waiting = 0; log('Долго ждал — отправляю «дальше» всё равно'); }
            else { setTimeout(fire, 1000); return; }
        }
        waiting = 0;
        const input = document.getElementById('chatInput');
        if (!input) { log('Ошибка: поле ввода не найдено'); return; }
        input.value = 'дальше';
        input.style.height = 'auto';
        if (typeof sendMessage === 'function') sendMessage();
        else log('Ошибка: чат не готов');
    }

    function start() {
        setBtn();
        const b = document.getElementById('autopilotBtn');
        if (b) b.onclick = toggle;
        if (timer) clearInterval(timer);
        timer = setInterval(scan, POLL_MS);
        log('Автопилот на связи — читаю чат напрямую');
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
})();
