/* ============================================================================
   office3d_life.js — ЖИВЫЕ 3D-ФИГУРЫ (моргание, взгляд, микрожесты)
   ----------------------------------------------------------------------------
   office3d.js v3.6 уже рисует 25 агентов с человеческими пропорциями и
   анимацией ходьбы/печати/доклада. Чего не хватало для «живости» — микрожизни
   в простое: глаза не моргают, голова не двигается, фигура стоит как манекен.

   Этот модуль НЕ переписывает офис и не трогает его анимации. Он:
   • берёт сцену и список агентов через window.__o3d (экспорт из office3d.js);
   • находит у каждого агента голову (сфера r≈0.115) и глаза (сферы r<0.03);
   • в своём requestAnimationFrame ДОБАВЛЯЕТ поверх штатной анимации:
       – моргание (глаза сжимаются по Y на ~0.15 с раз в 4–7 с, у каждого свой ритм);
       – медленный поворот головы влево-вправо (взгляд по сторонам);
       – еле заметный наклон головы.
   • Добавка считается как дельта и вычитается на следующем кадре, поэтому
     НЕ накапливается и не конфликтует с pose-анимацией (доклад, печать).

   Всё в try/catch: если разметка рига изменится — модуль просто тихо выключится,
   офис продолжит работать как раньше.
   ========================================================================== */
(function () {
    'use strict';

    const LIFE_VERSION = '1.0';
    const targets = [];      // { model, head, eyes, phase }
    let running = false;
    let t0 = 0;

    /* --- Поиск агентов ------------------------------------------------------ */
    function collectModels() {
        const out = [];
        const api = window.__o3d;
        if (!api) return out;

        // 1) Штатный путь: массив агентов офиса.
        try {
            const arr = api.agents;
            if (arr && arr.length) {
                for (let i = 0; i < arr.length; i++) {
                    const a = arr[i];
                    const m = a && (a.model || a.group || a.root || a.mesh);
                    if (m && m.isObject3D) out.push(m);
                }
            }
        } catch (e) { /* нет доступа — идём фолбэком */ }
        if (out.length) return out;

        // 2) Фолбэк: ищем в сцене меши-головы и поднимаемся к их корню.
        try {
            const scene = api.scene;
            if (!scene) return out;
            const seen = new Set();
            scene.traverse(function (o) {
                if (!o.isMesh || !o.geometry) return;
                const g = o.geometry;
                if (g.type !== 'SphereGeometry') return;
                const r = g.parameters && g.parameters.radius;
                if (!(r > 0.09 && r < 0.14)) return;
                let p = o;
                for (let i = 0; i < 4 && p.parent; i++) p = p.parent;
                if (!seen.has(p)) { seen.add(p); out.push(p); }
            });
        } catch (e) { /* сцены нет — молчим */ }
        return out;
    }

    /* --- Голова и глаза внутри модели --------------------------------------
       Риг агента: aHead = SphereGeometry(0.115), aHair = 0.118, aEye = 0.014,
       aEar = 0.028, aAntTip = 0.020. Поэтому:
       • голова — сфера с радиусом, ближайшим к 0.115;
       • глаза — только мелкие сферы 0.008…0.018 (уши и антенна отсекаются);
       • крутим РОДИТЕЛЯ головы (там же волосы, уши, нос), но только если
         в нём же лежат глаза и это не корень модели — иначе поворот
         закрутил бы всё тело. */
    function findParts(model) {
        let head = null, headErr = 1e9;
        const eyes = [];
        try {
            model.traverse(function (o) {
                if (!o.isMesh || !o.geometry) return;
                const g = o.geometry;
                if (g.type !== 'SphereGeometry') return;
                const r = g.parameters && g.parameters.radius;
                if (!r) return;
                if (r > 0.09 && r < 0.14) {
                    const err = Math.abs(r - 0.115);
                    if (err < headErr) { headErr = err; head = o; }
                } else if (r > 0.008 && r < 0.018) {
                    eyes.push(o);
                }
            });
        } catch (e) { /* модель без геометрии — пропускаем */ }

        let pivot = head;
        if (head && head.parent && head.parent !== model) {
            let eyesInside = 0;
            try {
                head.parent.traverse(function (o) { if (eyes.indexOf(o) !== -1) eyesInside++; });
            } catch (e) { eyesInside = 0; }
            if (eyesInside > 0) pivot = head.parent;
        }
        return { head: pivot, eyes: eyes };
    }

    /* --- Ритм моргания: 0.08 (закрыто) … 1 (открыто) ------------------------ */
    function blinkFactor(t, phase) {
        const period = 4.2 + (phase % 2.3);       // 4.2–6.5 с
        const dur = 0.16;                          // длительность моргания
        const local = (t + phase) % period;
        if (local > period - dur) {
            const k = (local - (period - dur)) / dur;   // 0…1
            return Math.max(0.08, Math.abs(Math.cos(k * Math.PI)));
        }
        return 1;
    }

    /* --- Кадр --------------------------------------------------------------- */
    function frame(now) {
        if (!running) return;
        const t = (now - t0) / 1000;
        const hidden = document.hidden;

        for (let i = 0; i < targets.length; i++) {
            const tg = targets[i];
            try {
                // Глаза: моргание. Если офис скрыт — не тратим время.
                if (!hidden) {
                    const b = blinkFactor(t, tg.phase);
                    for (let e = 0; e < tg.eyes.length; e++) tg.eyes[e].scale.y = b;
                }

                // Голова: добавка к текущему повороту (без накопления).
                const head = tg.head;
                if (head) {
                    const prev = head.userData.__lifeY || 0;
                    const want = hidden ? 0
                        : Math.sin(t * 0.55 + tg.phase) * 0.16 +
                          Math.sin(t * 1.7 + tg.phase * 2) * 0.03;
                    head.rotation.y = head.rotation.y - prev + want;
                    head.userData.__lifeY = want;

                    const prevZ = head.userData.__lifeZ || 0;
                    const wantZ = hidden ? 0 : Math.sin(t * 0.9 + tg.phase) * 0.035;
                    head.rotation.z = head.rotation.z - prevZ + wantZ;
                    head.userData.__lifeZ = wantZ;
                }
            } catch (e) { /* один сломанный агент не роняет остальных */ }
        }

        requestAnimationFrame(frame);
    }

    /* --- Запуск ------------------------------------------------------------- */
    function start() {
        if (running) return true;
        const models = collectModels();
        if (!models.length) return false;

        targets.length = 0;
        for (let i = 0; i < models.length; i++) {
            const parts = findParts(models[i]);
            if (!parts.head && !parts.eyes.length) continue;
            targets.push({
                model: models[i],
                head: parts.head,
                eyes: parts.eyes,
                phase: (i * 1.37) % 6.28          // у каждого свой ритм
            });
        }
        if (!targets.length) return false;

        running = true;
        t0 = performance.now();
        requestAnimationFrame(frame);
        console.log('[office3d_life] оживлено фигур:', targets.length);
        return true;
    }

    // Офис создаётся при первом открытии — ждём появления сцены.
    const poll = setInterval(function () { if (start()) clearInterval(poll); }, 800);
    setTimeout(function () { clearInterval(poll); }, 120000);

    window.office3dLife = {
        version: LIFE_VERSION,
        start: start,
        stop: function () { running = false; },
        count: function () { return targets.length; }
    };
    window.OFFICE3D_LIFE_VERSION = LIFE_VERSION;
})();
