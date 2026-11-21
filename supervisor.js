/* ============================================================
   НАДЗИРАТЕЛЬ — supervisor.js
   ------------------------------------------------------------
   Следит за диалогом Босса в Штабе и не даёт задаче умереть молча.

   Кто ведёт задачу (Архитектор или Помощник), когда ответил,
   сколько ждём ответа — всё лежит в localStorage под ключом
   shtabSupervisor. Оба агента пишут в один журнал и читают его,
   поэтому видят, что делает второй.

   ЭТАП 1: журнал задач + детект молчания + запись в ленту чата.
   ЭТАП 2: передача задачи второму агенту + бесплатная модель.
   ЭТАП 3: компактный индикатор в ленте + стоп-кран + ловля
           оборвавшегося счётчика на кнопке «Отправить».

   ЦЕПОЧКА ЗАМЕНЫ: Архитектор → Помощник → Бесплатная модель → стоп.
   Если агент молчит или сорвался, задача уходит следующему по цепочке.
   Число передач ограничено SUP_MAX_HANDOFFS — иначе два ИИ зациклятся
   и будут бесконечно пинать друг друга.

   СРОК МОЛЧАНИЯ = 300 с. Это лимит кнопки отправки. Пока он не вышел,
   агент считается работающим — даже если ответа ещё нет. Передача
   происходит только после 300 с тишины.

   НО ЕСТЬ И БЫСТРЫЕ ПРИЗНАКИ ОБРЫВА — по ним задача уходит дальше сразу,
   не дожидаясь 300 с:
   1) счётчик на кнопке «Отправить» ЗАСТЫЛ (не меняется 8 с) — поток умер;
   2) счётчик ОБОРВАЛСЯ (цифр нет, запрос не идёт), а ответа в ленте нет;
   3) ответ пришёл БИТЫМ — заглушка «пустой ответ» или «слишком много шагов.
      Задача прервана» (лимит шагов сервера).

   ОБОРВАВШИЙСЯ СЧЁТЧИК (Босс): на кнопке «Отправить» бегут секунды.
   Если счётчик ЗАМЕР (не меняется 6 с) или ПРОПАЛ, а ответа в чате нет —
   это обрыв потока, и задача уходит следующему СРАЗУ, не дожидаясь 300 с.

   Файл самостоятельный: ни от чего не зависит, всё внешнее —
   через typeof-проверки. Если chat.js не загрузился, надзиратель
   просто молчит и ничего не ломает.
   ============================================================ */
(function () {
    'use strict';

    const SUP_KEY = 'shtabSupervisor';
    const SUP_SILENCE_MS = 300000;      // 300 с — лимит кнопки отправки. Раньше этого срока агент может работать, это не молчание
    const SUP_TICK_MS = 5000;           // проверка каждые 5 с
    const SUP_MAX_HANDOFFS = 2;         // не больше 2 передач на одну задачу (стоп-кран)
    const SUP_TEXT_LIMIT = 2000;        // столько текста задачи храним в журнале
    const SUP_TIMER_GRACE_MS = 8000;    // первые 8 с счётчик на кнопке ещё не запущен — это не поломка
    const SUP_TIMER_FREEZE_MS = 6000;   // счётчик не менялся 6 с — застыл, значит поток умер
    const SUP_HANDOFF_GUARD_MS = 15000; // защита от двойной передачи: две проверки не передают задачу дважды
    /* Признаки битого ответа: заглушка «пустой ответ» и обрыв по лимиту шагов.
       Такой ответ = задача не сделана, её надо передать дальше. */
    const SUP_EMPTY_RE = /(?:^|[\s(\[«"'])(?:пуст(?:ой|ые|ая|ое|ым|ых)|нет\s+ответа|ответ\s+(?:пуст|отсутств)|empty\s+(?:answer|response)|no\s+(?:answer|response))(?=$|[\s)\]»"'.,!])/i;
    const SUP_STEPS_RE = /слишком много шагов|задача прервана|too many steps/i;

    const OWNER_LABEL = { arch: '🏛 Архитектор', assistant: '🤖 Помощник', free: '🆓 Бесплатная модель' };
    const OWNER_NEXT = { arch: 'assistant', assistant: 'free' };   // цепочка замены

    let supTimer = null;
    let supLastTimerText = '';        // текст счётчика на кнопке «Отправить» на прошлой проверке
    let supLastTimerChange = 0;       // когда счётчик менялся в последний раз
    let supStartCount = 0;            // сколько ответов было в ленте на момент старта задачи
    let supBusy = false;              // передача уже идёт — второй раз не дёргаем

    /* ---------- ЖУРНАЛ ---------- */

    function supLoad() {
        try {
            const raw = localStorage.getItem(SUP_KEY);
            const o = raw ? JSON.parse(raw) : null;
            return (o && typeof o === 'object') ? o : null;
        } catch (e) { return null; }
    }
    function supSave(o) {
        try { localStorage.setItem(SUP_KEY, JSON.stringify(o)); } catch (e) {}
    }
    function supClear() {
        try { localStorage.removeItem(SUP_KEY); } catch (e) {}
        supIndicatorHide();
    }
    function ownerLabel(o) { return OWNER_LABEL[o] || ('❔ ' + o); }

    /* Задача взята в работу. owner: 'arch' | 'assistant' */
    function supStart(text, owner) {
        supLastTimerText = ''; supLastTimerChange = Date.now();   // отсчёт застывания счётчика — с нуля
        supStartCount = supAgentNodes().length;                   // старые ответы в ленте не пересматриваем
        const prev = supLoad();
        const history = (prev && Array.isArray(prev.history)) ? prev.history : [];
        supSave({
            text: String(text || '').slice(0, SUP_TEXT_LIMIT),
            owner: owner || 'arch',
            status: 'waiting',                 // waiting | answered | stalled | failed
            handoffs: 0,
            startedAt: Date.now(),
            lastSeen: Date.now(),
            timerText: '',
            timerChange: Date.now(),
            lastHandoffAt: 0,
            history: history
        });
        supLog('📋 *[Надзиратель: задачу взял ' + ownerLabel(owner) + '. Жду ответа.]*');
        supIndicator('waiting', ownerLabel(owner) + ' работает…');
    }

    /* Агент ответил — задача закрыта. */
    function supAnswered(owner) {
        const st = supLoad();
        if (!st) return;
        if (owner && st.owner && owner !== st.owner) return;   // ответил не тот, кто ведёт — не закрываем
        st.status = 'answered';
        st.lastSeen = Date.now();
        supSave(st);
        supLog('✅ *[Надзиратель: ' + ownerLabel(st.owner) + ' ответил. Задача закрыта.]*');
        supIndicator('answered', ownerLabel(st.owner) + ' ответил');
        setTimeout(supClear, 1500);            // журнал чистим, чтобы не копить мусор
    }

    /* Агент сорвался (ошибка, пустой ответ, обрыв).
       Не просто помечаем сбой — сразу пробуем передать задачу дальше. */
    function supFailed(owner, reason) {
        const st = supLoad();
        if (!st) return;
        if (st.status === 'answered') return;
        if (owner && st.owner && owner !== st.owner) return;   // сбой от чужого агента — не наша задача
        st.status = 'failed';
        st.lastSeen = Date.now();
        st.reason = String(reason || 'сбой').slice(0, 300);
        supSave(st);
        supLog('⚠️ *[Надзиратель: ' + ownerLabel(owner || st.owner) + ' сорвался — ' + st.reason + '.]*');
        supHandoff();                          // пробуем следующего по цепочке
    }

    /* Пульс: агент ещё жив и работает (длинный запрос). */
    function supHeartbeat(owner) {
        const st = supLoad();
        if (!st) return;
        if (owner && st.owner && owner !== st.owner) return;
        st.lastSeen = Date.now();
        if (st.status === 'stalled') st.status = 'waiting';
        supSave(st);
    }

    /* ---------- ОБРЫВ: МОЛЧАНИЕ / ЗАСТЫВШИЙ ИЛИ ПРОПАВШИЙ СЧЁТЧИК ----------
       Единая точка: агент перестал отвечать (300 с тишины ЛИБО счётчик
       на кнопке замер/пропал) — задача уходит следующему по цепочке.
       Возвращает true, если надзиратель взял это на себя. */
    function supBreak(reason) {
        const st = supLoad();
        if (!st || st.status !== 'waiting') return false;
        st.status = 'stalled';
        st.lastSeen = Date.now();
        st.reason = String(reason || 'обрыв').slice(0, 300);
        supSave(st);
        supLog('⏳ *[Надзиратель: ' + ownerLabel(st.owner) + ' — ' + st.reason + '. Передаю задачу дальше.]*');
        supIndicator('stalled', '⚠️ ' + ownerLabel(st.owner) + ' молчит');
        supHandoff();
        return true;
    }

    /* ---------- ПЕРЕДАЧА ЗАДАЧИ ---------- */

    /* Кому передаём дальше: Архитектор → Помощник → Бесплатная модель.
       Передачи ограничены — иначе два ИИ зациклятся. */
    function supHandoff() {
        if (supBusy) return;              // передача уже идёт — вторую не запускаем
        const st = supLoad();
        if (!st) return;
        if (st.status === 'answered') return;
        if (st.lastHandoffAt && (Date.now() - st.lastHandoffAt) < SUP_HANDOFF_GUARD_MS) return;   // двойную передачу не делаем
        if ((st.handoffs || 0) >= SUP_MAX_HANDOFFS) { supStopKran(st); return; }
        const prev = st.owner;
        const next = OWNER_NEXT[prev];
        if (!next) { supStopKran(st); return; }
        st.owner = next;
        st.handoffs = (st.handoffs || 0) + 1;
        st.status = 'waiting';
        st.startedAt = Date.now();
        st.lastSeen = Date.now();
        st.timerText = '';
        st.timerChange = Date.now();
        st.lastHandoffAt = Date.now();
        st.reason = '';
        supSave(st);
        supLog('🔄 *[Надзиратель: ' + ownerLabel(prev) + ' не справился. Передаю задачу ' + ownerLabel(next) + ' (' + st.handoffs + '/' + SUP_MAX_HANDOFFS + ').]*');
        supIndicator('handoff', '🔄 передал ' + ownerLabel(next));
        supDispatch(st.text, next);
    }

    /* Стоп-кран: передачи исчерпаны — дальше только Босс. */
    function supStopKran(st) {
        st.status = 'failed';
        st.lastSeen = Date.now();
        supSave(st);
        supLog('🛑 *[Надзиратель: ' + ownerLabel(st.owner) + ' молчит, передачи исчерпаны (' + SUP_MAX_HANDOFFS + '/' + SUP_MAX_HANDOFFS + '). Нужен Босс.]*');
        supIndicator('stop', '🛑 нужен Босс');
    }

    /* Отправляем задачу новому владельцу и следим за результатом. */
    async function supDispatch(text, owner) {
        try {
            if (owner === 'assistant' && typeof window.sendToAssistant === 'function') {
                const ok = await window.sendToAssistant(text);
                if (ok) supAnswered('assistant'); else supFailed('assistant', 'Помощник не ответил');
            } else if (owner === 'free' && typeof window.sendToFreeModel === 'function') {
                const ok = await window.sendToFreeModel(text);
                if (ok) supAnswered('free'); else supFailed('free', 'Бесплатная модель не ответила');
            } else if (owner === 'arch' && typeof window.sendMessage === 'function') {
                window.sendMessage(text, true);   // Архитектор сам закроет журнал (supAnswered/supFailed)
            } else {
                supFailed(owner, 'нет канала для передачи');
            }
        } catch (e) {
            supFailed(owner, (e && e.message) || 'сбой передачи');
        } finally {
            supBusy = false;              // передача завершена — надзиратель снова на связи
        }
    }

    /* ---------- ВЫВОД В ЛЕНТУ ---------- */

    function supLog(text) {
        try {
            if (typeof renderMessage === 'function') renderMessage(text, 'director', 'Надзиратель');
        } catch (e) { /* лента недоступна — молчим */ }
    }

    /* ---------- КОМПАКТНЫЙ ИНДИКАТОР (ЭТАП 3) ----------
       Раньше каждая проверка писала в ленту длинную строку — Босс тонул
       в служебных сообщениях. Теперь состояние видно в маленькой плашке
       внизу слева: кто работает, кто молчит, кому передали задачу. */
    function supIndicatorCss() {
        if (document.getElementById('supIndicatorCss')) return;
        const st = document.createElement('style'); st.id = 'supIndicatorCss';
        st.textContent = `
        .sup-indicator {
            position: fixed; left: 10px; bottom: 78px; z-index: 9000;
            display: none; align-items: center; gap: 6px;
            max-width: 62vw; padding: 5px 10px;
            font-size: 11px; font-weight: 700; font-family: inherit;
            color: #cfefff; background: rgba(10,20,28,.86);
            border: 1px solid rgba(0,229,255,.45); border-radius: 999px;
            backdrop-filter: blur(6px); pointer-events: none;
            white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .sup-indicator.show { display: inline-flex; }
        .sup-indicator.waiting { border-color: rgba(0,229,255,.45); color: #9fe8ff; }
        .sup-indicator.stalled { border-color: rgba(255,193,7,.6); color: #ffd76a; }
        .sup-indicator.handoff { border-color: rgba(123,97,255,.65); color: #c3b6ff; }
        .sup-indicator.answered { border-color: rgba(76,175,80,.6); color: #8ee39a; }
        .sup-indicator.stop { border-color: rgba(255,82,82,.7); color: #ff9a9a; }
        `;
        document.head.appendChild(st);
    }
    let supIndHideTimer = null;
    function supIndicator(state, text) {
        try {
            supIndicatorCss();
            let el = document.getElementById('supIndicator');
            if (!el) {
                el = document.createElement('div');
                el.id = 'supIndicator';
                document.body.appendChild(el);
            }
            el.className = 'sup-indicator show ' + (state || 'waiting');
            el.textContent = text || '';
            if (supIndHideTimer) { clearTimeout(supIndHideTimer); supIndHideTimer = null; }
            if (state === 'answered') supIndHideTimer = setTimeout(() => { el.classList.remove('show'); }, 2500);
        } catch (e) { /* нет DOM — молчим */ }
    }
    function supIndicatorHide() {
        try {
            const el = document.getElementById('supIndicator');
            if (el) el.classList.remove('show');
        } catch (e) {}
    }

    /* ---------- СЧЁТЧИК НА КНОПКЕ «ОТПРАВИТЬ» ---------- */

    function supButtonTimer() {
        let txt = '';
        try {
            const b = document.getElementById('sendBtn');
            txt = b ? String(b.innerText || '') : '';
        } catch (e) {}
        return {
            txt: txt,
            hasDigits: /\d/.test(txt),
            generating: (typeof isGenerating !== 'undefined') ? !!isGenerating : false
        };
    }

    /* ---------- ЛЕНТА: ЧТО УЖЕ ОТВЕТИЛ АГЕНТ ---------- */

    /* Узлы ответов агентов в ленте. Свои записи (Надзиратель) не считаем. */
    function supAgentNodes() {
        try {
            if (typeof chatContainer === 'undefined' || !chatContainer) return [];
            const all = chatContainer.querySelectorAll('.msg-director');
            const out = [];
            for (let i = 0; i < all.length; i++) {
                const nm = all[i].querySelector('.msg-name');
                const name = nm ? String(nm.innerText || '') : '';
                if (name.indexOf('Надзиратель') !== -1) continue;
                out.push(all[i]);
            }
            return out;
        } catch (e) { return []; }
    }
    /* Текст последнего ответа агента, появившегося ПОСЛЕ старта задачи. */
    function supLastAgentText() {
        const nodes = supAgentNodes();
        if (nodes.length <= supStartCount) return '';
        return String(nodes[nodes.length - 1].innerText || '');
    }
    /* Битый ответ: заглушка «пустой ответ» или обрыв по лимиту шагов сервера. */
    function supBrokenReason(t) {
        const s = String(t || '').replace(/\[[^\]]*\]/g, ' ').replace(/[*_`>#~]/g, ' ').replace(/\s+/g, ' ').trim();
        if (!s) return '';
        if (SUP_STEPS_RE.test(s)) return 'упёрся в лимит шагов';
        if (s.length <= 200 && SUP_EMPTY_RE.test(s)) return 'пустой ответ';
        return '';
    }

    /* ---------- ДЕТЕКТ ОБРЫВА ---------- */

    function supTick() {
        const st = supLoad();
        if (!st) return;
        if (st.status !== 'waiting') return;
        if (supBusy) return;                       // передача уже идёт — второй раз не дёргаем

        const now = Date.now();
        const waited = now - (st.startedAt || now);

        // --- БИТЫЙ ОТВЕТ ---
        // Ответ в ленте появился, но это заглушка «пустой ответ» либо обрыв
        // «Слишком много шагов. Задача прервана» — задача не сделана,
        // передаём её следующему агенту, а не пинаем того же самого.
        const broken = supBrokenReason(supLastAgentText());
        if (broken) { supBreak(broken); return; }

        // --- СЧЁТЧИК НА КНОПКЕ ---
        // Босс нажал «Отправить» → на кнопке бегут секунды. Пропал счётчик
        // или замер на месте, а ответа нет — поток умер. Задача сразу уходит
        // следующему, не ждём 300 с.
        if (waited >= SUP_TIMER_GRACE_MS) {
            const t = supButtonTimer();
            if (t.hasDigits) {
                if (t.txt !== st.timerText) { st.timerText = t.txt; st.timerChange = now; supSave(st); }
                else if (now - (st.timerChange || now) >= SUP_TIMER_FREEZE_MS) {
                    supBreak('счётчик застыл на ' + t.txt); return;
                }
            } else if (!t.generating) {
                supBreak('счётчик на кнопке пропал, ответа нет'); return;
            } else if (now - (st.timerChange || now) >= SUP_TIMER_FREEZE_MS) {
                supBreak('счётчик на кнопке не отображается'); return;
            }
        }

        // --- ЛИМИТ 300 С (лимит кнопки отправки) ---
        // Отсчёт ведём от момента, когда задача ушла агенту (startedAt).
        // Пульс lastSeen его НЕ сбрасывает: 300 с — жёсткий лимит.
        if (waited < SUP_SILENCE_MS) {
            if (typeof isGenerating !== 'undefined' && isGenerating) supHeartbeat(st.owner);
            return;
        }
        supBreak('молчит ' + Math.round(waited / 1000) + ' с (лимит 300 с)');
    }

    function supStartWatch() {
        if (supTimer) return;
        supTimer = setInterval(supTick, SUP_TICK_MS);
    }

    /* ---------- НАРУЖУ ---------- */

    window.supStart = supStart;
    window.supAnswered = supAnswered;
    window.supFailed = supFailed;
    window.supHeartbeat = supHeartbeat;
    window.supHandoff = supHandoff;
    window.supClear = supClear;
    window.supState = supLoad;
    window.supTick = supTick;
    window.supTimerBroken = supBreak;   // chat.js: счётчик на кнопке оборвался → задача уходит дальше
    window.supIndicator = supIndicator;
    window.SUPERVISOR_VERSION = '1.4-stage3';

    supStartWatch();
})();
