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
    const LS_DONE = 'shtabAutopilotDone';   // хеши уже отработанных меток
    const POLL_MS = 1200;                   // как часто смотрим чат
    const MAX_DONE = 60;

    // Невидимая метка: word-joiner + zero-width space (в тексте не видно)
    const ZW = '\u2060\u200B\u2060\u200B\u2060';
    const RE_ZW = /\u2060\u200B\u2060\u200B\u2060/;
    const RE_COMMENT = /<!--\s*NEXT\s*-->/i;
    const RE_PLAIN = /\[\[\s*NEXT\s*\]\]/i;

    // --- ПИНОК: ловим системное «Слишком много шагов. Задача прервана.» ---
    const RE_TOOMANY = /Слишком\s+много\s+шагов/i;
    // --- ПИНОК СЛОВОМ: Босс пишет «Пинок» — команда «разбей на задачи» ---
    const RE_KICK_WORD = /пинок/i;
    const KICK_TEXT = 'разбей на задачи по шагам';

    /* --- НАДЁЖНАЯ ЗАЩИТА ОТ ПЕРЕРИСОВКИ ЧАТА ---
       Держим ссылку на последний ОБРАБОТАННЫЙ узел сообщения (lastMsgEl).

       • Новое сообщение ДОБАВЛЯЕТСЯ в конец — старый узел остаётся в DOM.
         Значит новое = всё, что появилось ПОСЛЕ lastMsgEl.
       • Смена чата / loadChat ПЕРЕРИСОВЫВАЕТ историю (chatContainer.innerHTML='').
         Старый узел выпадает из DOM → это перерисовка, НИЧЕГО не отправляем.

       Раньше считали «сколько раз встречается слово» и сверяли currentChatId.
       При переключении чатов счётчик прыгал 0 → N, и автопилот САМ отправлял
       «разбей на задачи по шагам» (Босс видел это как «мне приплывает сообщение,
       хотя я его не писал»). Теперь опираемся только на идентичность DOM-узлов —
       это не зависит ни от счётчиков, ни от currentChatId. */
    let lastMsgEl = null;

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
        if (list.indexOf(h) !== -1) return;
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

    /* Возвращает только НОВЫЕ сообщения (появившиеся после lastMsgEl).
       При перерисовке истории возвращает { rerender: true } и ничего не отдаёт. */
    function scanMessages() {
        const box = document.getElementById('chatContainer');
        if (!box) return { fresh: [], rerender: false };
        const msgs = Array.prototype.slice.call(box.querySelectorAll('.chat-msg'));
        if (msgs.length === 0) return { fresh: [], rerender: false };

        // Перерисовка: последний обработанный узел больше не в контейнере.
        if (lastMsgEl && !box.contains(lastMsgEl)) {
            lastMsgEl = msgs[msgs.length - 1];
            return { fresh: [], rerender: true };
        }

        // Новые сообщения — только те, что идут после lastMsgEl.
        let fresh = [];
        if (lastMsgEl) {
            const idx = msgs.indexOf(lastMsgEl);
            if (idx !== -1) fresh = msgs.slice(idx + 1);
        }
        lastMsgEl = msgs[msgs.length - 1];
        return { fresh: fresh, rerender: false };
    }

    // Помечаем всю текущую историю как «виденную» — молча, без отправки.
    // Метки «дальше» из истории тоже считаем отработанными, иначе при смене
    // чата автопилот отправит «дальше» в чужой чат.
    function primeAll() {
        const box = document.getElementById('chatContainer');
        if (!box) return;
        const dirs = box.querySelectorAll('.chat-msg.msg-director');
        for (let i = 0; i < dirs.length; i++) {
            const el = dirs[i];
            const txt = el.innerText || '';
            const html = el.innerHTML || '';
            if (RE_ZW.test(txt) || RE_COMMENT.test(html) || RE_PLAIN.test(txt)) {
                const clean = txt.replace(RE_ZW, '').replace(RE_PLAIN, '').replace(/\s+/g, ' ').trim();
                markDone(hash(clean.slice(-400)));
            }
        }
        const all = box.querySelectorAll('.chat-msg');
        lastMsgEl = all.length ? all[all.length - 1] : null;
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

        const scan = scanMessages();

        // 0) ПЕРЕРИСОВКА (смена чата / loadChat) — история это НЕ команда.
        if (scan.rerender) { waiting = 0; return; }

        // Нет новых сообщений — делать нечего.
        if (scan.fresh.length === 0) { waiting = 0; return; }

        // 1) Ищем команду ТОЛЬКО среди новых сообщений:
        //    «Пинок» словом (от Босса) или «Слишком много шагов» (система).
        let kickEl = null, tooManyEl = null;
        for (let i = 0; i < scan.fresh.length; i++) {
            const el = scan.fresh[i];
            const txt = el.innerText || '';
            if (el.classList.contains('msg-boss') && RE_KICK_WORD.test(txt)) { kickEl = el; break; }
            if (el.classList.contains('msg-director') && RE_TOOMANY.test(txt)) { tooManyEl = el; break; }
        }

        if (tooManyEl || kickEl) {
            if (typeof isGenerating !== 'undefined' && isGenerating) { waiting++; return; }
            busy = true; waiting = 0;
            log(tooManyEl ? 'Поймал «слишком много шагов» → отправляю «' + KICK_TEXT + '»'
                          : 'Босс сказал «Пинок» → отправляю «' + KICK_TEXT + '»');
            sendText(KICK_TEXT);
            setTimeout(function () { busy = false; }, 4000);
            return;
        }

        // 2) МЕТКА — обычный шаг (повтор отсекает doneList).
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
        primeAll();
        timer = setInterval(tick, POLL_MS);
        log('Автопилот на связи. Слежу за чатом (без GitHub).');
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
})();
