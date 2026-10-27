// --- НАСТРОЙКИ ОЗВУЧКИ ---
const TTS_PROXY = "https://functions.yandexcloud.net/d4etaf7qtg7n1r7j6eka";

let isVoiceEnabled = localStorage.getItem('shtabVoiceEnabled') === 'true';
let agentVoiceSettings = {};
try { 
    const sv = localStorage.getItem('shtabAgentVoice'); 
    if (sv) agentVoiceSettings = JSON.parse(sv); 
} catch (e) {}

let currentAudio = null; // Храним текущее аудио, чтобы останавливать старое

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

    // Останавливаем предыдущую озвучку
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
        // Запасной вариант (голос телефона)
        if ('speechSynthesis' in window) {
            const utterance = new SpeechSynthesisUtterance(cleanText);
            utterance.lang = 'ru-RU';
            
            // Делаем голоса разными
            if (agentName === 'Хакер') { utterance.pitch = 0.5; utterance.rate = 0.9; }
            else if (agentName === 'Дизайнер') { utterance.pitch = 1.5; utterance.rate = 1.1; }
            else if (agentName === 'Охранник') { utterance.pitch = 0.8; utterance.rate = 1.0; }
            
            window.speechSynthesis.speak(utterance);
        }
    }
                }
