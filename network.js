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

// --- ПОГОДА (Open-Meteo, без ключей) ---
async function getWeather(city = 'Саратов') {
    try {
        const geoUrl = 'https://geocoding-api.open-meteo.com/v1/search?name=' +
            encodeURIComponent(city) + '&count=1&language=ru&format=json';
        const geoRes = await fetch(geoUrl, { cache: 'no-store' });
        if (!geoRes.ok) throw new Error('геокодинг недоступен');
        const geoData = await geoRes.json();
        const place = geoData && geoData.results && geoData.results[0];
        if (!place) return 'Не нашёл город «' + city + '» в базе Open-Meteo.';

        const lat = place.latitude;
        const lon = place.longitude;
        const placeName = place.name || city;

        const forecastUrl = 'https://api.open-meteo.com/v1/forecast?latitude=' + lat +
            '&longitude=' + lon + '&current_weather=true';
        const fcRes = await fetch(forecastUrl, { cache: 'no-store' });
        if (!fcRes.ok) throw new Error('прогноз недоступен');
        const fcData = await fcRes.json();
        const cw = fcData && fcData.current_weather;
        if (!cw) return 'Open-Meteo не отдал текущую погоду по ' + placeName + '.';

        const temp = Math.round(cw.temperature);
        const wind = Math.round(cw.windspeed);
        const dirs = ['С', 'СВ', 'В', 'ЮВ', 'Ю', 'ЮЗ', 'З', 'СЗ'];
        const dir = dirs[Math.round((cw.winddirection || 0) / 45) % 8];
        const codes = {
            0: 'ясно', 1: 'почти ясно', 2: 'переменная облачность', 3: 'пасмурно',
            45: 'туман', 48: 'изморозь',
            51: 'слабая морось', 53: 'морось', 55: 'сильная морось',
            61: 'слабый дождь', 63: 'дождь', 65: 'сильный дождь',
            71: 'слабый снег', 73: 'снег', 75: 'сильный снег',
            80: 'ливень', 81: 'сильный ливень', 82: 'очень сильный ливень',
            95: 'гроза', 96: 'гроза с градом', 99: 'сильная гроза с градом'
        };
        const emojis = {
            0: '☀️', 1: '🌤️', 2: '⛅', 3: '☁️',
            45: '🌫️', 48: '🌫️',
            51: '🌦️', 53: '🌦️', 55: '🌦️',
            61: '🌧️', 63: '🌧️', 65: '🌧️',
            71: '🌨️', 73: '🌨️', 75: '❄️',
            80: '🌦️', 81: '🌧️', 82: '⛈️',
            95: '⛈️', 96: '⛈️', 99: '⛈️'
        };
        const desc = codes[cw.weathercode] || 'без описания';
        const emoji = emojis[cw.weathercode] || '🌡️';

        return emoji + ' Погода в ' + placeName + ': ' + temp + '°C, ' + desc +
            '.\n💨 Ветер ' + wind + ' км/ч, ' + dir + '.';
    } catch (e) {
        return 'Не удалось получить погоду: ' + e.message;
    }
}
