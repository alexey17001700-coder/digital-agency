/* ============================================================================
   figures.js — ЖИВЫЕ ФИГУРЫ АГЕНТОВ (анимированный SVG, без внешних файлов)
   ----------------------------------------------------------------------------
   Зачем: Босс сказал «клиенты хотят видеть живые фигуры». В 2D-карточках
   агентов (agents.js) вместо фигур стояли эмодзи 🤖👑 — это и был «мёртвый»
   дизайн, который клиент видит первым.

   Что делает модуль:
   • window.agentFigureSVG(name, color) — строка с SVG-фигурой человека:
     голова, торс, руки, ноги, причёска и аксессуар по роли.
   • Фигура ДЫШИТ (торс), МОРГАЕТ (глаза), ПОВОРАЧИВАЕТ ГОЛОВУ, шевелит
     руками и слегка покачивается — всё на CSS-анимациях, без JS-цикла.
   • Цвет одежды = AGENT_COLORS[name], поэтому фигура и рамка карточки в одном стиле.
   • У каждого агента свой ритм (animation-delay от хеша имени) — фигуры
     не мигают синхронно, «толпа» выглядит живой.
   • Ничего не грузит из сети: чистый inline SVG + инжект CSS. Вес ~0.
   • Уважает prefers-reduced-motion: при отключённой анимации фигуры статичны.

   Совместимость: если модуль не загрузился, agents.js подставит пустую строку
   и карточка отрисуется как раньше — ничего не падает.
   ========================================================================== */
(function () {
    'use strict';

    const SKIN = ['#f2c9a0', '#e6b183', '#d19a6a', '#b87a4e', '#f7d9b8'];
    const HAIR = ['#1b1f27', '#2b2118', '#3a2a1c', '#4a4a52', '#6b4a2a'];

    /* Стабильный хеш имени: одинаковый агент — одинаковая внешность и ритм. */
    function hash(s) {
        let h = 0;
        s = String(s || '');
        for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
        return Math.abs(h);
    }

    /* Затемнить/осветлить цвет AGENT_COLORS для рукавов и обводки. */
    function shade(hex, k) {
        let h = String(hex || '#00e5ff').replace('#', '');
        if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
        const num = parseInt(h, 16);
        if (isNaN(num)) return hex || '#00e5ff';
        let r = (num >> 16) & 255, g = (num >> 8) & 255, b = num & 255;
        r = Math.max(0, Math.min(255, Math.round(r * (1 + k))));
        g = Math.max(0, Math.min(255, Math.round(g * (1 + k))));
        b = Math.max(0, Math.min(255, Math.round(b * (1 + k))));
        return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
    }

    /* Аксессуар по роли. Возвращает ДВЕ части:
       head — то, что рисуется поверх головы (внутри анимированной группы головы);
       body — то, что рисуется на торсе (иначе галстук уезжал бы вместе с головой).
       Ключевые слова русские и английские — модуль не зависит от точного
       списка имён агентов. */
    function accessory(name, accent, hair) {
        const n = String(name || '').toLowerCase();
        const out = { head: '', body: '' };

        // Руководитель / Оркестратор — корона.
        if (/оркестр|директор|босс|шеф|главн|руковод|chief|boss|lead/.test(n)) {
            out.head = '<path d="M22 4 L25 -2 L32 3 L39 -2 L42 4 Z" fill="#ffd700" stroke="#b8860b" stroke-width="0.8" stroke-linejoin="round"/>';
            return out;
        }
        // Хакер / Red Team — капюшон.
        if (/хакер|взлом|hack|red.?team/.test(n)) {
            out.head = '<path d="M20 20 Q20 3 32 3 Q44 3 44 20 Q38 11 32 11 Q26 11 20 20 Z" fill="#1b2028"/>';
            return out;
        }
        // Охранник / Тестировщик / Исполнитель / DevOps — каска.
        if (/охран|страж|guard|security|blue.?team|тест|qa|исполн|инженер|engineer|devops|сборк/.test(n)) {
            out.head = '<path d="M20 13 Q20 3 32 3 Q44 3 44 13 Z" fill="#ffd700"/><rect x="18" y="12" width="28" height="2.6" rx="1.3" fill="#c9a400"/>';
            return out;
        }
        // Аналитик / Критик / Юрист / Техпис / Исследователь — очки.
        if (/аналит|критик|юрист|техпис|ревизор|исслед|audit|analyst|critic|law|research/.test(n)) {
            out.head = '<g fill="none" stroke="#0d1117" stroke-width="1.4"><rect x="25" y="15" width="6" height="5" rx="2"/><rect x="33" y="15" width="6" height="5" rx="2"/><path d="M31 17.5 h2"/></g>';
            return out;
        }
        // Переводчик / Приёмная / Диспетчер — гарнитура.
        if (/перевод|приемн|приёмн|диспетч|оператор|support|voice/.test(n)) {
            out.head = '<path d="M20 16 Q20 4 32 4 Q44 4 44 16" fill="none" stroke="' + accent + '" stroke-width="2"/>' +
                '<rect x="16.5" y="14" width="4" height="7" rx="2" fill="' + accent + '"/>' +
                '<rect x="43.5" y="14" width="4" height="7" rx="2" fill="' + accent + '"/>' +
                '<path d="M18.5 21 Q22 26 26 25" fill="none" stroke="' + accent + '" stroke-width="1.6"/>';
            return out;
        }
        // Маркетолог / Планировщик — кепка.
        if (/маркет|план|продаж|реклам|sale|marketing|promo/.test(n)) {
            out.head = '<path d="M20 12 Q22 3 32 3 Q42 3 44 12 Z" fill="' + accent + '"/><rect x="17" y="11" width="22" height="2.8" rx="1.4" fill="' + accent + '"/>';
            return out;
        }
        // Методолог / Архитектор — борода.
        if (/метод|архит|наставн|mentor|architect/.test(n)) {
            out.head = '<path d="M23 19 Q32 31 41 19 Q39 28 32 29 Q25 28 23 19 Z" fill="' + hair + '"/>';
            return out;
        }
        // Дизайнер / Креатив — длинные волосы.
        if (/дизайн|креатив|арт|design|creative|ui|ux/.test(n)) {
            out.head = '<path d="M20 15 Q20 3 32 3 Q44 3 44 15 L44 27 Q42 20 40 17 Q36 11 32 11 Q28 11 24 17 Q22 20 20 27 Z" fill="' + hair + '"/>';
            return out;
        }
        // GigaChat / ИИ / Робот — антенна.
        if (/giga|гига|ии|ai|робот|bot|нейро/.test(n)) {
            out.head = '<path d="M32 4 L32 -2" stroke="' + accent + '" stroke-width="1.6"/><circle cx="32" cy="-3" r="2.2" fill="' + accent + '"/>';
            return out;
        }
        // Остальные — галстук цвета агента на торсе.
        out.body = '<path d="M32 33 L35 36 L32 45 L29 36 Z" fill="' + accent + '"/>';
        return out;
    }

    /* Главная функция: SVG-фигура агента. */
    function agentFigureSVG(name, color) {
        const seed = hash(name);
        const skin = SKIN[seed % SKIN.length];
        const hair = HAIR[(seed >> 3) % HAIR.length];
        const accent = color || '#00e5ff';
        const dark = shade(accent, -0.4);
        const delay = ((seed % 47) / 10).toFixed(1); // 0.0–4.6 c, свой ритм у каждого
        const acc = accessory(name, accent, hair);

        return '<svg class="fig-svg" viewBox="0 -6 64 98" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">' +
            '<g class="fig-body" style="animation-delay:-' + delay + 's">' +
                // ноги и обувь
                '<rect x="25" y="62" width="6" height="22" rx="3" fill="#1a2029"/>' +
                '<rect x="33" y="62" width="6" height="22" rx="3" fill="#1a2029"/>' +
                '<rect x="22" y="82" width="10" height="5" rx="2.5" fill="#0d1117"/>' +
                '<rect x="32" y="82" width="10" height="5" rx="2.5" fill="#0d1117"/>' +
                // руки (рисуем ДО торса, чтобы плечи уходили под пиджак)
                '<g class="fig-arm-l" style="animation-delay:-' + delay + 's">' +
                    '<rect x="16" y="38" width="6" height="22" rx="3" fill="' + dark + '"/>' +
                    '<circle cx="19" cy="62" r="3.2" fill="' + skin + '"/>' +
                '</g>' +
                '<g class="fig-arm-r" style="animation-delay:-' + delay + 's">' +
                    '<rect x="42" y="38" width="6" height="22" rx="3" fill="' + dark + '"/>' +
                    '<circle cx="45" cy="62" r="3.2" fill="' + skin + '"/>' +
                '</g>' +
                // торс
                '<path d="M22 42 Q22 34 30 32 L34 32 Q42 34 42 42 L42 62 Q42 66 38 66 L26 66 Q22 66 22 62 Z" fill="' + accent + '" stroke="' + dark + '" stroke-width="1"/>' +
                '<path d="M28 32 L32 40 L36 32" fill="none" stroke="' + dark + '" stroke-width="2" stroke-linejoin="round"/>' +
                acc.body +
                // шея
                '<rect x="29" y="25" width="6" height="9" rx="2" fill="' + skin + '"/>' +
                // голова
                '<g class="fig-head" style="animation-delay:-' + delay + 's">' +
                    '<circle cx="32" cy="17" r="11" fill="' + skin + '"/>' +
                    '<path d="M21 15 Q22 5 32 5 Q42 5 43 15 Q38 10 32 10 Q26 10 21 15 Z" fill="' + hair + '"/>' +
                    '<g class="fig-eyes" style="animation-delay:-' + delay + 's">' +
                        '<ellipse cx="28" cy="17.5" rx="1.7" ry="2.1" fill="#0d1117"/>' +
                        '<ellipse cx="36" cy="17.5" rx="1.7" ry="2.1" fill="#0d1117"/>' +
                    '</g>' +
                    '<path d="M29 22.5 Q32 24.5 35 22.5" fill="none" stroke="#0d1117" stroke-width="1.3" stroke-linecap="round"/>' +
                    acc.head +
                '</g>' +
            '</g>' +
        '</svg>';
    }

    /* --- CSS один раз на страницу ------------------------------------------- */
    const CSS = [
        '.agent-figure{display:inline-flex;width:25px;height:34px;vertical-align:middle;margin-right:6px;flex:0 0 auto;animation:figSway 4.6s ease-in-out infinite;}',
        '.agent-figure .fig-svg{width:100%;height:100%;overflow:visible;display:block;}',
        '.agent-figure .fig-body{animation:figBreathe 3.6s ease-in-out infinite;transform-box:fill-box;transform-origin:50% 100%;}',
        '.agent-figure .fig-head{animation:figHead 7s ease-in-out infinite;transform-box:fill-box;transform-origin:50% 88%;}',
        '.agent-figure .fig-eyes{animation:figBlink 5.4s ease-in-out infinite;transform-box:fill-box;transform-origin:center;}',
        '.agent-figure .fig-arm-l{animation:figArmL 5.1s ease-in-out infinite;transform-box:fill-box;transform-origin:50% 8%;}',
        '.agent-figure .fig-arm-r{animation:figArmR 4.4s ease-in-out infinite;transform-box:fill-box;transform-origin:50% 8%;}',
        '@keyframes figBreathe{0%,100%{transform:scaleY(1)}50%{transform:scaleY(1.035)}}',
        '@keyframes figHead{0%,100%{transform:rotate(-3.5deg)}50%{transform:rotate(3.5deg)}}',
        '@keyframes figBlink{0%,92%,100%{transform:scaleY(1)}95%{transform:scaleY(0.1)}}',
        '@keyframes figArmL{0%,100%{transform:rotate(4deg)}50%{transform:rotate(-6deg)}}',
        '@keyframes figArmR{0%,100%{transform:rotate(-4deg)}50%{transform:rotate(6deg)}}',
        '@keyframes figSway{0%,100%{transform:translateY(0)}50%{transform:translateY(-1.2px)}}',
        '@media (prefers-reduced-motion: reduce){.agent-figure,.agent-figure .fig-body,.agent-figure .fig-head,.agent-figure .fig-eyes,.agent-figure .fig-arm-l,.agent-figure .fig-arm-r{animation:none!important;}}'
    ].join('\n');

    function injectCSS() {
        if (document.getElementById('figures-css')) return;
        const st = document.createElement('style');
        st.id = 'figures-css';
        st.textContent = CSS;
        (document.head || document.documentElement).appendChild(st);
    }

    injectCSS();

    window.agentFigureSVG = agentFigureSVG;
    window.FIGURES_VERSION = '1.0';
})();
