/* ============================================================
   НАДЗИРАТЕЛЬ — supervisor.js  v1.5-stage3
   ------------------------------------------------------------
   Следит за диалогом Босса в Штабе и не даёт задаче умереть молча.

   ГЛАВНЫЙ ПОРОГ: 300 СЕКУНД (лимит кнопки «Отправить»).
   Пока лимит не вышел — агент считается живым, передача НЕ делается,
   сколько бы он ни думал.

   ЖИЗНЬ (передача НЕ делается):
     • на кнопке «Отправить» тикает счётчик;
     • isGenerating == true и прошло меньше 300 с;
     • идёт авто-пинок «продолжи», следующий этап [ЭТАП N/M];
     • большая задача разбита на части — каждая часть у своего агента;
     • печатается ответ (typingTimer) или в ленте было движение.

   СМЕРТЬ (задача/часть уходит следующему по цепочке):
     • счётчик на кнопке ЗАСТЫЛ и не менялся 15 с;
     • счётчик ПРОПАЛ (запрос оборвался), ответа в чате нет;
     • прошло 300 с тишины — лимит кнопки истёк;
     • явный сбой: ошибка, пустой ответ, «слишком много шагов».

   ЦЕПОЧКА ЗАМЕНЫ: Архитектор → Помощник → Бесплатная модель → стоп.
   Передач не больше SUP_MAX_HANDOFFS — иначе два ИИ зациклятся.

   РАСПРЕДЕЛЕНИЕ БОЛЬШОЙ ЗАДАЧИ:
     supSplit(text) — опрашивает агентов (кто онлайн), режет задачу
     на части и раздаёт: каждый агент делает свою часть, другим не мешает.

   Файл самостоятельный: всё внешнее — через typeof-проверки.
   ============================================================ */
(function () {
    'use strict';

    const SUP_KEY = 'shtabSupervisor';
    const SUP_LIMIT_MS = 300000;    // 300 с — лимит кнопки отправки: только после него передача по времени
    const SUP_FREEZE_MS = 15000;    // счётчик не менялся 15 с — считаем застывшим
    const SUP_TICK_MS = 3000;       // проверка каждые 3 с
    const SUP_MAX_HANDOFFS = 2;     // не больше 2 передач на одну задачу (стоп-кран)
    const SUP_TEXT_LIMIT = 2000;    // столько текста задачи храним в журнале
    const SUP_ALIVE_MS = 120000;    // признак жизни держится 120 с: агент работает — передача запрещена
    const SUP_ACTIVITY_MS = 45000;  // движение в ленте за это время = агент жив
    const SUP_DISTRIBUTE_MAX = 3;   // не больше 3 агентов на одну большую задачу
    const SUP_NUDGE_MAX = 2;        // столько раз просим разбить задачу на этапы, потом передаём
    const SUP_PING_TTL_MS = 30000;  // опрос «кто онлайн» кэшируем 30 с — модели не долбим
    const SUP_PING_TIMEOUT = 20000; // сколько ждём /ai/ping

    const OWNER_LABEL = {
        arch: '🏛 Архитектор',
        assistant: '🤖 Помощник',
        free: '🆓 Бесплатная модель'
    };
    const OWNER_NEXT = { arch: 'assistant', assistant: 'free' };   // цепочка замены

    let supTimer = null;
    let supBusyCount = 0;           // идёт передача задачи — надзиратель не мешает сам себе
    let supAliveUntil = 0;          // до этого времени задача считается ЖИВОЙ — передача запрещена
    let supLastActivity = 0;        // когда в ленте последний раз было движение (печать/ответ)
    let supStageInfo = null;        // { cur, total } — задача разбита на этапы, это НЕ молчание
    let supDistributed = false;     // большую задачу уже раскидали по агентам — второй раз не раскидываем

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
    }
    function ownerLabel(o) { return OWNER_LABEL[o] || ('👤 ' + o); }

    /* ---------- ЖИВОЙ АГЕНТ: ПРИЗНАКИ ЖИЗНИ ----------
       Передача задачи — только когда агент МЁРТВ. Пока он работает,
       надзиратель молчит и ждёт. Признаки жизни:
       1) идёт запрос (isGenerating) или печатается ответ (typingTimer);
       2) крутятся этапы большой задачи ([ЭТАП N/M], N < M);
       3) запущены фоновые задачи ([TASK:...]) или «раздели задачу»;
       4) в ленте было движение за последние SUP_ACTIVITY_MS;
       5) chat.js явно позвал supAlive() (этап, Совет, фон, ответ).
       Любой из них — задача живая, передача запрещена. */
    function supAlive(ms) {
        supAliveUntil = Math.max(supAliveUntil, Date.now() + (ms || SUP_ALIVE_MS));
    }
    function supNoteActivity() { supLastActivity = Date.now(); supAlive(); }
    /* Свежая жизнь: только что был ответ/печать или идут этапы.
       Именно это отличает РАБОТУ от обрыва, когда счётчик на кнопке замер.
       isGenerating здесь НЕ учитываем: зависший запрос — это не жизнь. */
    function supRecentlyAlive() {
        const now = Date.now();
        if (supLastActivity && (now - supLastActivity) < SUP_ACTIVITY_MS) return true;
        if (supStageInfo && supStageInfo.cur < supStageInfo.total) return true;
        try { if (typeof typingTimer !== 'undefined' && typingTimer) return true; } catch (e) {}
        return false;
    }
    function supIsAlive() {
        if (supRecentlyAlive()) return true;
        if (Date.now() < supAliveUntil) return true;
        try { if (typeof isGenerating !== 'undefined' && isGenerating) return true; } catch (e) {}
        return false;
    }
    function supDirectorCount() {
        try {
            const c = document.getElementById('chatContainer');
            return c ? c.querySelectorAll('.msg-director').length : 0;
        } catch (e) { return 0; }
    }

    /* ---------- БОЛЬШАЯ ЗАДАЧА: ЭТАПЫ ----------
       Модель разбила задачу на этапы ([ЭТАП N/M]). Это НЕ молчание:
       задача живая, пока этапы идут. Надзиратель запоминает разбивку
       и не передаёт задачу другому. */
    function supStage(stage) {
        if (!stage || !stage.total) { supStageInfo = null; return; }
        supStageInfo = { cur: Number(stage.cur) || 1, total: Number(stage.total) || 1 };
        supAlive(SUP_ALIVE_MS);
        const st = supLoad();
        if (st) { st.big = supStageInfo.total > 1; st.stage = supStageInfo.cur + '/' + supStageInfo.total; supSave(st); }
        supLog('🧩 Задача разбита на этапы ' + supStageInfo.cur + '/' + supStageInfo.total + ' — агент жив, передача не нужна');
    }

    /* Задача взята в работу. owner: 'arch' | 'assistant' | 'free' | имя агента */
    function supStart(text, owner) {
        supStageInfo = null; supDistributed = false;   // новая задача — этапы и распределение с нуля
        supLastActivity = 0;                           // прошлая жизнь не считается
        supAlive(SUP_ALIVE_MS);                        // агент только взял задачу — он жив
        const prev = supLoad();
        const history = (prev && Array.isArray(prev.history)) ? prev.history : [];
        const now = Date.now();
        supSave({
            text: String(text || '').slice(0, SUP_TEXT_LIMIT),
            owner: owner || 'arch',
            status: 'waiting',                 // waiting | answered | failed
            handoffs: 0,
            startedAt: now,
            lastSeen: now,
            lastTimerText: '',
            lastTimerChange: now,
            parts: [],
            partIndex: 0,
            history: history
        });
        supLog('📋 Задачу взял ' + ownerLabel(owner));

        /* БОЛЬШАЯ ЗАДАЧА + НЕСКОЛЬКО АГЕНТОВ ОНЛАЙН → делим сразу.
           Надзиратель опрашивает агентов, считает, кто на связи, и раскидывает
           задачу между ними. Это НЕ передача: счётчик handoffs не растёт. */
        if (supIsBigTask(text)) {
            supSplitByOnline(text);   // опрос реальных моделей → делим по тем, кто онлайн
        }
    }

    /* Задача продолжается: авто-пинок, следующий этап, повтор после сбоя.
       Журнал переоткрываем — агент снова в работе, передавать некому. */
    function supResume(owner) {
        const st = supLoad();
        if (!st) return;
        const now = Date.now();
        if (!st.parts || !st.parts.length) st.owner = owner || st.owner || 'arch';
        st.status = 'waiting';
        st.startedAt = now;
        st.lastSeen = now;
        st.lastTimerText = '';
        st.lastTimerChange = now;
        st.reason = '';
        supSave(st);
        supAlive(SUP_ALIVE_MS);   // агент продолжает работу — он жив
    }

    /* Пульс: агент ещё жив и работает (пинок, этап, длинный запрос). */
    function supHeartbeat(owner) {
        const st = supLoad();
        if (!st) return;
        if (owner && !(st.parts && st.parts.length) && st.owner && owner !== st.owner) return;
        st.lastSeen = Date.now();
        supSave(st);
    }

    /* Агент ответил. Если задача разбита на части — двигаем очередь дальше. */
    function supAnswered(owner) {
        const st = supLoad();
        if (!st) return;
        supNoteActivity();   // ответ пришёл — агент жив, задача не брошена

        if (st.parts && st.parts.length) {
            const p = st.parts[st.partIndex];
            if (p) { p.status = 'done'; p.lastSeen = Date.now(); }
            const nextIdx = st.parts.findIndex(function (x) { return x.status !== 'done' && x.status !== 'failed'; });
            if (nextIdx === -1) {
                st.status = 'answered';
                st.lastSeen = Date.now();
                supSave(st);
                supLog('✅ Разбитая задача собрана — все ' + st.parts.length + ' частей готовы');
                return;
            }
            st.partIndex = nextIdx;
            st.status = 'waiting';
            st.lastSeen = Date.now();
            st.lastTimerChange = Date.now();
            st.lastTimerText = '';
            supSave(st);
            supLog('🧩 Часть ' + (nextIdx + 1) + '/' + st.parts.length + ' → ' + ownerLabel(st.parts[nextIdx].owner));
            supDispatchPart(st.parts[nextIdx]);
            return;
        }

        if (owner && st.owner && owner !== st.owner) return;   // ответил не тот, кто ведёт — не закрываем
        st.status = 'answered';
        st.lastSeen = Date.now();
        supSave(st);
        supLog('✅ ' + ownerLabel(st.owner) + ' ответил — задача закрыта');
    }

    /* Агент сорвался (ошибка, пустой ответ, обрыв).
       Не просто помечаем сбой — сразу пробуем передать задачу дальше. */
    function supFailed(owner, reason) {
        const st = supLoad();
        if (!st) return;
        if (st.status === 'answered') return;
        st.status = 'failed';
        st.lastSeen = Date.now();
        st.reason = String(reason || 'сбой').slice(0, 300);
        supSave(st);
        supLog('⚠️ ' + ownerLabel(owner || st.owner) + ' сорвался — ' + st.reason);
        supHandoff();                          // пробуем следующего по цепочке
    }

    /* ---------- ПЕРЕДАЧА ЗАДАЧИ ---------- */

    function supHandoff() {
        const st = supLoad();
        if (!st) return;
        if (st.status === 'answered') return;

        /* Разбитая задача: передаём ТОЛЬКО зависшую часть, остальные не трогаем. */
        if (st.parts && st.parts.length) {
            const p = st.parts[st.partIndex];
            if (!p) { supStopKran(st); return; }
            if ((p.handoffs || 0) >= SUP_MAX_HANDOFFS) {
                p.status = 'failed';
                supSave(st);
                supLog('🛑 Часть ' + (st.partIndex + 1) + ' не сделана (' + ownerLabel(p.owner) + ') — нужен Босс');
                return;
            }
            const next = OWNER_NEXT[p.owner] || 'free';
            p.handoffs = (p.handoffs || 0) + 1;
            const prev = p.owner;
            p.owner = next;
            p.lastSeen = Date.now();
            st.lastSeen = Date.now();
            st.lastTimerChange = Date.now();
            st.lastTimerText = '';
            supSave(st);
            supLog('🔄 Часть ' + (st.partIndex + 1) + ': ' + ownerLabel(prev) + ' → ' + ownerLabel(next) + ' (' + p.handoffs + '/' + SUP_MAX_HANDOFFS + ')');
            supDispatchPart(p);
            return;
        }

        if ((st.handoffs || 0) >= SUP_MAX_HANDOFFS) { supStopKran(st); return; }

        /* БОЛЬШАЯ ЗАДАЧА: не передаём её целиком одному — режем на части
           и раздаём свободным агентам, чтобы работа шла параллельно. */
        if (st.big && !supDistributed && supStageInfo && supStageInfo.total > 1) {
            supDistributed = true;
            if (supSplit(st.text)) return;
        }

        const prev = st.owner;
        const next = OWNER_NEXT[prev];
        if (!next) { supStopKran(st); return; }
        const now = Date.now();
        st.owner = next;
        st.handoffs = (st.handoffs || 0) + 1;
        st.status = 'waiting';
        st.startedAt = now;
        st.lastSeen = now;
        st.lastTimerText = '';
        st.lastTimerChange = now;
        st.reason = '';
        supSave(st);
        supLog('🔄 ' + ownerLabel(prev) + ' → ' + ownerLabel(next) + ' (' + st.handoffs + '/' + SUP_MAX_HANDOFFS + ')');
        supDispatch(st.text, next);
    }

    /* Стоп-кран: передачи исчерпаны — дальше только Босс. */
    function supStopKran(st) {
        st.status = 'failed';
        st.lastSeen = Date.now();
        supSave(st);
        supLog('🛑 ' + ownerLabel(st.owner) + ' молчит, передачи исчерпаны — нужен Босс');
    }

    /* Отправляем задачу новому владельцу и следим за результатом. */
    async function supDispatch(text, owner) {
        supBusyCount++;
        try {
            if (owner === 'assistant' && typeof window.sendToAssistant === 'function') {
                const ok = await window.sendToAssistant(text);
                if (ok) supAnswered('assistant'); else supFailed('assistant', 'Помощник не ответил');
            } else if (owner === 'free' && typeof window.sendToFreeModel === 'function') {
                const ok = await window.sendToFreeModel(text);
                if (ok) supAnswered('free'); else supFailed('free', 'Бесплатная модель не ответила');
            } else if (owner === 'arch' && typeof window.sendMessage === 'function') {
                window.sendMessage(text, true);   // Архитектор сам закроет журнал
            } else if (typeof window.askAgent === 'function') {
                const ok = await window.askAgent(owner, text);
                if (ok) supAnswered(owner); else supFailed(owner, 'агент не ответил');
            } else {
                supFailed(owner, 'нет канала для передачи');
            }
        } catch (e) {
            supFailed(owner, (e && e.message) || 'сбой передачи');
        } finally {
            supBusyCount--;
        }
    }

    async function supDispatchPart(p) {
        if (!p) return;
        await supDispatch(p.text, p.owner);
    }

    /* ---------- РАСПРЕДЕЛЕНИЕ БОЛЬШОЙ ЗАДАЧИ ---------- */

    /* ---------- ОПРОС: КТО РЕАЛЬНО ОНЛАЙН ----------
       Честная проверка, а не декоративная: Надзиратель спрашивает у ИИ-шлюза,
       какие МОДЕЛИ живые прямо сейчас (GET /ai/ping — мини-запрос к каждой).
       Результат кэшируется 30 с. Эти имена и есть «агенты онлайн»:
       каждая часть большой задачи уходит СВОЕЙ модели через provider.
       Карточки .agent-card в DOM — только признак «занят/ошибка». */
    let supOnlineCache = { at: 0, list: [], models: [] };
    let supOnlineBusy = false;
    let supGatewayBase = '';

    /* Адреса шлюза. Первым — тот же домен: Caddy проксирует /ai → :8002,
       иначе на HTTPS-странице браузер блокирует http-запрос (mixed content). */
    function supGatewayCandidates() {
        const out = [];
        /* 1) ТОТ ЖЕ АДРЕС, ЧТО И ЧАТ (Caddy :8443, путь /ai) — основной путь.
           Шлюз ИИ живёт рядом со Штабом, Caddy проксирует /ai → :8002.
           Так Надзиратель видит шлюз и с телефона, и снаружи. */
        try { if (typeof PROXY !== 'undefined' && PROXY) out.push(String(PROXY).replace(/\/+$/, '')); } catch (e) {}
        try {
            const saved = localStorage.getItem('shtabAiUrl');
            if (saved) out.push(String(saved).replace(/\/+$/, ''));
        } catch (e) {}
        try {
            out.push(location.origin.replace(/\/+$/, ''));
            if (location.hostname) out.push(location.protocol + '//' + location.hostname + ':8002');
        } catch (e) {}
        out.push('http://localhost:8002');
        out.push('http://127.0.0.1:8002');
        return out.filter(function (v, i, a) { return v && a.indexOf(v) === i; });
    }

    async function supFetchJson(base, path, ms) {
        const ctl = new AbortController();
        const to = setTimeout(function () { ctl.abort(); }, ms || SUP_PING_TIMEOUT);
        try {
            const r = await fetch(base + path, { method: 'GET', signal: ctl.signal });
            if (!r.ok) throw new Error('HTTP ' + r.status);
            return await r.json();
        } finally { clearTimeout(to); }
    }

    /* Опрос моделей: кто онлайн. force=true — мимо кэша. */
    async function supPollOnline(force) {
        const now = Date.now();
        if (!force && supOnlineCache.at && (now - supOnlineCache.at) < SUP_PING_TTL_MS) return supOnlineCache;
        if (supOnlineBusy) return supOnlineCache;
        supOnlineBusy = true;
        try {
            const bases = supGatewayBase ? [supGatewayBase] : supGatewayCandidates();
            for (let i = 0; i < bases.length; i++) {
                try {
                    const d = await supFetchJson(bases[i], '/ai/ping' + (force ? '?force=1' : ''), SUP_PING_TIMEOUT);
                    if (!d || !Array.isArray(d.providers)) continue;
                    supGatewayBase = bases[i];
                    supOnlineCache = {
                        at: Date.now(),
                        list: d.providers.filter(function (p) { return p.online; }).map(function (p) { return p.name; }),
                        models: d.providers
                    };
                    return supOnlineCache;
                } catch (e) { /* следующий адрес */ }
            }
            return supOnlineCache;
        } finally { supOnlineBusy = false; }
    }

    /* Карточки агентов — только «занят / в ошибке», не источник онлайна. */
    function supAgentCards() {
        const out = [];
        try {
            const cards = document.querySelectorAll('.agent-card');
            for (let i = 0; i < cards.length; i++) {
                const card = cards[i];
                const name = String(card.id || '').replace('agent-', '');
                if (!name) continue;
                const stText = card.querySelector('.agent-status-text');
                out.push({
                    name: name,
                    busy: card.classList.contains('working'),
                    error: card.classList.contains('error'),
                    status: stText ? String(stText.innerText || '') : ''
                });
            }
        } catch (e) { /* нет DOM — работаем базовыми каналами */ }
        return out;
    }
    function supOnlineAgents() {
        const list = ['arch', 'assistant', 'free'];
        supOnlineCache.list.forEach(function (n) { if (list.indexOf(n) === -1) list.push(n); });
        return list;
    }
    /* Свободные = реально онлайн модели, не занятые локальной карточкой.
       Именно им раздаём части большой задачи. */
    function supFreeAgents() {
        const busy = {};
        supAgentCards().forEach(function (a) { if (a.busy || a.error) busy[a.name] = 1; });
        return supOnlineCache.list.filter(function (n) { return !busy[n]; });
    }
    /* Агенты, которые реально отвечают (модели шлюза). Без базовых каналов. */
    function supRealAgents() {
        return supOnlineCache.list.slice();
    }
    /* Итог опроса для ленты: сколько моделей на связи. */
    function supOnlineReport() {
        const on = supOnlineCache.list;
        const off = (supOnlineCache.models || []).filter(function (p) { return !p.online; });
        let s = '🔎 Онлайн моделей: ' + on.length;
        if (on.length) s += ' — ' + on.join(', ');
        if (off.length) s += ' | молчат: ' + off.map(function (p) { return p.name; }).join(', ');
        return s;
    }

    /* Режем задачу на части: по файлам → по пунктам → по абзацам. */
    function supSplitText(text) {
        const src = String(text || '').trim();
        const parts = [];

        // 1) по файлам [FILE: путь] / [READ: путь]
        const fileRe = /\[(?:FILE|READ):\s*([^\]]+)\]/gi;
        const files = [];
        let m;
        while ((m = fileRe.exec(src)) !== null) files.push(m[1].trim());
        if (files.length >= 2) {
            return files.map(function (f, i) {
                return { text: 'Часть ' + (i + 1) + '/' + files.length + '. Работай только с файлом ' + f + '.\n\nОбщая задача: ' + src, file: f };
            });
        }

        // 2) по пунктам списка
        const lines = src.split('\n').map(function (l) { return l.trim(); }).filter(Boolean);
        const bullets = lines.filter(function (l) { return /^([-•*]|\d+[.)])\s+/.test(l); });
        if (bullets.length >= 2) {
            return bullets.map(function (l, i) {
                return { text: 'Часть ' + (i + 1) + '/' + bullets.length + '. Сделай ТОЛЬКО этот пункт, остальные не трогай:\n' + l };
            });
        }

        // 3) по абзацам
        const paras = src.split(/\n\s*\n/).map(function (p) { return p.trim(); }).filter(Boolean);
        if (paras.length >= 2) {
            return paras.map(function (p, i) {
                return { text: 'Часть ' + (i + 1) + '/' + paras.length + '. Сделай ТОЛЬКО эту часть, остальные не трогай:\n' + p };
            });
        }

        return [{ text: src }];
    }

    /* Разбить большую задачу и раздать частям разных агентов. */
    function supSplit(text, owners) {
        const chunks = supSplitText(text);
        if (chunks.length < 2) {
            supLog('🧩 Задача не делится — веду её целиком');
            return false;
        }
        const pool = (Array.isArray(owners) && owners.length) ? owners : supOnlineAgents();
        const now = Date.now();
        const parts = chunks.map(function (c, i) {
            return {
                text: c.text,
                file: c.file || '',
                owner: pool[i % pool.length],
                status: 'waiting',
                handoffs: 0,
                lastSeen: now
            };
        });
        supSave({
            text: String(text || '').slice(0, SUP_TEXT_LIMIT),
            owner: parts[0].owner,
            status: 'waiting',
            handoffs: 0,
            startedAt: now,
            lastSeen: now,
            lastTimerText: '',
            lastTimerChange: now,
            parts: parts,
            partIndex: 0,
            history: []
        });
        supDistributed = true;
        const who = parts.map(function (p) { return ownerLabel(p.owner); }).join(' · ');
        supLog('🧩 Задача на ' + parts.length + ' частей: ' + who);
        supDispatchPart(parts[0]);
        return true;
    }

    /* ---------- ДЕЛЁЖ ПО ОНЛАЙНУ ----------
       Опрашиваем модели и, если на связи минимум две, режем задачу между ними:
       каждая часть уходит СВОЕЙ модели (provider), файлы не пересекаются. */
    async function supSplitByOnline(text) {
        const p = await supPollOnline();
        supLog(supOnlineReport());
        if (supDistributed) return false;
        const online = (p.list || []).slice(0, SUP_DISTRIBUTE_MAX);
        if (online.length >= 2) {
            supLog('🧩 Делю между онлайн-моделями: ' + online.join(' · '));
            return supSplit(text, online);
        }
        if (online.length === 1) supLog('🧩 Онлайн одна модель (' + online[0] + ') — веду задачу целиком');
        return false;
    }

    /* Отправить часть задачи конкретной модели через шлюз (provider).
       Каждая модель получает только свой кусок — друг другу не мешают. */
    async function supAskProvider(provider, text) {
        const bases = supGatewayBase ? [supGatewayBase] : supGatewayCandidates();
        for (let i = 0; i < bases.length; i++) {
            const base = bases[i];
            const ctl = new AbortController();
            const to = setTimeout(function () { ctl.abort(); }, 95000);
            try {
                const r = await fetch(base + '/ai', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        provider: provider,
                        messages: [{ role: 'user', content: String(text || '') }]
                    }),
                    signal: ctl.signal
                });
                const d = await r.json();
                if (!d || !d.ok || !d.text) throw new Error((d && d.error) || 'пустой ответ');
                supGatewayBase = base;
                supNoteActivity();
                supLog('🤖 ' + provider + ' (' + (d.model || '') + '):\n' + String(d.text).slice(0, 4000));
                return true;
            } catch (e) {
                /* следующий адрес или провайдер не ответил */
            } finally { clearTimeout(to); }
        }
        return false;
    }

    /* ---------- ВЫВОД В ЛЕНТУ ---------- */

    function supLog(text) {
        try {
            if (typeof renderMessage === 'function') renderMessage(text, 'director', 'Надзиратель');
        } catch (e) { /* лента недоступна — молчим */ }
    }

    /* ---------- БОЛЬШАЯ ЛИ ЗАДАЧА ----------
       Признаки: длинный текст, несколько файлов, несколько пунктов списка
       или прямая просьба «раздели/распредели задачу». */
    function supIsBigTask(text) {
        const s = String(text || '');
        if (s.length >= 400) return true;
        if (/раздели\s+задач|распредели\s+задач|по\s+агентам|параллельно/i.test(s)) return true;
        const files = s.match(/\[(?:FILE|READ):\s*[^\]]+\]/gi);
        if (files && files.length >= 2) return true;
        const bullets = s.split('\n').filter(function (l) { return /^\s*(?:[-•*]|\d+[.)])\s+/.test(l); });
        if (bullets.length >= 2) return true;
        return false;
    }

    /* ---------- 300 С ИСТЕКЛО, НО АГЕНТ ЖИВ ----------
       Это не смерть, а большая задача. Не передаём её другому:
       опрашиваем агентов и раскидываем задачу между ними. Если онлайн
       мало — просим разбить задачу на этапы и отчитаться по каждому. */
    function supSplitOrHandoff(st) {
        const free = supFreeAgents();
        const online = supRealAgents();
        const pool = free.length >= 2 ? free : online;
        if (pool.length >= 2) {
            supLog('🔎 Опрос агентов: онлайн ' + online.length + ', свободны ' + free.length + ' — делю большую задачу');
            supSplit(st.text, pool);
            return;
        }
        st.startedAt = Date.now();
        st.lastSeen = Date.now();
        st.nudges = (st.nudges || 0) + 1;
        supSave(st);
        if (st.nudges > SUP_NUDGE_MAX) {
            supLog('⏳ Агентов онлайн нет — передаю задачу дальше');
            supHandoff();
            return;
        }
        supLog('🧩 Агент жив, задача большая — прошу разбить её на этапы (не передаю)');
        try { if (typeof window.sendMessage === 'function') window.sendMessage('раздели задачу на этапы и отчитайся по каждому', true); } catch (e) {}
    }

    /* ---------- ДЕТЕКТ МОЛЧАНИЯ ---------- */

    function timerState(st, now) {
        const btnText = (typeof sendBtn !== 'undefined' && sendBtn) ? String(sendBtn.innerText || '') : '';
        const timerAlive = /\d/.test(btnText);
        if (timerAlive && btnText !== st.lastTimerText) {
            st.lastTimerText = btnText;
            st.lastTimerChange = now;
            st.lastSeen = now;
            return { alive: true, text: btnText };
        }
        return { alive: timerAlive, text: btnText };
    }

    function supTick() {
        const st = supLoad();
        if (!st || st.status !== 'waiting') return;
        if (supBusyCount > 0) return;

        const now = Date.now();
        const t = timerState(st, now);
        if (t.alive && t.text === st.lastTimerText) supSave(st);

        // 1) Счётчик тикает — агент работает.
        if (t.alive && (now - (st.lastTimerChange || now)) < SUP_FREEZE_MS) return;

        const generating = (typeof isGenerating !== 'undefined') && isGenerating;
        const silent = now - (st.lastSeen || st.startedAt || now);

        // 2) ГЛАВНОЕ: 300 с ещё не вышло и агент жив — не трогаем.
        if (generating && silent < SUP_LIMIT_MS) return;
        if (!generating && silent < SUP_FREEZE_MS) return;

        // 2б) ЖИВОЙ АГЕНТ — НЕ ПЕРЕДАЁМ. Печатается ответ, крутятся этапы
        //     большой задачи, работает Совет или фон — это работа, а не молчание.
        //     Срок продлеваем и ждём дальше.
        if (supRecentlyAlive()) {
            st.lastSeen = now;
            st.startedAt = now;
            st.lastTimerText = '';
            st.lastTimerChange = now;
            supSave(st);
            return;
        }

        // 3) Причина передачи.
        let why = '';
        if (silent >= SUP_LIMIT_MS) why = 'лимит 300 с истёк';
        else if (!generating && !t.alive) why = 'счётчик пропал, ответа нет';
        else if (t.alive) why = 'счётчик застыл на ' + t.text;
        else return;

        /* 300 с истекли, а агент ЖИВОЙ (запрос идёт, счётчик тикает) —
           это не смерть, а большая задача. Не передаём её другому:
           делим между онлайн-агентами или просим разбить на этапы. */
        if (generating && t.alive && silent >= SUP_LIMIT_MS) { supSplitOrHandoff(st); return; }

        st.status = 'failed';
        st.reason = why;
        st.lastSeen = now;
        supSave(st);
        supLog('⏳ ' + ownerLabel(st.owner) + ' — ' + why);
        supHandoff();
    }

    /* ---------- ОБРЫВ (зов из chat.js) ----------
       chat.js зовёт это, когда счётчик на кнопке замер/пропал или вышло 300 с.
       ЖИВОЙ АГЕНТ НЕ ПЕРЕДАЁТСЯ: если идёт печать, крутятся этапы или фон —
       это работа, а не обрыв. Возвращает true, если надзиратель взял на себя. */
    function supBreak(reason) {
        const st = supLoad();
        if (!st || st.status !== 'waiting') return false;
        const now = Date.now();
        if (supRecentlyAlive()) {
            st.lastSeen = now;
            st.startedAt = now;
            st.lastTimerText = '';
            st.lastTimerChange = now;
            supSave(st);
            return true;                        // агент жив — передачи не будет
        }
        st.status = 'failed';
        st.reason = String(reason || 'обрыв').slice(0, 300);
        st.lastSeen = now;
        supSave(st);
        supLog('⏳ ' + ownerLabel(st.owner) + ' — ' + st.reason);
        supHandoff();
        return true;
    }

    function supStartWatch() {
        if (supTimer) return;
        supTimer = setInterval(supTick, SUP_TICK_MS);
    }

    /* ---------- НАРУЖУ ---------- */

    window.supStart = supStart;
    window.supResume = supResume;
    window.supAnswered = supAnswered;
    window.supFailed = supFailed;
    window.supHeartbeat = supHeartbeat;
    window.supHandoff = supHandoff;
    window.supSplit = supSplit;
    window.supOnlineAgents = supOnlineAgents;
    window.supClear = supClear;
    window.supState = supLoad;
    window.supTick = supTick;
    window.supTimerBroken = supBreak;        // chat.js: счётчик оборвался / 300 с → задача уходит дальше
    window.supAlive = supAlive;              // chat.js: агент жив (этап, Совет, фон, ответ)
    window.supNoteActivity = supNoteActivity;// chat.js: в ленте движение — агент работает
    window.supStage = supStage;              // chat.js: задача разбита на этапы [ЭТАП N/M]
    window.supIsAlive = supIsAlive;
    window.SUPERVISOR_VERSION = '1.5-stage3';

    supStartWatch();
})();
