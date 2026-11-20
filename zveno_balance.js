// ============================================================
//  БАЛАНС ZVENOAI В ШАПКЕ ШТАБА
//  Ключ хранится ТОЛЬКО в localStorage этого устройства.
//  В репозиторий и в код ключ не пишется.
//  Короткое нажатие — обновить. Долгое (или ПКМ) — сменить ключ.
// ============================================================
(function () {
    'use strict';

    var LS_KEY = 'zvenoApiKey';        // сам ключ
    var LS_PATH = 'zvenoBalancePath';  // свой путь к балансу (если авто не угадал)
    var LS_CACHE = 'zvenoBalanceCache';
    var BASE = 'https://api.zveno.ai/v1';

    // Шлюзы отдают баланс по-разному — пробуем по очереди, пока не найдём число.
    var ENDPOINTS = ['/credits', '/balance', '/me', '/user/balance', '/dashboard/billing/credit_grants'];

    var longFired = false;
    var pressTimer = null;

    function box() { return document.getElementById('status-zveno'); }
    function label() { return document.getElementById('zveno-balance-text'); }

    function getKey() { try { return localStorage.getItem(LS_KEY) || ''; } catch (e) { return ''; } }
    function setKey(k) { try { localStorage.setItem(LS_KEY, k); } catch (e) {} }

    function render(text, color, title) {
        var e = label();
        if (e) { e.textContent = text; if (color) e.style.color = color; }
        var b = box();
        if (b && title) b.title = title;
    }

    // Достаём число из ответа любой формы (число, строка, вложенный объект).
    function pickNumber(obj, depth) {
        depth = depth || 0;
        if (obj == null || depth > 4) return null;
        if (typeof obj === 'number') return isFinite(obj) ? obj : null;
        if (typeof obj === 'string') {
            var m = obj.replace(',', '.').match(/-?\d+(\.\d+)?/);
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
        var custom = '';
        try { custom = localStorage.getItem(LS_PATH) || ''; } catch (e) {}
        return custom ? [custom].concat(ENDPOINTS) : ENDPOINTS.slice();
    }

    function fetchBalance(key) {
        var list = endpoints();
        var lastErr = 'нет ответа';

        return list.reduce(function (chain, path) {
            return chain.catch(function () {
                var url = path.indexOf('http') === 0 ? path : BASE + path;
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
        try {
            var c = JSON.parse(localStorage.getItem(LS_CACHE) || 'null');
            if (c && typeof c.v === 'number') {
                render('ZVENO ' + c.v.toFixed(2) + ' ₽', '#888', 'Последний известный баланс ZvenoAI');
            }
        } catch (e) {}
    }

    function refresh(silent) {
        var key = getKey();
        if (!key) {
            render('ZVENO 🔑', '#ffd700', 'Нажми, чтобы ввести ключ ZvenoAI');
            return;
        }
        render('ZVENO …', '#aaa', 'Обновляю баланс ZvenoAI…');

        fetchBalance(key).then(function (res) {
            var v = res.value;
            var color = v <= 0 ? '#ff0055' : (v < 100 ? '#ffd700' : '#00ff88');
            render('ZVENO ' + v.toFixed(2) + ' ₽', color,
                   'Баланс ZvenoAI: ' + v.toFixed(2) + ' ₽  (' + res.path + ')');
            try { localStorage.setItem(LS_CACHE, JSON.stringify({ v: v, t: Date.now() })); } catch (e) {}
        }).catch(function (e) {
            render('ZVENO ✖', '#ff0055',
                   'Баланс не получен: ' + e.message + '\nДолгое нажатие — сменить ключ или путь.');
            if (!silent) console.warn('ZvenoAI balance:', e.message);
        });
    }

    function askKey() {
        var cur = getKey();
        var k = prompt('ZvenoAI API-ключ (sk-...).\nХранится только на этом устройстве, в репозиторий не пишется.',
                       cur ? '' : '');
        if (k === null) return;
        k = k.trim();
        if (!k) return;
        setKey(k);
        refresh();
    }

    function askPath() {
        var cur = '';
        try { cur = localStorage.getItem(LS_PATH) || ''; } catch (e) {}
        var p = prompt('Путь к балансу (необязательно).\nПусто — искать автоматически.\nПример: /credits', cur);
        if (p === null) return;
        p = p.trim();
        try {
            if (p) localStorage.setItem(LS_PATH, p);
            else localStorage.removeItem(LS_PATH);
        } catch (e) {}
        refresh();
    }

    function bind() {
        var b = box();
        if (!b) return;

        function startPress() {
            clearTimeout(pressTimer);
            pressTimer = setTimeout(function () {
                longFired = true;
                askKey();
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
            if (!getKey()) askKey();
            else refresh();
        });
    }

    window.zvenoBalanceRefresh = function () { refresh(); };
    window.zvenoBalanceSetKey = askKey;

    function boot() {
        bind();
        showCache();
        setTimeout(function () { refresh(true); }, 1200);
        setInterval(function () { refresh(true); }, 5 * 60 * 1000); // авто-обновление раз в 5 минут
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})();
