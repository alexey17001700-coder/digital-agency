// --- СЕТЕВЫЕ МАЯЧКИ ---
function updateNetStatus() {
    if (navigator.onLine) { 
        elNet.className = 'status-item online'; 
        checkPing(); 
    } else { 
        elNet.className = 'status-item offline'; 
        elAi.className = 'status-item offline'; 
        pingText.innerText = 'OFFLINE'; 
    }
}

async function checkPing() {
    if (!navigator.onLine) return;
    const start = Date.now();
    try {
        await fetch('https://www.google.com/favicon.ico?t=' + start, { mode: 'no-cors', cache: 'no-store' });
        const ping = Date.now() - start;
        pingText.innerText = ping + ' ms';
        elPing.className = 'status-item ' + (ping < 200 ? 'online' : 'loading');
    } catch (e) { 
        pingText.innerText = 'ERR'; 
        elPing.className = 'status-item offline'; 
    }
}

function setAlarm(state) { 
    elAlarm.className = state ? 'status-item alarm-active' : 'status-item online'; 
}

window.addEventListener('online', updateNetStatus);
window.addEventListener('offline', updateNetStatus);

function toggleTester() {
    const menu = document.getElementById('testerMenu');
    menu.classList.toggle('open');
    if (menu.classList.contains('open')) { runConnectionTest(); }
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
    document.getElementById('t-wifi-type').innerText = netType;

    const inetEl = document.getElementById('t-inet-status');
    const pingEl = document.getElementById('t-ping');
    inetEl.innerText = "Проверка..."; pingEl.innerText = "--";
    
    const start = Date.now();
    try {
        await fetch('https://www.google.com/favicon.ico?t=' + start, { mode: 'no-cors', cache: 'no-store' });
        const ping = Date.now() - start;
        inetEl.innerText = "✅ Есть"; inetEl.style.color = "#00ff00";
        pingEl.innerText = ping + " ms"; pingEl.style.color = ping < 300 ? "#00ff00" : "#ffaa00";
    } catch (e) {
        inetEl.innerText = "❌ Нет"; inetEl.style.color = "#ff0000";
        pingEl.innerText = "ERR"; pingEl.style.color = "#ff0000";
    }

    const ghEl = document.getElementById('t-github');
    ghEl.innerText = "Проверка...";
    try {
        const ghStart = Date.now();
        await fetch('https://api.github.com', { method: 'HEAD', cache: 'no-store' });
        ghEl.innerText = "✅ Доступен (" + (Date.now() - ghStart) + " ms)"; ghEl.style.color = "#00ff00";
    } catch (e) {
        ghEl.innerText = "❌ Блокирован"; ghEl.style.color = "#ff0000";
    }
    document.getElementById('t-ai-model').innerText = "yandexgpt";
                                             }
