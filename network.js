// --- СЕТЕВЫЕ МАЯЧКИ ---
function updateNetStatus() {
    const elNet = document.getElementById('status-internet');
    const elAi = document.getElementById('status-ai');
    const elPing = document.getElementById('status-ping');
    const pingText = elPing ? elPing.querySelector('.text') : null;

    if (navigator.onLine) {
        if (elNet) elNet.className = 'status-item online';
        checkPing();
    } else {
        if (elNet) elNet.className = 'status-item offline';
        if (elAi) elAi.className = 'status-item offline';
        if (pingText) pingText.innerText = 'OFFLINE';
    }
}

async function checkPing() {
    if (!navigator.onLine) return;
    const elPing = document.getElementById('status-ping');
    const pingText = elPing ? elPing.querySelector('.text') : null;
    if (!elPing) return;

    const start = Date.now();
    try {
        await fetch('https://www.google.com/favicon.ico?t=' + start, { mode: 'no-cors', cache: 'no-store' });
        const ping = Date.now() - start;
        if (pingText) pingText.innerText = ping + ' ms';
        elPing.className = 'status-item ' + (ping < 200 ? 'online' : 'loading');
    } catch (e) {
        if (pingText) pingText.innerText = 'ERR';
        elPing.className = 'status-item offline';
    }
}

function setAlarm(state) {
    const elAlarm = document.getElementById('status-alarm');
    if (elAlarm) elAlarm.className = state ? 'status-item alarm-active' : 'status-item online';
}

window.addEventListener('online', updateNetStatus);
window.addEventListener('offline', updateNetStatus);

function toggleTester() {
    const menu = document.getElementById('testerMenu');
    if (menu) {
        menu.classList.toggle('open');
        if (menu.classList.contains('open')) { runConnectionTest(); }
    }
}

async function runConnectionTest() {
    const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    let netType = "Неизвестно";
    if (conn) {
        netType = conn.effectiveType ? conn.effectiveType.toUpperCase() : conn.type;
        if (conn.type === 'wifi') netType = 'Wi-Fi';
    } else {
        netType = navigator.onLine ? "Онлайн" : "Офлайн";
    }
    const wifiEl = document.getElementById('t-wifi-type');
    if (wifiEl) wifiEl.innerText = netType;

    const inetEl = document.getElementById('t-inet-status');
    const pingEl = document.getElementById('t-ping');
    if (inetEl) inetEl.innerText = "Проверка...";
    if (pingEl) pingEl.innerText = "--";
    
    const start = Date.now();
    try {
        await fetch('https://www.google.com/favicon.ico?t=' + start, { mode: 'no-cors', cache: 'no-store' });
        const ping = Date.now() - start;
        if (inetEl) { inetEl.innerText = "✅ Есть"; inetEl.style.color = "#00ff00"; }
        if (pingEl) { pingEl.innerText = ping + " ms"; pingEl.style.color = ping < 300 ? "#00ff00" : "#ffaa00"; }
    } catch (e) {
        if (inetEl) { inetEl.innerText = "❌ Нет"; inetEl.style.color = "#ff0000"; }
        if (pingEl) { pingEl.innerText = "ERR"; pingEl.style.color = "#ff0000"; }
    }

    const ghEl = document.getElementById('t-github');
    if (ghEl) ghEl.innerText = "Проверка...";
    try {
        const ghStart = Date.now();
        await fetch('https://api.github.com', { method: 'HEAD', cache: 'no-store' });
        if (ghEl) { ghEl.innerText = "✅ Доступен (" + (Date.now() - ghStart) + " ms)"; ghEl.style.color = "#00ff00"; }
    } catch (e) {
        if (ghEl) { ghEl.innerText = "❌ Блокирован"; ghEl.style.color = "#ff0000"; }
    }
    const aiEl = document.getElementById('t-ai-model');
    if (aiEl) aiEl.innerText = "yandexgpt";
                    }
