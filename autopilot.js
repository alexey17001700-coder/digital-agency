/* ============================================================
   АВТОПИЛОТ ШТАБА — «ДАЛЬШЕ» ПО СКРЫТОЙ МЕТКЕ В ЧАТЕ
   Работает БЕЗ интернета и без GitHub: следит за живым чатом.
   Архитектор в конце ответа ставит невидимую метку — скрипт её
   видит и сам отправляет в чат сообщение «дальше».

   Метки, которые ловятся (любая из трёх):
     1) невидимые символы (основная) — Босс их не видит вообще;
     2) <!--NEXT--> — HTML-комментарий, в чате не отображается;
     3) [[NEXT]] — обычный текст (аварийный вариант).
   ============================================================ */
(function () {
    const LS_ON = 'shtabAutopilotOn';
    const LS_DONE = 'shtabAutopilotDone';   // хеши уже отработанных сообщений
    const POLL_MS = 1200;                   // как часто смотрим чат
    const MAX_DONE = 30;

    // Невидимая метка: word-joiner + zero-width space (в тексте не видно)
    const ZW = '\u2060\u200B\u2060\u200B\u2060';
    const RE_ZW = /\u2060\u200B\u2060\u200B\u2060/;
    const RE_COMMENT = /<!--\s*NEXT\s*-->/i;
    const RE_PLAIN = /\[\[\s*NEXT\s*\]\]/i;

    // --- ПИНОК: ловим системное «Слишком много шагов. Задача прервана.» ---
    // ВАЖНО: помечаем КАЖДОЕ сообщение, а не считаем «сколько раз в чате».
    // Раньше счётчик шёл по всему контейнеру, и при переключении чата
    // (loadChat перерисовывает историю) счётчик прыгал 0 → N. Автопилот решал,
    // что Босс написал «Пинок», и САМ отправлял «разбей на задачи по шагам».
    const RE_TOOMANY = /Слишком\s+много\s+шагов/i;
    const KICK_TEXT = 'разбей на задачи по шагам';

    // --- ПИНОК СЛОВОМ: Босс пишет «Пинок» — это тоже команда «разбей на задачи» ---
    const RE_KICK_WORD = /пинок/i;

    // Метки «уже видел» ставим прямо на сообщения (data-атрибуты).
    const ATTR_KICK = 'apKick';
    const ATTR_TOOMANY = 'apTooMany';
    let lastChatId = null;      // какой чат открыт сейчас
    let lastMsgCount = -1;      // сколько сообщений было в прошлый тик

    let timer = null;
    let busy = false;      // уже отправляем — второй раз не дёргаем
    let waiting = 0;       // сколько циклов ждём, пока Архитектор договорит

    function isOn() { return localStorage.getItem(LS_ON) !== 'off'; }

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

    function hash(s) {
        let h = 5381;
        for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
        return 'h' + (h >>> 0).toString(36) + '_' + s.length;
    }

    function doneList() {
        try { return JSON.parse(localStorage.getItem(LS_DONE) || '[]'); } catch (e) { return []; }
    }
    function markDone(h) {
        const list = doneList();
        list.push(h);
        while (list.length > MAX_DONE) list.shift();
        localStorage.setItem(LS_DONE, JSON.stringify(list));
    }

    // Ищем метку только в ответах Архитектора (msg-director), не в своих сообщениях
    function findSignal() {
        const box = document.getElementById('chatContainer');
        if (!box) return null;
        const msgs = box.querySelectorAll('.chat-msg.msg-director');
        for (let i = msgs.length - 1; i >= 0; i--) {
            const el = msgs[i];
            const html = el.innerHTML || '';
            const txt = el.innerText || '';
            if (!RE_ZW.test(txt) && !RE_COMMENT.test(html) && !RE_PLAIN.test(txt)) continue;
            const clean = txt.replace(RE_ZW, '').replace(RE_PLAIN, '').replace(/\s+/g, ' ').trim();
            const h = hash(clean.slice(-400));
            if (doneList().indexOf(h) !== -1) return null;   // уже отработано
            return { el: el, hash: h, text: clean };
        }
        return null;
    }

    /* --- «УЖЕ ВИДЕЛ» ВМЕСТО СЧЁТЧИКОВ ---
       Переключение чата перерисовывает историю: сообщения появляются заново.
       Раньше автопилот считал их новыми и сам отправлял «разбей на задачи по шагам»
       (Босс видел это как «мне приплывает сообщение, хотя я его не писал»).
       Теперь каждое сообщение помечается data-атрибутом, а при старте и при
       переключении чата вся история помечается «виденной» БЕЗ отправки. */

    // Помечаем всё, что уже есть в чате, как «виденное» — молча.
    function primeSeen() {
        const box = document.getElementById('chatContainer');
        if (!box) return;
        box.querySelectorAll('.chat-msg.msg-boss').forEach(function (el) {
            if (RE_KICK_WORD.test(el.innerText || '')) el.dataset[ATTR_KICK] = '1';
        });
        box.querySelectorAll('.chat-msg.msg-director').forEach(function (el) {
            const txt = el.innerText || '';
            const html = el.innerHTML || '';
            if (RE_TOOMANY.test(txt)) el.dataset[ATTR_TOOMANY] = '1';
            // Метку «дальше» из истории тоже считаем отработанной — иначе при
            // переключении чата автопилот отправит «дальше» в чужой чат.
            if (RE_ZW.test(txt) || RE_COMMENT.test(html) || RE_PLAIN.test(txt)) {
                const clean = txt.replace(RE_ZW, '').replace(RE_PLAIN, '').replace(/\s+/g, ' ').trim();
                markDone(hash(clean.slice(-400)));
            }
        });
    }

    // Новое сообщение Босса со словом «Пинок» (ещё не помеченное).
    function findNewKick() {
        const box = document.getElementById('chatContainer');
        if (!box) return null;
        const msgs = box.querySelectorAll('.chat-msg.msg-boss');
        for (let i = 0; i < msgs.length; i++) {
            const el = msgs[i];
            if (el.dataset[ATTR_KICK]) continue;
            if (RE_KICK_WORD.test(el.innerText || '')) return el;
            el.dataset[ATTR_KICK] = '1';   // без «пинка» — больше не проверяем
        }
        return null;
    }

    // Новое системное «Слишком много шагов» (ещё не помеченное).
    function findNewTooMany() {
        const box = document.getElementById('chatContainer');
        if (!box) return null;
        const msgs = box.querySelectorAll('.chat-msg.msg-director');
        for (let i = 0; i < msgs.length; i++) {
            const el = msgs[i];
            if (el.dataset[ATTR_TOOMANY]) continue;
            if (RE_TOOMANY.test(el.innerText || '')) return el;
            el.dataset[ATTR_TOOMANY] = '1';
        }
        return null;
    }

    // Переключили чат или чат очистили — история принимается как «виденная».
    function checkChatSwitch() {
        const box = document.getElementById('chatContainer');
        if (!box) return false;
        const id = (typeof currentChatId !== 'undefined') ? currentChatId : null;
        const count = box.querySelectorAll('.chat-msg').length;
        if (id !== lastChatId || count < lastMsgCount) {
            lastChatId = id; lastMsgCount = count;
            primeSeen();
            return true;
        }
        lastMsgCount = count;
        return false;
    }

    function sendText(text) {
        const input = document.getElementById('chatInput');
        if (input) { input.value = text; input.style.height = 'auto'; }
        try {
            if (typeof sendMessage === 'function') sendMessage();
            else log('Ошибка: чат не готов');
        } catch (e) { log('Сбой отправки: ' + e.message); }
    }

    function tick() {
        if (!isOn() || busy) return;

        // 0) СМЕНИЛИ ЧАТ — история это не команда, просто помечаем её.
        if (checkChatSwitch()) { waiting = 0; return; }

        // 1) ПИНОК — задача развалилась на «слишком много шагов»
        const tooManyEl = findNewTooMany();
        if (tooManyEl) {
            if (typeof isGenerating !== 'undefined' && isGenerating) { waiting++; return; }
            busy = true; waiting = 0;
            tooManyEl.dataset[ATTR_TOOMANY] = '1';
            log('Поймал «слишком много шагов» → отправляю «' + KICK_TEXT + '»');
            sendText(KICK_TEXT);
            setTimeout(function () { busy = false; }, 4000);
            return;
        }

        // 1б) ПИНОК СЛОВОМ — Босс написал «Пинок»
        const kickEl = findNewKick();
        if (kickEl) {
            if (typeof isGenerating !== 'undefined' && isGenerating) { waiting++; return; }
            busy = true; waiting = 0;
            kickEl.dataset[ATTR_KICK] = '1';
            log('Босс сказал «Пинок» → отправляю «' + KICK_TEXT + '»');
            sendText(KICK_TEXT);
            setTimeout(function () { busy = false; }, 4000);
            return;
        }

        // 2) МЕТКА — обычный шаг
        const sig = findSignal();
        if (!sig) { waiting = 0; return; }

        // Архитектор ещё печатает или думает — ждём, метка никуда не денется
        if (typeof isGenerating !== 'undefined' && isGenerating) {
            waiting++;
            if (waiting === 1) log('Метка найдена, жду окончания ответа...');
            return;
        }

        busy = true;
        waiting = 0;
        markDone(sig.hash);
        const step = (sig.text.match(/ШАГ\s*(\d+)/i) || [])[1];
        log('Метка поймана' + (step ? ' (шаг ' + step + ')' : '') + ' → отправляю «дальше»');
        sendText('дальше');
        setTimeout(function () { busy = false; }, 4000);
    }

    function start() {
        setBtn();
        const b = document.getElementById('autopilotBtn');
        if (b) b.onclick = toggle;
        if (timer) clearInterval(timer);
        // Стартовая история чата — не команда: помечаем молча.
        primeSeen();
        lastMsgCount = (document.getElementById('chatContainer') || { querySelectorAll: function () { return []; } }).querySelectorAll('.chat-msg').length;
        lastChatId = (typeof currentChatId !== 'undefined') ? currentChatId : null;
        timer = setInterval(tick, POLL_MS);
        log('Автопилот на связи. Слежу за чатом (без GitHub).');
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
})();
