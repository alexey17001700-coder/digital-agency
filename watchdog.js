(function () {
"use strict";

var wd_TARGET_FILE = "local_ai.js";
var wd_DENO_URL = "https://early-amoeba-1705.alexey17001700.deno.net";
var wd_state = { code: "", analysis: null, secrets: [], modal: null };

function wd_lineOf(code, index) {
    var line = 1;
    for (var i = 0; i < index && i < code.length; i++) if (code.charCodeAt(i) === 10) line++;
    return line;
}
function wd_colOf(code, index) {
    var last = code.lastIndexOf("\n", index - 1);
    return index - last;
}

function wd_maskCode(code) {
    var out = code.split(""); var i = 0, n = code.length; var state = "code";
    function blank(from, to) { for (var k = from; k < to; k++) if (out[k] !== "\n") out[k] = " "; }
    while (i < n) {
        var c = code[i], c2 = code[i + 1];
        if (state === "code") {
            if (c === "/" && c2 === "/") { state = "line_comment"; i += 2; continue; }
            if (c === "/" && c2 === "*") { state = "block_comment"; i += 2; continue; }
            if (c === "'") { state = "sq"; i++; continue; }
            if (c === '"') { state = "dq"; i++; continue; }
            if (c === "`") { state = "bt"; i++; continue; }
            i++; continue;
        }
        if (state === "line_comment") { if (c === "\n") state = "code"; else out[i] = " "; i++; continue; }
        if (state === "block_comment") { if (c === "*" && c2 === "/") { out[i] = " "; out[i+1] = " "; i += 2; state = "code"; continue; } if (c !== "\n") out[i] = " "; i++; continue; }
        var quote = state === "sq" ? "'" : state === "dq" ? '"' : "`";
        if (c === "\\") { out[i] = " "; if (i + 1 < n && out[i+1] !== "\n") out[i+1] = " "; i += 2; continue; }
        if (c === quote) { state = "code"; i++; continue; }
        if (c !== "\n") out[i] = " ";
        i++;
    }
    return { masked: out.join(""), endedIn: state };
}
    function wdSmartAnalyzer(code) {
    var errors = [];
    var maskInfo = wd_maskCode(code);
    var masked = maskInfo.masked;
    if (maskInfo.endedIn !== "code") {
        var l = { sq: "Незакрытая строка ('...')", dq: 'Незакрытая строка ("...")', bt: "Незакрытый шаблонный литерал (`...`)", line_comment: "Незакрытый однострочный комментарий", block_comment: "Незакрытый блочный комментарий (/* ... */)" };
        errors.push({ type: "unterminated", message: l[maskInfo.endedIn] || "Незакрытая конструкция", line: wd_lineOf(code, code.length), col: 1, fixable: false });
    }
    var pairs = { "}": "{", ")": "(", "]": "[" };
    var stack = [];
    for (var i = 0; i < masked.length; i++) {
        var ch = masked[i];
        if (ch === "{" || ch === "(" || ch === "[") { stack.push({ char: ch, line: wd_lineOf(code, i), col: wd_colOf(code, i), index: i }); }
        else if (ch === "}" || ch === ")" || ch === "]") {
            var openChar = pairs[ch], found = -1;
            for (var s = stack.length - 1; s >= 0; s--) { if (stack[s].char === openChar) { found = s; break; } }
            if (found === -1) { errors.push({ type: "extra", message: "Лишняя закрывающая скобка '" + ch + "'", line: wd_lineOf(code, i), col: wd_colOf(code, i), char: ch, index: i, fixable: true }); }
            else { stack.splice(found, 1); }
        }
    }
    for (var j = 0; j < stack.length; j++) {
        var op = stack[j];
        var closer = op.char === "{" ? "}" : op.char === "(" ? ")" : "]";
        errors.push({ type: "unclosed", message: "Незакрытая скобка '" + op.char + "' → нужна '" + closer + "'", line: op.line, col: op.col, char: op.char, closer: closer, index: op.index, fixable: true });
    }
    errors.sort(function (a, b) { return a.line - b.line || a.col - b.col; });
    return { errors: errors, stack: stack };
}

function wdScanSecrets(code) {
    var patterns = [
        { name: "OpenAI", re: /sk-[A-Za-z0-9_\-]{16,}/g },
        { name: "GitHub (ghp)", re: /ghp_[A-Za-z0-9]{20,}/g },
        { name: "GitHub (fine)", re: /github_pat_[A-Za-z0-9_]{30,}/g },
        { name: "HuggingFace", re: /hf_[A-Za-z0-9]{20,}/g },
        { name: "Yandex", re: /AQVN[A-Za-z0-9_\-]{12,}/g },
        { name: "AWS", re: /AKIA[0-9A-Z]{16}/g },
        { name: "Google API", re: /AIza[0-9A-Za-z_\-]{30,}/g }
    ];
    var found = [];
    patterns.forEach(function (p) {
        var m;
        while ((m = p.re.exec(code)) !== null) {
            found.push({ type: "secret", name: p.name, match: m[0].slice(0, 8) + "…" + m[0].slice(-4), line: wd_lineOf(code, m.index), fixable: false });
        }
    });
    return found;
}

var wdTypoDict = {
    functon: "function", fucntion: "function", funcion: "function", funtion: "function",
    reutrn: "return", retrun: "return", retrn: "return",
    cosnt: "const", cnost: "const", lte: "let", varr: "var", avr: "var",
    flase: "false", fasle: "false", fales: "false", ture: "true", treu: "true",
    nulll: "null", undefind: "undefined",
    getElementByID: "getElementById", querrySelector: "querySelector", querySelctor: "querySelector",
    lenght: "length", lenth: "length", forEch: "forEach", docment: "document",
    wundow: "window", windown: "window", consle: "console",
    addEventListner: "addEventListener", removeEventListner: "removeEventListener",
    parseint: "parseInt", strngify: "JSON.stringify",
    awit: "await", asnyc: "async", Promsie: "Promise",
    innerhtml: "innerHTML", classname: "className",
    appendchild: "appendChild", createElemnt: "createElement",
    textContnet: "textContent", preevntDefault: "preventDefault",
    locallStorage: "localStorage", thsi: "this"
};

function wdApplyTypos(code) {
    var result = code, changes = 0;
    Object.keys(wdTypoDict).forEach(function (bad) {
        var re = new RegExp("\\b" + bad + "\\b", "g");
        result = result.replace(re, function () { changes++; return wdTypoDict[bad]; });
    });
    return { code: result, changes: changes };
}
    function wdFixCode(code, analysis, specificError) {
    var fixedCode = code, applied = 0;
    var extras = analysis.errors.filter(function(e){ return e.type === "extra" && e.fixable && (!specificError || e === specificError); });
    extras.sort(function(a,b){ return b.index - a.index; });
    for (var i = 0; i < extras.length; i++) {
        fixedCode = fixedCode.slice(0, extras[i].index) + fixedCode.slice(extras[i].index + 1);
        applied++;
    }
    var unclosed = analysis.errors.filter(function(e){ return e.type === "unclosed" && e.fixable && (!specificError || e === specificError); });
    if (unclosed.length) {
        var lines = fixedCode.split("\n"), ins = [], sc = analysis.stack.slice();
        for (var j = sc.length - 1; j >= 0; j--) {
            if (specificError && sc[j].index !== specificError.index) continue;
            var op = sc[j], cl = op.char === "{" ? "}" : op.char === "(" ? ")" : "]";
            var ol = lines[op.line - 1] || "", ind = (ol.match(/^[ \t]*/) || [""])[0];
            ins.push(ind + cl); applied++;
        }
        if (ins.length) fixedCode = lines.join("\n") + "\n" + ins.join("\n");
    }
    return { code: fixedCode, applied: applied };
}

function wdInjectCSS() {
    if (document.getElementById("wd-style")) return;
    var css = `
    @import url('https://fonts.googleapis.com/css2?family=Fira+Code:wght@400;700&display=swap');
    #wd-matrix-bg{position:fixed;top:0;left:0;width:100%;height:100%;z-index:2147483200;pointer-events:none;opacity:0.15}
    #wd-bell{position:fixed;top:100px;right:20px;z-index:2147483500;cursor:pointer;font-size:40px;animation:wd-pulse 1s infinite alternate;line-height:1}
    @keyframes wd-pulse{0%{transform:scale(0.9);opacity:0.7}100%{transform:scale(1.15);opacity:1}}
    #wd-overlay{position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:2147483600;display:flex;align-items:center;justify-content:center}
    #wd-modal{position:relative;width:92vw;height:82vh;max-width:1100px;background:#000;border:2px solid #00ff66;border-radius:10px;display:flex;flex-direction:column;overflow:hidden;font-family:'Fira Code',monospace;color:#00ff66;box-shadow:0 0 40px rgba(0,255,102,.4)}
    #wd-modal::before{content:'';position:absolute;inset:0;pointer-events:none;background:repeating-linear-gradient(0deg,rgba(0,255,102,.05) 0px,rgba(0,255,102,.05) 1px,transparent 1px,transparent 3px);z-index:5}
    .wd-header{display:flex;align-items:center;gap:12px;padding:12px 16px;border-bottom:1px dashed #00ff66;position:relative;z-index:6}
    .wd-siren{width:38px;height:38px;border-radius:50%;flex:0 0 38px;background:radial-gradient(circle at 50% 40%,#ff5a5a,#a10000 60%,#3a0000 100%);box-shadow:0 0 14px 4px rgba(255,0,0,.7);animation:wd-pulse 1s infinite;position:relative}
    .wd-siren::after{content:'';position:absolute;inset:-6px;border-radius:50%;border:2px dashed rgba(255,80,80,.7);animation:wd-spin 3s linear infinite}
    @keyframes wd-spin{to{transform:rotate(360deg)}}
    .wd-title{font-weight:700;letter-spacing:1px;font-size:15px;color:#ff6b6b}
    .wd-spacer{flex:1}
    .wd-close{background:transparent;border:1px solid #00ff66;color:#00ff66;width:32px;height:32px;border-radius:6px;cursor:pointer;font-size:16px}
    .wd-music-btn{background:transparent;border:1px solid #00ffff;color:#00ffff;padding:6px 12px;border-radius:6px;cursor:pointer;font-family:inherit;font-size:12px}
    .wd-terminal{flex:1;overflow-y:auto;padding:14px 16px;position:relative;z-index:6;font-size:13px;line-height:1.55}
    .wd-err{border:1px solid rgba(255,80,80,.5);background:rgba(255,0,0,.05);border-radius:8px;padding:10px 12px;margin-bottom:12px}
    .wd-err-head{color:#ff8b8b;font-weight:600;margin-bottom:4px}
    .wd-err-loc{color:#ffd27f;font-size:12px}
    .wd-fixbtn{margin-top:8px;background:transparent;border:1px solid #00ff66;color:#00ff66;padding:5px 12px;border-radius:6px;cursor:pointer;font-family:inherit;font-size:12px}
    .wd-ok{color:#00ff66}.wd-warn{color:#ffb000}
    .wd-footer{display:flex;gap:10px;padding:12px 16px;border-top:1px dashed #00ff66;position:relative;z-index:6}
    .wd-btn{padding:10px 18px;border-radius:8px;font-family:inherit;font-size:13px;cursor:pointer;font-weight:600}
    .wd-btn-primary{flex:1;background:#00ff66;color:#001b0c;border:1px solid #00ff66}
    .wd-btn-ghost{background:transparent;color:#9fd;border:1px solid rgba(0,255,102,.5)}
    pre.wd-snippet{background:#0a0a0a;border:1px solid #333;padding:8px;font-size:11px;color:#00ff66;overflow-x:auto;margin-top:6px;white-space:pre}
    `;
    var style = document.createElement("style");
    style.id = "wd-style"; style.textContent = css;
    document.head.appendChild(style);
}
    var wdMatrixCanvas = null, wdMatrixTimer = null;
function wdStartMatrix() {
    if (document.getElementById("wd-matrix-bg")) return;
    var canvas = document.createElement("canvas");
    canvas.id = "wd-matrix-bg"; document.body.appendChild(canvas);
    var ctx = canvas.getContext("2d");
    canvas.width = window.innerWidth; canvas.height = window.innerHeight;
    var chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789アカサタナハマヤラワ";
    var fontSize = 16, columns = Math.floor(canvas.width / fontSize), drops = [];
    for (var i = 0; i < columns; i++) drops[i] = Math.random() * canvas.height / fontSize;
    wdMatrixCanvas = canvas;
    wdMatrixTimer = setInterval(function () {
        ctx.fillStyle = "rgba(0,0,0,0.06)"; ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = "#00ff41"; ctx.font = fontSize + "px monospace";
        for (var i = 0; i < drops.length; i++) {
            ctx.fillText(chars[Math.floor(Math.random() * chars.length)], i * fontSize, drops[i] * fontSize);
            if (drops[i] * fontSize > canvas.height && Math.random() > 0.975) drops[i] = 0;
            drops[i]++;
        }
    }, 50);
}

var wdAudioCtx = null, wdIsPlaying = false, wdTimer = null, wdNextNote = 0, wdStep = 0, wdTrack = 0;
var wdNotes = { "A1":55,"C2":65.41,"D2":73.42,"E2":82.41,"F2":87.31,"G2":98,"A2":110,"B2":123.47,"C3":130.81,"D3":146.83,"E3":164.81,"F3":174.61,"G3":196,"G#3":207.65,"A3":220,"B3":246.94,"C4":261.63,"D4":293.66,"E4":329.63,"F4":349.23,"G4":392,"G#4":415.3,"A4":440,"B4":493.88,"C5":523.25,"D5":587.33,"E5":659.25,"F5":698.46,"G5":783.99,"A5":880,"E6":1318.51,"D6":1174.66,"C6":1046.5,"B5":987.77,"Bb5":932.33,"Bb2":116.54,"Bb3":233.08,"G#5":830.61,"Bb4":466.16 };

var wdT1M = ["A4",null,"E5",null,"A5",null,"G5","E5","F5",null,"E5",null,"D5",null,"C5",null,"D5",null,"A4",null,"D5",null,"F5","A5","G5",null,"F5",null,"E5",null,"D5",null,"C5",null,"G4",null,"C5",null,"E5","G5","A5",null,"G5",null,"E5",null,"C5",null,"D5",null,"E5",null,"F5",null,"G5",null,"A5",null,null,null,null,null,null,null,"A4","C5","E5","A5","G5","E5","C5","E5","F5","A5","C6","A5","G5","E5","C5","A4","G4","B4","D5","G5","F5","D5","B4","D5","E5","G5","B5","G5","F5","D5","B4","G4","A4","C5","E5","A5","G5","E5","C5","E5","F5","A5","C6","A5","G5","E5","C5","A4","E5",null,"G5",null,"A5",null,"B5",null,"C6",null,null,null,null,null,null,null];
var wdT1B = ["A2","A2",null,"A3","A2","A2",null,"A3","F2","F2",null,"F3","F2","F2",null,"F3","D2","D2",null,"D3","D2","D2",null,"D3","G2","G2",null,"G3","G2","G2",null,"G3","C3","C3",null,"C4","C3","C3",null,"C4","A2","A2",null,"A3","A2","A2",null,"A3","F2","F2",null,"F3","G2","G2",null,"G3","A2","A2",null,"A3","A2",null,null,null,"A2","A2",null,"A3","A2","A2",null,"A3","F2","F2",null,"F3","F2","F2",null,"F3","G2","G2",null,"G3","G2","G2",null,"G3","E2","E2",null,"E3","E2","E2",null,"E3","A2","A2",null,"A3","A2","A2",null,"A3","F2","F2",null,"F3","F2","F2",null,"F3","E2","E2",null,"E3","E2","E2",null,"E3","A2",null,null,null,null,null,null,null];
var wdSadM = ["E5",null,null,null,"D5",null,"C5",null,"B4",null,null,null,"A4",null,null,null,"A4",null,null,null,"B4",null,"C5",null,"E5",null,null,null,null,null,null,null,"F5",null,null,null,"E5",null,"D5",null,"C5",null,null,null,"A4",null,null,null,"C5",null,null,null,"B4",null,"A4",null,"G4",null,null,null,null,null,null,null,"G4",null,null,null,"C5",null,"E5",null,"G5",null,null,null,"F5",null,null,null,"E5",null,null,null,"D5",null,"C5",null,"B4",null,null,null,null,null,null,null,"D5",null,null,null,"F5",null,"A5",null,"G5",null,null,null,"F5",null,null,null,"E5",null,null,null,"D5",null,"C5",null,"D5",null,null,null,null,null,null,null,"E5",null,null,null,"G#4",null,"B4",null,"E5",null,null,null,"D5",null,null,null,"C5",null,null,null,"B4",null,"A4",null,"G#4",null,null,null,null,null,null,null,"A4",null,null,null,"C5",null,"E5",null,"A5",null,null,null,"G5",null,null,null,"F5",null,null,null,"E5",null,"D5",null,"C5",null,null,null,null,null,null,null];
var wdSadB = ["A2",null,null,null,null,null,null,null,"A2",null,null,null,null,null,null,null,"A2",null,null,null,null,null,null,null,"A2",null,null,null,"E2",null,null,null,"F2",null,null,null,null,null,null,null,"F2",null,null,null,null,null,null,null,"C3",null,null,null,null,null,null,null,"C3",null,null,null,null,null,null,null,"G2",null,null,null,null,null,null,null,"G2",null,null,null,null,null,null,null,"C3",null,null,null,null,null,null,null,"C3",null,null,null,null,null,null,null,"D2",null,null,null,null,null,null,null,"D2",null,null,null,null,null,null,null,"E2",null,null,null,null,null,null,null,"E2",null,null,null,null,null,null,null,"E2",null,null,null,null,null,null,null,"E2",null,null,null,null,null,null,null,"E2",null,null,null,null,null,null,null,"E2",null,null,null,"B2",null,null,null,"A2",null,null,null,null,null,null,null,"A2",null,null,null,null,null,null,null,"F2",null,null,null,null,null,null,null,"F2",null,null,null,null,null,null,null,"F2",null,null,null,null,null,null,null,"F2",null,null,null,null,null,null,null,"G2",null,null,null,null,null,null,null,"G2",null,null,null,null,null,null,null,"E2",null,null,null,null,null,null,null,"E2",null,null,null,null,null,null,null,"E2",null,null,null,null,null,null,null,"E2",null,null,null,null,null,null,null];
var wdTracks = [{tempo:110,melody:wdT1M,bass:wdT1B,wave:"square",bw:"triangle"},{tempo:120,melody:wdT1M,bass:wdT1B,wave:"sawtooth",bw:"square"},{tempo:130,melody:wdT1M,bass:wdT1B,wave:"square",bw:"sawtooth"},{tempo:115,melody:wdSadM,bass:wdSadB,wave:"sine",bw:"triangle"}];
    function wdPlayTone(freq, dur, type, vol) {
    if (!wdAudioCtx || !freq) return;
    var o = wdAudioCtx.createOscillator(), g = wdAudioCtx.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(vol, wdAudioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, wdAudioCtx.currentTime + dur);
    o.connect(g); g.connect(wdAudioCtx.destination); o.start(); o.stop(wdAudioCtx.currentTime + dur);
}
function wdPlayKick() {
    if (!wdAudioCtx) return;
    var o = wdAudioCtx.createOscillator(), g = wdAudioCtx.createGain();
    o.type = "sine"; o.frequency.setValueAtTime(150, wdAudioCtx.currentTime);
    o.frequency.exponentialRampToValueAtTime(0.01, wdAudioCtx.currentTime + 0.15);
    g.gain.setValueAtTime(0.4, wdAudioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, wdAudioCtx.currentTime + 0.15);
    o.connect(g); g.connect(wdAudioCtx.destination); o.start(); o.stop(wdAudioCtx.currentTime + 0.15);
}
function wdSchedule() {
    if (!wdAudioCtx) return;
    var t = wdTracks[wdTrack], step = 60 / t.tempo / 4;
    while (wdNextNote < wdAudioCtx.currentTime + 0.1) {
        var i = wdStep % t.melody.length;
        if (t.melody[i]) wdPlayTone(wdNotes[t.melody[i]], 0.1, t.wave, 0.06);
        if (t.bass[i]) wdPlayTone(wdNotes[t.bass[i]], 0.15, t.bw, 0.1);
        if (wdTrack !== 3) {
            if (i % 8 === 0) wdPlayKick();
        }
        wdNextNote += step; wdStep++;
        if (wdStep >= t.melody.length) { wdStep = 0; wdTrack = (wdTrack + 1) % wdTracks.length; }
    }
}
function wdToggleMusic() {
    var b = document.getElementById("wd-music-btn");
    if (wdIsPlaying) {
        clearInterval(wdTimer); wdIsPlaying = false;
        if (wdAudioCtx) { try { wdAudioCtx.close(); } catch(e){} wdAudioCtx = null; }
        if (b) b.innerText = "♪ МУЗЫКА";
    } else {
        if (!wdAudioCtx) wdAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
        wdAudioCtx.resume();
        wdNextNote = wdAudioCtx.currentTime + 0.05; wdStep = 0; wdIsPlaying = true;
        wdTimer = setInterval(wdSchedule, 25);
        if (b) b.innerText = "♪ ВЫКЛ";
    }
}
    function wdShowBell(count) {
    if (document.getElementById("wd-bell")) return;
    var bell = document.createElement("div");
    bell.id = "wd-bell"; bell.textContent = "🚨"; bell.title = "Проблем: " + count;
    bell.addEventListener("click", wdOpenModal);
    document.body.appendChild(bell);
}

function wdOpenModal() {
    if (document.getElementById("wd-overlay")) return;
    wdInjectCSS();
    wdStartMatrix();

    var overlay = document.createElement("div"); overlay.id = "wd-overlay";
    var modal = document.createElement("div"); modal.id = "wd-modal";

    var header = document.createElement("div"); header.className = "wd-header";
    header.innerHTML = '<div class="wd-siren"></div><div class="wd-title">SYS_ERR // WATCHDOG</div><div class="wd-spacer"></div><button id="wd-music-btn" class="wd-music-btn">♪ МУЗЫКА</button><button class="wd-close" style="margin-left:8px;">✕</button>';
    header.querySelector(".wd-close").addEventListener("click", wdCloseModal);
    header.querySelector("#wd-music-btn").addEventListener("click", wdToggleMusic);

    var terminal = document.createElement("div"); terminal.className = "wd-terminal"; terminal.id = "wd-terminal";
    terminal.innerHTML = '<div class="wd-warn">> Загрузка свежего кода...</div>';
    fetch(wd_TARGET_FILE + "?t=" + Date.now(), { cache: "no-store" })
        .then(function(r){ return r.text(); })
        .then(function(code){
            wd_state.code = code;
            wd_state.secrets = wdScanSecrets(code);
            wd_state.analysis = wdSmartAnalyzer(code);
            wdRenderErrors(terminal);
        })
        .catch(function(e){ terminal.innerHTML = '<div class="wd-err">Ошибка загрузки: ' + e.message + '</div>'; });

    var footer = document.createElement("div"); footer.className = "wd-footer";
    var fixAll = document.createElement("button"); fixAll.className = "wd-btn wd-btn-primary"; fixAll.textContent = "Починить всё";
    fixAll.addEventListener("click", wdFixAll);
    var ignore = document.createElement("button"); ignore.className = "wd-btn wd-btn-ghost"; ignore.textContent = "Игнорировать";
    ignore.addEventListener("click", wdCloseModal);
    footer.appendChild(fixAll); footer.appendChild(ignore);

    modal.appendChild(header); modal.appendChild(terminal); modal.appendChild(footer);
    overlay.appendChild(modal); document.body.appendChild(overlay);
    overlay.addEventListener("click", function(e){ if (e.target === overlay) wdCloseModal(); });
    wd_state.modal = overlay;
}

function wdCloseModal() {
    if (wd_state.modal && wd_state.modal.parentNode) wd_state.modal.parentNode.removeChild(wd_state.modal);
    wd_state.modal = null;
    if (wdIsPlaying) wdToggleMusic();
    if (wdMatrixTimer) { clearInterval(wdMatrixTimer); wdMatrixTimer = null; }
    var bg = document.getElementById("wd-matrix-bg");
    if (bg) bg.remove();
    wdMatrixCanvas = null;
}
    function wdRenderErrors(container) {
    container.innerHTML = "";
    var intro = document.createElement("div"); intro.className = "wd-warn"; intro.textContent = "> Анализ local_ai.js ..."; container.appendChild(intro);

    if (wd_state.secrets.length) {
        var secBox = document.createElement("div"); secBox.className = "wd-err"; secBox.style.borderColor = "#ff2d2d";
        secBox.innerHTML = '<div class="wd-err-head">⚠ УТЕЧКА КЛЮЧЕЙ — АВТОФИКС ЗАБЛОКИРОВАН</div>';
        wd_state.secrets.forEach(function(s){
            var l = document.createElement("div"); l.className = "wd-err-loc"; l.textContent = "[" + s.name + "] " + s.match + " (стр. " + s.line + ")"; secBox.appendChild(l);
        });
        container.appendChild(secBox);
    }

    var errs = wd_state.analysis.errors;
    if (!errs.length && !wd_state.secrets.length) {
        var ok = document.createElement("div"); ok.className = "wd-ok"; ok.textContent = "> Синтаксис чист. ✅"; container.appendChild(ok);
        return;
    }

    var lines = wd_state.code.split("\n");
    errs.forEach(function(err, idx){
        var box = document.createElement("div"); box.className = "wd-err";
        var head = document.createElement("div"); head.className = "wd-err-head";
        head.textContent = "#" + (idx + 1) + " " + err.message;
        box.appendChild(head);
        var loc = document.createElement("div"); loc.className = "wd-err-loc";
        loc.textContent = "строка " + err.line + ", колонка " + err.col;
        box.appendChild(loc);

        var start = Math.max(1, err.line - 2), end = Math.min(lines.length, err.line + 2);
        var snippet = "";
        for (var k = start; k <= end; k++) {
            var mark = k === err.line ? ">> " : "   ";
            snippet += mark + String(k).padStart(4, " ") + ": " + (lines[k-1] || "") + "\n";
        }
        var codeBox = document.createElement("pre"); codeBox.className = "wd-snippet"; codeBox.textContent = snippet;
        box.appendChild(codeBox);

        if (err.fixable && !wd_state.secrets.length) {
            var btn = document.createElement("button"); btn.className = "wd-fixbtn"; btn.textContent = "✅ Фикс";
            btn.addEventListener("click", function(){ wdApplySingleFix(err, btn); });
            box.appendChild(btn);
        }
        container.appendChild(box);
    });
    }

 function wdApplySingleFix(err, btn) {
    var res = wdFixCode(wd_state.code, wd_state.analysis, err);
    if (res.applied > 0) {
        wd_state.code = res.code;
        wd_state.analysis = wdSmartAnalyzer(wd_state.code);
        var term = document.getElementById("wd-terminal");
        if (term) { wdRenderErrors(term); var ok = document.createElement("div"); ok.className = "wd-ok"; ok.textContent = "> Применено: " + res.applied; term.appendChild(ok); }
        wdMaybeShowPatch();
    }
}

function wdFixAll() {
    if (wd_state.secrets.length > 0) return;
    var res = wdFixCode(wd_state.code, wd_state.analysis);
    var typoRes = wdApplyTypos(res.code);
    var fixed = typoRes.code;
    var summary = "Скобки: " + res.applied + "\nОпечатки: " + typoRes.changes;
    if (!window.confirm("ПАТЧ\n\n" + summary + "\n\nОтправить на сервер?")) return;
    wd_state.code = fixed;
    wdSendPatch(fixed);
}

function wdMaybeShowPatch() {
    var term = document.getElementById("wd-terminal");
    if (!term || document.getElementById("wd-patch-btn")) return;
    if (wd_state.analysis.errors.length !== 0 || wd_state.secrets.length !== 0) return;
    var btn = document.createElement("button"); btn.id = "wd-patch-btn"; btn.className = "wd-btn wd-btn-primary";
    btn.style.marginTop = "16px"; btn.textContent = "Отправить патч";
    btn.addEventListener("click", function(){ wdSendPatch(wd_state.code); });
    term.appendChild(btn);
}

function wdSendPatch(content) {
    var payload = { updateFile: true, path: "local_ai.js", content: content, message: "Auto-fix via Watchdog" };
    var term = document.getElementById("wd-terminal");
    if (term) { var log = document.createElement("div"); log.className = "wd-warn"; log.textContent = "> Отправка патча..."; term.appendChild(log); term.scrollTop = term.scrollHeight; }
    fetch(wd_DENO_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) })
        .then(function(r){ return r.json(); })
        .then(function(data){
            if (data && data.success === true) {
                if (term) { var ok = document.createElement("div"); ok.className = "wd-ok"; ok.textContent = "> УСПЕХ. Перезагрузка через 3 сек..."; term.appendChild(ok); term.scrollTop = term.scrollHeight; }
                setTimeout(function(){ location.reload(); }, 3000);
            } else { alert("Сервер: " + JSON.stringify(data)); }
        })
        .catch(function(e){ alert("Сеть: " + e.message); });
}

function wdInit() {
    wdInjectCSS();
    fetch(wd_TARGET_FILE + "?t=" + Date.now(), { cache: "no-store" })
        .then(function(r){ if (!r.ok) throw new Error("HTTP " + r.status); return r.text(); })
        .then(function(code){
            wd_state.code = code;
            wd_state.secrets = wdScanSecrets(code);
            wd_state.analysis = wdSmartAnalyzer(code);
            var total = wd_state.analysis.errors.length + wd_state.secrets.length;
            if (total > 0) wdShowBell(total);
        })
        .catch(function(e){ console.warn("[Watchdog] " + e.message); });
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wdInit);
else wdInit();

})();
