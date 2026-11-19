/* ============================================================
   АВТОПИЛОТ ШТАБА — «ДАЛЬШЕ» ПО МЕТКЕ
   Архитектор, закончив шаг, пишет метку [[NEXT]] в файл
   digital-agency/step_signal.txt. Этот скрипт ловит метку
   и сам отправляет в чат сообщение «дальше».
   ============================================================ */
(function () {
    const SIGNAL_URL = 'step_signal.txt';
    const POLL_MS = 5000;
    const TAG = '[[NEXT]]';
    const LS_LAST = 'shtabAutopilotLastSignal';
    const LS_ON = 'shtabAutopilotOn';

    let timer = null;
    let retry = 0;

    function isOn() { return localStorage.getItem(LS_ON) !== 'off'; }

    function setBtn() {
        const b = document.getElementById('autopilotBtn');
        if (!b) return;
        if (isOn()) { b.innerText = '🤖 Автопилот: ВКЛ'; b.classList.add('active'); }
        else { b.innerText = '🤖 Автопилот: ВЫКЛ'; b.classList.remove('active'); }
    }

    function toggle() {
        localStorage.setItem(LS_ON, isOn() ? 'off' : 'on');
        setBtn();
        log(isOn() ? 'Автопилот включён — жду метку [[NEXT]]' : 'Автопилот выключен');
    }

    function log(msg) {
        const el = document.getElementById('autopilotLog');
        if (!el) return;
        const d = document.createElement('div');
        d.className = 'autopilot-line';
        d.innerText = new Date().toLocaleTimeString() + ' · ' + msg;
        el.appendChild(d);
        el.scrollTop = el.scrollHeight;
        while (el.children.length > 30) el.removeChild(el.firstChild);
    }

    async function poll() {
        if (!isOn()) return;
        try {
            const res = await fetch(SIGNAL_URL + '?t=' + Date.now(), { cache: 'no-store' });
            if (!res.ok) return;
            const text = (await res.text()).trim();
            if (!text || text.indexOf(TAG) === -1) { retry = 0; return; }
            if (localStorage.getItem(LS_LAST) === text) return;   // эту метку уже отработали
            if (typeof isGenerating !== 'undefined' && isGenerating) {   // Архитектор ещё печатает — ждём
                retry++;
                if (retry < 120) return;
            }
            localStorage.setItem(LS_LAST, text);
            retry = 0;
            fire(text);
        } catch (e) { /* нет сети — просто ждём следующий цикл */ }
    }

    function fire(signal) {
        const step = (signal.match(/ШАГ\s*(\d+)/i) || [])[1];
        log('Метка поймана' + (step ? ' (шаг ' + step + ')' : '') + ' → отправляю «дальше»');
        const input = document.getElementById('chatInput');
        if (input) { input.value = 'дальше'; input.style.height = 'auto'; }
        if (typeof sendMessage === 'function') sendMessage();
        else log('Ошибка: чат не готов');
    }

    function start() {
        setBtn();
        const b = document.getElementById('autopilotBtn');
        if (b) b.onclick = toggle;
        if (timer) clearInterval(timer);
        timer = setInterval(poll, POLL_MS);
        setTimeout(poll, 1500);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
})();
