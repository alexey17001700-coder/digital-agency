(function() {
    // 1. Создаем стили
    const style = document.createElement('style');
    style.innerHTML = `
    @import url('https://fonts.googleapis.com/css2?family=Fira+Code:wght@400;700&display=swap');
    #wd-matrix-bg{position:fixed;top:0;left:0;width:100%;height:100%;z-index:9998;pointer-events:none;opacity:0.15}
    #wd-panel{position:fixed;bottom:20px;right:20px;width:380px;max-width:calc(100vw - 40px);background:rgba(0,10,0,0.95);border:1px solid #00ff41;border-radius:4px;box-shadow:0 0 25px rgba(0,255,65,0.5),inset 0 0 20px rgba(0,255,65,0.1);z-index:999999;overflow:hidden;display:none;transform:scale(0.9);opacity:0;transition:all 0.3s ease-out;font-family:'Fira Code',monospace}
    #wd-panel.active{display:flex;flex-direction:column;transform:scale(1);opacity:1;animation:wd-borderPulse 1.5s infinite alternate}
    @keyframes wd-borderPulse{from{box-shadow:0 0 10px rgba(0,255,65,0.3),inset 0 0 10px rgba(0,255,65,0.1)}to{box-shadow:0 0 35px rgba(0,255,65,1),inset 0 0 25px rgba(0,255,65,0.5)}}
    .wd-header{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px dashed #00ff41;background:rgba(0,255,65,0.05)}
    .wd-title-area{display:flex;align-items:center;gap:15px}
    .wd-title{color:#00ff41;font-weight:700;font-size:14px;text-shadow:0 0 8px #00ff41}
    .wd-cyber-alarm{width:40px;height:40px;background:radial-gradient(circle at 30% 30%,#ffaaaa,#ff0000 40%,#660000 90%);border-radius:50%;position:relative;box-shadow:0 0 15px #ff0000,0 0 30px #ff0000,inset 0 0 10px #fff;border:2px solid #440000;animation:wd-alarmPulse 1s infinite alternate}
    .wd-cyber-alarm::before{content:'';position:absolute;top:-6px;left:-6px;right:-6px;bottom:-6px;border-radius:50%;border:2px dashed rgba(255,0,0,0.5);animation:wd-spin 4s linear infinite}
    .wd-cyber-alarm::after{content:'';position:absolute;top:15%;left:20%;width:30%;height:20%;background:rgba(255,255,255,0.8);border-radius:50%;transform:rotate(-45deg)}
    @keyframes wd-alarmPulse{0%{transform:scale(0.9);box-shadow:0 0 10px #ff0000,0 0 20px #ff0000,inset 0 0 5px #ff8888}100%{transform:scale(1.1);box-shadow:0 0 30px #ff0000,0 0 60px #ff0000,inset 0 0 20px #fff}}
    @keyframes wd-spin{100%{transform:rotate(360deg)}}
    .wd-close{background:none;border:none;color:#00ff41;font-size:20px;cursor:pointer;transition:0.2s}
    .wd-close:hover{color:#fff;text-shadow:0 0 10px #fff}
    .wd-terminal{background:#000;margin:0;padding:16px;height:200px;overflow-y:auto;font-size:13px;position:relative;background-image:repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(0,255,65,0.05) 2px,rgba(0,255,65,0.05) 4px)}
    .wd-terminal::-webkit-scrollbar{width:8px}.wd-terminal::-webkit-scrollbar-track{background:#000;border-left:1px solid #003300}.wd-terminal::-webkit-scrollbar-thumb{background:#00ff41}
    .wd-log-line{margin-bottom:6px;line-height:1.4;word-wrap:break-word}.wd-log-error{color:#ff3333;text-shadow:0 0 5px #ff3333}.wd-log-info{color:#00ff41}.wd-log-system{color:#888}
    .wd-actions{padding:12px 16px;display:flex;gap:10px;border-top:1px dashed #00ff41}
    .wd-btn{flex:1;padding:12px;border:1px solid #00ff41;background:transparent;color:#00ff41;font-weight:700;font-size:13px;cursor:pointer;text-transform:uppercase;transition:all 0.2s;letter-spacing:1px;font-family:'Fira Code',monospace}
    .wd-btn-fix:hover{background:#00ff41;color:#000;box-shadow:0 0 20px #00ff41}
    .wd-btn-ignore{border-color:#555;color:#555}.wd-btn-ignore:hover{border-color:#ff3333;color:#ff3333}
    .wd-music-btn{background:none;border:1px solid #00ff41;color:#00ff41;padding:4px 8px;font-size:12px;cursor:pointer;border-radius:4px;font-family:inherit;margin-left:10px}
    .wd-music-btn:hover{background:#00ff41;color:#000}
    #wd-alarm-btn{position:fixed;top:100px;right:20px;z-index:1000000;cursor:pointer;display:none;animation:wd-alarmPulse 1s infinite alternate;font-size:40px;line-height:1}
    `;
    document.head.appendChild(style);

    // 2. Внедряем разметку
    const div = document.createElement('div');
    div.innerHTML = `
    <canvas id="wd-matrix-bg"></canvas>
    <div id="wd-alarm-btn" onclick="window.wdShow()" title="Ошибка!">🚨</div>
    <div id="wd-panel">
        <div class="wd-header">
            <div class="wd-title-area"><div class="wd-cyber-alarm"></div><div class="wd-title">SYS_ERR // WATCHDOG</div></div>
            <div style="display:flex; align-items:center;">
                <button id="wd-music-btn" class="wd-music-btn" onclick="window.wdToggleMusic()">🔊 MUSIC: OFF</button>
                <button id="wd-track-btn" class="wd-music-btn" onclick="window.wdNextTrack()" style="display:none; margin-left:5px;">⏭ 1/4</button>
                <button class="wd-close" onclick="window.wdHide()" style="margin-left:15px;">✕</button>
            </div>
        </div>
        <div class="wd-terminal" id="wd-terminal"></div>
        <div class="wd-actions">
            <button class="wd-btn wd-btn-fix" onclick="window.wdApplyPatch()">Патч</button>
            <button class="wd-btn wd-btn-ignore" onclick="window.wdHide()">Игнор</button>
        </div>
    </div>
    `;
    document.body.appendChild(div);

    // 3. Матрица
    const wdCanvas = document.getElementById('wd-matrix-bg');
    const wdCtx = wdCanvas.getContext('2d');
    wdCanvas.width = window.innerWidth; wdCanvas.height = window.innerHeight;
    const wdChars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789アカサタナハマヤラワイキシチニヒミリ';
    const wdFontSize = 16;
    const wdColumns = Math.floor(wdCanvas.width / wdFontSize);
    const wdDrops = [];
    for (let i = 0; i < wdColumns; i++) wdDrops[i] = Math.random() * wdCanvas.height / wdFontSize;
    setInterval(() => {
        wdCtx.fillStyle = 'rgba(0, 0, 0, 0.06)'; wdCtx.fillRect(0, 0, wdCanvas.width, wdCanvas.height);
        wdCtx.fillStyle = '#00ff41'; wdCtx.font = wdFontSize + 'px monospace';
        for (let i = 0; i < wdDrops.length; i++) {
            const text = wdChars[Math.floor(Math.random() * wdChars.length)];
            wdCtx.fillText(text, i * wdFontSize, wdDrops[i] * wdFontSize);
            if (wdDrops[i] * wdFontSize > wdCanvas.height && Math.random() > 0.975) wdDrops[i] = 0;
            wdDrops[i]++;
        }
    }, 50);
  let wdAudioCtx = null, wdIsPlaying = false, wdTimer = null, wdNextNote = 0, wdStep = 0, wdTrack = 0;
const wdNotes = { 'A1':55.00,'C2':65.41,'D2':73.42,'E2':82.41,'F2':87.31,'G2':98.00,'A2':110.00,'B2':123.47,'C3':130.81,'D3':146.83,'E3':164.81,'F3':174.61,'G3':196.00,'G#3':207.65,'A3':220.00,'B3':246.94,'C4':261.63,'D4':293.66,'E4':329.63,'F4':349.23,'G4':392.00,'G#4':415.30,'A4':440.00,'B4':493.88,'C5':523.25,'D5':587.33,'E5':659.25,'F5':698.46,'G5':783.99,'A5':880.00,'E6':1318.51,'D6':1174.66,'C6':1046.50,'B5':987.77,'Bb5':932.33,'Bb2':116.54,'Bb3':233.08,'G#5':830.61,'Bb4':466.16 };

const wdT1M = ['A4',null,'E5',null,'A5',null,'G5','E5','F5',null,'E5',null,'D5',null,'C5',null,'D5',null,'A4',null,'D5',null,'F5','A5','G5',null,'F5',null,'E5',null,'D5',null,'C5',null,'G4',null,'C5',null,'E5','G5','A5',null,'G5',null,'E5',null,'C5',null,'D5',null,'E5',null,'F5',null,'G5',null,'A5',null,null,null,null,null,null,null,'A4','C5','E5','A5','G5','E5','C5','E5','F5','A5','C6','A5','G5','E5','C5','A4','G4','B4','D5','G5','F5','D5','B4','D5','E5','G5','B5','G5','F5','D5','B4','G4','A4','C5','E5','A5','G5','E5','C5','E5','F5','A5','C6','A5','G5','E5','C5','A4','E5',null,'G5',null,'A5',null,'B5',null,'C6',null,null,null,null,null,null,null];
const wdT1B = ['A2','A2',null,'A3','A2','A2',null,'A3','F2','F2',null,'F3','F2','F2',null,'F3','D2','D2',null,'D3','D2','D2',null,'D3','G2','G2',null,'G3','G2','G2',null,'G3','C3','C3',null,'C4','C3','C3',null,'C4','A2','A2',null,'A3','A2','A2',null,'A3','F2','F2',null,'F3','G2','G2',null,'G3','A2','A2',null,'A3','A2',null,null,null,'A2','A2',null,'A3','A2','A2',null,'A3','F2','F2',null,'F3','F2','F2',null,'F3','G2','G2',null,'G3','G2','G2',null,'G3','E2','E2',null,'E3','E2','E2',null,'E3','A2','A2',null,'A3','A2','A2',null,'A3','F2','F2',null,'F3','F2','F2',null,'F3','E2','E2',null,'E3','E2','E2',null,'E3','A2',null,null,null,null,null,null,null];
const wdT2M = ['D5',null,'D5','F5','A5',null,'G5','F5','E5',null,'D5',null,'C5','D5',null,null,'Bb4',null,'Bb4','D5','F5',null,'E5','D5','C5',null,'Bb4',null,'A4','Bb4',null,null,'C5',null,'C5','E5','G5',null,'F5','E5','D5',null,'C5',null,'Bb4','C5',null,null,'A4',null,'C5','E5','A5',null,'G5','E5','C5',null,'A4',null,'E4','A4',null,null,'D5','F5','A5','D6',null,'C6','A5','F5','D5','F5','A5','D6','C6','A5','F5','D5','Bb4','D5','F5','Bb5',null,'A5','F5','D5','Bb4','D5','F5','Bb5','A5','F5','D5','Bb4','C5','E5','G5','C6',null,'B5','G5','E5','C5','E5','G5','C6','B5','G5','E5','C5','A4','C5','E5','A5','G5','E5','C5','A4','E4','A4','C5','E5','A5','G5','E5','C5'];
const wdT2B = ['D2','D2','D3','D2','D2','D2','D3','D2','D2','D2','D3','D2','D2','D2','D3','D2','Bb2','Bb2','Bb3','Bb2','Bb2','Bb2','Bb3','Bb2','Bb2','Bb2','Bb3','Bb2','Bb2','Bb2','Bb3','Bb2','C3','C3','C4','C3','C3','C3','C4','C3','C3','C3','C4','C3','C3','C3','C4','C3','A2','A2','A3','A2','A2','A2','A3','A2','A2','A2','A3','A2','A2','A2','A3','A2','D2','D2','D3','D2','D2','D2','D3','D2','D2','D2','D3','D2','D2','D2','D3','D2','Bb2','Bb2','Bb3','Bb2','Bb2','Bb2','Bb3','Bb2','Bb2','Bb2','Bb3','Bb2','Bb2','Bb2','Bb3','Bb2','C3','C3','C4','C3','C3','C3','C4','C3','C3','C3','C4','C3','C3','C3','C4','C3','A2','A2','A3','A2','A2','A2','A3','A2','A2','A2','A3','A2','A2','A2','A3','A2'];
const wdSadM = ['E5',null,null,null,'D5',null,'C5',null,'B4',null,null,null,'A4',null,null,null,'A4',null,null,null,'B4',null,'C5',null,'E5',null,null,null,null,null,null,null,'F5',null,null,null,'E5',null,'D5',null,'C5',null,null,null,'A4',null,null,null,'C5',null,null,null,'B4',null,'A4',null,'G4',null,null,null,null,null,null,null,'G4',null,null,null,'C5',null,'E5',null,'G5',null,null,null,'F5',null,null,null,'E5',null,null,null,'D5',null,'C5',null,'B4',null,null,null,null,null,null,null,'D5',null,null,null,'F5',null,'A5',null,'G5',null,null,null,'F5',null,null,null,'E5',null,null,null,'D5',null,'C5',null,'D5',null,null,null,null,null,null,null,'E5',null,null,null,'G#4',null,'B4',null,'E5',null,null,null,'D5',null,null,null,'C5',null,null,null,'B4',null,'A4',null,'G#4',null,null,null,null,null,null,null,'A4',null,null,null,'C5',null,'E5',null,'A5',null,null,null,'G5',null,null,null,'F5',null,null,null,'E5',null,'D5',null,'C5',null,null,null,null,null,null,null,'F4',null,null,null,'A4',null,'C5',null,'F5',null,null,null,'E5',null,null,null,'D5',null,null,null,'C5',null,'B4',null,'A4',null,null,null,null,null,null,null,'G#4',null,null,null,'B4',null,'E5',null,'G#5',null,null,null,'B5',null,null,null,'A5',null,null,null,'G#5',null,'E5',null,'B4',null,null,null,null,null,null,null];
const wdSadB = ['A2',null,null,null,null,null,null,null,'A2',null,null,null,null,null,null,null,'A2',null,null,null,null,null,null,null,'A2',null,null,null,'E2',null,null,null,'F2',null,null,null,null,null,null,null,'F2',null,null,null,null,null,null,null,'C3',null,null,null,null,null,null,null,'C3',null,null,null,null,null,null,null,'G2',null,null,null,null,null,null,null,'G2',null,null,null,null,null,null,null,'C3',null,null,null,null,null,null,null,'C3',null,null,null,null,null,null,null,'D2',null,null,null,null,null,null,null,'D2',null,null,null,null,null,null,null,'E2',null,null,null,null,null,null,null,'E2',null,null,null,null,null,null,null,'E2',null,null,null,null,null,null,null,'E2',null,null,null,null,null,null,null,'E2',null,null,null,null,null,null,null,'E2',null,null,null,'B2',null,null,null,'A2',null,null,null,null,null,null,null,'A2',null,null,null,null,null,null,null,'F2',null,null,null,null,null,null,null,'F2',null,null,null,null,null,null,null,'F2',null,null,null,null,null,null,null,'F2',null,null,null,null,null,null,null,'G2',null,null,null,null,null,null,null,'G2',null,null,null,null,null,null,null,'E2',null,null,null,null,null,null,null,'E2',null,null,null,null,null,null,null,'E2',null,null,null,null,null,null,null,'E2',null,null,null,null,null,null,null];
const wdTracks = [{ tempo:110,melody:wdT1M,bass:wdT1B,wave:'square',bassWave:'triangle' },{ tempo:120,melody:wdT2M,bass:wdT2B,wave:'sawtooth',bassWave:'square' },{ tempo:130,melody:wdT2M,bass:wdT2B,wave:'square',bassWave:'sawtooth' },{ tempo:115,melody:wdSadM,bass:wdSadB,wave:'sine',bassWave:'triangle' }];
  function wdPlayTone(freq, duration, type, vol) {
    if (!wdAudioCtx || !freq) return;
    const osc = wdAudioCtx.createOscillator(), gain = wdAudioCtx.createGain();
    osc.type = type; osc.frequency.value = freq;
    gain.gain.setValueAtTime(vol, wdAudioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, wdAudioCtx.currentTime + duration);
    osc.connect(gain); gain.connect(wdAudioCtx.destination); osc.start(); osc.stop(wdAudioCtx.currentTime + duration);
}
function wdPlayKick() {
    if (!wdAudioCtx) return;
    const osc = wdAudioCtx.createOscillator(), gain = wdAudioCtx.createGain();
    osc.type = 'sine'; osc.frequency.setValueAtTime(150, wdAudioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(0.01, wdAudioCtx.currentTime + 0.15);
    gain.gain.setValueAtTime(0.4, wdAudioCtx.currentTime); gain.gain.exponentialRampToValueAtTime(0.001, wdAudioCtx.currentTime + 0.15);
    osc.connect(gain); gain.connect(wdAudioCtx.destination); osc.start(); osc.stop(wdAudioCtx.currentTime + 0.15);
}
function wdPlayNoise(duration, freq, isHighpass, vol) {
    if (!wdAudioCtx) return;
    const bufferSize = wdAudioCtx.sampleRate * duration, buffer = wdAudioCtx.createBuffer(1, bufferSize, wdAudioCtx.sampleRate), data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
    const noise = wdAudioCtx.createBufferSource(), filter = wdAudioCtx.createBiquadFilter(), gain = wdAudioCtx.createGain();
    noise.buffer = buffer; filter.type = isHighpass ? 'highpass' : 'bandpass'; filter.frequency.value = freq;
    gain.gain.setValueAtTime(vol, wdAudioCtx.currentTime); gain.gain.exponentialRampToValueAtTime(0.001, wdAudioCtx.currentTime + duration);
    noise.connect(filter); filter.connect(gain); gain.connect(wdAudioCtx.destination); noise.start();
}
function wdSchedule() {
    if (!wdAudioCtx) return;
    const track = wdTracks[wdTrack], timeStep = 60 / track.tempo / 4;
    while (wdNextNote < wdAudioCtx.currentTime + 0.1) {
        const idx = wdStep % track.melody.length;
        if (track.melody[idx]) wdPlayTone(wdNotes[track.melody[idx]], 0.1, track.wave, 0.06);
        if (track.bass[idx]) wdPlayTone(wdNotes[track.bass[idx]], 0.15, track.bassWave, 0.1);
        if (wdTrack !== 3) {
            if (idx % 8 === 0) wdPlayKick();
            if (idx % 8 === 4) wdPlayNoise(0.15, 1500, false, 0.1);
            if (idx % 2 === 0) wdPlayNoise(0.03, 7000, true, 0.03);
        }
        wdNextNote += timeStep; wdStep++;
        if (wdStep >= track.melody.length) { wdStep = 0; wdTrack = (wdTrack + 1) % wdTracks.length; }
    }
}
function wdNextTrack() {
    if (!wdIsPlaying) return;
    wdTrack = (wdTrack + 1) % wdTracks.length;
    document.getElementById('wd-track-btn').innerText = `⏭ ${wdTrack + 1}/4`;
}
function wdStopMusic() {
    wdIsPlaying = false; if (wdTimer) clearInterval(wdTimer);
    if (wdAudioCtx) { try { wdAudioCtx.close(); } catch(e) {} wdAudioCtx = null; }
    const btn = document.getElementById('wd-music-btn'), trackBtn = document.getElementById('wd-track-btn');
    if (btn) btn.innerText = '🔊 MUSIC: OFF';
    if (trackBtn) trackBtn.style.display = 'none';
}
window.wdToggleMusic = function() {
    const btn = document.getElementById('wd-music-btn'), trackBtn = document.getElementById('wd-track-btn');
    if (wdIsPlaying) { wdStopMusic(); } 
    else {
        if (!wdAudioCtx) wdAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
        if (wdAudioCtx.state === 'suspended') wdAudioCtx.resume();
        wdNextNote = wdAudioCtx.currentTime + 0.05; wdStep = 0; wdIsPlaying = true;
        wdTimer = setInterval(wdSchedule, 25);
        btn.innerText = '🔇 MUSIC: ON';
        trackBtn.style.display = 'block'; trackBtn.innerText = `⏭ ${wdTrack + 1}/4`;
    }
};
window.wdNextTrack = wdNextTrack;
  const wdPanel = document.getElementById('wd-panel'), wdTerminal = document.getElementById('wd-terminal'), wdAlarmBtn = document.getElementById('wd-alarm-btn');
let wdPendingFix = null;

function wdLog(text, className) {
    const line = document.createElement('div'); line.className = `wd-log-line ${className}`;
    line.innerText = text; wdTerminal.appendChild(line); wdTerminal.scrollTop = wdTerminal.scrollHeight;
}
window.wdShow = function() { wdPanel.classList.add('active'); };
window.wdHide = function() { wdPanel.classList.remove('active'); wdStopMusic(); };

const wdTypoDict = {
    'functon':'function','fucntion':'function','funtion':'function','functin':'function',
    'reutrn':'return','retrun':'return','retun':'return','retrn':'return',
    'consle':'console','cosnt':'const','conts':'const','cnost':'const',
    'lte':'let','va r':'var','tru e':'true','flase':'false','fales':'false',
    'asycn':'async','asnyc':'async','awiat':'await','awit':'await',
    'proimse':'Promise','promsie':'Promise','promis':'Promise',
    'Objet':'Object','Arrat':'Array','Strng':'String','Numbr':'Number','Boolen':'Boolean',
    'addEvenetListener':'addEventListener','addeventlistener':'addEventListener',
    'getElementByID':'getElementById','getelementbyid':'getElementById',
    'querrySelector':'querySelector','querryselector':'querySelector',
    'innerHtml':'innerHTML','innerhtml':'innerHTML','classname':'className',
    'documnt':'document','documnet':'document','windo':'window','widow':'window',
    'localstorage':'localStorage','LocalStorage':'localStorage',
    'settimeout':'setTimeout','setinterval':'setInterval',
    'lenght':'length','lengt':'length','slce':'slice','splce':'splice','filtr':'filter',
    'reverese':'reverse','toUppercase':'toUpperCase','toLowercase':'toLowerCase',
    'registerLayr':'registerLayer','registerlayer':'registerLayer','applyautofix':'applyAutoFix'
};

function wdLexer(code) {
    let lines = code.split('\n');
    let inString = false, stringChar = '', inComment = false, inBlockComment = false;
    let braces = 0, parens = 0, brackets = 0, braceLines = [];
    for (let l = 0; l < lines.length; l++) {
        for (let i = 0; i < lines[l].length; i++) {
            const c = lines[l][i], next = lines[l][i+1];
            if (inComment) { if (c === '\n') inComment = false; continue; }
            if (inBlockComment) { if (c === '*' && next === '/') { inBlockComment = false; i++; } continue; }
            if (c === '/' && next === '/') { inComment = true; i++; continue; }
            if (c === '/' && next === '*') { inBlockComment = true; i++; continue; }
            if (inString) { if (c === '\\') { i++; continue; } if (c === stringChar) inString = false; continue; }
            if (c === '"' || c === "'" || c === '`') { inString = true; stringChar = c; continue; }
            if (c === '{') { braces++; braceLines.push(l + 1); }
            if (c === '}') { braces--; if (braceLines.length > 0) braceLines.pop(); }
            if (c === '(') parens++; if (c === ')') parens--;
            if (c === '[') brackets++; if (c === ']') brackets--;
        }
        inComment = false;
    }
    return { inString, stringChar, inBlockComment, braces, parens, brackets, braceLines };
}
      async function wdRunScan() {
        try {
            wdLog("> ЗАПУСК АНАЛИЗА...", "wd-log-system");
            const res = await fetch('https://early-amoeba-1705.alexey17001700.deno.net', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ scanRepo: true })
            });
            const data = await res.json();
            if (!data.success) throw new Error(data.error || "Ошибка сканирования");

            let code = null;
            try { const f = await fetch('local_ai.js?t='+Date.now()); if(f.ok) code = await f.text(); } catch(e){}

            let fixes = [];
            if (code) {
                const lexer = wdLexer(code);
                if (lexer.inString) { code += lexer.stringChar; fixes.push(`Добавлена кавычка ${lexer.stringChar}`); }
                if (lexer.inBlockComment) { code += " */"; fixes.push(`Добавлен конец комментария */`); }
                if (lexer.braces > 0) { code += "\n" + "}".repeat(lexer.braces); fixes.push(`Добавлено ${lexer.braces} скобок } (стр. ${lexer.braceLines.join(',')})`); }
                if (lexer.parens > 0) { code += ")".repeat(lexer.parens); fixes.push(`Добавлено ${lexer.parens} скобок )`); }
                if (lexer.brackets > 0) { code += "]".repeat(lexer.brackets); fixes.push(`Добавлено ${lexer.brackets} скобок ]`); }

                for (const [bad, good] of Object.entries(wdTypoDict)) {
                    if (bad === good) continue;
                    const regex = new RegExp(`\\b${bad}\\b`, 'g');
                    if (regex.test(code)) { code = code.replace(regex, good); fixes.push(`Опечатка: "${bad}" -> "${good}"`); }
                }
            }

            if (fixes.length > 0) {
                wdTerminal.innerHTML = ''; fixes.forEach(f => wdLog(`> ${f}`, "wd-log-info"));
                wdPendingFix = { path: 'local_ai.js', content: code }; wdAlarmBtn.style.display = 'block';
                wdLog("> ФИКС ГОТОВ. ЖДУ КОМАНДЫ...", "wd-log-system");
            } else {
                wdLog("> ВСЁ ЧИСТО. ОШИБОК НЕТ.", "wd-log-info");
                wdAlarmBtn.style.display = 'none';
            }
        } catch (e) { wdLog("> СБОЙ: " + e.message, "wd-log-error"); }
    }

    window.wdApplyPatch = async function() {
        if (!wdPendingFix) return;
        wdLog("> ОТПРАВКА ПАТЧА...", "wd-log-info");
        try {
            const res = await fetch("https://early-amoeba-1705.alexey17001700.deno.net", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ updateFile: true, path: wdPendingFix.path, content: wdPendingFix.content, message: "Auto-fix via Watchdog" })
            });
            const data = await res.json();
            if (data.success) { 
                wdLog("> УСПЕХ. ПЕРЕЗАГРУЗКА...", "wd-log-info"); 
                wdStopMusic(); 
                setTimeout(() => location.reload(), 2000); 
            } else {
                wdLog("> ОШИБКА: " + data.error, "wd-log-error");
            }
        } catch (e) { wdLog("> ОШИБКА СЕТИ", "wd-log-error"); }
    };
    
    setTimeout(wdRunScan, 3000);
})();
