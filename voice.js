const TTS_PROXY = "https://functions.yandexcloud.net/d4etaf7qtg7n1r7j6eka";
let isVoiceEnabled = localStorage.getItem('shtabVoiceEnabled') === 'true';
let agentVoiceSettings = {};
try { const sv = localStorage.getItem('shtabAgentVoice'); if (sv) agentVoiceSettings = JSON.parse(sv); } catch (e) {}
let currentAudio = null; 
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

function playSound(type) {
    try {
        if (audioCtx.state === 'suspended') audioCtx.resume();
        const osc = audioCtx.createOscillator(); const gain = audioCtx.createGain();
        osc.connect(gain); gain.connect(audioCtx.destination);
        if (type === 'send') { osc.type = 'sine'; osc.frequency.setValueAtTime(800, audioCtx.currentTime); osc.frequency.exponentialRampToValueAtTime(1200, audioCtx.currentTime + 0.1); } 
        else if (type === 'receive') { osc.type = 'triangle'; osc.frequency.setValueAtTime(600, audioCtx.currentTime); osc.frequency.exponentialRampToValueAtTime(400, audioCtx.currentTime + 0.2); }
        gain.gain.setValueAtTime(0.1, audioCtx.currentTime); gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.2);
        osc.start(); osc.stop(audioCtx.currentTime + 0.2);
    } catch (e) {}
}

function stopVoice() {
    if (currentAudio) {
        try { currentAudio.pause(); currentAudio.currentTime = 0; } catch (e) {}
        currentAudio = null;
    }
    if ('speechSynthesis' in window) {
        try { window.speechSynthesis.cancel(); } catch (e) {}
    }
}

function toggleVoice() {
    isVoiceEnabled = !isVoiceEnabled; localStorage.setItem('shtabVoiceEnabled', isVoiceEnabled);
    const btn = document.getElementById('btnVoiceToggle');
    if (btn) { btn.innerText = isVoiceEnabled ? '🗣️ Озвучка: ВКЛ' : '🗣️ Озвучка: ВЫКЛ'; btn.classList.toggle('active', isVoiceEnabled); }
    if (!isVoiceEnabled) stopVoice();
}

async function speakText(text, agentName) {
    if (!isVoiceEnabled || agentVoiceSettings[agentName] === false) return;
    let cleanText = text.replace(/```[\s\S]*?```/g, ' [Код] ').replace(/[*#_`]/g, '').replace(/\[.*?\]/g, '').trim();
    if (!cleanText) return;

    if (currentAudio) { currentAudio.pause(); currentAudio.currentTime = 0; }
    if ('speechSynthesis' in window) { window.speechSynthesis.cancel(); }

    const _ov = voiceOverrides[agentName];
    const v = _ov ? _ov : ((typeof AGENT_VOICES !== 'undefined' && AGENT_VOICES[agentName]) ? AGENT_VOICES[agentName] : { voice: "alena", emotion: "neutral" });

    try {
        const res = await fetch(TTS_PROXY, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: cleanText, voice: v.voice, emotion: v.emotion }) });
        if (!isVoiceEnabled) return;
        if (!res.ok) throw new Error("Сервер");
        const data = await res.json();
        if (!isVoiceEnabled) return;
        if (data.audio) { currentAudio = new Audio("data:audio/mpeg;base64," + data.audio); await currentAudio.play(); } else throw new Error("Нет аудио");
    } catch (e) {
        ttsLastError = 'озвучка: ' + (e && e.message ? e.message : e) + ' → голос телефона';
        if (!isVoiceEnabled) return;
        speakPhoneVoice(cleanText, agentName);
    }
}

let recognition = null; let isListening = false;
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
if (SpeechRecognition) {
    recognition = new SpeechRecognition(); recognition.lang = 'ru-RU'; recognition.continuous = false; recognition.interimResults = false;
    recognition.onstart = function() { isListening = true; const b = document.getElementById('micBtn'); if (b) { b.style.background = '#ff0055'; b.style.boxShadow = '0 0 10px #ff0055'; } };
    recognition.onresult = function(event) {
        const chatInput = document.getElementById('chatInput');
        if (chatInput) {
            chatInput.value += (chatInput.value ? ' ' : '') + event.results[0][0].transcript;
            setTimeout(() => { if (typeof handleSendClick === 'function') handleSendClick(); }, 100);
        }
    };
    recognition.onerror = function() { const b = document.getElementById('micBtn'); if (b) { b.style.background = '#333'; b.style.boxShadow = 'none'; } };
    recognition.onend = function() { isListening = false; const b = document.getElementById('micBtn'); if (b) { b.style.background = '#333'; b.style.boxShadow = 'none'; } };
}
function toggleVoiceInput() { if (!recognition) return alert('Нет поддержки микрофона'); if (isListening) recognition.stop(); else try { recognition.start(); } catch (e) {} }

/* ================= ЛАБОРАТОРИЯ ГОЛОСОВ ================= */
const YANDEX_VOICES = [
    { id: 'alena',     name: 'Алёна',     tag: 'женский · тёплый' },
    { id: 'filipp',    name: 'Филипп',    tag: 'мужской · ровный' },
    { id: 'ermil',     name: 'Ермил',     tag: 'мужской · низкий' },
    { id: 'jane',      name: 'Джейн',     tag: 'женский · мягкий' },
    { id: 'omazh',     name: 'Омаж',      tag: 'женский · низкий' },
    { id: 'zahar',     name: 'Захар',     tag: 'мужской · жёсткий' },
    { id: 'dasha',     name: 'Даша',      tag: 'женский · живой' },
    { id: 'julia',     name: 'Юлия',      tag: 'женский · спокойный' },
    { id: 'lera',      name: 'Лера',      tag: 'женский · лёгкий' },
    { id: 'masha',     name: 'Маша',      tag: 'женский · детский' },
    { id: 'marina',    name: 'Марина',    tag: 'женский · деловой' },
    { id: 'alexander', name: 'Александр', tag: 'мужской · строгий' },
    { id: 'kirill',    name: 'Кирилл',    tag: 'мужской · молодой' },
    { id: 'anton',     name: 'Антон',     tag: 'мужской · дружелюбный' },
    { id: 'madirus',   name: 'Мадирус',   tag: 'мужской · глубокий' }
];
const VOICE_EMOTIONS = ['neutral', 'good', 'evil', 'strict', 'friendly', 'happy', 'sad', 'whisper'];
const VOICE_PHRASE = 'Здравствуйте, Босс. Система готова к работе.';

let voiceOverrides = {};
try { const vo = localStorage.getItem('shtabVoiceOverrides'); if (vo) voiceOverrides = JSON.parse(vo); } catch (e) {}
let vlabAudio = null;
let ttsLastError = 'нет данных';

async function vlabCheckServer() {
    const out = document.getElementById('vlabDiag');
    if (out) out.textContent = '⏳ Проверяю сервер…';
    const lines = [];

    // 1) обычный POST — точно так же, как в озвучке чата
    const t0 = Date.now();
    try {
        const res = await fetch(TTS_PROXY, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: 'Проверка связи', voice: 'alena', emotion: 'neutral' })
        });
        const ms = Date.now() - t0;
        const raw = await res.text();
        let info = 'HTTP ' + res.status + ' · ' + ms + ' мс';
        try {
            const d = JSON.parse(raw);
            if (d.audio) info += ' · аудио ' + Math.round(d.audio.length * 0.75 / 1024) + ' КБ · РАБОТАЕТ ✅';
            else info += ' · нет поля audio ❌ · ' + raw.slice(0, 200);
        } catch (e) { info += ' · ответ не JSON ❌ · ' + raw.slice(0, 200); }
        lines.push('POST: ' + info);
    } catch (e) {
        lines.push('POST: ❌ ' + (e && e.message ? e.message : e));
    }

    // 2) проверка доступности сервера в обход CORS — отвечает ли он вообще
    try {
        const t1 = Date.now();
        await fetch(TTS_PROXY, { method: 'GET', mode: 'no-cors', cache: 'no-store' });
        lines.push('Доступность: сервер ОТВЕЧАЕТ ✅ (' + (Date.now() - t1) + ' мс) → дело в CORS-заголовках функции');
    } catch (e) {
        lines.push('Доступность: сервер НЕ отвечает ❌ → функция удалена, квота кончилась или домен заблокирован провайдером');
    }

    // 3) адрес, который можно открыть руками
    lines.push('Адрес: ' + TTS_PROXY);

    const info = lines.join('\n');
    if (out) out.textContent = info;
    ttsLastError = info;
    return info;
}

async function vlabPlay(voice, emotion, rowEl) {
    if (vlabAudio) { try { vlabAudio.pause(); } catch (e) {} vlabAudio = null; }
    if (rowEl) rowEl.classList.add('vlab-playing');
    try {
        const res = await fetch(TTS_PROXY, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: VOICE_PHRASE, voice: voice, emotion: emotion })
        });
        if (!res.ok) throw new Error('Сервер ' + res.status);
        const data = await res.json();
        if (!data.audio) throw new Error('Нет аудио');
        vlabAudio = new Audio('data:audio/mpeg;base64,' + data.audio);
        vlabAudio.onended = function () { if (rowEl) rowEl.classList.remove('vlab-playing'); };
        await vlabAudio.play();
    } catch (e) {
        ttsLastError = 'прослушивание: ' + (e && e.message ? e.message : e) + ' → голос телефона';
        const dg = document.getElementById('vlabDiag');
        if (dg) dg.textContent = ttsLastError;
        if (rowEl) rowEl.classList.remove('vlab-playing');
        if ('speechSynthesis' in window) {
            const u = new SpeechSynthesisUtterance(VOICE_PHRASE); u.lang = 'ru-RU';
            window.speechSynthesis.speak(u);
        }
    }
}

function openVoiceLab2() {
    const old = document.getElementById('vlab2');
    if (old) { old.remove(); return; }
    const ov = document.createElement('div');
    ov.id = 'vlab2';
    ov.innerHTML =
        '<div class="vlab-box">' +
          '<div class="vlab-head">' +
            '<div><div class="vlab-title">ЛАБОРАТОРИЯ ГОЛОСОВ · v2</div>' +
            '<div class="vlab-sub">Нажми ▶ — услышишь голос. Выбери голос агенту — сохранится сразу.</div></div>' +
            '<button class="vlab-close">✕</button>' +
          '</div>' +
          '<div class="vlab-scroll">' +
            '<div class="vlab-diag">' +
              '<div class="vlab-diag-t">ДИАГНОСТИКА СЕРВЕРА ОЗВУЧКИ</div>' +
              '<div id="vlabDiag" class="vlab-diag-v">нажми «Проверить»</div>' +
              '<button id="vlabCheck" class="vlab-check">ПРОВЕРИТЬ СЕРВЕР</button>' +
              '<button id="vlabOpen" class="vlab-check" style="margin-top:7px">ОТКРЫТЬ АДРЕС В БРАУЗЕРЕ</button>' +
            '</div>' +
            '<div class="vlab-sec">ГОЛОСА ЯНДЕКСА</div><div id="vlabVoices"></div>' +
            '<div class="vlab-sec">АГЕНТЫ ШТАБА</div><div id="vlabAgents"></div>' +
          '</div>' +
        '</div>';
    document.body.appendChild(ov);
    ov.querySelector('.vlab-close').onclick = function () { ov.remove(); };
    ov.querySelector('#vlabCheck').onclick = vlabCheckServer;
    ov.querySelector('#vlabOpen').onclick = function () { window.open(TTS_PROXY, '_blank'); };
    const dg0 = ov.querySelector('#vlabDiag');
    if (dg0 && ttsLastError !== 'нет данных') dg0.textContent = ttsLastError;
    ov.onclick = function (e) { if (e.target === ov) ov.remove(); };

    const vbox = ov.querySelector('#vlabVoices');
    YANDEX_VOICES.forEach(function (v) {
        const row = document.createElement('div');
        row.className = 'vlab-row';
        row.innerHTML = '<button class="vlab-play">▶</button>' +
            '<div class="vlab-info"><div class="vlab-name">' + v.name + '</div>' +
            '<div class="vlab-tag">' + v.tag + ' · ' + v.id + '</div></div>';
        row.querySelector('.vlab-play').onclick = function () { vlabPlay(v.id, 'neutral', row); };
        vbox.appendChild(row);
    });

    const abox = ov.querySelector('#vlabAgents');
    const names = (typeof AGENT_VOICES !== 'undefined') ? Object.keys(AGENT_VOICES) : [];
    if (!names.length) abox.innerHTML = '<div class="vlab-tag">AGENT_VOICES не найден</div>';
    names.forEach(function (name) {
        const base = (typeof AGENT_VOICES !== 'undefined' && AGENT_VOICES[name]) ? AGENT_VOICES[name] : { voice: 'alena', emotion: 'neutral' };
        const cur = voiceOverrides[name] || base;
        const row = document.createElement('div');
        row.className = 'vlab-row';
        const opts = YANDEX_VOICES.map(function (v) {
            return '<option value="' + v.id + '"' + (v.id === cur.voice ? ' selected' : '') + '>' + v.name + '</option>';
        }).join('');
        const eopts = VOICE_EMOTIONS.map(function (e) {
            return '<option value="' + e + '"' + (e === cur.emotion ? ' selected' : '') + '>' + e + '</option>';
        }).join('');
        row.innerHTML = '<button class="vlab-play">▶</button>' +
            '<div class="vlab-info"><div class="vlab-name">' + name + '</div>' +
            '<div class="vlab-ctl"><select class="vlab-sel vlab-v">' + opts + '</select>' +
            '<select class="vlab-sel vlab-e">' + eopts + '</select></div></div>';
        const vSel = row.querySelector('.vlab-v');
        const eSel = row.querySelector('.vlab-e');
        row.querySelector('.vlab-play').onclick = function () { vlabPlay(vSel.value, eSel.value, row); };
        const save = function () {
            voiceOverrides[name] = { voice: vSel.value, emotion: eSel.value };
            localStorage.setItem('shtabVoiceOverrides', JSON.stringify(voiceOverrides));
        };
        vSel.onchange = function () { save(); vlabPlay(vSel.value, eSel.value, row); };
        eSel.onchange = save;
        abox.appendChild(row);
    });
}

function injectVoiceLab() {
    const _oldBtn = document.getElementById('vlabBtn');
    if (_oldBtn) _oldBtn.remove();
    if (document.getElementById('vlabBtn2')) { window.openVoiceLab = openVoiceLab2; return; }
    if (!document.getElementById('vlabCss2')) {
        const st = document.createElement('style');
        st.id = 'vlabCss2';
        st.textContent =
            '#vlabBtn2{position:fixed;left:0;top:0;width:46px;height:46px;border-radius:50%;' +
            'background:linear-gradient(145deg,#C9A227,#8E6F14);color:#0B1522;font-size:20px;border:1px solid #E3C766;' +
            'box-shadow:0 6px 18px rgba(0,0,0,.45);z-index:99999;cursor:pointer}' +
            '#vlabBtn2:active{transform:scale(.94)}' +
            '#vlab2{position:fixed;inset:0;background:rgba(3,8,16,.78);backdrop-filter:blur(6px);z-index:9999;' +
            'display:flex;align-items:center;justify-content:center;padding:14px}' +
            '.vlab-box{width:100%;max-width:520px;max-height:88vh;display:flex;flex-direction:column;' +
            'background:linear-gradient(160deg,#0F1B2D,#0A1220);border:1px solid rgba(201,162,39,.45);border-radius:22px;' +
            'box-shadow:0 24px 60px rgba(0,0,0,.6);overflow:hidden}' +
            '.vlab-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;padding:16px 16px 12px;' +
            'border-bottom:1px solid rgba(201,162,39,.22)}' +
            '.vlab-title{color:#C9A227;font:700 14px/1.2 system-ui,sans-serif;letter-spacing:1.6px}' +
            '.vlab-sub{color:#7E93AC;font:400 11.5px/1.4 system-ui,sans-serif;margin-top:5px}' +
            '.vlab-close{background:transparent;border:1px solid rgba(201,162,39,.35);color:#C9A227;width:32px;height:32px;' +
            'border-radius:10px;font-size:14px;cursor:pointer;flex:0 0 auto}' +
            '.vlab-scroll{overflow-y:auto;padding:12px 16px 18px}' +
            '.vlab-diag{background:rgba(255,255,255,.04);border:1px solid rgba(201,162,39,.28);border-radius:14px;padding:11px 12px}' +
            '.vlab-diag-t{color:#B08D57;font:700 10.5px/1 system-ui,sans-serif;letter-spacing:1.4px}' +
            '.vlab-diag-v{color:#DCE6F2;font:500 11.5px/1.45 system-ui,sans-serif;margin:7px 0 9px;word-break:break-word;white-space:pre-line}' +
            '.vlab-check{width:100%;height:38px;border-radius:11px;cursor:pointer;border:1px solid rgba(201,162,39,.5);' +
            'background:rgba(201,162,39,.12);color:#C9A227;font:700 11.5px system-ui,sans-serif;letter-spacing:1.2px}' +
            '.vlab-sec{color:#B08D57;font:700 10.5px/1 system-ui,sans-serif;letter-spacing:1.6px;margin:14px 0 8px}' +
            '.vlab-row{display:flex;align-items:center;gap:12px;padding:9px 10px;border-radius:14px;' +
            'background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);margin-bottom:7px;transition:.2s}' +
            '.vlab-row.vlab-playing{border-color:rgba(201,162,39,.7);background:rgba(201,162,39,.10)}' +
            '.vlab-play{width:38px;height:38px;border-radius:12px;flex:0 0 auto;cursor:pointer;' +
            'background:linear-gradient(145deg,#C9A227,#8E6F14);color:#0B1522;border:none;font-size:14px}' +
            '.vlab-info{flex:1;min-width:0}' +
            '.vlab-name{color:#EAF1FA;font:600 13.5px/1.2 system-ui,sans-serif}' +
            '.vlab-tag{color:#7E93AC;font:400 11px/1.3 system-ui,sans-serif;margin-top:3px}' +
            '.vlab-ctl{display:flex;gap:6px;margin-top:6px}' +
            '.vlab-sel{flex:1;min-width:0;background:#0A1220;color:#DCE6F2;border:1px solid rgba(201,162,39,.35);' +
            'border-radius:9px;padding:6px 8px;font:500 12px system-ui,sans-serif}' +
            '.pv-sl{display:flex;justify-content:space-between;align-items:center;margin:10px 0 4px;' +
            'color:#7E93AC;font:500 11.5px system-ui,sans-serif}' +
            '.pv-sl b{color:#C9A227;font:700 11.5px system-ui,sans-serif}' +
            '.pv-range{width:100%;height:26px;-webkit-appearance:none;appearance:none;background:transparent}' +
            '.pv-range::-webkit-slider-runnable-track{height:4px;border-radius:2px;background:rgba(201,162,39,.28)}' +
            '.pv-range::-webkit-slider-thumb{-webkit-appearance:none;width:18px;height:18px;margin-top:-7px;' +
            'border-radius:50%;background:linear-gradient(145deg,#E3C766,#8E6F14);border:1px solid #E3C766}' +
            '.pv-range::-moz-range-track{height:4px;border-radius:2px;background:rgba(201,162,39,.28)}' +
            '.pv-range::-moz-range-thumb{width:16px;height:16px;border-radius:50%;border:1px solid #E3C766;' +
            'background:linear-gradient(145deg,#E3C766,#8E6F14)}';
        document.head.appendChild(st);
    }
    const b = document.createElement('button');
    b.id = 'vlabBtn2';
    b.title = 'Лаборатория голосов v2';
    b.textContent = '🎛';
    b.onclick = openVoiceLab2;
    document.body.appendChild(b);
    positionVoiceBtn();
    window.openVoiceLab = openVoiceLab2;
}

// Кнопка 🎛 «прилипает» прямо ПОД кнопкой отправки ➤.
// Позиция считается от реального положения #sendBtn, поэтому кнопка
// остаётся под ней и при повороте экрана, и при открытии панели агентов.
function positionVoiceBtn() {
    const b = document.getElementById('vlabBtn2');
    if (!b) return;
    const sb = document.getElementById('sendBtn');
    if (sb) {
        const r = sb.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) {
            b.style.left = Math.round(r.right - 46) + 'px';
            b.style.top = Math.round(r.bottom + 6) + 'px';
            return;
        }
    }
    b.style.left = Math.round(window.innerWidth - 58) + 'px';
    b.style.top = Math.round(window.innerHeight - 110) + 'px';
}

window.addEventListener('resize', positionVoiceBtn);
window.addEventListener('orientationchange', function () { setTimeout(positionVoiceBtn, 250); });

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', injectVoiceLab); else injectVoiceLab();

// ПЕРЕХВАТ: если другой скрипт переопределит openVoiceLab или удалит кнопку —
// возвращаем свою версию. Иначе открывалась СТАРАЯ лаборатория без диагностики.
setInterval(function () {
    if (window.openVoiceLab !== openVoiceLab2) window.openVoiceLab = openVoiceLab2;
    if (!document.getElementById('vlabBtn2')) injectVoiceLab();
    positionVoiceBtn();
}, 1500);
