/* ============================================================
   АВТОПИЛОТ ШТАБА — «ДАЛЬШЕ» ПО СКРЫТОЙ МЕТКЕ В ЧАТЕ
   Работает БЕЗ интернета и без GitHub: следит за живым чатом.
   Архитектор в конце ответа ставит невидимую метку — скрипт её
   видит и сам отправляет в чат сообщение «дальше».

   Метки, которые ловятся (любая из трёх):
     1) невидимые символы (основная) — Босс их не видит вообще;
     2) <!--NEXT--> — HTML-комментарий, в чате не отображается;
     3) [[NEXT]] — обычный текст (аварийный вариант).

   ПИНОК: «Слишком много шагов» или слово «Пинок» → автопилот сам
   отправляет «разбей на задачи по шагам».

   ГЛАВНОЕ ПРАВИЛО ЭТОГО ФАЙЛА:
   «уже видел» хранится в localStorage ПО ХЕШУ текста, а НЕ в
   data-атрибутах и НЕ в счётчиках. Атрибуты живут на элементе, а
   чат при перерисовке (loadChat, отправка, смена чата) создаёт
   элементы заново — метки пропадали, и автопилот повторно
   срабатывал на СТАРЫХ сообщениях. Босс видел это как «мне
   приплывает сообщение, хотя я его не писал».
   Хеш = чат + текст + номер такого же сообщения по счёту.
   Перерисовка и переключение чатов хеш не меняют → повтора нет.
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
    // Якорь ^ и ограничение длины: иначе мой же отчёт, где встречаются слова
    // «Слишком много шагов», принимался за системное сообщение и вызывал
    // ложную отправку.
    const RE_TOOMANY = /^\s*Слишком\s+много\s+шагов/i;
    const MAX_TOOMANY_LEN = 120;
    const KICK_TEXT = 'разбей на задачи по шагам';

    // --- ПИНОК СЛОВОМ: Босс пишет «Пинок» — это тоже команда «разбей на задачи» ---
    const RE_KICK_WORD = /пинок/i;
    const MAX_KICK_LEN = 60;

    // --- ЗАЩИТА ОТ ПЕТЛИ ---
    // Отправка «разбей на задачи» сама вызывает ответ Архитектора, который
    // снова может закончиться «Слишком много шагов». Без паузы получалась
    // бесконечная петля: Босс видел 5 одинаковых сообщений подряд.
    const KICK_COOLDOWN_MS = 45000;

    let timer = null;
    let busy = false;       // уже отправляем — второй раз не дёргаем
    let waiting = 0;        // сколько циклов ждём, пока Архитектор договорит
    let lastKickAt = 0;     // когда последний раз отправляли «разбей на задачи»
    let lastChatId = null;  // какой чат открыт сейчас
    let lastMsgCount = -1;  // сколько сообщений было в прошлый тик

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

    /* Устойчивый хеш: чат + текст + номер такого же сообщения по счёту.
       При перерисовке чата порядок сообщений не меняется → хеш тот же →
       повторной отправки нет. Два одинаковых сообщения Босса при этом
       остаются разными (n = 1 и 2). */
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

    // Первое сообщение из списка, чей хеш ещё не отработан.
    function firstNew(list) {
        for (let i = 0; i < list.length; i++) if (!isDone(list[i].hash)) return list[i];
        return null;
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

    // Переключили чат или чат очистили — история принимается как «виденная».
    function checkChatSwitch() {
        const b = box();
        if (!b) return false;
        const id = chatKey();
        const count = b.querySelectorAll('.chat-msg').length;
        if (id !== lastChatId || count < lastMsgCount) {
            lastChatId = id; lastMsgCount = count;
            primeSeen();
            return true;
        }
        lastMsgCount = count;
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
        if (input) { input.value = text; input.style.height = 'auto'; }
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

    function tick() {
        if (!isOn() || busy) return;

        // 0) СМЕНИЛИ ЧАТ — история это не команда, просто помечаем её.
        if (checkChatSwitch()) { waiting = 0; return; }

        const tooMany = firstNew(scanTooMany());
        const kick = firstNew(scanBossKicks());

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
        const bb = box();
        lastMsgCount = bb ? bb.querySelectorAll('.chat-msg').length : 0;
        lastChatId = chatKey();
        timer = setInterval(tick, POLL_MS);
        log('Автопилот на связи. Слежу за чатом (без GitHub).');
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
})();
