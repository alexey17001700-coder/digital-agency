/* =========================================
   tutorial.js — «ВИДЕОИНСТРУКЦИЯ» ПО ШТАБУ
   Босс: после главной загрузки окна Штаба должно показываться
   как будто видео-инструкция — как пользоваться Штабом.

   Реализация: полноэкранный оверлей-«плеер» с 5 анимированными
   сценами (кадр + субтитр), прогресс-баром, таймкодом и кнопками
   ⏮ ⏸/▶ ⏭. Это не настоящий видеофайл, а CSS-анимация: грузится
   мгновенно, не тянет трафик и не тормозит Штаб.

   Показывается ОДИН РАЗ на устройство (метка в localStorage).
   Повторно открыть: кнопка «🎬 Инструкция» в панели режимов (⚙️).
   ========================================= */
(function () {
    'use strict';

    const SEEN_KEY = 'shtabTutorialSeen';
    const SCENE_MS = 7000;   // длительность одной сцены
    const TICK_MS = 100;     // шаг прогресс-бара

    /* --- СЦЕНЫ: art — «кадр» видео, caption — субтитр --- */
    const SCENES = [
        {
            caption: 'Это Штаб — твой рабочий центр. Здесь ты ставишь задачи, а агенты их выполняют.',
            art: `
                <div class="tut-logo">📡</div>
                <div class="tut-h1">ЦИФРОВОЕ АГЕНТСТВО</div>
                <div class="tut-sub">Штаб загружен и готов к работе</div>
                <div class="tut-dots"><i></i><i></i><i></i></div>`
        },
        {
            caption: 'Пиши задачу в поле внизу и жми ➤. Архитектор разберёт её и сделает работу.',
            art: `
                <div class="tut-inputbar">
                    <span class="tut-typed">Напиши задачу Боссу...</span>
                    <span class="tut-send">➤</span>
                </div>
                <div class="tut-cursor"></div>
                <div class="tut-sub">Поле ввода задачи</div>`
        },
        {
            caption: 'Кнопки 📎 и 📄 — прикрепить фото или файл. 🎤 — голосовой ввод.',
            art: `
                <div class="tut-row">
                    <div class="tut-round">📎</div>
                    <div class="tut-round">📄</div>
                    <div class="tut-round">🎤</div>
                </div>
                <div class="tut-sub">Фото · Файл · Голос</div>`
        },
        {
            caption: 'Шестерёнка ⚙️ открывает все режимы: Офис, Голоса, Модели, API-ключи, Ремонт сервера.',
            art: `
                <div class="tut-gear">⚙️</div>
                <div class="tut-chips">
                    <span>🏢 Офис</span><span>🎛 Голоса</span><span>🧠 Модели</span><span>🔑 API</span><span>🚑 Ремонт</span>
                </div>
                <div class="tut-sub">Панель режимов</div>`
        },
        {
            caption: 'Справа — агенты. Тапни карточку, чтобы открыть агента и написать ему характер.',
            art: `
                <div class="tut-cards">
                    <div class="tut-card">🤖<br>Архитектор</div>
                    <div class="tut-card">🧠<br>GigaChat</div>
                    <div class="tut-card">⚙️<br>Техник</div>
                </div>
                <div class="tut-sub">Тап по карточке — открыть агента</div>`
        }
    ];

    const TOTAL_MS = SCENES.length * SCENE_MS;
    let st = null;   // состояние плеера

    const CSS = `
.tut-overlay{position:fixed;inset:0;z-index:99998;background:rgba(0,0,0,.94);display:flex;align-items:center;justify-content:center;padding:16px;font-family:system-ui,-apple-system,sans-serif;animation:tutFade .35s ease;}
.tut-player{width:min(94vw,760px);}
.tut-frame{position:relative;width:100%;aspect-ratio:16/9;background:radial-gradient(circle at 50% 40%,#0d1a20,#050505 70%);border:1px solid #00e5ff;border-radius:14px;overflow:hidden;box-shadow:0 0 30px rgba(0,229,255,.25);}
.tut-rec{position:absolute;top:10px;left:12px;font:11px monospace;color:#ff4d6d;letter-spacing:1px;display:flex;align-items:center;gap:6px;z-index:3;}
.tut-rec i{width:8px;height:8px;border-radius:50%;background:#ff4d6d;animation:tutBlink 1s infinite;}
.tut-tag{position:absolute;top:10px;right:12px;font:11px monospace;color:#00e5ff;border:1px solid #00e5ff55;border-radius:6px;padding:2px 8px;z-index:3;}
.tut-stage{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:24px 24px 56px;text-align:center;animation:tutFade .5s ease;}
.tut-caption{position:absolute;left:0;right:0;bottom:0;padding:12px 14px;background:linear-gradient(transparent,rgba(0,0,0,.9));color:#e6f7ff;font-size:13px;line-height:1.45;z-index:2;}
.tut-logo{font-size:52px;animation:tutPulse 1.6s infinite;}
.tut-h1{color:#00e5ff;font-weight:800;letter-spacing:2px;font-size:clamp(14px,3.4vw,22px);}
.tut-sub{color:#8b98a5;font-size:12px;}
.tut-dots{display:flex;gap:8px;margin-top:6px;}
.tut-dots i{width:8px;height:8px;border-radius:50%;background:#00e5ff;animation:tutJump 1.2s infinite;}
.tut-dots i:nth-child(2){animation-delay:.15s}
.tut-dots i:nth-child(3){animation-delay:.3s}
.tut-inputbar{width:min(80%,420px);display:flex;align-items:center;gap:8px;background:#141414;border:1px solid #333;border-radius:22px;padding:10px 12px;}
.tut-typed{display:inline-block;width:22ch;overflow:hidden;white-space:nowrap;text-align:left;color:#c9d6e2;font-size:13px;border-right:2px solid #00e5ff;animation:tutType 3.2s steps(22) infinite;}
.tut-send{width:34px;height:34px;border-radius:50%;background:#00e5ff;color:#000;display:flex;align-items:center;justify-content:center;font-weight:800;flex:0 0 auto;animation:tutPulse 1.6s infinite;}
.tut-cursor{position:absolute;width:16px;height:16px;border-radius:50%;background:rgba(0,229,255,.35);border:1px solid #00e5ff;animation:tutMove 3.2s infinite;}
.tut-row{display:flex;gap:18px;}
.tut-round{width:56px;height:56px;border-radius:50%;background:#1c1c1c;border:1px solid #333;display:flex;align-items:center;justify-content:center;font-size:24px;animation:tutPulse 1.8s infinite;}
.tut-round:nth-child(2){animation-delay:.2s}
.tut-round:nth-child(3){animation-delay:.4s}
.tut-gear{font-size:46px;animation:tutSpin 4s linear infinite;}
.tut-chips{display:flex;flex-wrap:wrap;gap:8px;justify-content:center;}
.tut-chips span{font-size:11px;color:#c9d6e2;border:1px solid #00e5ff55;background:#101820;border-radius:14px;padding:5px 10px;animation:tutFade .6s ease both;}
.tut-chips span:nth-child(2){animation-delay:.15s}
.tut-chips span:nth-child(3){animation-delay:.3s}
.tut-chips span:nth-child(4){animation-delay:.45s}
.tut-chips span:nth-child(5){animation-delay:.6s}
.tut-cards{display:flex;gap:12px;}
.tut-card{width:88px;padding:12px 6px;background:#121212;border:1px solid #333;border-radius:10px;color:#c9d6e2;font-size:11px;line-height:1.5;animation:tutPulse 2s infinite;}
.tut-card:nth-child(2){animation-delay:.25s}
.tut-card:nth-child(3){animation-delay:.5s}
.tut-controls{display:flex;align-items:center;gap:10px;margin-top:12px;}
.tut-btn{background:#141414;border:1px solid #00e5ff;color:#00e5ff;border-radius:8px;padding:8px 12px;font-size:14px;cursor:pointer;}
.tut-btn:hover{background:#00e5ff;color:#000;}
.tut-bar{flex:1;height:6px;background:#222;border-radius:4px;overflow:hidden;cursor:pointer;}
.tut-fill{height:100%;width:0;background:linear-gradient(90deg,#00e5ff,#00ff88);}
.tut-time{font:12px monospace;color:#8b98a5;min-width:78px;text-align:right;}
.tut-foot{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:10px;flex-wrap:wrap;}
.tut-hint{color:#8b98a5;font-size:11px;}
.tut-skip{background:#ff0055;border:none;color:#fff;border-radius:8px;padding:9px 14px;font-weight:700;font-size:13px;cursor:pointer;}
@keyframes tutFade{from{opacity:0}to{opacity:1}}
@keyframes tutBlink{0%,100%{opacity:1}50%{opacity:.15}}
@keyframes tutPulse{0%,100%{transform:scale(1)}50%{transform:scale(1.12)}}
@keyframes tutJump{0%,100%{transform:translateY(0);opacity:.5}50%{transform:translateY(-6px);opacity:1}}
@keyframes tutSpin{from{transform:rotate(0)}to{transform:rotate(360deg)}}
@keyframes tutType{0%{width:0}60%{width:22ch}100%{width:22ch}}
@keyframes tutMove{0%{transform:translate(-90px,40px)}50%{transform:translate(70px,-30px)}100%{transform:translate(-90px,40px)}}
`;

    function seenGet() { try { return localStorage.getItem(SEEN_KEY); } catch (e) { return null; } }
    function seenSet() { try { localStorage.setItem(SEEN_KEY, '1'); } catch (e) { /* хранилище недоступно — окно просто покажется снова */ } }

    function fmt(ms) {
        const s = Math.max(0, Math.round(ms / 1000));
        return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
    }

    function build() {
        const ov = document.createElement('div');
        ov.className = 'tut-overlay';
        ov.innerHTML = `
            <style>${CSS}</style>
            <div class="tut-player">
                <div class="tut-frame">
                    <div class="tut-rec"><i></i>ИНСТРУКЦИЯ</div>
                    <div class="tut-tag">ШТАБ · ОБУЧЕНИЕ</div>
                    <div class="tut-stage" id="tutStage"></div>
                    <div class="tut-caption" id="tutCaption"></div>
                </div>
                <div class="tut-controls">
                    <button class="tut-btn" id="tutPrev" title="Назад">⏮</button>
                    <button class="tut-btn" id="tutPlay" title="Пауза">⏸</button>
                    <button class="tut-btn" id="tutNext" title="Вперёд">⏭</button>
                    <div class="tut-bar" id="tutBar"><div class="tut-fill" id="tutFill"></div></div>
                    <div class="tut-time" id="tutTime">0:00 / ${fmt(TOTAL_MS)}</div>
                </div>
                <div class="tut-foot">
                    <span class="tut-hint">Показывается один раз. Открыть снова: ⚙️ → 🎬 Инструкция</span>
                    <button class="tut-skip" id="tutSkip">Пропустить ✖</button>
                </div>
            </div>`;
        document.body.appendChild(ov);
        return ov;
    }

    function renderScene() {
        const s = SCENES[st.i];
        const stage = st.el.querySelector('#tutStage');
        stage.innerHTML = s.art;
        // перезапуск CSS-анимаций кадра
        stage.style.animation = 'none';
        void stage.offsetWidth;
        stage.style.animation = '';
        st.el.querySelector('#tutCaption').textContent = s.caption;
    }

    function updateBar() {
        st.el.querySelector('#tutFill').style.width = (st.elapsed / TOTAL_MS * 100) + '%';
        st.el.querySelector('#tutTime').textContent = fmt(st.elapsed) + ' / ' + fmt(TOTAL_MS);
    }

    function tick() {
        if (!st || !st.playing) return;
        st.elapsed += TICK_MS;
        if (st.elapsed >= TOTAL_MS) { close(); return; }
        const i = Math.min(SCENES.length - 1, Math.floor(st.elapsed / SCENE_MS));
        if (i !== st.i) { st.i = i; renderScene(); }
        updateBar();
    }

    function seek(ms) {
        if (!st) return;
        st.elapsed = Math.max(0, Math.min(TOTAL_MS - 1, ms));
        const i = Math.min(SCENES.length - 1, Math.floor(st.elapsed / SCENE_MS));
        if (i !== st.i) { st.i = i; renderScene(); }
        updateBar();
    }

    function close() {
        if (!st) return;
        clearInterval(st.timer);
        document.removeEventListener('keydown', onKey);
        st.el.remove();
        st = null;
        seenSet();   // закрыл (досмотрел или пропустил) — больше не вылезает само
    }

    function onKey(e) {
        if (e.key === 'Escape') close();
        if (e.key === ' ') { e.preventDefault(); togglePlay(); }
    }

    function togglePlay() {
        if (!st) return;
        st.playing = !st.playing;
        st.el.querySelector('#tutPlay').textContent = st.playing ? '⏸' : '▶';
    }

    function start(force) {
        if (st) return;
        if (!force && seenGet()) return;
        const el = build();
        st = { el, i: 0, elapsed: 0, playing: true, timer: null };
        renderScene();
        updateBar();

        el.querySelector('#tutPlay').onclick = togglePlay;
        el.querySelector('#tutSkip').onclick = close;
        el.querySelector('#tutPrev').onclick = () => seek((st.i - 1) * SCENE_MS);
        el.querySelector('#tutNext').onclick = () => {
            if (st.i >= SCENES.length - 1) { close(); return; }
            seek((st.i + 1) * SCENE_MS);
        };
        el.querySelector('#tutBar').onclick = (e) => {
            const r = e.currentTarget.getBoundingClientRect();
            seek((e.clientX - r.left) / r.width * TOTAL_MS);
        };
        document.addEventListener('keydown', onKey);

        // МОБИЛЬНЫЕ: свернул вкладку/приложение — ставим на паузу, чтобы
        // инструкция не «прокрутилась» в фоне и не съела батарею.
        st.onVis = () => { if (document.hidden && st && st.playing) togglePlay(); };
        document.addEventListener('visibilitychange', st.onVis);

        // СВАЙП по кадру: влево — следующая сцена, вправо — предыдущая.
        const frame = el.querySelector('.tut-frame');
        let tx = 0, ty = 0;
        frame.addEventListener('touchstart', (e) => {
            tx = e.touches[0].clientX; ty = e.touches[0].clientY;
        }, { passive: true });
        frame.addEventListener('touchend', (e) => {
            if (!st) return;
            const dx = e.changedTouches[0].clientX - tx;
            const dy = e.changedTouches[0].clientY - ty;
            if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy)) return;   // это скролл, не свайп
            if (dx < 0) {
                if (st.i >= SCENES.length - 1) { close(); return; }
                seek((st.i + 1) * SCENE_MS);
            } else {
                seek((st.i - 1) * SCENE_MS);
            }
        }, { passive: true });

        st.timer = setInterval(tick, TICK_MS);
    }

    window.startShtabTutorial = start;
    window.closeShtabTutorial = close;
})();
