/* ============================================================
   АВТОПИЛОТ ШТАБА — «ДАЛЬШЕ» ПО СКРЫТОЙ МЕТКЕ В ЧАТЕ
   Работает БЕЗ интернета и без GitHub: следит за живым чатом.
   Архитектор в конце ответа ставит невидимую метку — скрипт её
   видит и сам отправляет в чат сообщение «дальше».

   Метки (любая из трёх):
     1) невидимые символы (основная) — Босс их не видит вообще;
     2) <!--NEXT--> — HTML-комментарий, в чате не отображается;
     3) [[NEXT]] — обычный текст (аварийный вариант).

   ПИНОК: «Слишком много шагов» или слово «Пинок» → автопилот сам
   отправляет «разбей на задачи по шагам».

   ПИНОК ПО ТАЙМЕРУ (300 сек):
   Пока Архитектор отвечает, на кнопке отправки идут секунды, а сам
   запрос обрывается на 300-й секунде. Если ответа так и не пришло —
   задача умирает на полуслове. Теперь на исходе таймера автопилот
   обрывает зависший запрос и сам отправляет Боссу задание:
   «Разбей на задачи и делай по одной задаче, отчитывайся после каждой».
   Работает даже при выключенном автопилоте.

   ГЛАВНОЕ ПРАВИЛО ЭТОГО ФАЙЛА:
   «уже видел» хранится в localStorage ПО ХЕШУ текста, а НЕ в
   data-атрибутах и НЕ в счётчиках — перерисовка чата их убивает.
   Хеш = чат + текст + номер такого же сообщения по счёту.
   Перерисовка хеш не меняет → повторной отправки нет.

   СМЕНА ЧАТА (build 34):
   Раньше смену чата ловили по id и по «count < lastMsgCount». При
   переходе из маленького чата в большой счётчик РОС — смену не
   замечали, и старое «Пинок» из истории снова вызывало автоотправку
   «разбей на задачи по шагам». Босс видел это как «мне приплывает
   сообщение, хотя я его не писал».
   Теперь чат опознаём ещё и по «отпечатку» первого сообщения
   (hash первого .chat-msg) — это ловится при любом переходе.
   ============================================================ */
(function () {
    const LS_ON = 'shtabAutopilotOn';
    const LS_DONE = 'shtabAutopilotDone';   // хеши уже отработанных сообщений
    const POLL_MS = 1200;                   // как часто смотрим чат
    const MAX_DONE = 60;

    // Невидимая метка: word-joiner + zero-width space (в тексте не видно)
    const ZW = '\u2060\u200B\u2060\u200B\u2060';
    const RE_ZW = /\u2060\u200B\u2060\u200B\u2060/;
    const RE_COMMENT = /<!--\s*NEXT\s*-->/i;
    const RE_PLAIN = /\[\[\s*NEXT\s*\]\]/i;

    // --- ПИНОК: системное «Слишком много шагов. Задача прервана.» ---
    // Якорь ^ и ограничение длины: иначе отчёт, где встречаются слова
    // «Слишком много шагов», принимался за системное сообщение.
    const RE_TOOMANY = /^\s*Слишком\s+много\s+шагов/i;
    const MAX_TOOMANY_LEN = 120;
    const KICK_TEXT = 'разбей на задачи по шагам';

    // --- ПИНОК СЛОВОМ: Босс пишет «Пинок» — это тоже команда ---
    const RE_KICK_WORD = /пинок/i;
    const MAX_KICK_LEN = 60;

    // --- ЗАЩИТА ОТ ПЕТЛИ ---
    // Отправка «разбей на задачи» сама вызывает ответ Архитектора, который
    // снова может закончиться «Слишком много шагов». Без паузы — петля.
    const KICK_COOLDOWN_MS = 45000;

    // --- ПИНОК ПО ТАЙМЕРУ (300 сек) ---
    // В чате идёт счётчик секунд, запрос обрывается сам на 300-й секунде.
    // Если ответа нет — на исходе таймера обрываем запрос и шлём задание.
    const TIMEOUT_KICK_TEXT = 'Разбей на задачи и делай по одной задаче, отчитывайся после каждой';
    const TIMEOUT_LIMIT_S = 298;             // порог: таймаут запроса в чате — 300 сек
    const TIMEOUT_KICK_COOLDOWN_MS = 120000; // не чаще одного пинка в 2 минуты
    const TIMEOUT_KICK_MAX = 3;              // не больше 3 пинков подряд без ответа

    let timer = null;
    let busy = false;       // уже отправляем — второй раз не дёргаем
    let waiting = 0;        // сколько циклов ждём, пока Архитектор договорит
    let lastKickAt = 0;     // когда последний раз отправляли «разбей на задачи»
    let lastChatId = null;  // какой чат открыт сейчас
    let lastHead = null;    // «отпечаток» первого сообщения чата
    let switchCooldown = 0; // тики «остывания» после смены/перерисовки чата
    let genStartMsgs = -1;  // сколько ответов Архитектора было на старте запроса
    let timeoutKickAt = 0;  // когда последний раз пинали по таймеру
    let timeoutKickRun = 0; // сколько пинков подряд без ответа

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
        if (list.indexOf(h) !== -1) return;
        list.push(h);
        while (list.length > MAX_DONE) list.shift();
        localStorage.setItem(LS_DONE, JSON.stringify(list));
    }
    function isDone(h) { return doneList().indexOf(h) !== -1; }

    function box() { return document.getElementById('chatContainer'); }

    // Какой чат открыт сейчас. Если переменной нет — общий ключ '_'.
    function chatKey() {
        return (typeof currentChatId !== 'undefined' && currentChatId) ? String(currentChatId) : '_';
    }

    // «Отпечаток» чата: hash первого сообщения. Меняется при смене чата
    // и при перерисовке в другой чат — но не при добавлении сообщений.
    function chatHead() {
        const b = box();
        if (!b) return '(нет)';
        const first = b.querySelector('.chat-msg');
        return first ? hash((first.innerText || '').slice(0, 200)) : '(пусто)';
    }

    /* Устойчивый хеш: чат + текст + номер такого же сообщения по счёту.
       Перерисовка чата порядок не меняет → хеш тот же → повтора нет.
       Два одинаковых сообщения Босса при этом остаются разными (n = 1 и 2). */
    function scan(sel, re, maxLen, tag) {
        const b = box();
        if (!b) return [];
        const out = [];
        const seen = {};
        b.querySelectorAll(sel).forEach(function (el) {
            const txt = (el.innerText || '').replace(/\s+/g, ' ').trim();
            if (!re.test(txt) || txt.length > maxLen) return;
            seen[txt] = (seen[txt] || 0) + 1;
            out.push({ el: el, hash: hash(tag + '|' + chatKey() + '|' + txt + '|' + seen[txt]) });
        });
        return out;
    }

    // Все сообщения Босса со словом «Пинок».
    function scanBossKicks() { return scan('.chat-msg.msg-boss', RE_KICK_WORD, MAX_KICK_LEN, 'kick'); }

    // Все системные «Слишком много шагов».
    function scanTooMany() { return scan('.chat-msg.msg-director', RE_TOOMANY, MAX_TOOMANY_LEN, 'many'); }

    // Кандидат на команду — только ПОСЛЕДНЕЕ сообщение своего типа, и только
    // если оно ещё не отработано. Команда «из середины» истории (после
    // перерисовки чата) не срабатывает — вторая линия защиты к хешу.
    function tailCandidate(list) {
        if (!list.length) return null;
        const last = list[list.length - 1];
        return isDone(last.hash) ? null : last;
    }

    // Помечаем всё, что уже есть в чате, как «виденное» — молча.
    function primeSeen() {
        scanBossKicks().forEach(function (m) { markDone(m.hash); });
        scanTooMany().forEach(function (m) { markDone(m.hash); });
        const b = box();
        if (!b) return;
        // Метку «дальше» из истории тоже считаем отработанной — иначе при
        // переключении чата автопилот отправит «дальше» в чужой чат.
        b.querySelectorAll('.chat-msg.msg-director').forEach(function (el) {
            const txt = el.innerText || '';
            const html = el.innerHTML || '';
            if (RE_ZW.test(txt) || RE_COMMENT.test(html) || RE_PLAIN.test(txt)) {
                const clean = txt.replace(RE_ZW, '').replace(RE_PLAIN, '').replace(/\s+/g, ' ').trim();
                markDone(hash(clean.slice(-400)));
            }
        });
    }

    /* Переключили чат, открыли заново или чат перерисовался — история
       принимается как «виденная». Опознаём по id чата И по «отпечатку»
       первого сообщения: только так ловится переход в чат, где сообщений
       БОЛЬШЕ, чем в предыдущем (иначе счётчик растёт и смену не видно). */
    function checkChatSwitch() {
        const b = box();
        if (!b) return false;
        const id = chatKey();
        const head = chatHead();
        if (id !== lastChatId || head !== lastHead) {
            lastChatId = id; lastHead = head;
            genStartMsgs = -1;    // счёт ответов для пинка по таймеру — заново
            primeSeen();
            switchCooldown = 3;   // даём DOM дорисоваться — команды не слушаем
            return true;
        }
        return false;
    }

    // Ищем метку только в ответах Архитектора (msg-director), не в своих сообщениях
    function findSignal() {
        const b = box();
        if (!b) return null;
        const msgs = b.querySelectorAll('.chat-msg.msg-director');
        for (let i = msgs.length - 1; i >= 0; i--) {
            const el = msgs[i];
            const html = el.innerHTML || '';
            const txt = el.innerText || '';
            if (!RE_ZW.test(txt) && !RE_COMMENT.test(html) && !RE_PLAIN.test(txt)) continue;
            const clean = txt.replace(RE_ZW, '').replace(RE_PLAIN, '').replace(/\s+/g, ' ').trim();
            const h = hash(clean.slice(-400));
            if (isDone(h)) return null;   // уже отработано
            return { el: el, hash: h, text: clean };
        }
        return null;
    }

    function sendText(text) {
        const input = document.getElementById('chatInput');
        if (!input) { log('Ошибка: поле ввода не найдено'); return; }
        // Не затираем текст, который Босс печатает сам.
        if (input.value && input.value.trim() && input.value.trim() !== text) {
            log('В поле ввода есть текст Босса — не мешаю');
            return;
        }
        input.value = text; input.style.height = 'auto';
        try {
            if (typeof sendMessage === 'function') sendMessage();
            else log('Ошибка: чат не готов');
        } catch (e) { log('Сбой отправки: ' + e.message); }
    }

    // Прошло ли достаточно времени с последнего пинка.
    function kickReady() { return (Date.now() - lastKickAt) > KICK_COOLDOWN_MS; }

    function fire(reason) {
        busy = true; waiting = 0; lastKickAt = Date.now();
        log(reason + ' → отправляю «' + KICK_TEXT + '»');
        sendText(KICK_TEXT);
        setTimeout(function () { busy = false; }, 4000);
    }

    /* ============================================================
       ПИНОК ПО ТАЙМЕРУ (300 СЕК)
       Пока идёт ответ, на кнопке отправки тикают секунды, а запрос
       обрывается сам на 300-й секунде. Если ответа не пришло — задача
       умирает на полуслове. На исходе таймера обрываем зависший запрос
       и сами отправляем Боссу задание: разбить работу на задачи и
       делать по одной, отчитываясь после каждой.
       ============================================================ */

    // Сколько ответов Архитектора сейчас в чате.
    function directorCount() {
        const b = box();
        return b ? b.querySelectorAll('.chat-msg.msg-director').length : 0;
    }

    // Секунды с кнопки отправки («123.4s»). -1 — запрос не идёт.
    function sendBtnElapsed() {
        const btn = document.getElementById('sendBtn');
        if (!btn) return -1;
        const m = String(btn.innerText || '').match(/^\s*([\d.]+)s\s*$/);
        return m ? parseFloat(m[1]) : -1;
    }

    // Обрываем зависший запрос и отправляем пинок от имени Босса.
    function fireTimeoutKick() {
        busy = true;
        try {
            if (typeof isGenerating !== 'undefined' && isGenerating) {
                if (typeof currentAbortController !== 'undefined' && currentAbortController) currentAbortController.abort();
                if (typeof typingTimer !== 'undefined') clearTimeout(typingTimer);
                isGenerating = false;
            }
        } catch (e) {}
        const input = document.getElementById('chatInput');
        if (!input) { busy = false; return; }
        if (input.value && input.value.trim()) { log('В поле ввода есть текст Босса — пинок не отправляю'); busy = false; return; }
        // Даём старому запросу «догаснуть» (его finally гасит статусы), потом шлём пинок.
        setTimeout(function () {
            input.value = TIMEOUT_KICK_TEXT;
            try {
                if (typeof sendMessage === 'function') sendMessage();
                else log('Ошибка: чат не готов');
            } catch (e) { log('Сбой пинка: ' + e.message); }
            setTimeout(function () { busy = false; }, 4000);
        }, 500);
    }

    // Следим за таймером: 300 сек без ответа — пинок.
    function checkTimeoutKick() {
        const gen = (typeof isGenerating !== 'undefined') && isGenerating;
        const sec = sendBtnElapsed();
        if (!gen || sec < 0) { genStartMsgs = -1; return; }        // запрос не идёт — счёт сброшен
        if (genStartMsgs < 0) { genStartMsgs = directorCount(); return; }
        if (directorCount() > genStartMsgs) {                       // ответ пришёл — всё хорошо
            genStartMsgs = -1; timeoutKickRun = 0; return;
        }
        if (sec < TIMEOUT_LIMIT_S) return;
        if ((Date.now() - timeoutKickAt) < TIMEOUT_KICK_COOLDOWN_MS) return;
        if (timeoutKickRun >= TIMEOUT_KICK_MAX) { genStartMsgs = -1; return; }
        timeoutKickAt = Date.now(); timeoutKickRun++; genStartMsgs = -1;
        log('Таймер ' + Math.round(sec) + 'с — ответа нет → пинок: «' + TIMEOUT_KICK_TEXT + '»');
        fireTimeoutKick();
    }

    function tick() {
        if (busy) return;

        // ПИНОК ПО ТАЙМЕРУ работает всегда — даже если автопилот выключен:
        // иначе ответ обрывается на 300-й секунде и задача умирает молча.
        checkTimeoutKick();
        if (busy) return;

        if (!isOn()) return;

        // 0) СМЕНИЛИ ЧАТ / ЧАТ ПЕРЕРИСОВАЛСЯ — история это не команда.
        //    Остываем несколько тиков: DOM может дорисоваться не сразу.
        const switched = checkChatSwitch();
        if (switchCooldown > 0) { switchCooldown--; waiting = 0; return; }
        if (switched) { waiting = 0; return; }

        const tooMany = tailCandidate(scanTooMany());
        const kick = tailCandidate(scanBossKicks());

        // Команда есть, но Архитектор ещё печатает — ждём, хеш не помечаем.
        if ((tooMany || kick) && typeof isGenerating !== 'undefined' && isGenerating) {
            waiting++;
            if (waiting === 1) log('Команда найдена, жду окончания ответа...');
            return;
        }

        // 1) ПИНОК — задача развалилась на «слишком много шагов»
        if (tooMany) {
            markDone(tooMany.hash);          // гасим сразу, иначе петля
            if (!kickReady()) { log('Пинок уже отправлялся — пауза, второй раз не шлю'); return; }
            fire('Поймал «слишком много шагов»');
            return;
        }

        // 1б) ПИНОК СЛОВОМ — Босс написал «Пинок»
        if (kick) {
            markDone(kick.hash);
            if (!kickReady()) { log('Пинок уже отправлялся — пауза, второй раз не шлю'); return; }
            fire('Босс сказал «Пинок»');
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
        lastChatId = chatKey();
        lastHead = chatHead();
        switchCooldown = 3;   // на старте тоже остываем, пока история рисуется
        timer = setInterval(tick, POLL_MS);
        log('Автопилот на связи. Слежу за чатом (без GitHub).');
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
})();
