<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>WATCHDOG // Терминал</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Fira+Code:wght@400;700&display=swap');
*{box-sizing:border-box}
body{margin:0;padding:0;height:100vh;background:#000;font-family:'Fira Code',monospace;overflow:hidden;display:flex;justify-content:center;align-items:center}
#matrix-bg{position:fixed;top:0;left:0;width:100%;height:100%;z-index:0;pointer-events:none;opacity:0.4}
#wd-panel{position:relative;width:90%;max-width:500px;background:rgba(0,10,0,0.95);border:2px solid #00ff41;border-radius:8px;box-shadow:0 0 40px rgba(0,255,65,0.6),inset 0 0 30px rgba(0,255,65,0.1);z-index:10;overflow:hidden;display:flex;flex-direction:column;animation:borderPulse 2s infinite alternate}
@keyframes borderPulse{from{box-shadow:0 0 20px rgba(0,255,65,0.4),inset 0 0 15px rgba(0,255,65,0.1)}to{box-shadow:0 0 50px rgba(0,255,65,1),inset 0 0 30px rgba(0,255,65,0.3)}}
.wd-header{display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border-bottom:1px dashed #00ff41;background:rgba(0,255,65,0.08)}
.wd-title-area{display:flex;align-items:center;gap:15px}
.wd-title{color:#00ff41;font-weight:700;font-size:16px;text-shadow:0 0 10px #00ff41}
.cyber-alarm{width:40px;height:40px;background:radial-gradient(circle at 30% 30%,#ffaaaa,#ff0000 40%,#660000 90%);border-radius:50%;position:relative;box-shadow:0 0 15px #ff0000,0 0 30px #ff0000,inset 0 0 10px #fff;border:2px solid #440000;animation:alarmPulse 1s infinite alternate}
.cyber-alarm::before{content:'';position:absolute;top:-6px;left:-6px;right:-6px;bottom:-6px;border-radius:50%;border:2px dashed rgba(255,0,0,0.5);animation:spin 4s linear infinite}
.cyber-alarm::after{content:'';position:absolute;top:15%;left:20%;width:30%;height:20%;background:rgba(255,255,255,0.8);border-radius:50%;transform:rotate(-45deg)}
@keyframes alarmPulse{0%{transform:scale(0.9);box-shadow:0 0 10px #ff0000,0 0 20px #ff0000}100%{transform:scale(1.1);box-shadow:0 0 40px #ff0000,0 0 80px #ff0000}}
@keyframes spin{100%{transform:rotate(360deg)}}
.wd-terminal{background:#000;padding:16px;height:350px;overflow-y:auto;font-size:13px;line-height:1.5;background-image:repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(0,255,65,0.04) 2px,rgba(0,255,65,0.04) 4px)}
.wd-terminal::-webkit-scrollbar{width:8px}.wd-terminal::-webkit-scrollbar-track{background:#000}.wd-terminal::-webkit-scrollbar-thumb{background:#00ff41}
.log-line{margin-bottom:6px;word-wrap:break-word}.log-err{color:#ff3333;text-shadow:0 0 5px #ff3333}.log-ok{color:#00ff41}.log-sys{color:#888}
.cursor::after{content:"_";animation:blink 1s step-end infinite;color:#00ff41;font-weight:bold}
@keyframes blink{50%{opacity:0}}
.wd-actions{padding:14px;display:flex;gap:10px;border-top:1px dashed #00ff41;flex-wrap:wrap}
.wd-btn{flex:1;min-width:100px;padding:12px;border:1px solid #00ff41;background:transparent;color:#00ff41;font-weight:700;font-size:13px;cursor:pointer;text-transform:uppercase;transition:all 0.2s;letter-spacing:1px;font-family:inherit}
.wd-btn:hover{background:#00ff41;color:#000;box-shadow:0 0 20px #00ff41}
.wd-btn-music{border-color:#00ffff;color:#00ffff}.wd-btn-music:hover{background:#00ffff;color:#000;box-shadow:0 0 20px #00ffff}
</style>
</head>
<body>
<canvas id="matrix-bg"></canvas>
<div id="wd-panel">
<div class="wd-header">
<div class="wd-title-area"><div class="cyber-alarm"></div><div class="wd-title">WATCHDOG // СКАНЕР</div></div>
</div>
<div class="wd-terminal" id="terminal"></div>
<div class="wd-actions">
<button class="wd-btn" id="fix-btn" onclick="applyPatch()">Патч</button>
<button class="wd-btn" id="scan-btn" onclick="runScan()">Скан</button>
<button class="wd-btn wd-btn-music" id="music-btn" onclick="toggleMusic()">♪ МУЗЫКА</button>
</div>
</div>
<script>
  // МАТРИЦА
const canvas = document.getElementById('matrix-bg');
const ctx = canvas.getContext('2d');
canvas.width = window.innerWidth; canvas.height = window.innerHeight;
const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789アカサタナハマヤラワイキシチニヒミリ';
const fontSize = 16;
const columns = Math.floor(canvas.width / fontSize);
const drops = [];
for (let i = 0; i < columns; i++) drops[i] = Math.random() * canvas.height / fontSize;
setInterval(() => {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.06)'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#00ff41'; ctx.font = fontSize + 'px monospace';
    for (let i = 0; i < drops.length; i++) {
        const text = chars[Math.floor(Math.random() * chars.length)];
        ctx.fillText(text, i * fontSize, drops[i] * fontSize);
        if (drops[i] * fontSize > canvas.height && Math.random() > 0.975) drops[i] = 0;
        drops[i]++;
    }
}, 50);

// МУЗЫКА
let audioCtx = null, isMusicPlaying = false, timer = null, nextNoteTime = 0, stepIndex = 0, trackIndex = 0;
const notes = { 'A1':55.00,'C2':65.41,'D2':73.42,'E2':82.41,'F2':87.31,'G2':98.00,'A2':110.00,'B2':123.47,'C3':130.81,'D3':146.83,'E3':164.81,'F3':174.61,'G3':196.00,'G#3':207.65,'A3':220.00,'B3':246.94,'C4':261.63,'D4':293.66,'E4':329.63,'F4':349.23,'G4':392.00,'G#4':415.30,'A4':440.00,'B4':493.88,'C5':523.25,'D5':587.33,'E5':659.25,'F5':698.46,'G5':783.99,'A5':880.00,'E6':1318.51,'D6':1174.66,'C6':1046.50,'B5':987.77,'Bb5':932.33,'Bb2':116.54,'Bb3':233.08,'G#5':830.61,'Bb4':466.16 };
const t1M = ['A4',null,'E5',null,'A5',null,'G5','E5','F5',null,'E5',null,'D5',null,'C5',null,'D5',null,'A4',null,'D5',null,'F5','A5','G5',null,'F5',null,'E5',null,'D5',null,'C5',null,'G4',null,'C5',null,'E5','G5','A5',null,'G5',null,'E5',null,'C5',null,'D5',null,'E5',null,'F5',null,'G5',null,'A5',null,null,null,null,null,null,null,'A4','C5','E5','A5','G5','E5','C5','E5','F5','A5','C6','A5','G5','E5','C5','A4','G4','B4','D5','G5','F5','D5','B4','D5','E5','G5','B5','G5','F5','D5','B4','G4','A4','C5','E5','A5','G5','E5','C5','E5','F5','A5','C6','A5','G5','E5','C5','A4','E5',null,'G5',null,'A5',null,'B5',null,'C6',null,null,null,null,null,null,null];
const t1B = ['A2','A2',null,'A3','A2','A2',null,'A3','F2','F2',null,'F3','F2','F2',null,'F3','D2','D2',null,'D3','D2','D2',null,'D3','G2','G2',null,'G3','G2','G2',null,'G3','C3','C3',null,'C4','C3','C3',null,'C4','A2','A2',null,'A3','A2','A2',null,'A3','F2','F2',null,'F3','G2','G2',null,'G3','A2','A2',null,'A3','A2',null,null,null,'A2','A2',null,'A3','A2','A2',null,'A3','F2','F2',null,'F3','F2','F2',null,'F3','G2','G2',null,'G3','G2','G2',null,'G3','E2','E2',null,'E3','E2','E2',null,'E3','A2','A2',null,'A3','A2','A2',null,'A3','F2','F2',null,'F3','F2','F2',null,'F3','E2','E2',null,'E3','E2','E2',null,'E3','A2',null,null,null,null,null,null,null];
const t2M = ['D5',null,'D5','F5','A5',null,'G5','F5','E5',null,'D5',null,'C5','D5',null,null,'Bb4',null,'Bb4','D5','F5',null,'E5','D5','C5',null,'Bb4',null,'A4','Bb4',null,null,'C5',null,'C5','E5','G5',null,'F5','E5','D5',null,'C5',null,'Bb4','C5',null,null,'A4',null,'C5','E5','A5',null,'G5','E5','C5',null,'A4',null,'E4','A4',null,null,'D5','F5','A5','D6',null,'C6','A5','F5','D5','F5','A5','D6','C6','A5','F5','D5','Bb4','D5','F5','Bb5',null,'A5','F5','D5','Bb4','D5','F5','Bb5','A5','F5','D5','Bb4','C5','E5','G5','C6',null,'B5','G5','E5','C5','E5','G5','C6','B5','G5','E5','C5','A4','C5','E5','A5','G5','E5','C5','A4','E4','A4','C5','E5','A5','G5','E5','C5'];
const t2B = ['D2','D2','D3','D2','D2','D2','D3','D2','D2','D2','D3','D2','D2','D2','D3','D2','Bb2','Bb2','Bb3','Bb2','Bb2','Bb2','Bb3','Bb2','Bb2','Bb2','Bb3','Bb2','Bb2','Bb2','Bb3','Bb2','C3','C3','C4','C3','C3','C3','C4','C3','C3','C3','C4','C3','C3','C3','C4','C3','A2','A2','A3','A2','A2','A2','A3','A2','A2','A2','A3','A2','A2','A2','A3','A2','D2','D2','D3','D2','D2','D2','D3','D2','D2','D2','D3','D2','D2','D2','D3','D2','Bb2','Bb2','Bb3','Bb2','Bb2','Bb2','Bb3','Bb2','Bb2','Bb2','Bb3','Bb2','Bb2','Bb2','Bb3','Bb2','C3','C3','C4','C3','C3','C3','C4','C3','C3','C3','C4','C3','C3','C3','C4','C3','A2','A2','A3','A2','A2','A2','A3','A2','A2','A2','A3','A2','A2','A2','A3','A2'];
const sadM = ['E5',null,null,null,'D5',null,'C5',null,'B4',null,null,null,'A4',null,null,null,'A4',null,null,null,'B4',null,'C5',null,'E5',null,null,null,null,null,null,null,'F5',null,null,null,'E5',null,'D5',null,'C5',null,null,null,'A4',null,null,null,'C5',null,null,null,'B4',null,'A4',null,'G4',null,null,null,null,null,null,null,'G4',null,null,null,'C5',null,'E5',null,'G5',null,null,null,'F5',null,null,null,'E5',null,null,null,'D5',null,'C5',null,'B4',null,null,null,null,null,null,null,'D5',null,null,null,'F5',null,'A5',null,'G5',null,null,null,'F5',null,null,null,'E5',null,null,null,'D5',null,'C5',null,'D5',null,null,null,null,null,null,null,'E5',null,null,null,'G#4',null,'B4',null,'E5',null,null,null,'D5',null,null,null,'C5',null,null,null,'B4',null,'A4',null,'G#4',null,null,null,null,null,null,null,'A4',null,null,null,'C5',null,'E5',null,'A5',null,null,null,'G5',null,null,null,'F5',null,null,null,'E5',null,'D5',null,'C5',null,null,null,null,null,null,null,'F4',null,null,null,'A4',null,'C5',null,'F5',null,null,null,'E5',null,null,null,'D5',null,null,null,'C5',null,'B4',null,'A4',null,null,null,null,null,null,null,'G#4',null,null,null,'B4',null,'E5',null,'G#5',null,null,null,'B5',null,null,null,'A5',null,null,null,'G#5',null,'E5',null,'B4',null,null,null,null,null,null,null];
const sadB = ['A2',null,null,null,null,null,null,null,'A2',null,null,null,null,null,null,null,'A2',null,null,null,null,null,null,null,'A2',null,null,null,'E2',null,null,null,'F2',null,null,null,null,null,null,null,'F2',null,null,null,null,null,null,null,'C3',null,null,null,null,null,null,null,'C3',null,null,null,null,null,null,null,'G2',null,null,null,null,null,null,null,'G2',null,null,null,null,null,null,null,'C3',null,null,null,null,null,null,null,'C3',null,null,null,null,null,null,null,'D2',null,null,null,null,null,null,null,'D2',null,null,null,null,null,null,null,'E2',null,null,null,null,null,null,null,'E2',null,null,null,null,null,null,null,'E2',null,null,null,null,null,null,null,'E2',null,null,null,null,null,null,null,'E2',null,null,null,null,null,null,null,'E2',null,null,null,'B2',null,null,null,'A2',null,null,null,null,null,null,null,'A2',null,null,null,null,null,null,null,'F2',null,null,null,null,null,null,null,'F2',null,null,null,null,null,null,null,'F2',null,null,null,null,null,null,null,'F2',null,null,null,null,null,null,null,'G2',null,null,null,null,null,null,null,'G2',null,null,null,null,null,null,null,'E2',null,null,null,null,null,null,null,'E2',null,null,null,null,null,null,null,'E2',null,null,null,null,null,null,null,'E2',null,null,null,null,null,null,null];
const tracks = [{tempo:110,melody:t1M,bass:t1B,wave:'square',bw:'triangle'},{tempo:120,melody:t2M,bass:t2B,wave:'sawtooth',bw:'square'},{tempo:130,melody:t2M,bass:t2B,wave:'square',bw:'sawtooth'},{tempo:115,melody:sadM,bass:sadB,wave:'sine',bw:'triangle'}];

function playTone(freq,dur,type,vol){if(!audioCtx||!freq)return;const o=audioCtx.createOscillator(),g=audioCtx.createGain();o.type=type;o.frequency.value=freq;g.gain.setValueAtTime(vol,audioCtx.currentTime);g.gain.exponentialRampToValueAtTime(0.001,audioCtx.currentTime+dur);o.connect(g);g.connect(audioCtx.destination);o.start();o.stop(audioCtx.currentTime+dur);}
function playKick(){if(!audioCtx)return;const o=audioCtx.createOscillator(),g=audioCtx.createGain();o.type='sine';o.frequency.setValueAtTime(150,audioCtx.currentTime);o.frequency.exponentialRampToValueAtTime(0.01,audioCtx.currentTime+0.15);g.gain.setValueAtTime(0.4,audioCtx.currentTime);g.gain.exponentialRampToValueAtTime(0.001,audioCtx.currentTime+0.15);o.connect(g);g.connect(audioCtx.destination);o.start();o.stop(audioCtx.currentTime+0.15);}
function playNoise(dur,freq,hp,vol){if(!audioCtx)return;const bs=audioCtx.sampleRate*dur,buf=audioCtx.createBuffer(1,bs,audioCtx.sampleRate),d=buf.getChannelData(0);for(let i=0;i<bs;i++)d[i]=Math.random()*2-1;const n=audioCtx.createBufferSource(),f=audioCtx.createBiquadFilter(),g=audioCtx.createGain();n.buffer=buf;f.type=hp?'highpass':'bandpass';f.frequency.value=freq;g.gain.setValueAtTime(vol,audioCtx.currentTime);g.gain.exponentialRampToValueAtTime(0.001,audioCtx.currentTime+dur);n.connect(f);f.connect(g);g.connect(audioCtx.destination);n.start();}
function schedule(){if(!audioCtx)return;const t=tracks[trackIndex],step=60/t.tempo/4;while(nextNoteTime<audioCtx.currentTime+0.1){const i=stepIndex%t.melody.length;if(t.melody[i])playTone(notes[t.melody[i]],0.1,t.wave,0.06);if(t.bass[i])playTone(notes[t.bass[i]],0.15,t.bw,0.1);if(trackIndex!==3){if(i%8===0)playKick();if(i%8===4)playNoise(0.15,1500,false,0.1);if(i%2===0)playNoise(0.03,7000,true,0.03);}nextNoteTime+=step;stepIndex++;if(stepIndex>=t.melody.length){stepIndex=0;trackIndex=(trackIndex+1)%tracks.length;}}}
function toggleMusic(){const b=document.getElementById('music-btn');if(isMusicPlaying){clearInterval(timer);isMusicPlaying=false;if(audioCtx){try{audioCtx.close();}catch(e){}audioCtx=null;}b.innerText='♪ МУЗЫКА';}else{if(!audioCtx)audioCtx=new(window.AudioContext||window.webkitAudioContext)();audioCtx.resume();nextNoteTime=audioCtx.currentTime+0.05;stepIndex=0;isMusicPlaying=true;timer=setInterval(schedule,25);b.innerText='♪ ВЫКЛ';}}
const terminal = document.getElementById('terminal');
const fixBtn = document.getElementById('fix-btn');
let pendingFix = null;

function log(text, cls) {
    const d = document.createElement('div'); d.className = `log-line ${cls}`;
    d.innerText = text; terminal.appendChild(d); terminal.scrollTop = terminal.scrollHeight;
}

const typos = {
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

function scanSecrets(code) {
    const lines = code.split('\n'), issues = [];
    const pats = [
        {re:/sk-[a-zA-Z0-9]{20,}/g, n:'OpenAI/DeepSeek Key'},
        {re:/ghp_[a-zA-Z0-9]{30,}/g, n:'GitHub Token'},
        {re:/AQVN[a-zA-Z0-9_]{30,}/g, n:'Yandex Key'}
    ];
    for(let i=0;i<lines.length;i++){pats.forEach(p=>{if(p.re.test(lines[i]))issues.push(`СТРОКА ${i+1}: УТЕЧКА ${p.n}!`);});}
    return issues;
}
function lexer(code) {
    let lines = code.split('\n');
    let inS=false, sc='', inC=false, inBC=false, br=0, pr=0, bk=0, brL=[];
    for(let l=0;l<lines.length;l++){
        for(let i=0;i<lines[l].length;i++){
            const c=lines[l][i], nx=lines[l][i+1];
            if(inC){if(c==='\n')inC=false;continue;}
            if(inBC){if(c==='*'&&nx==='/'){inBC=false;i++;}continue;}
            if(c==='/'&&nx==='/'){inC=true;i++;continue;}
            if(c==='/'&&nx==='*'){inBC=true;i++;continue;}
            if(inS){if(c==='\\'){i++;continue;}if(c===sc)inS=false;continue;}
            if(c==='"'||c==="'"||c==='`'){inS=true;sc=c;continue;}
            if(c==='{'){br++;brL.push(l+1);}
            if(c==='}'){br--;if(brL.length>0)brL.pop();}
            if(c==='(')pr++; if(c===')')pr--;
            if(c==='[')bk++; if(c===']')bk--;
        }
        inC=false;
    }
    return {inS,sc,inBC,br,pr,bk,brL};
}

async function runScan() {
    terminal.innerHTML = '';
    log("> ЗАПУСК СКАНИРОВАНИЯ...", "log-sys");
    try {
        const res = await fetch('https://early-amoeba-1705.alexey17001700.deno.net', {
            method: 'POST', headers: {'Content-Type':'application/json'},
            body: JSON.stringify({scanRepo: true})
        });
        const data = await res.json();
        if (!data.success) throw new Error(data.error || "Ошибка сканирования");
        
        let code = null;
        try { const f = await fetch('local_ai.js?t='+Date.now()); if(f.ok) code = await f.text(); } catch(e){}
        
        if (data.issues && data.issues.length > 0) {
            data.issues.forEach(issue => {
                log(`> ${issue.path}: ${issue.description}`, "log-err");
                if (issue.diff > 0) {
                    pendingFix = { path: issue.path, content: issue.content + "\n" + "}".repeat(issue.diff) + "\n" };
                    log(`> ФИКС ГОТОВ (${issue.path})`, "log-ok");
                }
            });
            fixBtn.style.display = 'block';
        } else {
            log("> ОШИБОК НЕ НАЙДЕНО.", "log-ok");
        }
        log("> ГОТОВО.", "log-sys");
    } catch(e) { log(`> ОШИБКА: ${e.message}`, "log-err"); }
}

async function applyPatch() {
    if (!pendingFix) { log("> НЕТ ФИКСА", "log-err"); return; }
    log("> ОТПРАВКА ПАТЧА...", "log-sys");
    try {
        const res = await fetch('https://early-amoeba-1705.alexey17001700.deno.net', {
            method: 'POST', headers: {'Content-Type':'application/json'},
            body: JSON.stringify({updateFile: true, path: pendingFix.path, content: pendingFix.content, message: "Auto-fix via Watchdog"})
        });
        const data = await res.json();
        if (data.success) { log("> ✅ " + data.message, "log-ok"); setTimeout(()=>location.reload(), 2000); }
        else throw new Error(data.error);
    } catch(e) { log("> ОШИБКА: " + e.message, "log-err"); }
}

runScan();
</script>
</body>
</html>
