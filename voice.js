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

    const v = (typeof AGENT_VOICES !== 'undefined' && AGENT_VOICES[agentName]) ? AGENT_VOICES[agentName] : { voice: "alena", emotion: "neutral" };

    try {
        const res = await fetch(TTS_PROXY, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: cleanText, voice: v.voice, emotion: v.emotion }) });
        if (!isVoiceEnabled) return;
        if (!res.ok) throw new Error("Сервер");
        const data = await res.json();
        if (!isVoiceEnabled) return;
        if (data.audio) { currentAudio = new Audio("data:audio/mpeg;base64," + data.audio); await currentAudio.play(); } else throw new Error("Нет аудио");
    } catch (e) {
        if (!isVoiceEnabled) return;
        if ('speechSynthesis' in window) {
            const utterance = new SpeechSynthesisUtterance(cleanText); utterance.lang = 'ru-RU';
            if (agentName === 'Хакер') { utterance.pitch = 0.5; utterance.rate = 0.9; }
            else if (agentName === 'Охранник') { utterance.pitch = 0.8; utterance.rate = 1.0; }
            window.speechSynthesis.speak(utterance);
        }
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
