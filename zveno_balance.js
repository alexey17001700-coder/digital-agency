// ============================================================
//  БАЛАНС ZVENOAI В ШАПКЕ ШТАБА
//  Просто: нажал на ZVENO → ввёл свой баланс → он висит вверху
//  и сам уменьшается с каждым потраченным токеном.
//  Всё хранится ТОЛЬКО в localStorage этого устройства.
// ============================================================
(function () {
    'use strict';

    var LS_START = 'zvenoBalanceManual';  // баланс, который ввёл Босс
    var LS_SPENT = 'zvenoSpentTokens';    // накопленные токены
    var LS_SPENT_RUB = 'zvenoSpentRub';   // накопленный расход, ₽
    var LS_PRICE = 'zvenoPricePerM';      // цена за 1 млн токенов, ₽
    var DEFAULT_PRICE = 8.17;             // ₽ за 1 млн токенов (средняя по моделям)

    var longFired = false;
    var pressTimer = null;

    function box() { return document.getElementById('status-zveno'); }
    function label() { return document.getElementById('zveno-balance-text'); }

    function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
    function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
    function lsDel(k) { try { localStorage.removeItem(k); } catch (e) {} }

    function num(v, def) {
        var n = parseFloat(String(v == null ? '' : v).replace(/\s/g, '').replace(',', '.'));
        return isFinite(n) ? n : def;
    }
    function getStart() {
        var raw = lsGet(LS_START);
        if (raw === null || raw === '') return null;
        var v = num(raw, null);
        return v === null ? null : v;
    }
    function getPrice() {
        var v = num(lsGet(LS_PRICE), DEFAULT_PRICE);
        return v > 0 ? v : DEFAULT_PRICE;
    }
    function getSpentTokens() { return num(lsGet(LS_SPENT), 0); }
    function getSpentRub() { return num(lsGet(LS_SPENT_RUB), 0); }

    // Текущий баланс = введённый минус потраченное.
    function currentBalance() {
        var s = getStart();
        return s === null ? null : s - getSpentRub();
    }

    function render(text, color, title) {
        var e = label();
        if (e) { e.textContent = text; if (color) e.style.color = color; }
        var b = box();
        if (b && title) b.title = title;
    }

    function show() {
        var v = currentBalance();
        if (v === null) {
            render('ZVENO — ₽', '#888', 'Нажми, чтобы ввести текущий баланс ZvenoAI');
            return false;
        }
        var color = v <= 0 ? '#ff0055' : (v < 100 ? '#ffd700' : '#00ff88');
        render('ZVENO ' + v.toFixed(2) + ' ₽', color,
               'Баланс ZvenoAI: ' + v.toFixed(2) + ' ₽\n' +
               'Введён: ' + getStart().toFixed(2) + ' ₽ · израсходовано: ' + getSpentRub().toFixed(2) + ' ₽\n' +
               'Токенов: ' + Math.round(getSpentTokens()).toLocaleString('ru-RU') +
               ' · цена: ' + getPrice().toFixed(2) + ' ₽ за 1 млн\n' +
               'Нажатие — сменить баланс · долгое нажатие — расход');
        return true;
    }

    // Учёт токенов от модели. Зовётся из chat.js после каждого ответа.
    function addUsage(usage) {
        if (!usage || typeof usage !== 'object') return;
        var p = Number(usage.prompt_tokens || usage.input_tokens || 0);
        var c = Number(usage.completion_tokens || usage.output_tokens || 0);
        var total = Number(usage.total_tokens || 0);
        if (!total) total = p + c;
        if (!isFinite(total) || total <= 0) return;
        lsSet(LS_SPENT, String(getSpentTokens() + total));
        lsSet(LS_SPENT_RUB, String(getSpentRub() + (total / 1000000) * getPrice()));
        show();
    }

    // Ввод текущего баланса — единственное, что нужно от Босса.
    function askBalance() {
        var cur = currentBalance();
        var p = prompt('Текущий баланс ZvenoAI, ₽ (например 582.41).\nДальше он сам уменьшается с каждым потраченным токеном.',
                       cur !== null ? cur.toFixed(2) : '');
        if (p === null) return;
        p = String(p).replace(/\s/g, '').replace(',', '.').trim();
        if (!p) { lsDel(LS_START); lsDel(LS_SPENT); lsDel(LS_SPENT_RUB); show(); return; }
        var v = parseFloat(p);
        if (!isFinite(v)) { alert('Не понял число.'); return; }
        lsSet(LS_START, String(v));
        lsSet(LS_SPENT, '0');
        lsSet(LS_SPENT_RUB, '0');
        show();
    }

    function showSpent() {
        var bal = currentBalance();
        var ans = prompt(
            'ZvenoAI — расход через Штаб\n\n' +
            'Баланс: ' + (bal === null ? '—' : bal.toFixed(2) + ' ₽') + '\n' +
            'Израсходовано: ' + getSpentRub().toFixed(2) + ' ₽\n' +
            'Токенов: ' + Math.round(getSpentTokens()).toLocaleString('ru-RU') + '\n' +
            'Цена: ' + getPrice().toFixed(2) + ' ₽ за 1 млн\n\n' +
            'Введи цену за 1 млн токенов, ₽ (Enter — оставить как есть).',
            String(getPrice()));
        if (ans === null) return;
        ans = String(ans).replace(/\s/g, '').replace(',', '.').trim();
        if (!ans) return;
        var v = parseFloat(ans);
        if (!isFinite(v) || v <= 0) { alert('Не понял число.'); return; }
        lsSet(LS_PRICE, String(v));
        show();
    }

    function bind() {
        var b = box();
        if (!b) return;

        function startPress() {
            clearTimeout(pressTimer);
            pressTimer = setTimeout(function () { longFired = true; showSpent(); }, 700);
        }
        function cancelPress() { clearTimeout(pressTimer); }

        b.addEventListener('touchstart', startPress, { passive: true });
        b.addEventListener('touchend', cancelPress);
        b.addEventListener('touchmove', cancelPress);
        b.addEventListener('mousedown', startPress);
        b.addEventListener('mouseup', cancelPress);
        b.addEventListener('mouseleave', cancelPress);
        b.addEventListener('contextmenu', function (e) { e.preventDefault(); askBalance(); });

        b.addEventListener('click', function () {
            if (longFired) { longFired = false; return; }
            askBalance();
        });
    }

    window.zvenoBalanceRefresh = show;
    window.zvenoBalanceSetManual = askBalance;
    window.zvenoAddUsage = addUsage;   // chat.js зовёт после каждого ответа модели
    // Если шлюз не вернул usage — считаем токены по длине текста (~4 символа на токен).
    window.zvenoAddText = function (text) {
        var s = String(text || '');
        if (!s) return;
        addUsage({ total_tokens: Math.max(1, Math.round(s.length / 4)) });
    };

    function boot() {
        bind();
        show();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})();
