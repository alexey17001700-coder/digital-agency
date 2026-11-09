// --- НАСТРОЙКИ ОЗВУЧКИ ---
const TTS_PROXY = "https://functions.yandexcloud.net/d4etaf7qtg7n1r7j6eka";

let isVoiceEnabled = localStorage.getItem('shtabVoiceEnabled') === 'true';
let agentVoiceSettings = {};
try { 
    const sv = localStorage.getItem('shtabAgentVoice'); 
    if (sv) agentVoiceSettings = JSON.parse(sv); 
} catch (e) {}

let currentAudio = null; 
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

// --- ЗВУКИ ИНТЕРФЕЙСА ---
function playSound(type) {
    try {
        if (audioCtx.state === 'suspended') audioCtx.resume();
        const osc = audioCtx.createOscillator(); 
        const gain = audioCtx.createGain();
        osc.connect(gain); gain.connect(audioCtx.destination);
        
        if (type === 'send') { 
            osc.type = 'sine'; 
            osc.frequency.setValueAtTime(800, audioCtx.currentTime); 
            osc.frequency.exponentialRampToValueAtTime(1200, audioCtx.currentTime + 0.1); 
        } else if (type === 'receive') { 
            osc.type = 'triangle'; 
            osc.frequency.setValueAtTime(600, audioCtx.currentTime); 
            osc.frequency.exponentialRampToValueAtTime(400, audioCtx.currentTime + 0.2); 
        }
        gain.gain.setValueAtTime(0.1, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.2);
        osc.start(); osc.stop(audioCtx.currentTime + 0.2);
    } catch (e) { console.warn("Звук заблокирован браузером"); }
}

// --- ПЕРЕКЛЮЧАТЕЛЬ ОЗВУЧКИ ---
function toggleVoice() {
    isVoiceEnabled = !isVoiceEnabled;
    localStorage.setItem('shtabVoiceEnabled', isVoiceEnabled);
    const btn = document.getElementById('btnVoiceToggle');
    if (btn) {
        if (isVoiceEnabled) {
            btn.innerText = '🗣️ Озвучка: ВКЛ';
            btn.classList.add('active');
        } else {
            btn.innerText = '🗣️ Озвучка: ВЫКЛ';
            btn.classList.remove('active');
        }
    }
}

// --- ОЗВУЧКА ТЕКСТА ---
async function speakText(text, agentName) {
    if (!isVoiceEnabled) return;
    if (agentVoiceSettings[agentName] === false) return;

    let cleanText = text.replace(/[*#_`]/g, '').replace(/\[.*?\]/g, '').trim();
    if (!cleanText) return;

    if (currentAudio) { currentAudio.pause(); currentAudio.currentTime = 0; }
    if ('speechSynthesis' in window) { window.speechSynthesis.cancel(); }

    const v = (typeof AGENT_VOICES !== 'undefined' && AGENT_VOICES[agentName]) 
        ? AGENT_VOICES[agentName] 
        : { voice: "alena", emotion: "neutral" };

    try {
        const res = await fetch(TTS_PROXY, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: cleanText, voice: v.voice, emotion: v.emotion })
        });
        
        if (!res.ok) throw new Error("Сервер: " + res.status);

        const data = await res.json();
        
        if (data.audio) {
            const audioUrl = "data:audio/mpeg;base64," + data.audio;
            currentAudio = new Audio(audioUrl);
            await currentAudio.play();
        } else {
            throw new Error("Нет аудио");
        }
    } catch (e) {
        console.error('Ошибка Яндекса, встроенный голос:', e);
        if ('speechSynthesis' in window) {
            const utterance = new SpeechSynthesisUtterance(cleanText);
            utterance.lang = 'ru-RU';
            
            if (agentName === 'Хакер') { utterance.pitch = 0.5; utterance.rate = 0.9; }
            else if (agentName === 'Дизайнер') { utterance.pitch = 1.5; utterance.rate = 1.1; }
            else if (agentName === 'Охранник') { utterance.pitch = 0.8; utterance.rate = 1.0; }
            
            window.speechSynthesis.speak(utterance);
        }
    }
    }
// --- ГОЛОСОВОЙ ВВОД (МИКРОФОН) ---
let recognition = null;
let isListening = false;

// Проверяем поддержку браузером
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

if (SpeechRecognition) {
    recognition = new SpeechRecognition();
    recognition.lang = 'ru-RU';
    recognition.continuous = false; // Слушаем до первой паузы
    recognition.interimResults = false; // Ждем финальный результат

    recognition.onstart = function() {
        isListening = true;
        const btn = document.getElementById('micBtn');
        if (btn) {
            btn.style.background = '#ff0055'; // Красный, когда слушает
            btn.style.boxShadow = '0 0 10px #ff0055';
        }
    };

    recognition.onresult = function(event) {
        const transcript = event.results[0][0].transcript;
        const chatInput = document.getElementById('chatInput');
        if (chatInput) {
            // Добавляем распознанный текст к тому, что уже написано
            chatInput.value += (chatInput.value ? ' ' : '') + transcript;
            chatInput.style.height = 'auto';
            chatInput.style.height = (chatInput.scrollHeight) + 'px';
        }
    };

    recognition.onerror = function(event) {
        console.error('Ошибка микрофона:', event.error);
        if (event.error === 'not-allowed') {
            alert('Браузер заблокировал микрофон. Разреши доступ в настройках!');
        }
    };

    recognition.onend = function() {
        isListening = false;
        const btn = document.getElementById('micBtn');
        if (btn) {
            btn.style.background = '#333'; // Возвращаем стандартный цвет
            btn.style.boxShadow = 'none';
        }
    };
}

function toggleVoiceInput() {
    if (!recognition) {
        alert('Твой браузер не поддерживает голосовой ввод. Используй Chrome или Safari.');
        return;
    }
    
    if (isListening) {
        recognition.stop();
    } else {
        try {
            recognition.start();
        } catch (e) {
            console.warn("Микрофон уже запущен", e);
        }
    }
    }
