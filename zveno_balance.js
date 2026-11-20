// ============================================================
//  БАЛАНС ZVENOAI В ШАПКЕ ШТАБА
//  Ключ хранится ТОЛЬКО в localStorage этого устройства.
//  В репозиторий и в код ключ не пишется.
//
//  Короткое нажатие — обновить с API.
//  Долгое нажатие  — меню (ручной баланс / ключ / путь / очистка).
//  ПКМ             — задать путь к балансу.
//
//  ВНИМАНИЕ: у ZvenoAI в публичной доке есть только
//  Chat Completions / Models / Embeddings. Эндпоинта баланса нет,
//  поэтому основной режим — РУЧНОЙ: цифру вводит Босс, виджет её помнит.
// ============================================================
(function () {
    'use strict';

    var LS_KEY = 'zvenoApiKey';         // сам ключ
    var LS_PATH = 'zvenoBalancePath';   // свой путь к балансу (если авто не угадал)
    var LS_CACHE = 'zvenoBalanceCache'; // последний ответ API
    var LS_MANUAL = 'zvenoBalanceManual'; // стартовый баланс (вводит Босс)
    var LS_SPENT = 'zvenoSpentTokens';    // накопленные токены (все ответы через Штаб)
    var LS_SPENT_RUB = 'zvenoSpentRub';   // накопленный расход, ₽
    var LS_PRICE = 'zvenoPricePerM';      // цена за 1 млн токенов, ₽
    var DEFAULT_PRICE = 8.17;             // ₽ за 1 млн токенов (средняя по моделям)
    var BASE = 'https://api.zveno.ai/v1';

    // Шлюзы отдают баланс по-разному — пробуем по очереди, пока не найдём число.
    var ENDPOINTS = ['/api/zveno/balance', '/credits', '/balance', '/me', '/user/balance', '/dashboard/billing/credit_grants'];

    var longFired = false;
    var pressTimer = null;

    function box() { return document.getElementById('status-zveno'); }
    function label() { return document.getElementById('zveno-balance-text'); }

    function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
    function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
    function lsDel(k) { try { localStorage.removeItem(k); } catch (e) {} }

    function getKey() { return lsGet(LS_KEY) || ''; }
    function getManual() {
        var v = parseFloat((lsGet(LS_MANUAL) || '').replace(',', '.'));
        return isFinite(v) ? v : null;
    }
    function getPrice() {
        var v = parseFloat((lsGet(LS_PRICE) || '').replace(',', '.'));
        return isFinite(v) && v > 0 ? v : DEFAULT_PRICE;
    }
    function getSpentTokens() {
        var v = parseFloat(lsGet(LS_SPENT) || '0');
        return isFinite(v) ? v : 0;
    }
    function getSpentRub() {
        var v = parseFloat((lsGet(LS_SPENT_RUB) || '').replace(',', '.'));
        return isFinite(v) ? v : 0;
    }
    // Баланс с учётом расхода: стартовый минус потраченное.
    function currentBalance() {
        var start = getManual();
        if (start === null) return null;
        return start - getSpentRub();
    }
    // Учёт токенов от модели. Зовётся из chat.js после каждого ответа.
    function addUsage(usage) {
        if (!usage || typeof usage !== 'object') return;
        var p = Number(usage.prompt_tokens || usage.input_tokens || 0);
        var c = Number(usage.completion_tokens || usage.output_tokens || 0);
        var total = Number(usage.total_tokens || 0);
        if (!total) total = p + c;
        if (!isFinite(total) || total <= 0) return;
        var tokens = getSpentTokens() + total;
        var rub = getSpentRub() + (total / 1000000) * getPrice();
        lsSet(LS_SPENT, String(tokens));
        lsSet(LS_SPENT_RUB, String(rub));
        showManual();
    }

    function render(text, color, title) {
        var e = label();
        if (e) { e.textContent = text; if (color) e.style.color = color; }
        var b = box();
        if (b && title) b.title = title;
    }

    function showManual() {
        var v = currentBalance();
        if (v === null) return false;
        var color = v <= 0 ? '#ff0055' : (v < 100 ? '#ffd700' : '#00ff88');
        render('ZVENO ' + v.toFixed(2) + ' ₽', color,
               'Баланс ZvenoAI: ' + v.toFixed(2) + ' ₽\n' +
               'Старт: ' + getManual().toFixed(2) + ' ₽ · расход: ' + getSpentRub().toFixed(2) + ' ₽\n' +
               'Токенов: ' + Math.round(getSpentTokens()).toLocaleString('ru-RU') +
               ' · цена: ' + getPrice().toFixed(2) + ' ₽ за 1 млн');
        return true;
    }

    // Достаём число из ответа любой формы (число, строка, вложенный объект).
    function pickNumber(obj, depth) {
        depth = depth || 0;
        if (obj == null || depth > 4) return null;
        if (typeof obj === 'number') return isFinite(obj) ? obj : null;
        if (typeof obj === 'string') {
            var m = obj.replace(/\s/g, '').replace(',', '.').match(/-?\d+(\.\d+)?/);
            return m ? parseFloat(m[0]) : null;
        }
        if (typeof obj !== 'object') return null;

        var keys = ['balance', 'credits', 'credit', 'total_available', 'available',
                    'amount', 'remaining', 'total_granted', 'value', 'rub', 'rubles'];
        for (var i = 0; i < keys.length; i++) {
            if (obj[keys[i]] !== undefined) {
                var v = pickNumber(obj[keys[i]], depth + 1);
                if (v !== null) return v;
            }
        }
        var wrap = ['data', 'result', 'account', 'user', 'billing', 'wallet'];
        for (var j = 0; j < wrap.length; j++) {
            if (obj[wrap[j]]) {
                var w = pickNumber(obj[wrap[j]], depth + 1);
                if (w !== null) return w;
            }
        }
        return null;
    }

    function endpoints() {
        var custom = lsGet(LS_PATH) || '';
        return custom ? [custom].concat(ENDPOINTS) : ENDPOINTS.slice();
    }

    function fetchBalance(key) {
        var list = endpoints();
        var lastErr = 'нет ответа';

        return list.reduce(function (chain, path) {
            return chain.catch(function () {
                // /api/... — прокси Штаба на своём сервере (обход CORS), остальное — ZvenoAI напрямую.
                var url = path.indexOf('http') === 0 ? path
                        : (path.indexOf('/api/') === 0 ? path : BASE + path);
                return fetch(url, {
                    headers: { 'Authorization': 'Bearer ' + key, 'Accept': 'application/json' }
                }).then(function (r) {
                    if (!r.ok) throw new Error(path + ' → HTTP ' + r.status);
                    return r.json().catch(function () { return null; });
                }).then(function (j) {
                    var n = pickNumber(j);
                    if (n === null) throw new Error(path + ' → в ответе нет числа');
                    return { value: n, path: path };
                }).catch(function (e) {
                    lastErr = e.message;
                    throw e;
                });
            });
        }, Promise.reject()).catch(function () {
            throw new Error(lastErr);
        });
    }

    function showCache() {
        var c = null;
        try { c = JSON.parse(lsGet(LS_CACHE) || 'null'); } catch (e) {}
        if (c && typeof c.v === 'number') {
            render('ZVENO ' + c.v.toFixed(2) + ' ₽', '#888', 'Последний ответ API ZvenoAI');
        }
    }

    function refresh(silent) {
        var key = getKey();
        if (!key) {
            if (showManual()) return;
            render('ZVENO 🔑', '#ffd700', 'Долгое нажатие — ввести баланс или ключ ZvenoAI');
            return;
        }
        render('ZVENO …', '#aaa', 'Обновляю баланс ZvenoAI…');

        fetchBalance(key).then(function (res) {
            var v = res.value;
            var color = v <= 0 ? '#ff0055' : (v < 100 ? '#ffd700' : '#00ff88');
            render('ZVENO ' + v.toFixed(2) + ' ₽', color,
                   'Баланс ZvenoAI: ' + v.toFixed(2) + ' ₽  (' + res.path + ')');
            lsSet(LS_CACHE, JSON.stringify({ v: v, t: Date.now() }));
        }).catch(function (e) {
            // API баланс не отдаёт — показываем ручной, если он есть.
            if (showManual()) {
                if (!silent) console.warn('ZvenoAI balance API:', e.message, '(показан ручной баланс)');
                return;
            }
            render('ZVENO ✖', '#ff0055',
                   'Баланс не получен: ' + e.message +
                   '\nДолгое нажатие — ввести баланс вручную.');
            if (!silent) console.warn('ZvenoAI balance:', e.message);
        });
    }

    function askManual() {
        var cur = getManual();
        var p = prompt('Стартовый баланс ZvenoAI, ₽ (например 582.41).\nДальше Штаб сам вычитает потраченные токены.\nПусто — убрать баланс.',
                       cur !== null ? String(cur) : '');
        if (p === null) return;
        p = p.replace(/\s/g, '').replace(',', '.').trim();
        if (!p) { lsDel(LS_MANUAL); refresh(); return; }
        var v = parseFloat(p);
        if (!isFinite(v)) { alert('Не понял число.'); return; }
        lsSet(LS_MANUAL, String(v));
        showManual();
    }

    function askKey() {
        var cur = getKey();
        var k = prompt('ZvenoAI API-ключ (sk-...).\nХранится только на этом устройстве, в репозиторий не пишется.\nПусто — удалить ключ.',
                       '');
        if (k === null) return;
        k = k.trim();
        if (!k) { lsDel(LS_KEY); refresh(); return; }
        lsSet(LS_KEY, k);
        refresh();
    }

    function askPath() {
        var cur = lsGet(LS_PATH) || '';
        var p = prompt('Путь к балансу (необязательно).\nПусто — искать автоматически.\nПример: /credits', cur);
        if (p === null) return;
        p = p.trim();
        if (p) lsSet(LS_PATH, p); else lsDel(LS_PATH);
        refresh();
    }

    function menu() {
        var ans = prompt(
            'ZVENOAI — что сделать?\n' +
            '1 — ввести баланс вручную\n' +
            '2 — ввести / сменить API-ключ\n' +
            '3 — задать путь к балансу (авто)\n' +
            '4 — обновить с API\n' +
            '5 — очистить ручной баланс',
            '1');
        if (ans === null) return;
        ans = ans.trim();
        if (ans === '1') askManual();
        else if (ans === '2') askKey();
        else if (ans === '3') askPath();
        else if (ans === '4') refresh();
        else if (ans === '5') { lsDel(LS_MANUAL); refresh(); }
    }

    function bind() {
        var b = box();
        if (!b) return;

        function startPress() {
            clearTimeout(pressTimer);
            pressTimer = setTimeout(function () {
                longFired = true;
                menu();
            }, 700);
        }
        function cancelPress() { clearTimeout(pressTimer); }

        b.addEventListener('touchstart', startPress, { passive: true });
        b.addEventListener('touchend', cancelPress);
        b.addEventListener('touchmove', cancelPress);
        b.addEventListener('mousedown', startPress);
        b.addEventListener('mouseup', cancelPress);
        b.addEventListener('mouseleave', cancelPress);
        b.addEventListener('contextmenu', function (e) { e.preventDefault(); askPath(); });

        b.addEventListener('click', function () {
            if (longFired) { longFired = false; return; }
            if (!getKey()) { if (!showManual()) menu(); return; }
            refresh();
        });
    }

    window.zvenoBalanceRefresh = function () { refresh(); };
    window.zvenoBalanceSetKey = askKey;
    window.zvenoBalanceSetManual = askManual;

    function boot() {
        bind();
        if (!showManual()) showCache();
        setTimeout(function () { refresh(true); }, 1200);
        setInterval(function () { refresh(true); }, 5 * 60 * 1000); // авто-обновление раз в 5 минут
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})();
