// Озвучка идёт на СВОЙ сервер (main.ts) → edge-tts. Бесплатно, без ключей.
// ВАЖНО: в Caddy корень домена уже проброшен на main.ts (там же ходит и чат),
// а отдельный маршрут /tts не прописан — поэтому POST на /tts отдавал 405.
// main.ts обрабатывает озвучку на ЛЮБОМ пути, значит корень домена работает.
// Список адресов: пробуем по очереди, первый ответивший аудио — рабочий.
const TTS_HOST = "https://shtab-boss.duckdns.org:8443";
const TTS_ENDPOINTS = [TTS_HOST, TTS_HOST + "/tts", "/tts"];
let TTS_PROXY = TTS_ENDPOINTS[0];

// Отправка запроса на синтез: перебирает адреса, пока не получит аудио.
async function ttsFetch(body) {
    let lastErr = null;
    for (let i = 0; i < TTS_ENDPOINTS.length; i++) {
        const url = TTS_ENDPOINTS[i];
        try {
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: body
            });
            const ct = res.headers.get('Content-Type') || '';
            if (res.ok && ct.indexOf('audio') > -1) { TTS_PROXY = url; return res; }
            lastErr = new Error('Сервер ' + res.status + (ct ? ' · ' + ct.split(';')[0] : ''));
        } catch (e) { lastErr = e; }
    }
    throw lastErr || new Error('Сервер озвучки не ответил');
}
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
    const _base = (typeof AGENT_VOICES !== 'undefined' && AGENT_VOICES[agentName]) ? AGENT_VOICES[agentName] : { voice: "ru-RU-SvetlanaNeural", emotion: "neutral" };
    const v = _ov ? _ov : (defaultVoice ? { voice: defaultVoice, emotion: _base.emotion } : _base);

    try {
        const res = await ttsFetch(ttsBody(cleanText, v.voice, v.emotion));
        if (!isVoiceEnabled) return;
        const blob = await res.blob();
        if (!isVoiceEnabled) return;
        if (blob.size < 200) throw new Error("Нет аудио");
        currentAudio = new Audio(URL.createObjectURL(blob));
        await currentAudio.play();
    } catch (e) {
        ttsLastError = 'озвучка: ' + (e && e.message ? e.message : e) + ' → голос телефона';
        ttsToast(ttsLastError);
        const _dg = document.getElementById('vlabDiag');
        if (_dg) _dg.textContent = ttsLastError;
        if (!isVoiceEnabled) return;
        phoneSpeak(cleanText, agentName);
    }
}

let recognition = null; let isListening = false;
let micUserStopped = true;   // Босс сам выключил микрофон?
let micRestarts = 0;         // сколько раз авто-перезапускали (защита от петли)
// ── Защита от дублей при голосовом вводе (главная боль на iPhone) ──
let micBase = '';            // текст, который был в поле ДО старта микрофона
let micPhrase = '';          // накопленный текст ТЕКУЩЕЙ фразы
let micConsumed = 0;         // сколько результатов движка уже учтено (защита от повторов)
let micLastCount = 0;        // сколько результатов пришло в последнем событии
let micLockUntil = 0;        // до этого времени результаты игнорируем (поздние «хвосты»)
let micLive = '';            // промежуточный (нефинальный) текст — спасение, если движок не финалил
let micSendTimer = null;     // отложенная отправка — ждём, пока Босс договорит
const MIC_SEND_DELAY = 2000; // пауза перед отправкой, мс
const MIC_SILENCE_MS = 4000; // тишина 4 сек — микрофон выключается сам, не висит
const MIC_MAX_MS = 12000;    // потолок сессии 12 сек — дольше не слушаем
let micSilenceTimer = null;  // тишина: ждём, Босс ещё говорит или уже всё
let micMaxTimer = null;      // жёсткий потолок сессии
// Слова-команды: голосом «стоп» — микрофон гаснет сразу.
const MIC_STOP_WORDS = ['стоп', 'хватит', 'отмена', 'выключи микрофон', 'выключить микрофон', 'молчи', 'замолчи', 'stop', 'cancel'];
function micIsStop(phrase) {
    const t = String(phrase || '').toLowerCase().replace(/[.,!?]/g, '').trim();
    if (!t) return false;
    for (let i = 0; i < MIC_STOP_WORDS.length; i++) if (t === MIC_STOP_WORDS[i]) return true;
    return false;
}
// Сброс таймеров тишины и потолка — вызываем при новом слове и при выключении.
function micTimersReset() {
    clearTimeout(micSilenceTimer);
    clearTimeout(micMaxTimer);
}
// Тишина: Босс замолчал — отправляем фразу и гасим микрофон, чтобы не висел.
function micArmSilence() {
    clearTimeout(micSilenceTimer);
    micSilenceTimer = setTimeout(function () {
        if (!isListening) return;
        micFlush();
        micUserStopped = true;
        try { recognition.stop(); } catch (e) {}
        micUI(false, '🎤 Тишина — микрофон выключен');
    }, MIC_SILENCE_MS);
}
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
// Определяем iPhone/iPad: там continuous не работает и всё равно рвётся после паузы.
const IS_IOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
               (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

// Единая точка отрисовки кнопки микрофона — одинаково на всех браузерах.
function micUI(on, text) {
    const b = document.getElementById('micBtn');
    if (b) {
        b.style.background = on ? '#ff0055' : '#333';
        b.style.boxShadow = on ? '0 0 10px #ff0055' : 'none';
        b.textContent = on ? '🔴' : '🎤';
    }
    if (text) micToast(text);
}

// Тост под кнопкой: Босс сразу видит, что происходит с микрофоном.
let _micToastEl = null;
function micToast(msg) {
    try {
        if (!_micToastEl) {
            _micToastEl = document.createElement('div');
            _micToastEl.style.cssText = 'position:fixed;left:50%;transform:translateX(-50%);bottom:150px;' +
                'max-width:88vw;padding:8px 12px;border-radius:10px;background:rgba(20,30,45,.94);' +
                'color:#DCE6F2;font:600 11.5px/1.35 system-ui,sans-serif;z-index:100000;' +
                'box-shadow:0 8px 24px rgba(0,0,0,.5);pointer-events:none;text-align:center';
            document.body.appendChild(_micToastEl);
        }
        _micToastEl.textContent = msg;
        _micToastEl.style.display = 'block';
        clearTimeout(_micToastEl._t);
        _micToastEl._t = setTimeout(function () { _micToastEl.style.display = 'none'; }, 3200);
    } catch (e) {}
}

// РАЗРЕШЕНИЕ НА МИКРОФОН. На Android (в т.ч. Яндекс.Браузер) распознавание
// стартует и ТУТ ЖЕ глохнет, если доступ ещё не выдан. Поэтому сначала явно
// просим доступ через getUserMedia, отпускаем поток и только потом запускаем
// распознавание — тогда onstart держится, а не гаснет мгновенно.
// ВАЖНО: доступ спрашиваем ОДИН РАЗ за сессию. Повторный getUserMedia на
// каждом старте заставлял телефон показывать запрос снова и снова.
let micPermOK = false;      // доступ уже выдан — больше не дёргаем браузер
let micPermAsked = false;   // getUserMedia уже вызывали (второй раз не просим)

async function micPermState() {
    try {
        if (navigator.permissions && navigator.permissions.query) {
            const st = await navigator.permissions.query({ name: 'microphone' });
            return st.state;   // 'granted' | 'denied' | 'prompt'
        }
    } catch (e) {}
    return 'unknown';
}

async function micEnsurePermission() {
    if (micPermOK) return true;                       // уже разрешено — молча
    const st = await micPermState();
    if (st === 'granted') { micPermOK = true; return true; }
    if (st === 'denied') return false;
    // На iOS распознавание речи само спрашивает доступ. Если дёрнуть ещё и
    // getUserMedia — выскочат ДВА запроса подряд. Поэтому там не трогаем.
    if (IS_IOS) return true;
    if (micPermAsked) return true;                    // второй раз не спрашиваем
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return true;
    micPermAsked = true;
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach(function (t) { try { t.stop(); } catch (e) {} });
        micPermOK = true;
        return true;
    } catch (e) {
        return false;
    }
}

// Из нескольких вариантов распознавания берём самый УВЕРЕННЫЙ, а не первый.
// Chrome/Android часто кладёт верный вариант не на первое место — это заметно
// повышает точность. Если движок не даёт confidence — остаётся первый вариант.
function bestAlt(result) {
    try {
        let best = (result[0] && result[0].transcript) ? result[0].transcript : '';
        let bestConf = (result[0] && typeof result[0].confidence === 'number') ? result[0].confidence : 0;
        for (let i = 1; i < result.length; i++) {
            const c = (typeof result[i].confidence === 'number') ? result[i].confidence : 0;
            const t = (result[i] && result[i].transcript) ? result[i].transcript : '';
            if (t && c > bestConf + 0.01) { bestConf = c; best = t; }
        }
        return best;
    } catch (e) { return ''; }
}

// Отправка накопленной фразы ЦЕЛИКОМ — вызывается по паузе (micSendTimer).
// ВАЖНО: после отправки поле НЕ перезаписывается поздними результатами движка —
// раньше текст «возвращался» в строку ввода и уходил в чат вторым сообщением.
function micFlush() {
    clearTimeout(micSendTimer);
    // Если движок так и не финалил фразу — берём промежуточный текст (micLive).
    // Без этого при обрыве сессии не отправлялось ВООБЩЕ ничего.
    let phrase = micPhrase || micLive;
    if (!phrase) return;
    const clean = phrase.replace(/[^а-яёa-z0-9]/gi, '');
    if (clean.length < 2) { micUI(true, '🎤 Не разобрал — повтори'); return; }
    const sent = phrase;
    micPhrase = '';                       // фраза ушла — начинаем следующую
    micLive = '';
    micConsumed = micLastCount;           // уже отданные результаты больше не читаем
    micLockUntil = Date.now() + 1200;     // поздние «хвосты» движка игнорируем
    const ci = document.getElementById('chatInput');
    const full = (micBase ? micBase + ' ' : '') + sent;
    if (ci) ci.value = full;
    // Ответ ещё идёт — не обрываем его: текст остаётся в поле, Босс отправит кнопкой ➤.
    if (typeof isGenerating !== 'undefined' && isGenerating) {
        micBase = full;
        micUI(true, '🎤 Ответ ещё идёт — текст в поле, отправь кнопкой ➤');
        return;
    }
    micBase = '';
    if (typeof handleSendClick === 'function') handleSendClick();   // поле очистит сам
}

if (SpeechRecognition) {
    recognition = new SpeechRecognition();
    recognition.lang = 'ru-RU';
    // На iOS continuous игнорируется и всё равно рвётся после паузы,
    // поэтому там ставим false и полагаемся на авто-перезапуск.
    recognition.continuous = !IS_IOS;
    recognition.interimResults = true;   // текст появляется по мере речи
    recognition.maxAlternatives = 5;     // 5 вариантов — берём самый уверенный

    recognition.onstart = function () {
        isListening = true;
        micPermOK = true;   // распознавание стартовало — доступ точно есть
        micConsumed = 0;    // новая сессия — читаем результаты с нуля
        micLive = '';
        // ЖЁСТКИЙ ПОТОЛОК 12 сек: даже если Босс говорит без остановки — сессия
        // обрывается сама и всё сказанное уходит в чат. Дольше микрофон не висит.
        micTimersReset();
        micMaxTimer = setTimeout(function () {
            if (!isListening) return;
            micFlush();
            micUserStopped = true;
            try { recognition.stop(); } catch (e) {}
            micUI(false, '🎤 12 сек — отправляю, что сказал');
        }, MIC_MAX_MS);
        micUI(true, '🎤 Слушаю…');
    };

    recognition.onresult = function (event) {
        const chatInput = document.getElementById('chatInput');
        if (!chatInput) return;
        micLastCount = event.results.length;
        // Поздний «хвост» уже отправленной фразы — не читаем его вовсе.
        if (Date.now() < micLockUntil) return;
        // Читаем ТОЛЬКО новые результаты (micConsumed). На Android сессия одна и
        // длинная: старые результаты приходят в каждом событии снова — отсюда дубли.
        let finalText = '', interimText = '';
        for (let i = micConsumed; i < event.results.length; i++) {
            const r = event.results[i];
            const t = bestAlt(r);
            if (r.isFinal) finalText += t; else interimText += t;
        }
        finalText = finalText.trim();
        interimText = interimText.trim();

        // Склейка внутри ТЕКУЩЕЙ фразы БЕЗ дублей: если движок повторил весь
        // текст — берём новую версию; если фрагмент уже есть — не добавляем.
        if (finalText) {
            if (micPhrase && finalText.indexOf(micPhrase) === 0) micPhrase = finalText;
            else if (micPhrase && micPhrase.indexOf(finalText) === 0) { /* уже есть — пропускаем */ }
            else micPhrase = micPhrase ? micPhrase + ' ' + finalText : finalText;
        }

        // Поле собирается ЗАМЕНОЙ, а не приклеиванием — главный фикс дублей.
        const parts = [];
        if (micBase) parts.push(micBase);
        if (micPhrase) parts.push(micPhrase);
        if (interimText) parts.push(interimText);
        chatInput.value = parts.join(' ');

        micLive = interimText;   // запомним «сырое» — пригодится, если финала не будет

        // КОМАНДА ГОЛОСОМ: «стоп» / «хватит» / «отмена» — гасим микрофон СРАЗУ,
        // и в чат это слово не уходит. Проверяем ДО отправки.
        if (micPhrase && micIsStop(micPhrase)) {
            micPhrase = ''; micLive = '';
            micTimersReset(); clearTimeout(micSendTimer);
            micConsumed = micLastCount;
            micLockUntil = Date.now() + 1500;
            chatInput.value = micBase || '';
            micUserStopped = true;
            try { recognition.stop(); } catch (e) {}
            micUI(false, '🎤 Стоп — микрофон выключен');
            return;
        }

        // Пауза перед отправкой: сбрасываем на ЛЮБОМ новом результате — и на
        // промежуточном, и на финальном. Раньше сбрасывалось только на финальном,
        // поэтому улетало одно первое слово, пока Босс продолжал говорить.
        if (micPhrase) {
            clearTimeout(micSendTimer);
            micSendTimer = setTimeout(micFlush, MIC_SEND_DELAY);
            micArmSilence();   // тишина 4 сек — микрофон выключится сам
            micUI(true, '🎤 Понял — отправлю через секунду…');
        }
    };

    recognition.onerror = function (event) {
        const code = (event && event.error) ? event.error : 'unknown';
        if (code === 'no-speech') { micUI(true, '🎤 Не слышу — говори громче'); return; }
        if (code === 'aborted') return;
        isListening = false;
        micUserStopped = true;
        let msg = '🎤 Микрофон: ' + code;
        if (code === 'not-allowed' || code === 'service-not-allowed') {
            msg = '🎤 Нет доступа к микрофону — разреши его в настройках браузера';
            micPermOK = false; micPermAsked = false;   // дадим шанс запросить заново
        }
        else if (code === 'audio-capture') msg = '🎤 Микрофон занят или недоступен';
        else if (code === 'network') msg = '🎤 Распознаванию нужен интернет';
        micUI(false, msg);
    };

    recognition.onend = function () {
        // Финал сессии запоминаем — авто-перезапуск продолжит текст, а не начнёт заново.
        if (micFull) micDone = micFull;
        // АВТО-ПЕРЕЗАПУСК: если Босс не останавливал вручную и лимит не превышен —
        // продолжаем слушать. Так микрофон не «выключается сразу» на Android.
        if (!micUserStopped && micRestarts < 8) {
            micRestarts++;
            // micDone уже содержит всё сказанное — новая сессия продолжит текст,
            // а не начнёт заново. Поэтому базу и счётчики НЕ сбрасываем.
            setTimeout(function () {
                if (micUserStopped) return;
                try { recognition.start(); }
                catch (e) { isListening = false; micUI(false, '🎤 Не удалось запустить микрофон'); }
            }, 250);
            return;
        }
        isListening = false;
        micUI(false, null);
    };
}

async function toggleVoiceInput() {
    if (!recognition) {
        micToast('🎤 Браузер не поддерживает распознавание речи. Открой в Chrome.');
        return;
    }
    if (isListening) {
        micUserStopped = true;
        try { recognition.stop(); } catch (e) {}
        micUI(false, '🎤 Микрофон выключен');
        return;
    }
    micUserStopped = false;
    micRestarts = 0;
    clearTimeout(micSendTimer);
    // Сброс накопленного: поле запоминаем как базу, текст сессии — с чистого листа.
    const _ci = document.getElementById('chatInput');
    micBase = _ci ? String(_ci.value || '').trim() : '';
    micDone = ''; micFull = ''; micSent = '';
    micUI(true, '🎤 Запрашиваю доступ…');
    const ok = await micEnsurePermission();
    if (!ok) { micUserStopped = true; micUI(false, '🎤 Нет доступа к микрофону — разреши его в настройках'); return; }
    try { recognition.start(); }
    catch (e) { micUserStopped = true; micUI(false, '🎤 Не удалось запустить микрофон'); }
}

/* ================= ЛАБОРАТОРИЯ ГОЛОСОВ ================= */
// НЕЙРО-ГОЛОСА EDGE-TTS (бесплатные, от Microsoft). Синтез на сервере, ключ не нужен.
const YANDEX_VOICES = [
    { id: 'ru-RU-DmitryNeural',  name: 'Дмитрий',  tag: 'мужской · деловой' },
    { id: 'ru-RU-SvetlanaNeural', name: 'Светлана', tag: 'женский · мягкий' }
];
const VOICE_EMOTIONS = ['neutral', 'good', 'evil', 'strict', 'friendly', 'happy', 'sad', 'whisper'];
const VOICE_PHRASE = 'Здравствуйте, Босс. Система готова к работе.';

// Старые id из AGENT_VOICES (яндексовые) → нейро-голоса edge-tts
const VOICE_MAP = {
    alena: 'ru-RU-SvetlanaNeural', jane: 'ru-RU-SvetlanaNeural', julia: 'ru-RU-SvetlanaNeural',
    marina: 'ru-RU-SvetlanaNeural', omazh: 'ru-RU-SvetlanaNeural',
    dasha: 'ru-RU-SvetlanaNeural', lera: 'ru-RU-SvetlanaNeural', masha: 'ru-RU-SvetlanaNeural',
    filipp: 'ru-RU-DmitryNeural', ermil: 'ru-RU-DmitryNeural', zahar: 'ru-RU-DmitryNeural',
    alexander: 'ru-RU-DmitryNeural', kirill: 'ru-RU-DmitryNeural', anton: 'ru-RU-DmitryNeural',
    madirus: 'ru-RU-DmitryNeural'
};
function edgeVoice(v) {
    if (!v) return 'ru-RU-DmitryNeural';
    if (String(v).indexOf('Neural') > -1) return v;
    return VOICE_MAP[v] || 'ru-RU-DmitryNeural';
}
// Эмоции у edge-tts нет — передаём их через темп речи
function emotionRate(emotion) {
    if (emotion === 'evil' || emotion === 'strict') return '-8%';
    if (emotion === 'happy' || emotion === 'good') return '+8%';
    if (emotion === 'sad') return '-14%';
    if (emotion === 'whisper') return '-20%';
    return '+0%';
}

let voiceOverrides = {};
try { const vo = localStorage.getItem('shtabVoiceOverrides'); if (vo) voiceOverrides = JSON.parse(vo); } catch (e) {}
// Голос по умолчанию — выбирается в лаборатории. Применяется ко всем агентам,
// которым не задан свой голос. Пусто = как в AGENT_VOICES.
let defaultVoice = '';
try { defaultVoice = localStorage.getItem('shtabDefaultVoice') || ''; } catch (e) {}
let vlabAudio = null;
let ttsLastError = 'нет данных';

// Видимый тост: если серверная озвучка не сработала — Босс сразу видит причину,
// а не только слышит робота телефона.
let _ttsToastEl = null;
function ttsToast(msg) {
    try {
        if (!_ttsToastEl) {
            _ttsToastEl = document.createElement('div');
            _ttsToastEl.style.cssText = 'position:fixed;left:50%;transform:translateX(-50%);bottom:120px;' +
                'max-width:88vw;padding:9px 13px;border-radius:12px;background:rgba(180,40,40,.92);' +
                'color:#fff;font:600 11.5px/1.35 system-ui,sans-serif;z-index:100000;' +
                'box-shadow:0 8px 24px rgba(0,0,0,.5);pointer-events:none;text-align:center';
            document.body.appendChild(_ttsToastEl);
        }
        _ttsToastEl.textContent = '🔇 ' + msg;
        _ttsToastEl.style.display = 'block';
        clearTimeout(_ttsToastEl._t);
        _ttsToastEl._t = setTimeout(function () { _ttsToastEl.style.display = 'none'; }, 4500);
    } catch (e) {}
}

// Ключ Яндекс Облака (SpeechKit). Хранится ТОЛЬКО в браузере (localStorage),
// в репозиторий не попадает и на сервер не пишется.
let yandexKey = '';
try { yandexKey = localStorage.getItem('shtabYandexKey') || ''; } catch (e) {}
function saveYandexKey(k) { yandexKey = (k || '').trim(); try { localStorage.setItem('shtabYandexKey', yandexKey); } catch (e) {} }
// Настройки нейро-голосов (edge-tts): скорость, громкость, тон.
// Работают на сервере — edge-tts принимает --rate / --volume / --pitch.
let neuralVoiceSettings = { rate: 0, volume: 0, pitch: 0 };
try { const nv = localStorage.getItem('shtabNeuralVoice'); if (nv) neuralVoiceSettings = Object.assign(neuralVoiceSettings, JSON.parse(nv)); } catch (e) {}
function saveNeuralVoice() { try { localStorage.setItem('shtabNeuralVoice', JSON.stringify(neuralVoiceSettings)); } catch (e) {} }
function sign(v, unit) { const n = Number(v) || 0; return (n > 0 ? '+' : '') + n + unit; }

function ttsBody(text, voice, emotion) {
    // Эмоция задаёт базовый темп, ползунок Босса сдвигает его поверх.
    const r = (parseInt(emotionRate(emotion)) || 0) + (Number(neuralVoiceSettings.rate) || 0);
    return JSON.stringify({
        tts: true,
        text: text,
        voice: edgeVoice(voice),
        rate: sign(r, '%'),
        volume: sign(neuralVoiceSettings.volume, '%'),
        pitch: sign(neuralVoiceSettings.pitch, 'Hz')
    });
}

async function vlabCheckServer() {
    const out = document.getElementById('vlabDiag');
    if (out) out.textContent = '⏳ Проверяю сервер…';
    const lines = [];

    // 1) POST на каждый адрес по очереди — ищем тот, что реально отдаёт аудио
    for (let i = 0; i < TTS_ENDPOINTS.length; i++) {
        const url = TTS_ENDPOINTS[i];
        const t0 = Date.now();
        try {
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: ttsBody('Проверка связи', 'ru-RU-SvetlanaNeural', 'neutral')
            });
            const ms = Date.now() - t0;
            const ct = res.headers.get('Content-Type') || '';
            const buf = await res.arrayBuffer();
            let info = 'HTTP ' + res.status + ' · ' + ms + ' мс · ' + ct.split(';')[0];
            if (ct.indexOf('audio') > -1 && buf.byteLength > 200) {
                TTS_PROXY = url;
                info += ' · аудио ' + Math.round(buf.byteLength / 1024) + ' КБ · РАБОТАЕТ ✅';
            } else {
                info += ' · НЕ аудио ❌ · ' + new TextDecoder().decode(buf.slice(0, 160));
            }
            lines.push(url + ' → ' + info);
        } catch (e) {
            lines.push(url + ' → ❌ ' + (e && e.message ? e.message : e));
        }
    }

    // 2) проверка доступности сервера — отвечает ли он вообще
    try {
        const t1 = Date.now();
        await fetch(TTS_PROXY, { method: 'GET', mode: 'no-cors', cache: 'no-store' });
        lines.push('Доступность: сервер ОТВЕЧАЕТ ✅ (' + (Date.now() - t1) + ' мс)');
    } catch (e) {
        lines.push('Доступность: сервер НЕ отвечает ❌ → Штаб не запущен или нет связи');
    }

    // 3) движок и адрес
    lines.push('Движок: edge-tts · нейро-голоса Microsoft · бесплатно, без ключа');
    lines.push('Адрес: ' + TTS_PROXY);
    lines.push('Если ответ «edge-tts не установлен» — на сервере: pip install --break-system-packages edge-tts');

    const info = lines.join('\n');
    if (out) out.textContent = info;
    ttsLastError = info;
    return info;
}

async function vlabPlay(voice, emotion, rowEl) {
    if (vlabAudio) { try { vlabAudio.pause(); } catch (e) {} vlabAudio = null; }
    if (rowEl) rowEl.classList.add('vlab-playing');
    try {
        const res = await ttsFetch(ttsBody(VOICE_PHRASE, voice, emotion));
        const blob = await res.blob();
        if (blob.size < 200) throw new Error('Нет аудио');
        vlabAudio = new Audio(URL.createObjectURL(blob));
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

/* ================= ГОЛОС ТЕЛЕФОНА (бесплатный, системный) ================= */
let phoneVoiceSettings = { voice: '', rate: 0.95, pitch: 0.90, volume: 1.0 };
try { const pv = localStorage.getItem('shtabPhoneVoice'); if (pv) phoneVoiceSettings = Object.assign(phoneVoiceSettings, JSON.parse(pv)); } catch (e) {}
function savePhoneVoice() { try { localStorage.setItem('shtabPhoneVoice', JSON.stringify(phoneVoiceSettings)); } catch (e) {} }

function ruPhoneVoices() {
    if (!('speechSynthesis' in window)) return [];
    try {
        return window.speechSynthesis.getVoices().filter(function (v) {
            return (v.lang || '').toLowerCase().indexOf('ru') === 0;
        });
    } catch (e) { return []; }
}

// Своя реализация системного голоса — читает наши настройки (голос/скорость/тон).
// Перебивает любую другую реализацию speakPhoneVoice, чтобы настройки работали.
function phoneSpeak(text, agentName) {
    if (!('speechSynthesis' in window)) return;
    try {
        window.speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(text);
        u.lang = 'ru-RU';
        u.rate = Number(phoneVoiceSettings.rate) || 0.95;
        u.pitch = Number(phoneVoiceSettings.pitch) || 0.90;
        u.volume = Number(phoneVoiceSettings.volume) || 1.0;
        const vs = ruPhoneVoices();
        let pick = null;
        if (phoneVoiceSettings.voice) {
            for (let i = 0; i < vs.length; i++) { if (vs[i].name === phoneVoiceSettings.voice) { pick = vs[i]; break; } }
        }
        if (!pick && vs.length) pick = vs[0];
        if (pick) u.voice = pick;
        window.speechSynthesis.speak(u);
    } catch (e) {}
}
// РОУТЕР ОЗВУЧКИ: кто бы ни позвал speakPhoneVoice (чат, ui.js, старый код) —
// сначала идём на сервер (edge-tts), и только если он не ответил, звучит телефон.
let _phoneBusy = false;
function speakAny(text, agentName) {
    if (!isVoiceEnabled) return;
    if (_phoneBusy) { phoneSpeak(text, agentName); return; }
    _phoneBusy = true;
    Promise.resolve(speakText(text, agentName)).catch(function () {}).then(function () { _phoneBusy = false; });
}
window.speakPhoneVoice = speakAny;

function openVoiceLab2() {
    const old = document.getElementById('vlab2');
    if (old) { old.remove(); return; }
    const ov = document.createElement('div');
    ov.id = 'vlab2';
    // Сворачиваемый раздел: заголовок + тело. open=true — развёрнут сразу.
    function acc(id, title, open, body) {
        return '<div class="vlab-acc' + (open ? ' open' : '') + '" id="acc_' + id + '">' +
            '<div class="vlab-acc-head" data-acc="' + id + '">' +
              '<div class="vlab-acc-t">' + title + '</div>' +
              '<div class="vlab-acc-a">▾</div>' +
            '</div>' +
            '<div class="vlab-acc-body">' + body + '</div>' +
          '</div>';
    }

    ov.innerHTML =
        '<div class="vlab-box">' +
          '<div class="vlab-head">' +
            '<div><div class="vlab-title">ЛАБОРАТОРИЯ ГОЛОСОВ · v4</div>' +
            '<div class="vlab-sub">Всё бесплатно. Разделы сворачиваются нажатием.</div></div>' +
            '<button class="vlab-close">✕</button>' +
          '</div>' +
          '<div class="vlab-scroll">' +

            acc('free', '🆓 БЕСПЛАТНЫЕ · ГОЛОС ТЕЛЕФОНА', true,
              '<div class="vlab-diag">' +
                '<div class="vlab-diag-t">СИСТЕМНЫЙ СИНТЕЗ ANDROID</div>' +
                '<div class="vlab-tag" style="margin:7px 0 2px">Без сервера, интернета и оплаты. Выбери голос и подстрой тон.</div>' +
                '<select id="pvVoice" class="vlab-sel" style="width:100%;margin-top:9px"></select>' +
                '<div class="pv-sl"><span>Скорость речи</span><b id="pvRateV">0.95</b></div>' +
                '<input id="pvRate" class="pv-range" type="range" min="0.5" max="1.5" step="0.05">' +
                '<div class="pv-sl"><span>Высота тона</span><b id="pvPitchV">0.90</b></div>' +
                '<input id="pvPitch" class="pv-range" type="range" min="0.5" max="1.5" step="0.05">' +
                '<div class="pv-sl"><span>Громкость</span><b id="pvVolV">1.00</b></div>' +
                '<input id="pvVol" class="pv-range" type="range" min="0.2" max="1" step="0.05">' +
                '<button id="pvPlay" class="vlab-check" style="margin-top:10px">▶ ПОСЛУШАТЬ ГОЛОС ТЕЛЕФОНА</button>' +
                '<button id="pvReset" class="vlab-check" style="margin-top:7px">СБРОСИТЬ НАСТРОЙКИ</button>' +
              '</div>') +

            acc('paid', '🆓 БЕСПЛАТНЫЕ · НЕЙРО-ГОЛОСА EDGE-TTS', true,
              '<div class="vlab-diag">' +
                '<div class="vlab-diag-t">НЕЙРО-СИНТЕЗ MICROSOFT · БЕЗ КЛЮЧА</div>' +
                '<div class="vlab-tag" style="margin:7px 0 2px">Бесплатно, без регистрации и ключей. Синтез идёт на нашем сервере (маршрут /tts). Нужен интернет.</div>' +
              '</div>' +
              '<div class="vlab-sec">ГОЛОСА · 2 ШТУКИ</div><div id="vlabVoices"></div>' +
              '<div class="vlab-sec">НАСТРОЙКА ГОЛОСА</div>' +
              '<div class="vlab-diag">' +
                '<div class="pv-sl"><span>Скорость речи</span><b id="nvRateV">+0%</b></div>' +
                '<input id="nvRate" class="pv-range" type="range" min="-50" max="50" step="5">' +
                '<div class="pv-sl"><span>Громкость</span><b id="nvVolV">+0%</b></div>' +
                '<input id="nvVol" class="pv-range" type="range" min="-50" max="50" step="5">' +
                '<div class="pv-sl"><span>Высота тона</span><b id="nvPitchV">+0Hz</b></div>' +
                '<input id="nvPitch" class="pv-range" type="range" min="-50" max="50" step="5">' +
                '<button id="nvPlay" class="vlab-check" style="margin-top:10px">▶ ПОСЛУШАТЬ НЕЙРО-ГОЛОС</button>' +
                '<button id="nvReset" class="vlab-check" style="margin-top:7px">СБРОСИТЬ НАСТРОЙКИ</button>' +
              '</div>') +

            acc('agents', '🤖 АГЕНТЫ ШТАБА', false,
              '<div class="vlab-tag" style="margin-bottom:9px">Кому какой голос. Выбор сохраняется сразу.</div>' +
              '<div id="vlabAgents"></div>') +

            acc('diag', '🔧 ДИАГНОСТИКА СЕРВЕРА ОЗВУЧКИ', false,
              '<div class="vlab-diag">' +
                '<div class="vlab-diag-t">СОСТОЯНИЕ СЕРВЕРА</div>' +
                '<div id="vlabDiag" class="vlab-diag-v">нажми «Проверить»</div>' +
                '<button id="vlabCheck" class="vlab-check">ПРОВЕРИТЬ СЕРВЕР</button>' +
                '<button id="vlabOpen" class="vlab-check" style="margin-top:7px">ОТКРЫТЬ АДРЕС В БРАУЗЕРЕ</button>' +
              '</div>') +

          '</div>' +
        '</div>';
    document.body.appendChild(ov);
    ov.querySelectorAll('.vlab-acc-head').forEach(function (h) {
        h.onclick = function () { h.parentElement.classList.toggle('open'); };
    });
    ov.querySelector('.vlab-close').onclick = function () { ov.remove(); };
    ov.querySelector('#vlabCheck').onclick = vlabCheckServer;
    ov.querySelector('#vlabOpen').onclick = function () { window.open(TTS_PROXY, '_blank'); };
    const dg0 = ov.querySelector('#vlabDiag');
    if (dg0 && ttsLastError !== 'нет данных') dg0.textContent = ttsLastError;
    ov.onclick = function (e) { if (e.target === ov) ov.remove(); };

    const vbox = ov.querySelector('#vlabVoices');
    function renderVoices() {
        vbox.innerHTML = '';
        YANDEX_VOICES.forEach(function (v) {
            const on = (defaultVoice === v.id);
            const row = document.createElement('div');
            row.className = 'vlab-row' + (on ? ' vlab-picked' : '');
            row.innerHTML = '<button class="vlab-play">▶</button>' +
                '<div class="vlab-info"><div class="vlab-name">' + v.name + (on ? ' · ВЫБРАН' : '') + '</div>' +
                '<div class="vlab-tag">' + v.tag + ' · ' + v.id + '</div></div>' +
                '<button class="vlab-pick">' + (on ? '✓' : 'ВЫБРАТЬ') + '</button>';
            row.querySelector('.vlab-play').onclick = function () { vlabPlay(v.id, 'neutral', row); };
            row.querySelector('.vlab-pick').onclick = function () {
                defaultVoice = on ? '' : v.id;
                try { localStorage.setItem('shtabDefaultVoice', defaultVoice); } catch (e) {}
                renderVoices();
                if (defaultVoice) vlabPlay(v.id, 'neutral', null);
            };
            vbox.appendChild(row);
        });
        const hint = document.createElement('div');
        hint.className = 'vlab-tag';
        hint.style.margin = '8px 2px 0';
        hint.textContent = defaultVoice
            ? 'Выбран: ' + defaultVoice + ' — говорят все агенты, кроме тех, кому задан свой голос ниже.'
            : 'Голос не выбран — агенты говорят своими голосами из AGENT_VOICES.';
        vbox.appendChild(hint);
    }
    renderVoices();

    // ---- НЕЙРО-ГОЛОСА: скорость / громкость / тон (edge-tts на сервере) ----
    const nvRate = ov.querySelector('#nvRate');
    const nvVol = ov.querySelector('#nvVol');
    const nvPitch = ov.querySelector('#nvPitch');
    const nvRateV = ov.querySelector('#nvRateV');
    const nvVolV = ov.querySelector('#nvVolV');
    const nvPitchV = ov.querySelector('#nvPitchV');
    function nvRender() {
        nvRate.value = neuralVoiceSettings.rate;
        nvVol.value = neuralVoiceSettings.volume;
        nvPitch.value = neuralVoiceSettings.pitch;
        nvRateV.textContent = sign(neuralVoiceSettings.rate, '%');
        nvVolV.textContent = sign(neuralVoiceSettings.volume, '%');
        nvPitchV.textContent = sign(neuralVoiceSettings.pitch, 'Hz');
    }
    nvRender();
    function nvTest() { vlabPlay(defaultVoice || 'ru-RU-DmitryNeural', 'neutral', null); }
    nvRate.oninput = function () { neuralVoiceSettings.rate = Number(nvRate.value); nvRender(); saveNeuralVoice(); };
    nvVol.oninput = function () { neuralVoiceSettings.volume = Number(nvVol.value); nvRender(); saveNeuralVoice(); };
    nvPitch.oninput = function () { neuralVoiceSettings.pitch = Number(nvPitch.value); nvRender(); saveNeuralVoice(); };
    nvRate.onchange = nvVol.onchange = nvPitch.onchange = nvTest;
    ov.querySelector('#nvPlay').onclick = nvTest;
    ov.querySelector('#nvReset').onclick = function () {
        neuralVoiceSettings = { rate: 0, volume: 0, pitch: 0 };
        saveNeuralVoice(); nvRender(); nvTest();
    };

    const abox = ov.querySelector('#vlabAgents');
    const names = (typeof AGENT_VOICES !== 'undefined') ? Object.keys(AGENT_VOICES) : [];
    if (!names.length) abox.innerHTML = '<div class="vlab-tag">AGENT_VOICES не найден</div>';
    names.forEach(function (name) {
        const base = (typeof AGENT_VOICES !== 'undefined' && AGENT_VOICES[name]) ? AGENT_VOICES[name] : { voice: 'ru-RU-SvetlanaNeural', emotion: 'neutral' };
        const cur = voiceOverrides[name] || (defaultVoice ? { voice: defaultVoice, emotion: base.emotion } : base);
        const curVoice = edgeVoice(cur.voice);
        const row = document.createElement('div');
        row.className = 'vlab-row';
        const opts = YANDEX_VOICES.map(function (v) {
            return '<option value="' + v.id + '"' + (v.id === curVoice ? ' selected' : '') + '>' + v.name + '</option>';
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

    // ---- ГОЛОС ТЕЛЕФОНА: заполнение и настройки ----
    const pvSel = ov.querySelector('#pvVoice');
    const pvRate = ov.querySelector('#pvRate');
    const pvPitch = ov.querySelector('#pvPitch');
    const pvVol = ov.querySelector('#pvVol');
    const pvRateV = ov.querySelector('#pvRateV');
    const pvPitchV = ov.querySelector('#pvPitchV');
    const pvVolV = ov.querySelector('#pvVolV');
    pvRate.value = phoneVoiceSettings.rate;
    pvPitch.value = phoneVoiceSettings.pitch;
    pvVol.value = phoneVoiceSettings.volume;
    pvRateV.textContent = Number(phoneVoiceSettings.rate).toFixed(2);
    pvPitchV.textContent = Number(phoneVoiceSettings.pitch).toFixed(2);
    pvVolV.textContent = Number(phoneVoiceSettings.volume).toFixed(2);

    function fillPhoneVoices() {
        const vs = ruPhoneVoices();
        if (!vs.length) {
            pvSel.innerHTML = '<option value="">русские голоса не найдены</option>';
            return;
        }
        pvSel.innerHTML = vs.map(function (v) {
            const sel = (v.name === phoneVoiceSettings.voice) ? ' selected' : '';
            return '<option value="' + v.name + '"' + sel + '>' + v.name + ' · ' + v.lang + '</option>';
        }).join('');
        if (!phoneVoiceSettings.voice) {
            phoneVoiceSettings.voice = vs[0].name;
            savePhoneVoice();
        }
    }
    fillPhoneVoices();
    if ('speechSynthesis' in window) {
        window.speechSynthesis.onvoiceschanged = function () { fillPhoneVoices(); };
        setTimeout(fillPhoneVoices, 600);
    }

    pvSel.onchange = function () { phoneVoiceSettings.voice = pvSel.value; savePhoneVoice(); phoneSpeak(VOICE_PHRASE); };
    pvRate.oninput = function () { phoneVoiceSettings.rate = Number(pvRate.value); pvRateV.textContent = Number(pvRate.value).toFixed(2); savePhoneVoice(); };
    pvPitch.oninput = function () { phoneVoiceSettings.pitch = Number(pvPitch.value); pvPitchV.textContent = Number(pvPitch.value).toFixed(2); savePhoneVoice(); };
    pvVol.oninput = function () { phoneVoiceSettings.volume = Number(pvVol.value); pvVolV.textContent = Number(pvVol.value).toFixed(2); savePhoneVoice(); };
    pvRate.onchange = pvPitch.onchange = pvVol.onchange = function () { phoneSpeak(VOICE_PHRASE); };
    ov.querySelector('#pvPlay').onclick = function () { phoneSpeak(VOICE_PHRASE); };
    ov.querySelector('#pvReset').onclick = function () {
        phoneVoiceSettings = { voice: '', rate: 0.95, pitch: 0.90, volume: 1.0 };
        savePhoneVoice();
        pvRate.value = 0.95; pvPitch.value = 0.90; pvVol.value = 1.0;
        pvRateV.textContent = '0.95'; pvPitchV.textContent = '0.90'; pvVolV.textContent = '1.00';
        fillPhoneVoices();
        phoneSpeak(VOICE_PHRASE);
    };

    // ---- КЛЮЧ ЯНДЕКСА ----
    const ykInput = ov.querySelector('#ykInput');
    const ykState = ov.querySelector('#ykState');
    function ykRender() {
        if (!ykState) return;
        if (yandexKey) {
            ykState.textContent = '✅ ключ сохранён · ' + yandexKey.slice(0, 6) + '…' + yandexKey.slice(-4) + ' · ' + yandexKey.length + ' симв.';
            if (ykInput) ykInput.value = yandexKey;
        } else {
            ykState.textContent = '⚠ ключ не задан — голоса Яндекса не работают';
        }
    }
    ykRender();
    const ykSaveBtn = ov.querySelector('#ykSave');
    const ykClearBtn = ov.querySelector('#ykClear');
    if (ykSaveBtn) ykSaveBtn.onclick = function () {
        saveYandexKey(ykInput ? ykInput.value : '');
        ykRender();
        vlabCheckServer();
    };
    if (ykClearBtn) ykClearBtn.onclick = function () {
        saveYandexKey('');
        if (ykInput) ykInput.value = '';
        ykRender();
    };
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
            '.vlab-acc{border:1px solid rgba(201,162,39,.22);border-radius:14px;overflow:hidden;margin-bottom:9px;' +
            'background:rgba(255,255,255,.02)}' +
            '.vlab-acc-head{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:12px 13px;' +
            'cursor:pointer;background:rgba(201,162,39,.07);user-select:none}' +
            '.vlab-acc-head:active{background:rgba(201,162,39,.14)}' +
            '.vlab-acc-t{color:#C9A227;font:700 11.5px/1.2 system-ui,sans-serif;letter-spacing:1.3px}' +
            '.vlab-acc-a{color:#C9A227;font-size:13px;transition:transform .25s;flex:0 0 auto}' +
            '.vlab-acc.open .vlab-acc-a{transform:rotate(180deg)}' +
            '.vlab-acc-body{display:none;padding:11px 12px 13px}' +
            '.vlab-acc.open .vlab-acc-body{display:block}' +
            '.vlab-row{display:flex;align-items:center;gap:12px;padding:9px 10px;border-radius:14px;' +
            'background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);margin-bottom:7px;transition:.2s}' +
            '.vlab-row.vlab-playing{border-color:rgba(201,162,39,.7);background:rgba(201,162,39,.10)}' +
            '.vlab-play{width:38px;height:38px;border-radius:12px;flex:0 0 auto;cursor:pointer;' +
            'background:linear-gradient(145deg,#C9A227,#8E6F14);color:#0B1522;border:none;font-size:14px}' +
            '.vlab-pick{flex:0 0 auto;height:34px;padding:0 11px;border-radius:10px;cursor:pointer;' +
            'border:1px solid rgba(201,162,39,.5);background:rgba(201,162,39,.12);color:#C9A227;' +
            'font:700 10.5px system-ui,sans-serif;letter-spacing:1px}' +
            '.vlab-pick:active{transform:scale(.95)}' +
            '.vlab-row.vlab-picked{border-color:rgba(201,162,39,.7);background:rgba(201,162,39,.10)}' +
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
    // Плавающая кнопка 🎛 ПОД кнопкой отправки убрана по приказу Босса.
    // Лаборатория голосов открывается кнопкой «🎛 Голоса» в панели режимов.
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
    if (window.speakPhoneVoice !== speakAny) window.speakPhoneVoice = speakAny;
    const _leftover = document.getElementById('vlabBtn2');   // плавающая кнопка убрана — если осталась от старой версии, сносим
    if (_leftover) _leftover.remove();
}, 1500);
