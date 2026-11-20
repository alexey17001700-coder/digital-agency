// ============================================================
//  БАЛАНС ZVENOAI В ШАПКЕ ШТАБА
//  Вверху видно сам баланс. Тык по нему → окошко с полями:
//  баланс, цена за 1 млн токенов, расход. Баланс сам уменьшается
//  с каждым ответом модели.
//  Всё хранится ТОЛЬКО в localStorage этого устройства.
// ============================================================
(function () {
    'use strict';

    var LS_START = 'zvenoBalanceManual';  // баланс, который ввёл Босс
    var LS_SPENT = 'zvenoSpentTokens';    // накопленные токены
    var LS_SPENT_RUB = 'zvenoSpentRub';   // накопленный расход, ₽
    var LS_PRICE = 'zvenoPricePerM';      // цена за 1 млн токенов, ₽
    var DEFAULT_PRICE = 8.17;             // ₽ за 1 млн токенов (средняя по моделям)

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

    function fmt(n) { return n.toFixed(2).replace('.', ','); }

    function render(text, color, title) {
        var e = label();
        if (e) { e.textContent = text; if (color) e.style.color = color; }
        var b = box();
        if (b && title) b.title = title;
    }

    function show() {
        var v = currentBalance();
        if (v === null) {
            // Баланс ещё не введён — показываем 0,00 ₽ серым.
            render('0,00 ₽', '#888', 'Баланс не задан. Нажми и введи текущий баланс ZvenoAI');
            return;
        }
        var color = v <= 0 ? '#ff0055' : (v < 100 ? '#ffd700' : '#00ff88');
        render(fmt(v) + ' ₽', color,
               'Баланс ZvenoAI: ' + fmt(v) + ' ₽\n' +
               'Введён: ' + fmt(getStart()) + ' ₽ · израсходовано: ' + fmt(getSpentRub()) + ' ₽\n' +
               'Токенов: ' + Math.round(getSpentTokens()).toLocaleString('ru-RU') +
               ' · цена: ' + fmt(getPrice()) + ' ₽ за 1 млн');
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

    // ---------- ОКНО НАСТРОЕК ----------
    function openPanel() {
        if (document.getElementById('zveno-panel')) return;

        var bal = currentBalance();

        var ov = document.createElement('div');
        ov.id = 'zveno-panel';
        ov.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.72);' +
            'display:flex;align-items:center;justify-content:center;padding:16px;' +
            'font-family:inherit;';

        ov.innerHTML =
            '<div style="width:100%;max-width:340px;background:#101418;border:1px solid #2a333d;' +
            'border-radius:14px;padding:18px;color:#e6edf3;box-shadow:0 12px 40px rgba(0,0,0,.6)">' +
              '<div style="font-size:15px;font-weight:700;letter-spacing:.5px;margin-bottom:14px">' +
                'БАЛАНС ZVENOAI</div>' +

              '<label style="display:block;font-size:11px;color:#8b98a5;margin-bottom:4px">' +
                'ТЕКУЩИЙ БАЛАНС, ₽</label>' +
              '<input id="zv-bal" type="text" inputmode="decimal" ' +
                'value="' + (bal === null ? '0.00' : bal.toFixed(2)) + '" ' +
                'placeholder="0.00" ' +
                'style="width:100%;box-sizing:border-box;background:#0a0d10;border:1px solid #2a333d;' +
                'border-radius:8px;padding:10px;color:#e6edf3;font-size:16px;margin-bottom:12px">' +

              '<label style="display:block;font-size:11px;color:#8b98a5;margin-bottom:4px">' +
                'ЦЕНА ЗА 1 МЛН ТОКЕНОВ, ₽</label>' +
              '<input id="zv-price" type="text" inputmode="decimal" ' +
                'value="' + getPrice().toFixed(2) + '" ' +
                'style="width:100%;box-sizing:border-box;background:#0a0d10;border:1px solid #2a333d;' +
                'border-radius:8px;padding:10px;color:#e6edf3;font-size:16px;margin-bottom:12px">' +

              '<div style="font-size:12px;color:#8b98a5;line-height:1.6;margin-bottom:14px">' +
                'Израсходовано: <b style="color:#e6edf3">' + fmt(getSpentRub()) + ' ₽</b><br>' +
                'Токенов: <b style="color:#e6edf3">' +
                  Math.round(getSpentTokens()).toLocaleString('ru-RU') + '</b>' +
              '</div>' +

              '<button id="zv-save" style="width:100%;padding:11px;border:0;border-radius:8px;' +
                'background:#00ff88;color:#04120a;font-weight:700;font-size:14px;margin-bottom:8px;' +
                'cursor:pointer">СОХРАНИТЬ</button>' +

              '<button id="zv-reset" style="width:100%;padding:9px;border:1px solid #2a333d;' +
                'border-radius:8px;background:transparent;color:#8b98a5;font-size:13px;' +
                'margin-bottom:8px;cursor:pointer">СБРОСИТЬ РАСХОД</button>' +

              '<button id="zv-close" style="width:100%;padding:9px;border:1px solid #2a333d;' +
                'border-radius:8px;background:transparent;color:#8b98a5;font-size:13px;' +
                'cursor:pointer">ЗАКРЫТЬ</button>' +
            '</div>';

        document.body.appendChild(ov);

        function close() { if (ov.parentNode) ov.parentNode.removeChild(ov); }

        ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
        ov.querySelector('#zv-close').addEventListener('click', close);

        ov.querySelector('#zv-save').addEventListener('click', function () {
            var b = num(ov.querySelector('#zv-bal').value, null);
            var pr = num(ov.querySelector('#zv-price').value, null);
            if (pr !== null && pr > 0) lsSet(LS_PRICE, String(pr));
            if (b === null) { lsDel(LS_START); lsDel(LS_SPENT); lsDel(LS_SPENT_RUB); }
            else {
                // Введённое число = баланс СЕЙЧАС, расход начинаем с нуля.
                lsSet(LS_START, String(b));
                lsSet(LS_SPENT, '0');
                lsSet(LS_SPENT_RUB, '0');
            }
            show();
            close();
        });

        ov.querySelector('#zv-reset').addEventListener('click', function () {
            var s = getStart();
            lsSet(LS_SPENT, '0');
            lsSet(LS_SPENT_RUB, '0');
            if (s !== null) lsSet(LS_START, String(s));
            show();
            close();
        });
    }

    function bind() {
        var b = box();
        if (!b) return;
        b.style.cursor = 'pointer';
        b.addEventListener('click', function (e) { e.preventDefault(); openPanel(); });
        b.addEventListener('contextmenu', function (e) { e.preventDefault(); openPanel(); });
    }

    window.zvenoBalanceRefresh = show;
    window.zvenoBalanceSetManual = openPanel;
    window.zvenoAddUsage = addUsage;   // chat.js зовёт после каждого ответа модели
    // Если шлюз не вернул usage — считаем токены по длине текста (~4 символа на токен).
    window.zvenoAddText = function (text) {
        var s = String(text || '');
        if (!s) return;
        addUsage({ total_tokens: Math.max(1, Math.round(s.length / 4)) });
    };

    function boot() {
        var b = box();
        if (b) b.innerHTML = '<span id="zveno-balance-text"></span>';
        bind();
        show();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})();
