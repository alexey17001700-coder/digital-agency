// --- ЗВУКИ И ОЗВУЧКА ---
const TTS_PROXY = "https://functions.yandexcloud.net/d4etaf7qtg7n1r7j6eka";

let isVoiceEnabled = localStorage.getItem('shtabVoiceEnabled') === 'true';
let agentVoiceSettings = {};
try { 
    const sv = localStorage.getItem('shtabAgentVoice'); 
    if (sv) agentVoiceSettings = JSON.parse(sv); 
} catch (e) {}

const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

function playSound(type) {
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const osc = audioCtx.createOscillator(); const gain = audioCtx.createGain();
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
}

function toggleVoice() {
    isVoiceEnabled = !isVoiceEnabled;
    localStorage.setItem('shtabVoiceEnabled', isVoiceEnabled);
    const btn = document.getElementById('btnVoiceToggle');
    if (isVoiceEnabled) {
        btn.innerText = '🗣️ Озвучка: ВКЛ';
        btn.classList.add('active');
    } else {
        btn.innerText = '🗣️ Озвучка: ВЫКЛ';
        btn.classList.remove('active');
    }
}

async function speakText(text, agentName) {
    if (!isVoiceEnabled) return;
    if (agentVoiceSettings[agentName] === false) return;

    let cleanText = text.replace(/[*#_`]/g, '').replace(/\[.*?\]/g, '').trim();
    if (!cleanText) return;

    const v = AGENT_VOICES[agentName] || AGENT_VOICES["По умолчанию"];

    try {
        const res = await fetch(TTS_PROXY, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: cleanText, voice: v.voice, emotion: v.emotion })
        });
        
        if (!res.ok) {
            const errText = await res.text();
            throw new Error("Сервер: " + res.status + " " + errText);
        }

        const data = await res.json();
        
        if (data.audio) {
            const audioUrl = "data:audio/mpeg;base64," + data.audio;
            const audio = new Audio(audioUrl);
            await audio.play();
        } else {
            throw new Error("Нет аудио в ответе: " + JSON.stringify(data));
        }
    } catch (e) {
        console.error('Ошибка Яндекса:', e);
        // Показываем ошибку прямо в чате, чтобы понять причину
        renderMessage(`⚠️ **Ошибка озвучки:** ${e.message}`, 'director', 'Оркестратор');
        
        // Запасной парашют (встроенный голос)
        if ('speechSynthesis' in window) {
            window.speechSynthesis.cancel();
            const utterance = new SpeechSynthesisUtterance(cleanText);
            utterance.lang = 'ru-RU';
            window.speechSynthesis.speak(utterance);
        }
    }
}
