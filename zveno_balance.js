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
    var DEFAULT_PRICE = 17.0;             // ₽ за 1 млн токенов — средняя ставка из логов ZvenoAI
    var CACHE_DISCOUNT = 0.4;             // прочитанное из кеша дешевле: 40% от ставки
    var INPUT_OVERHEAD = 8000;            // системный промпт + инструменты + контекст агентов, токенов
    var REASONING_FACTOR = 1.25;          // скрытые рассуждения модели ≈ +25% к ответу

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
        if (raw === null || raw === '') return 0;   // не задан → ноль
        var v = num(raw, 0);
        return v === null ? 0 : v;
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
        var v = s - getSpentRub();
        return v < 0 ? 0 : v;      // ниже нуля не уходим
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
        if (!getStart()) {
            // Баланс не введён (или ноль) — в шапке стоят нули.
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

    // Учёт токенов от модели. Возвращает true, если токены реально списаны.
    function addUsage(usage) {
        if (!usage || typeof usage !== 'object') return false;
        var p = Number(usage.prompt_tokens || usage.input_tokens || usage.promptTokens || usage.inputTokens || 0);
        var c = Number(usage.completion_tokens || usage.output_tokens || usage.completionTokens || usage.outputTokens || 0);
        // Скрытые reasoning-токены (размышления модели) тоже платные — учитываем.
        var det = usage.completion_tokens_details || usage.output_tokens_details || {};
        var reas = Number(det.reasoning_tokens || det.reasoningTokens || usage.reasoning_tokens || 0);
        if (isFinite(reas) && reas > 0) c += reas;
        var total = Number(usage.total_tokens || usage.totalTokens || 0);
        if (!total) total = p + c;
        if (!isFinite(total) || total <= 0) return false;
        lsSet(LS_SPENT, String(getSpentTokens() + total));
        lsSet(LS_SPENT_RUB, String(getSpentRub() + (total / 1000000) * getPrice()));
        try { console.log('[zveno] списано токенов:', total, '· баланс:', currentBalance().toFixed(2), '₽'); } catch (e) {}
        show();
        return true;
    }

    // Оценка токенов по длине текста (~4 символа на токен).
    function addText(text) {
        var s = String(text || '');
        if (!s) return false;
        return addUsage({ total_tokens: Math.max(1, Math.round(s.length / 4)) });
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
                'value="' + (isFinite(bal) ? bal.toFixed(2) : '0.00') + '" ' +
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
            var b = num(ov.querySelector('#zv-bal').value, 0);
            var pr = num(ov.querySelector('#zv-price').value, null);
            if (pr !== null && pr > 0) lsSet(LS_PRICE, String(pr));
            // Пустое поле = ноль. Введённое число = баланс СЕЙЧАС, расход начинаем с нуля.
            lsSet(LS_START, String(b === null ? 0 : b));
            lsSet(LS_SPENT, '0');
            lsSet(LS_SPENT_RUB, '0');
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
        if (b.dataset.zvBound === '1') return;   // уже повешено
        b.dataset.zvBound = '1';
        b.addEventListener('click', function (e) { e.preventDefault(); openPanel(); });
        b.addEventListener('contextmenu', function (e) { e.preventDefault(); openPanel(); });
    }

    window.zvenoBalanceRefresh = show;
    window.zvenoBalanceSetManual = openPanel;
    window.zvenoAddUsage = addUsage;   // chat.js зовёт после каждого ответа модели
    window.zvenoAddText = addText;     // если шлюз не вернул usage — считаем по длине текста

    // ЗАЩИТА ОТ ДВОЙНОГО СПИСАНИЯ: один и тот же ответ может прийти
    // и от chat.js, и от перехватчика fetch. Считаем его РОВНО ОДИН раз.
    var lastSig = '', lastSigAt = 0;
    function alreadyCounted(sig) {
        var now = Date.now();
        if (sig && sig === lastSig && (now - lastSigAt) < 3000) return true;
        lastSig = sig; lastSigAt = now;
        return false;
    }

    // ГЛАВНАЯ функция учёта. РЕАЛЬНЫЙ расход = ВХОД (запрос: вся история) + ВЫХОД (ответ).
    // 1) Есть usage от шлюза — берём его (самый точный).
    // 2) Нет usage — считаем по длине текста (4 символа = 1 токен).
    window.zvenoAccount = function (data, text, promptText) {
        var out = text;
        if (!out && data && data.choices && data.choices[0] && data.choices[0].message) {
            out = data.choices[0].message.content;
        }
        var sig = String(promptText || '').slice(-300) + '||' + String(out || '').slice(0, 300);
        if (alreadyCounted(sig)) return false;

        // 1) Реальный usage от шлюза — самый точный.
        if (data && data.usage) {
            var u = data.usage;
            var t = Number(u.total_tokens || u.totalTokens || 0);
            if (!t) {
                var det = u.completion_tokens_details || u.output_tokens_details || {};
                var reas = Number(det.reasoning_tokens || det.reasoningTokens || u.reasoning_tokens || 0);
                t = Number(u.prompt_tokens || u.input_tokens || u.promptTokens || u.inputTokens || 0)
                  + Number(u.completion_tokens || u.output_tokens || u.completionTokens || u.outputTokens || 0)
                  + (isFinite(reas) ? reas : 0);
            }
            if (isFinite(t) && t > 0) return addUsage({ total_tokens: t });
        }

        // 2) Нет usage — считаем по длине: вход (вся история) + выход (ответ).
        var inTok = promptText ? Math.max(1, Math.round(String(promptText).length / 4)) : 0;
        var outTok = out ? Math.max(1, Math.round(String(out).length / 4)) : 0;
        var total = inTok + outTok;
        if (total > 0) return addUsage({ total_tokens: total });
        return false;
    };

    // ---------- АВТО-УЧЁТ ЧЕРЕЗ fetch (ГЛАВНАЯ СТРАХОВКА) ----------
    // ЛЮБОЙ запрос к модели — основной ответ, Совет, фоновая задача,
    // дозапросы READ / SEARCH / WEATHER — идёт через fetch. Перехватываем
    // его и считаем токены сами: баланс падает ВСЕГДА, даже если chat.js
    // по какой-то причине не позвал zvenoAccount. Двойного списания нет —
    // защита alreadyCounted() выше.
    (function hookFetch() {
        if (window.__zvenoFetchHooked) return;
        window.__zvenoFetchHooked = true;
        var orig = window.fetch;
        if (typeof orig !== 'function') return;

        window.fetch = function (input, init) {
            var promptText = '', isModelCall = false;
            try {
                var method = (init && init.method) ? String(init.method).toUpperCase() : 'GET';
                if (method === 'POST' && init && init.body && typeof init.body === 'string') {
                    var body = JSON.parse(init.body);
                    // Модельный запрос — это POST с массивом messages.
                    // Поиск (searchQuery) и запись файла (updateFile) пропускаем.
                    if (body && Array.isArray(body.messages) && body.messages.length) {
                        isModelCall = true;
                        promptText = body.messages.map(function (m) { return (m && m.content) || ''; }).join('\n');
                    }
                }
            } catch (e) { isModelCall = false; }

            var p = orig.apply(this, arguments);
            if (!isModelCall) return p;

            return p.then(function (res) {
                try {
                    if (res && res.ok) {
                        res.clone().json().then(function (data) {
                            var out = (data && data.choices && data.choices[0] && data.choices[0].message)
                                ? data.choices[0].message.content : '';
                            window.zvenoAccount(data, out, promptText);
                        }).catch(function () {
                            window.zvenoAccount(null, '', promptText);
                        });
                    }
                } catch (e) {}
                return res;
            });
        };
    })();

    function boot() {
        var b = box();
        if (!b) return;
        // Если в разметке уже есть подпись — используем её, не плодим дубли.
        if (!document.getElementById('zveno-balance-text')) {
            b.innerHTML = '<span id="zveno-balance-text"></span>';
        }
        bind();
        show();
        // Страховка: другие скрипты могут перерисовать статус-бар —
        // возвращаем подпись образа и цифру, чтобы в шапке всегда был баланс.
        setInterval(function () {
            var e = label();
            if (!e) {
                if (!document.getElementById('zveno-balance-text')) {
                    var host = box();
                    if (host) host.innerHTML = '<span id="zveno-balance-text"></span>';
                }
            }
            show();
            bind();
        }, 3000);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})();
