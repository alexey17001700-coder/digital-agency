/* ============================================================================
   office3d.js — 3D-ОФИС ШТАБА (Three.js)
   ЭТАП 1: Интерьер. Изометрия, комната, мебель, атмосферный свет.
   ЭТАП 2: 3D-агенты, анимация, перемещение, клик (Raycaster).
   ЭТАП 3 (v1.5): масштабирование до 25 агентов, зонирование с стеклянными
                  перегородками, санузел с душем, логика «туалет», оптимизация
                  (InstancedMesh для столов, общие геометрии/материалы).
   ВАЖНО: office.js (2D-версия) НЕ тронут и работает как фолбэк,
          если Three.js не загрузился.
   ============================================================================ */
(function () {
'use strict';

const OFFICE3D_VERSION = 'v1.8 · build 11';

const THREE_URLS = [
    './three.module.js',
      'https://rawcdn.githack.com/mrdoob/three.js/r160/build/three.module.js',
      'https://cdn.statically.io/gh/mrdoob/three.js/r160/build/three.module.js',
      'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js',
    'https://unpkg.com/three@0.160.0/build/three.module.js',
    'https://fastly.jsdelivr.net/npm/three@0.160.0/build/three.module.js',
    'https://esm.sh/three@0.160.0',
    'https://cdnjs.cloudflare.com/ajax/libs/three.js/0.160.0/three.module.min.js',
    'https://cdn.statically.io/gh/mrdoob/three.js/r160/build/three.module.js'
];

let THREE = null;
let loadPromise = null;
let isOpen = false;
let S = null;          // активная сцена-контекст
let origToggle = null; // оригинальный 2D toggleOffice

/* ------------------------------------------------------------------ */
/*  ЗАГРУЗКА THREE.JS                                                  */
/* ------------------------------------------------------------------ */
function esc(s) {
    return String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

function withTimeout(p, ms) {
    return Promise.race([
        p,
        new Promise((_, rej) => setTimeout(() => rej(new Error('таймаут ' + ms + ' мс')), ms))
    ]);
}

/* Диагностика локального файла: статус, тип, размер, первые байты.
   Нужна, чтобы понять, ЧТО именно лежит в three.module.js. */
async function probeLocal() {
    try {
        const r = await fetch('./three.module.js', { cache: 'no-store' });
        const ct = r.headers.get('content-type') || '?';
        const len = r.headers.get('content-length') || '?';
        let head = '';
        try { head = (await r.text()).slice(0, 60).replace(/\s+/g, ' '); } catch (e) { head = '(не прочитан)'; }
        return 'HTTP ' + r.status + ' · ' + ct + ' · ' + len + ' байт · начало: "' + head + '"';
    } catch (e) {
        return 'fetch не удался: ' + ((e && e.message) || e);
    }
}

/* Загрузка Three.js. Пробуем по очереди все источники.
   Поддерживаем ДВА формата файла:
   1) ES-модуль (export class WebGLRenderer ...) — обычный three.module.js
   2) UMD/глобальная сборка (three.min.js) — модуль ничего не экспортирует,
      но создаёт window.THREE. Такой файл тоже подхватываем. */
function loadThree() {
    if (THREE) return Promise.resolve(THREE);
    if (loadPromise) return loadPromise;
    loadPromise = (async () => {
        const errs = [];
        for (const url of THREE_URLS) {
            try {
                const mod = await withTimeout(import(url), 8000);
                if (mod && mod.WebGLRenderer) { THREE = mod; return THREE; }
                const g = (typeof window !== 'undefined') ? window.THREE : null;
                if (g && g.WebGLRenderer) { THREE = g; return THREE; }
                errs.push(url + ' → загрузился, но это не Three.js (нет WebGLRenderer)');
            } catch (e) {
                const m = (e && e.message) ? e.message : String(e);
                errs.push(url + ' → ' + m);
                console.warn('[office3d] Three.js не загрузился:', url, m);
            }
        }
        loadPromise = null; // разрешаем повторную попытку при следующем открытии
        const err = new Error('Three.js недоступен');
        err.details = errs;
        throw err;
    })();
    return loadPromise;
}

/* ------------------------------------------------------------------ */
/*  ПРОЦЕДУРНЫЕ ТЕКСТУРЫ (canvas, без внешних файлов)                  */
/* ------------------------------------------------------------------ */
function cv(w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return { c, x: c.getContext('2d') };
}

function texFloor() {
    const { c, x } = cv(512, 512);
    x.fillStyle = '#1b2130'; x.fillRect(0, 0, 512, 512);
    const T = 64;
    for (let i = 0; i < 8; i++) {
        for (let j = 0; j < 8; j++) {
            const v = 26 + Math.random() * 16;
            x.fillStyle = `rgb(${v},${v + 6},${v + 16})`;
            x.fillRect(i * T + 1, j * T + 1, T - 2, T - 2);
        }
    }
    x.strokeStyle = 'rgba(90,130,180,0.35)'; x.lineWidth = 2;
    for (let i = 0; i <= 8; i++) {
        x.beginPath(); x.moveTo(i * T, 0); x.lineTo(i * T, 512); x.stroke();
        x.beginPath(); x.moveTo(0, i * T); x.lineTo(512, i * T); x.stroke();
    }
    for (let i = 0; i < 900; i++) {
        x.fillStyle = `rgba(255,255,255,${Math.random() * 0.05})`;
        x.fillRect(Math.random() * 512, Math.random() * 512, 2, 2);
    }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(8, 6);
    return t;
}

function texTile() {
    const { c, x } = cv(256, 256);
    x.fillStyle = '#dfe9f2'; x.fillRect(0, 0, 256, 256);
    const T = 32;
    for (let i = 0; i < 8; i++) {
        for (let j = 0; j < 8; j++) {
            const v = 210 + Math.random() * 30;
            x.fillStyle = `rgb(${v},${v + 4},${v + 10})`;
            x.fillRect(i * T + 1, j * T + 1, T - 2, T - 2);
        }
    }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(4, 3.5);
    return t;
}

function texWall() {
    const { c, x } = cv(256, 256);
    x.fillStyle = '#232b39'; x.fillRect(0, 0, 256, 256);
    for (let j = 0; j < 4; j++) {
        const y = j * 64;
        x.fillStyle = j % 2 ? '#28313f' : '#1f2733';
        x.fillRect(0, y + 2, 256, 60);
        x.strokeStyle = 'rgba(120,160,210,0.25)'; x.lineWidth = 2;
        x.strokeRect(0, y + 2, 256, 60);
        for (let i = 0; i < 8; i++) {
            x.fillStyle = 'rgba(200,220,255,0.18)';
            x.beginPath(); x.arc(16 + i * 32, y + 10, 2, 0, 6.3); x.fill();
            x.beginPath(); x.arc(16 + i * 32, y + 54, 2, 0, 6.3); x.fill();
        }
    }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(7, 1.6);
    return t;
}

function texScreen(accent) {
    const { c, x } = cv(256, 160);
    x.fillStyle = '#04120c'; x.fillRect(0, 0, 256, 160);
    x.fillStyle = accent; x.font = 'bold 13px monospace';
    x.fillText('> NEXUS TERMINAL', 8, 18);
    x.fillStyle = 'rgba(255,255,255,0.55)'; x.font = '10px monospace';
    const chars = '01ABCDEF<>{}[]#$%&*+=/';
    for (let i = 0; i < 12; i++) {
        let line = '> ';
        for (let k = 0; k < 22; k++) line += chars[(Math.random() * chars.length) | 0];
        x.fillText(line, 8, 34 + i * 10);
    }
    x.fillStyle = accent; x.fillRect(8, 148, 60, 4);
    return new THREE.CanvasTexture(c);
}

function texSign(text, color) {
    const { c, x } = cv(256, 96);
    x.fillStyle = '#0a0f14'; x.fillRect(0, 0, 256, 96);
    x.strokeStyle = color; x.lineWidth = 4; x.strokeRect(6, 6, 244, 84);
    x.fillStyle = color; x.font = 'bold 46px monospace';
    x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText(text, 128, 52);
    return new THREE.CanvasTexture(c);
}

function texZone(text, color) {
    const { c, x } = cv(512, 128);
    x.clearRect(0, 0, 512, 128);
    x.fillStyle = 'rgba(6,12,20,0.62)';
    x.strokeStyle = color; x.lineWidth = 5;
    x.beginPath();
    const r = 22, px = 6, py = 14, w = 500, h = 100;
    x.moveTo(px + r, py);
    x.lineTo(px + w - r, py); x.quadraticCurveTo(px + w, py, px + w, py + r);
    x.lineTo(px + w, py + h - r); x.quadraticCurveTo(px + w, py + h, px + w - r, py + h);
    x.lineTo(px + r, py + h); x.quadraticCurveTo(px, py + h, px, py + h - r);
    x.lineTo(px, py + r); x.quadraticCurveTo(px, py, px + r, py);
    x.closePath(); x.fill(); x.stroke();
    x.fillStyle = color; x.font = 'bold 54px monospace';
    x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText(text, 256, 66);
    return new THREE.CanvasTexture(c);
}

/* ------------------------------------------------------------------ */
/*  МАТЕРИАЛЫ                                                          */
/* ------------------------------------------------------------------ */
function mats() {
    return {
        metal: new THREE.MeshStandardMaterial({ color: 0x8d99ab, metalness: 0.85, roughness: 0.35 }),
        dark: new THREE.MeshStandardMaterial({ color: 0x2b3240, metalness: 0.6, roughness: 0.5 }),
        desk: new THREE.MeshStandardMaterial({ color: 0x3b4657, metalness: 0.55, roughness: 0.45 }),
        plastic: new THREE.MeshStandardMaterial({ color: 0x1a1f28, metalness: 0.2, roughness: 0.7 }),
        white: new THREE.MeshStandardMaterial({ color: 0xe8eef5, metalness: 0.15, roughness: 0.35 }),
        soft: new THREE.MeshStandardMaterial({ color: 0x39445a, metalness: 0.15, roughness: 0.85 }),
        neon: (col) => new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 2.2, metalness: 0.2, roughness: 0.4 }),
        glass: new THREE.MeshStandardMaterial({ color: 0x9fd8ff, transparent: true, opacity: 0.35, metalness: 0.1, roughness: 0.1 }),
        glassWall: new THREE.MeshStandardMaterial({
            color: 0x7fd4ff, transparent: true, opacity: 0.14,
            metalness: 0.05, roughness: 0.08, side: THREE.DoubleSide, depthWrite: false
        })
    };
}

/* ------------------------------------------------------------------ */
/*  ОБЩИЕ ГЕОМЕТРИИ (переиспользуются всеми объектами)                 */
/* ------------------------------------------------------------------ */
let GEO = null;
function geos() {
    if (GEO) return GEO;
    GEO = {
        box: new THREE.BoxGeometry(1, 1, 1),
        cyl: new THREE.CylinderGeometry(1, 1, 1, 12),
        sph: new THREE.SphereGeometry(1, 12, 10),
        plane: new THREE.PlaneGeometry(1, 1),
        chairSeat: new THREE.BoxGeometry(0.95, 0.14, 0.9),
        chairBack: new THREE.BoxGeometry(0.95, 0.85, 0.14),
        chairPole: new THREE.CylinderGeometry(0.09, 0.09, 0.55, 8),
        chairFoot: new THREE.CylinderGeometry(0.42, 0.42, 0.07, 12),
        // агент
        aTorso: new THREE.CapsuleGeometry(0.30, 0.50, 4, 10),
        aChest: new THREE.BoxGeometry(0.30, 0.20, 0.10),
        aBelt: new THREE.CylinderGeometry(0.32, 0.32, 0.10, 12),
        aHead: new THREE.SphereGeometry(0.26, 12, 10),
        aVisor: new THREE.BoxGeometry(0.30, 0.16, 0.10),
        aAnt: new THREE.CylinderGeometry(0.015, 0.015, 0.22, 6),
        aAntTip: new THREE.SphereGeometry(0.045, 8, 6),
        aArm: new THREE.CapsuleGeometry(0.095, 0.40, 4, 8),
        aHand: new THREE.SphereGeometry(0.10, 8, 6),
        aLeg: new THREE.CapsuleGeometry(0.115, 0.42, 4, 8),
        aFoot: new THREE.BoxGeometry(0.20, 0.10, 0.32)
    };
    return GEO;
}

/* ------------------------------------------------------------------ */
/*  МЕБЕЛЬ                                                             */
/* ------------------------------------------------------------------ */
function buildChair(M) {
    const G = geos();
    const g = new THREE.Group();
    const seat = new THREE.Mesh(G.chairSeat, M.plastic); seat.position.y = 0.62; g.add(seat);
    const back = new THREE.Mesh(G.chairBack, M.plastic); back.position.set(0, 1.05, 0.42); g.add(back);
    const pole = new THREE.Mesh(G.chairPole, M.metal); pole.position.y = 0.32; g.add(pole);
    const foot = new THREE.Mesh(G.chairFoot, M.metal); foot.position.y = 0.05; g.add(foot);
    return g;
}

function buildCooler(M) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.85, 1.15, 0.85), M.metal);
    body.position.y = 0.58; g.add(body);
    const bottle = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.3, 0.95, 14), M.glass);
    bottle.position.y = 1.65; g.add(bottle);
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.22, 10), M.glass);
    neck.position.y = 1.2; g.add(neck);
    const tap = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.1, 0.22), M.neon(0x00e5ff));
    tap.position.set(0, 0.95, 0.5); g.add(tap);
    return g;
}

function buildRack(M, screenTex) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.1, 2.6, 2.4), M.dark);
    body.position.y = 1.3; g.add(body);
    for (let i = 0; i < 7; i++) {
        const led = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.06), M.neon(i % 2 ? 0x00ff88 : 0x00e5ff));
        led.position.set(0.58, 0.35 + i * 0.32, -0.9); g.add(led);
    }
    const panel = new THREE.Mesh(
        new THREE.PlaneGeometry(0.9, 0.5),
        new THREE.MeshStandardMaterial({ map: screenTex, emissive: 0xffffff, emissiveMap: screenTex, emissiveIntensity: 1.2 })
    );
    panel.position.set(0.57, 2.1, 0.4); panel.rotation.y = Math.PI / 2; g.add(panel);
    return g;
}

function buildPlant(M) {
    const g = new THREE.Group();
    const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.24, 0.5, 12), M.dark);
    pot.position.y = 0.25; g.add(pot);
    const leafMat = new THREE.MeshStandardMaterial({ color: 0x2f7a4a, roughness: 0.9 });
    for (let i = 0; i < 5; i++) {
        const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.85, 6), leafMat);
        leaf.position.set(Math.cos(i * 1.3) * 0.16, 0.85, Math.sin(i * 1.3) * 0.16);
        leaf.rotation.z = Math.cos(i * 1.3) * 0.4;
        leaf.rotation.x = Math.sin(i * 1.3) * 0.4;
        g.add(leaf);
    }
    return g;
}

function buildSofa(M) {
    const g = new THREE.Group();
    const base = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.5, 1.3), M.soft);
    base.position.y = 0.35; g.add(base);
    const back = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.9, 0.35), M.soft);
    back.position.set(0, 0.95, -0.48); g.add(back);
    [-1.55, 1.55].forEach(x => {
        const arm = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.62, 1.3), M.soft);
        arm.position.set(x, 0.72, 0); g.add(arm);
    });
    for (let i = 0; i < 3; i++) {
        const cush = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.16, 1.05), M.dark);
        cush.position.set(-1.0 + i * 1.0, 0.68, 0.05); g.add(cush);
    }
    return g;
}

function buildMeetingTable(M) {
    const g = new THREE.Group();
    const top = new THREE.Mesh(new THREE.BoxGeometry(7.2, 0.18, 3.0), M.desk);
    top.position.y = 1.05; g.add(top);
    const legGeo = new THREE.BoxGeometry(0.2, 1.0, 0.2);
    [[-3.3, -1.25], [3.3, -1.25], [-3.3, 1.25], [3.3, 1.25]].forEach(p => {
        const l = new THREE.Mesh(legGeo, M.dark);
        l.position.set(p[0], 0.5, p[1]); g.add(l);
    });
    const holo = new THREE.Mesh(
        new THREE.CylinderGeometry(0.9, 0.9, 0.06, 24),
        new THREE.MeshStandardMaterial({ color: 0x00e5ff, emissive: 0x00e5ff, emissiveIntensity: 1.6, transparent: true, opacity: 0.55 })
    );
    holo.position.y = 1.18; g.add(holo);
    return g;
}

/* --- САНУЗЕЛ --- */
function buildToilet(M) {
    const g = new THREE.Group();
    const tank = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.75, 0.26), M.white);
    tank.position.set(0, 0.72, -0.32); g.add(tank);
    const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.26, 0.45, 14), M.white);
    bowl.position.set(0, 0.42, 0.06); g.add(bowl);
    const seat = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.38, 0.09, 14), M.white);
    seat.position.set(0, 0.68, 0.06); g.add(seat);
    const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.05, 14), M.soft);
    lid.position.set(0, 0.74, 0.06); lid.rotation.x = -0.35; g.add(lid);
    const btn = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.05, 10), M.neon(0x00e5ff));
    btn.position.set(0.18, 1.11, -0.32); g.add(btn);
    return g;
}

function buildSink(M) {
    const g = new THREE.Group();
    const ped = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.2, 0.85, 12), M.white);
    ped.position.y = 0.42; g.add(ped);
    const basin = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.32, 0.24, 16), M.white);
    basin.position.y = 0.95; g.add(basin);
    const tap = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.3, 8), M.metal);
    tap.position.set(0, 1.18, -0.22); g.add(tap);
    const spout = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.24, 8), M.metal);
    spout.rotation.x = Math.PI / 2; spout.position.set(0, 1.32, -0.12); g.add(spout);
    const mirror = new THREE.Mesh(new THREE.PlaneGeometry(0.85, 0.95), M.glass);
    mirror.position.set(0, 1.85, -0.36); g.add(mirror);
    return g;
}

function buildShower(M) {
    const g = new THREE.Group();
    const tray = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.14, 1.5), M.white);
    tray.position.y = 0.07; g.add(tray);
    const glassMat = new THREE.MeshStandardMaterial({
        color: 0xbfe9ff, transparent: true, opacity: 0.22, metalness: 0.05, roughness: 0.05, side: THREE.DoubleSide
    });
    const p1 = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 2.1), glassMat);
    p1.position.set(0, 1.12, 0.75); g.add(p1);
    const p2 = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 2.1), glassMat);
    p2.rotation.y = Math.PI / 2; p2.position.set(0.75, 1.12, 0); g.add(p2);
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.0, 8), M.metal);
    pipe.position.set(-0.6, 1.1, -0.6); g.add(pipe);
    const head = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.16, 0.12, 12), M.metal);
    head.position.set(-0.35, 2.05, -0.35); head.rotation.z = 0.5; g.add(head);
    const drain = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.04, 10), M.metal);
    drain.position.set(0, 0.15, 0); g.add(drain);
    return g;
}

/* ------------------------------------------------------------------ */
/*  АГЕНТЫ: 25 моделей                                                 */
/* ------------------------------------------------------------------ */
const AGENT_3D = [
    { name: 'Оркестратор',   color: 0xffd700 },
    { name: 'Хакер',         color: 0xff0055 },
    { name: 'Охранник',      color: 0x2196f3 },
    { name: 'GigaChat',      color: 0x21a038 },
    { name: 'Исследователь', color: 0x00e5ff },
    { name: 'Дизайнер',      color: 0x9c27b0 },
    { name: 'Аналитик',      color: 0xff8c00 },
    { name: 'Копирайтер',    color: 0xff69b4 },
    { name: 'Тестировщик',   color: 0x9acd32 },
    { name: 'Архивариус',    color: 0x008080 },
    { name: 'Навигатор',     color: 0x4dabf7 },
    { name: 'Инженер',       color: 0xffb300 },
    { name: 'Логист',        color: 0xff7f50 },
    { name: 'Переводчик',    color: 0x8a2be2 },
    { name: 'Бухгалтер',     color: 0x3ddc97 },
    { name: 'Маркетолог',    color: 0xff4d6d },
    { name: 'Юрист',         color: 0x5c6bc0 },
    { name: 'Сметчик',       color: 0xd2b48c },
    { name: 'Оператор',      color: 0x29b6f6 },
    { name: 'Куратор',       color: 0xe040fb },
    { name: 'Прогнозист',    color: 0x1de9b6 },
    { name: 'Связист',       color: 0x00c853 },
    { name: 'Механик',       color: 0xcd7f32 },
    { name: 'Диспетчер',     color: 0x90a4ae },
    { name: 'Стажёр',        color: 0xeceff1 }
];

const BUSY_STATES = ['busy', 'working', 'thinking', 'typing'];

/* Коридоры и точки интереса */
const CORRIDOR_X = 5.0;      // вертикальный коридор x 3..7
const CORRIDOR_Z_TOP = 6.2;  // горизонтальный коридор z 5..7
const CORRIDOR_Z_BOT = -6.0; // горизонтальный коридор z -7..-5
const BATH_DOOR = { x: 25.7, z: 6.2 };
const BATH_IN = { x: 25.7, z: 3.4 };

function roundRect(x, px, py, w, h, r) {
    x.beginPath();
    x.moveTo(px + r, py);
    x.lineTo(px + w - r, py);
    x.quadraticCurveTo(px + w, py, px + w, py + r);
    x.lineTo(px + w, py + h - r);
    x.quadraticCurveTo(px + w, py + h, px + w - r, py + h);
    x.lineTo(px + r, py + h);
    x.quadraticCurveTo(px, py + h, px, py + h - r);
    x.lineTo(px, py + r);
    x.quadraticCurveTo(px, py, px + r, py);
    x.closePath();
}

function texNameTag(text, color) {
    const { c, x } = cv(256, 64);
    x.clearRect(0, 0, 256, 64);
    x.fillStyle = 'rgba(6,10,16,0.74)';
    x.strokeStyle = color; x.lineWidth = 3;
    roundRect(x, 5, 10, 246, 44, 12);
    x.fill(); x.stroke();
    x.fillStyle = color; x.font = 'bold 25px monospace';
    x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText(text, 128, 33);
    return new THREE.CanvasTexture(c);
}

/* Низкополигональная модель агента (~1.7 м). Геометрии — общие. */
function createAgentModel(color) {
    const G = geos();
    const g = new THREE.Group();

    const accent = new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.45);
    const suit = new THREE.MeshStandardMaterial({ color: color, metalness: 0.35, roughness: 0.55 });
    const suitDark = new THREE.MeshStandardMaterial({ color: 0x1b2028, metalness: 0.5, roughness: 0.6 });
    const glow = new THREE.MeshStandardMaterial({ color: accent, emissive: accent, emissiveIntensity: 1.5, metalness: 0.2, roughness: 0.4 });
    const visorMat = new THREE.MeshStandardMaterial({ color: 0x0a1018, emissive: accent, emissiveIntensity: 0.45, metalness: 0.9, roughness: 0.15 });

    const torso = new THREE.Mesh(G.aTorso, suit);
    torso.position.y = 0.55; g.add(torso);

    const chest = new THREE.Mesh(G.aChest, glow);
    chest.position.set(0, 0.62, 0.28); g.add(chest);

    const belt = new THREE.Mesh(G.aBelt, suitDark);
    belt.position.y = 0.06; g.add(belt);

    const head = new THREE.Mesh(G.aHead, suit);
    head.position.y = 1.24; g.add(head);

    const visor = new THREE.Mesh(G.aVisor, visorMat);
    visor.position.set(0, 1.26, 0.22); g.add(visor);

    const ant = new THREE.Mesh(G.aAnt, suitDark);
    ant.position.set(0.14, 1.52, 0); g.add(ant);
    const antTip = new THREE.Mesh(G.aAntTip, glow);
    antTip.position.set(0.14, 1.64, 0); g.add(antTip);

    const mkArm = (side) => {
        const p = new THREE.Group();
        p.position.set(side * 0.36, 0.92, 0);
        const a = new THREE.Mesh(G.aArm, suit);
        a.position.y = -0.28; p.add(a);
        const hand = new THREE.Mesh(G.aHand, suitDark);
        hand.position.y = -0.55; p.add(hand);
        g.add(p);
        return p;
    };
    const armL = mkArm(-1), armR = mkArm(1);

    const mkLeg = (side) => {
        const p = new THREE.Group();
        p.position.set(side * 0.15, -0.04, 0);
        const l = new THREE.Mesh(G.aLeg, suit);
        l.position.y = -0.33; p.add(l);
        const foot = new THREE.Mesh(G.aFoot, suitDark);
        foot.position.set(0, -0.62, 0.06); p.add(foot);
        g.add(p);
        return p;
    };
    const legL = mkLeg(-1), legR = mkLeg(1);

    g.userData.rig = { torso, head, armL, armR, legL, legR, glow };
    return g;
}

/* ------------------------------------------------------------------ */
/*  СБОРКА СЦЕНЫ                                                       */
/* ------------------------------------------------------------------ */
const ROOM_W = 44, ROOM_D = 34, ROOM_H = 6.4;
const BATH = { x0: 22, x1: 30, z0: -2, z1: 5 };

function buildDesks(scene, M, screenMats) {
    const COLS = [-18.5, -14.1, -9.7, -5.3, -0.9];
    const ROWS = [-13.2, -9.4, -5.6, -1.8, 2.0];
    const spots = [];
    ROWS.forEach(z => COLS.forEach(x => spots.push({ x, z })));
    const N = spots.length;

    const m4 = new THREE.Matrix4();
    const parts = [
        { geo: new THREE.BoxGeometry(3.4, 0.16, 1.7), mat: M.desk, offs: [[0, 1.05, 0]] },
        { geo: new THREE.BoxGeometry(0.14, 1.0, 0.14), mat: M.dark, offs: [[-1.55, 0.5, -0.72], [1.55, 0.5, -0.72], [-1.55, 0.5, 0.72], [1.55, 0.5, 0.72]] },
        { geo: new THREE.CylinderGeometry(0.09, 0.14, 0.5, 8), mat: M.plastic, offs: [[0, 1.38, -0.45]] },
        { geo: new THREE.CylinderGeometry(0.32, 0.32, 0.06, 12), mat: M.plastic, offs: [[0, 1.16, -0.45]] },
        { geo: new THREE.BoxGeometry(1.75, 1.05, 0.1), mat: M.plastic, offs: [[0, 2.05, -0.45]] },
        { geo: new THREE.BoxGeometry(1.1, 0.06, 0.36), mat: M.plastic, offs: [[0, 1.16, 0.35]] },
        { geo: new THREE.SphereGeometry(0.09, 10, 8), mat: M.plastic, offs: [[0.85, 1.18, 0.35]], scale: [1, 0.6, 1.4] },
        { geo: new THREE.CylinderGeometry(0.11, 0.09, 0.22, 10), mat: M.metal, offs: [[-1.3, 1.24, 0.3]] },
        { geo: geos().chairSeat, mat: M.plastic, offs: [[0, 0.62, 1.35]] },
        { geo: geos().chairBack, mat: M.plastic, offs: [[0, 1.05, 1.77]] },
        { geo: geos().chairPole, mat: M.metal, offs: [[0, 0.32, 1.35]] },
        { geo: geos().chairFoot, mat: M.metal, offs: [[0, 0.05, 1.35]] }
    ];

    parts.forEach(p => {
        const total = N * p.offs.length;
        const im = new THREE.InstancedMesh(p.geo, p.mat, total);
        im.frustumCulled = false;
        let k = 0;
        const sc = p.scale || [1, 1, 1];
        spots.forEach(s => p.offs.forEach(o => {
            m4.makeScale(sc[0], sc[1], sc[2]);
            m4.setPosition(s.x + o[0], o[1], s.z + o[2]);
            im.setMatrixAt(k++, m4);
        }));
        im.instanceMatrix.needsUpdate = true;
        scene.add(im);
    });

    // экраны — отдельные меши (нужна индивидуальная пульсация), но 3 общих материала
    const screens = [];
    const screenGeo = new THREE.PlaneGeometry(1.6, 0.9);
    spots.forEach((s, i) => {
        const m = new THREE.Mesh(screenGeo, screenMats[i % 3]);
        m.position.set(s.x, 2.05, s.z - 0.39);
        scene.add(m);
        screens.push(m);
    });

    return { spots, screens };
}

function glassWall(scene, M, x1, z1, x2, z2, h) {
    const dx = x2 - x1, dz = z2 - z1;
    const len = Math.hypot(dx, dz);
    if (len < 0.05) return;
    const rot = Math.atan2(-dz, dx);
    const g = new THREE.BoxGeometry(len, h, 0.08);
    const m = new THREE.Mesh(g, M.glassWall);
    m.position.set((x1 + x2) / 2, h / 2, (z1 + z2) / 2);
    m.rotation.y = rot;
    scene.add(m);
    const r = new THREE.Mesh(new THREE.BoxGeometry(len, 0.09, 0.16), M.metal);
    r.position.set((x1 + x2) / 2, h + 0.045, (z1 + z2) / 2);
    r.rotation.y = rot;
    scene.add(r);
}

function buildZones(scene, M) {
    const H = 1.8;
    // Опенспейс — правая граница x=3 с проходами
    glassWall(scene, M, 3, -17, 3, -6.5, H);
    glassWall(scene, M, 3, -4.5, 3, 4.5, H);
    glassWall(scene, M, 3, 6.5, 3, 17, H);
    // Серверная
    glassWall(scene, M, 7, -17, 7, -12, H);
    glassWall(scene, M, 7, -10, 7, -7, H);
    glassWall(scene, M, 7, -7, 9, -7, H);
    glassWall(scene, M, 11, -7, 22, -7, H);
    // Переговорная
    glassWall(scene, M, 7, -5, 9, -5, H);
    glassWall(scene, M, 11, -5, 22, -5, H);
    glassWall(scene, M, 7, -5, 7, -1, H);
    glassWall(scene, M, 7, 1, 7, 5, H);
    glassWall(scene, M, 7, 5, 9, 5, H);
    glassWall(scene, M, 11, 5, 22, 5, H);
    // Приемная
    glassWall(scene, M, 7, 7, 9, 7, H);
    glassWall(scene, M, 11, 7, 22, 7, H);
    glassWall(scene, M, 7, 7, 7, 11, H);
    glassWall(scene, M, 7, 13, 7, 17, H);
    // Санузел (низкие прозрачные стены)
    glassWall(scene, M, BATH.x0, BATH.z0, BATH.x0, BATH.z1, H);
    glassWall(scene, M, BATH.x0, BATH.z0, BATH.x1, BATH.z0, H);
    glassWall(scene, M, BATH.x1, BATH.z0, BATH.x1, BATH.z1, H);
    glassWall(scene, M, BATH.x0, BATH.z1, 24.8, BATH.z1, H);
    glassWall(scene, M, 26.6, BATH.z1, BATH.x1, BATH.z1, H);

    // Таблички зон
    const zones = [
        { t: 'ОПЕНСПЕЙС',   c: '#00e5ff', x: -10, z: 0 },
        { t: 'СЕРВЕРНАЯ',   c: '#00ff88', x: 14,  z: -12 },
        { t: 'ПЕРЕГОВОРНАЯ', c: '#ffd700', x: 14, z: 0 },
        { t: 'ПРИЕМНАЯ',    c: '#ff69b4', x: 14,  z: 12 },
        { t: 'САНУЗЕЛ',     c: '#9fd8ff', x: 26,  z: 1.5 }
    ];
    zones.forEach(z => {
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({
            map: texZone(z.t, z.c), transparent: true, depthWrite: false
        }));
        sp.scale.set(5.2, 1.3, 1);
        sp.position.set(z.x, 3.7, z.z);
        scene.add(sp);
    });
}

function buildBathroom(scene, M) {
    const w = BATH.x1 - BATH.x0, d = BATH.z1 - BATH.z0;
    const floor = new THREE.Mesh(
        new THREE.PlaneGeometry(w, d),
        new THREE.MeshStandardMaterial({ map: texTile(), metalness: 0.15, roughness: 0.5 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set((BATH.x0 + BATH.x1) / 2, 0.01, (BATH.z0 + BATH.z1) / 2);
    scene.add(floor);

    // «апрон» перед дверью санузла — агент идёт по полу, а не по пустоте
    const apron = new THREE.Mesh(
        new THREE.PlaneGeometry(w, 2.8),
        new THREE.MeshStandardMaterial({ map: texFloor(), metalness: 0.45, roughness: 0.55 })
    );
    apron.rotation.x = -Math.PI / 2;
    apron.position.set((BATH.x0 + BATH.x1) / 2, 0.005, BATH.z1 + 1.4);
    scene.add(apron);

    const toilet = buildToilet(M); toilet.position.set(23.6, 0, 1.0); toilet.rotation.y = Math.PI / 2; scene.add(toilet);
    const sink = buildSink(M); sink.position.set(28.6, 0, 0.2); sink.rotation.y = -Math.PI / 2; scene.add(sink);
    const shower = buildShower(M); shower.position.set(27.4, 0, 3.2); scene.add(shower);

    // дверь
    const doorG = new THREE.Group();
    const frame = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.4, 0.16), M.metal);
    frame.position.y = 1.2; doorG.add(frame);
    const leaf = new THREE.Mesh(new THREE.BoxGeometry(2.0, 2.15, 0.1), M.dark);
    leaf.position.set(0, 1.08, 0.1); doorG.add(leaf);
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.4, 8), M.metal);
    handle.rotation.z = Math.PI / 2; handle.position.set(0.75, 1.1, 0.2); doorG.add(handle);
    const sign = new THREE.Mesh(
        new THREE.PlaneGeometry(1.1, 0.42),
        new THREE.MeshStandardMaterial({ map: texSign('WC', '#9fd8ff'), emissive: 0xffffff, emissiveMap: texSign('WC', '#9fd8ff'), emissiveIntensity: 1.4 })
    );
    sign.position.set(0, 2.75, 0.14); doorG.add(sign);
    doorG.position.set(BATH_DOOR.x, 0, BATH.z1);
    scene.add(doorG);

    // светящаяся полоса над входом
    const strip = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.08, 0.08), M.neon(0x9fd8ff));
    strip.position.set(BATH_DOOR.x, 2.5, BATH.z1 + 0.12);
    scene.add(strip);
}

function buildScene() {
    const M = mats();
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x070a10);
    scene.fog = new THREE.Fog(0x070a10, 90, 200);

    // ПОЛ
    const floor = new THREE.Mesh(
        new THREE.PlaneGeometry(ROOM_W, ROOM_D),
        new THREE.MeshStandardMaterial({ map: texFloor(), metalness: 0.45, roughness: 0.55 })
    );
    floor.rotation.x = -Math.PI / 2;
    scene.add(floor);

    // СТЕНЫ (задняя + левая — открытый вид для изометрии)
    const wallMat = new THREE.MeshStandardMaterial({ map: texWall(), metalness: 0.35, roughness: 0.7 });
    const back = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_W, ROOM_H), wallMat);
    back.position.set(0, ROOM_H / 2, -ROOM_D / 2);
    scene.add(back);

    const left = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_D, ROOM_H), wallMat);
    left.position.set(-ROOM_W / 2, ROOM_H / 2, 0);
    left.rotation.y = Math.PI / 2;
    scene.add(left);

    // плинтус-подсветка
    const stripMat = M.neon(0x00b8d4);
    const stripB = new THREE.Mesh(new THREE.BoxGeometry(ROOM_W, 0.1, 0.1), stripMat);
    stripB.position.set(0, 0.12, -ROOM_D / 2 + 0.06); scene.add(stripB);
    const stripL = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, ROOM_D), stripMat);
    stripL.position.set(-ROOM_W / 2 + 0.06, 0.12, 0); scene.add(stripL);

    // потолочные балки + светильники
    const lampMat = M.neon(0xdff3ff);
    scene.userData.lamps = [];
    for (let i = 0; i < 6; i++) {
        const beam = new THREE.Mesh(new THREE.BoxGeometry(ROOM_W, 0.22, 0.3), M.dark);
        beam.position.set(0, ROOM_H - 0.2, -14 + i * 5.6);
        scene.add(beam);
        const lamp = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.12, 0.6), lampMat);
        lamp.position.set(0, ROOM_H - 0.36, -14 + i * 5.6);
        scene.add(lamp);
        lamp.userData.pulse = Math.random() * 6;
        scene.userData.lamps.push(lamp);
    }

    // СТОЛЫ + МОНИТОРЫ (InstancedMesh)
    const screenMats = [
        new THREE.MeshStandardMaterial({ map: texScreen('#00ff9d'), emissive: 0xffffff, emissiveMap: texScreen('#00ff9d'), emissiveIntensity: 1.5, metalness: 0, roughness: 1 }),
        new THREE.MeshStandardMaterial({ map: texScreen('#00e5ff'), emissive: 0xffffff, emissiveMap: texScreen('#00e5ff'), emissiveIntensity: 1.5, metalness: 0, roughness: 1 }),
        new THREE.MeshStandardMaterial({ map: texScreen('#ffd700'), emissive: 0xffffff, emissiveMap: texScreen('#ffd700'), emissiveIntensity: 1.5, metalness: 0, roughness: 1 })
    ];
    const { spots, screens } = buildDesks(scene, M, screenMats);

    // ЗОНЫ + ПЕРЕГОРОДКИ
    buildZones(scene, M);

    // СЕРВЕРНАЯ
    [[9.5, -15.6], [11.4, -15.6], [13.3, -15.6], [15.2, -15.6]].forEach(p => {
        const r = buildRack(M, screenMats[1]);
        r.position.set(p[0], 0, p[1]);
        scene.add(r);
    });

    // ПЕРЕГОВОРНАЯ
    const mt = buildMeetingTable(M);
    mt.position.set(14, 0, 0);
    scene.add(mt);
    [[10.6, -1.6], [12.6, -1.6], [14.6, -1.6], [16.6, -1.6], [10.6, 1.6], [12.6, 1.6], [14.6, 1.6], [16.6, 1.6]].forEach((p, i) => {
        const c = buildChair(M);
        c.position.set(p[0], 0, p[1]);
        c.rotation.y = i < 4 ? 0 : Math.PI;
        scene.add(c);
    });

    // ПРИЕМНАЯ
    const sofa = buildSofa(M);
    sofa.position.set(15.5, 0, 15.4);
    scene.add(sofa);
    const cooler = buildCooler(M);
    cooler.position.set(9.6, 0, 12.6);
    scene.add(cooler);
    const ctable = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.12, 0.9), M.desk);
    ctable.position.set(15.5, 0.5, 12.4);
    scene.add(ctable);
    [[9.4, 15.6], [20.6, 15.6], [20.6, 8.4]].forEach(p => {
        const pl = buildPlant(M);
        pl.position.set(p[0], 0, p[1]);
        scene.add(pl);
    });

    // САНУЗЕЛ
    buildBathroom(scene, M);

    // ДВЕРЬ «ВЫХОД» (в серверной, на задней стене)
    const doorG = new THREE.Group();
    const frame = new THREE.Mesh(new THREE.BoxGeometry(2.6, 4.2, 0.25), M.metal);
    frame.position.y = 2.1; doorG.add(frame);
    const leaf = new THREE.Mesh(new THREE.BoxGeometry(2.2, 3.8, 0.14), M.dark);
    leaf.position.set(0, 2.0, 0.14); doorG.add(leaf);
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.5, 8), M.metal);
    handle.rotation.z = Math.PI / 2; handle.position.set(0.85, 2.0, 0.24); doorG.add(handle);
    const exitTex = texSign('ВЫХОД', '#00ff88');
    const sign = new THREE.Mesh(
        new THREE.PlaneGeometry(1.5, 0.56),
        new THREE.MeshStandardMaterial({ map: exitTex, emissive: 0xffffff, emissiveMap: exitTex, emissiveIntensity: 1.6 })
    );
    sign.position.set(0, 4.6, 0.16); doorG.add(sign);
    doorG.position.set(18.5, 0, -ROOM_D / 2 + 0.2);
    scene.add(doorG);

    // АГЕНТЫ (25)
    const { agents, groups } = buildAgents(scene, spots);

    // СВЕТ: ровно 2 источника (без теней — экономия FPS)
    scene.add(new THREE.AmbientLight(0x8fa8c8, 1.15));
    const dir = new THREE.DirectionalLight(0xffffff, 1.7);
    dir.position.set(9, 15, 8);
    scene.add(dir);

    return { scene, spots, screens, agents, groups };
}

function buildAgents(scene, spots) {
    const agents = [];
    const groups = [];

    AGENT_3D.forEach((def, i) => {
        const desk = spots[i];
        if (!desk) return;

        const model = createAgentModel(def.color);
        const home = new THREE.Vector3(desk.x, 0, desk.z + 1.35);
        model.position.set(home.x, 0.66, home.z);
        model.rotation.y = Math.PI;
        model.traverse(o => { o.userData.agentName = def.name; });

        const tag = new THREE.Sprite(new THREE.SpriteMaterial({
            map: texNameTag(def.name, '#' + def.color.toString(16).padStart(6, '0')),
            transparent: true, depthTest: false, depthWrite: false
        }));
        tag.scale.set(1.9, 0.48, 1);
        tag.position.y = 2.0;
        model.add(tag);

        scene.add(model);
        groups.push(model);

        agents.push({
            name: def.name, model, rig: model.userData.rig, tag,
            home, homeYaw: Math.PI,
            state: 'sit', working: false, highlight: false,
            path: null, pi: 0, onDone: null,
            breakTimer: 12 + Math.random() * 25,
            toiletTimer: 45 + Math.random() * 75,
            waitTimer: 0,
            phase: Math.random() * 6.283
        });
    });

    return { agents, groups };
}

/* ------------------------------------------------------------------ */
/*  ПОВЕДЕНИЕ АГЕНТОВ                                                  */
/* ------------------------------------------------------------------ */
function poseSit(a) {
    a.model.position.y = 0.66;
    a.rig.legL.rotation.x = -1.45;
    a.rig.legR.rotation.x = -1.45;
}

function poseStand(a) {
    a.model.position.y = 0.68;
    a.rig.legL.rotation.x = 0;
    a.rig.legR.rotation.x = 0;
}

function goTo(a, path, onDone) {
    a.path = path;
    a.pi = 0;
    a.onDone = onDone || null;
    a.state = 'walk';
}

function goHome(a) {
    const p = a.model.position;
    if (Math.hypot(p.x - a.home.x, p.z - a.home.z) < 0.8) {
        a.state = 'sit';
        a.model.rotation.y = a.homeYaw;
        poseSit(a);
        return;
    }
    goTo(a, routeBack(p.x, p.z, a.home.x, a.home.z), () => {
        a.state = 'sit';
        a.model.rotation.y = a.homeYaw;
        poseSit(a);
    });
}

/* --- МАРШРУТИЗАЦИЯ ПО КОРИДОРАМ --------------------------------------
   Агенты ходят только по коридорам, а в комнаты заходят через проходы
   в стеклянных перегородках (единственные «двери»). Сквозь стены — нельзя.
   Возвращает [узел в коридоре, узел внутри комнаты]. */
function roomPath(destX, destZ) {
    if (destX > 22) return [{ x: 25.7, z: CORRIDOR_Z_TOP }, { x: 25.7, z: 4.0 }];  // санузел
    if (destZ > 7)  return [{ x: 10, z: CORRIDOR_Z_TOP }, { x: 10, z: 8.5 }];     // приемная
    if (destZ < -7) return [{ x: 10, z: CORRIDOR_Z_BOT }, { x: 10, z: -8.5 }];    // серверная
    if (destZ > 5)  return [{ x: 10, z: CORRIDOR_Z_TOP }, { x: 10, z: 5.8 }];     // переговорная ↑
    if (destZ < -5) return [{ x: 10, z: CORRIDOR_Z_BOT }, { x: 10, z: -5.8 }];    // переговорная ↓
    return [{ x: destX, z: destZ }, null];
}

/* Ближайший проход в стене опенспейса (x=3) */
function exitGapZ(z) {
    return Math.abs(z - CORRIDOR_Z_TOP) < Math.abs(z - CORRIDOR_Z_BOT) ? CORRIDOR_Z_TOP : CORRIDOR_Z_BOT;
}

/* Из опенспейса к цели */
function routeOut(homeZ, destX, destZ) {
    const exitZ = exitGapZ(homeZ);
    const [corr, inside] = roomPath(destX, destZ);
    const path = [
        new THREE.Vector3(2.2, 0, homeZ + 1.0),       // выйти в проход за креслами
        new THREE.Vector3(2.2, 0, exitZ),             // к проходу в стене x=3
        new THREE.Vector3(CORRIDOR_X, 0, exitZ)       // вертикальный коридор
    ];
    if (Math.abs(corr.z - exitZ) > 0.4) path.push(new THREE.Vector3(CORRIDOR_X, 0, corr.z));
    path.push(new THREE.Vector3(corr.x, 0, corr.z));
    if (inside) path.push(new THREE.Vector3(inside.x, 0, inside.z));
    path.push(new THREE.Vector3(destX, 0, destZ));
    return path;
}

/* Из цели обратно в опенспейс */
function routeBack(destX, destZ, homeX, homeZ) {
    const exitZ = exitGapZ(homeZ);
    const [corr] = roomPath(destX, destZ);
    const path = [
        new THREE.Vector3(corr.x, 0, corr.z),
        new THREE.Vector3(CORRIDOR_X, 0, corr.z)
    ];
    if (Math.abs(exitZ - corr.z) > 0.4) path.push(new THREE.Vector3(CORRIDOR_X, 0, exitZ));
    path.push(new THREE.Vector3(2.2, 0, exitZ));
    path.push(new THREE.Vector3(2.2, 0, homeZ + 1.0));
    path.push(new THREE.Vector3(homeX, 0, homeZ));
    return path;
}

const BREAK_SPOTS = [
    { x: 9.6, z: 11.4 },   // кулер (приемная)
    { x: 10.4, z: -13.6 }, // серверная стойка
    { x: 18.5, z: -15.4 }  // дверь «ВЫХОД»
];

let toiletCount = 0;
let toiletTimer = 60 + Math.random() * 60;

function agentBreak(a, dt) {
    if (a.state !== 'sit' || a.working) return;
    a.breakTimer -= dt;
    if (a.breakTimer > 0) return;
    a.breakTimer = 25 + Math.random() * 20;
    const s = BREAK_SPOTS[(Math.random() * BREAK_SPOTS.length) | 0];
    goTo(a, routeOut(a.model.position.z, s.x, s.z), () => {
        a.state = 'idle';
        a.waitTimer = 5;
    });
}

/* Раз в 1-2 минуты ОДИН случайный агент идёт в санузел.
   Внутри одновременно не больше двух (BATH_MAX). */
function sendToToilet(a) {
    if (a.state !== 'sit' || a.working) return false;
    toiletCount++;
    goTo(a, routeOut(a.model.position.z, BATH_IN.x, BATH_IN.z), () => {
        a.state = 'hidden';
        a.model.visible = false;
        a.waitTimer = 5 + Math.random() * 5;
    });
    return true;
}

function agentTick(a, dt, t) {
    const rig = a.rig;

    if (a.state === 'walk' && a.path) {
        const to = a.path[a.pi];
        const dx = to.x - a.model.position.x;
        const dz = to.z - a.model.position.z;
        const d = Math.hypot(dx, dz);

        if (d < 0.16) {
            a.pi++;
            if (a.pi >= a.path.length) {
                const cb = a.onDone;
                a.onDone = null;
                a.path = null;
                if (cb) cb();
                else goHome(a);
            }
        } else {
            const step = Math.min(2.0 * dt, d);
            a.model.position.x += (dx / d) * step;
            a.model.position.z += (dz / d) * step;
            a.model.rotation.y = Math.atan2(dx, dz);

            const s = Math.sin(t * 9 + a.phase);
            rig.legL.rotation.x = s * 0.55;
            rig.legR.rotation.x = -s * 0.55;
            rig.armL.rotation.x = -s * 0.45;
            rig.armR.rotation.x = s * 0.45;
            a.model.position.y = 0.68 + Math.abs(s) * 0.05;
            rig.torso.rotation.x = 0.06;
        }
    } else if (a.state === 'sit') {
        poseSit(a);
        rig.torso.rotation.x = 0.12 + Math.sin(t * 2.2 + a.phase) * 0.03;
        rig.armL.rotation.x = -0.95 + Math.sin(t * 7 + a.phase) * 0.10;
        rig.armR.rotation.x = -0.95 + Math.sin(t * 7 + a.phase + 1.6) * 0.10;
        rig.head.rotation.y = Math.sin(t * 0.7 + a.phase) * 0.25;
    } else if (a.state === 'hidden') {
        a.waitTimer -= dt;
        if (a.waitTimer <= 0) {
            a.model.visible = true;
            toiletCount = Math.max(0, toiletCount - 1);
            goTo(a, routeBack(BATH_IN.x, BATH_IN.z, a.home.x, a.home.z), () => {
                a.state = 'sit';
                a.model.rotation.y = a.homeYaw;
                poseSit(a);
            });
        }
    } else {
        poseStand(a);
        const s = Math.sin(t * 1.8 + a.phase);
        rig.torso.rotation.x = s * 0.04;
        rig.armL.rotation.x = s * 0.10;
        rig.armR.rotation.x = -s * 0.10;
        rig.head.rotation.y = Math.sin(t * 0.9 + a.phase) * 0.35;
        a.waitTimer -= dt;
        if (a.waitTimer <= 0) goHome(a);
    }

    const pulse = 1.3 + Math.sin(t * 2.5 + a.phase) * 0.35;
    rig.glow.emissiveIntensity = a.highlight ? pulse + 1.8 : pulse;
}

/* Тап по агенту → карточка. Драг камеры не считается тапом. */
function setupPick(renderer, cam, groups, onPick) {
    const ray = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const el = renderer.domElement;
    let x0 = 0, y0 = 0, t0 = 0, moved = false;

    const onDown = (e) => { x0 = e.clientX; y0 = e.clientY; t0 = performance.now(); moved = false; };
    const onMove = (e) => { if (Math.hypot(e.clientX - x0, e.clientY - y0) > 9) moved = true; };
    const onUp = (e) => {
        if (moved || performance.now() - t0 > 700) return;
        const r = el.getBoundingClientRect();
        ndc.x = ((e.clientX - r.left) / r.width) * 2 - 1;
        ndc.y = -((e.clientY - r.top) / r.height) * 2 + 1;
        ray.setFromCamera(ndc, cam);
        const hits = ray.intersectObjects(groups, true);
        onPick(hits.length ? (hits[0].object.userData.agentName || null) : null);
    };

    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);

    return () => {
        el.removeEventListener('pointerdown', onDown);
        el.removeEventListener('pointermove', onMove);
        el.removeEventListener('pointerup', onUp);
    };
}

/* ------------------------------------------------------------------ */
/*  КАМЕРА + УПРАВЛЕНИЕ (изометрия, drag / pinch / wheel)              */
/* ------------------------------------------------------------------ */
const CAM_HOME = { yaw: Math.PI * 0.25, pitch: 0.62, dist: 64, tx: 5, ty: 1.6, tz: 0.5 };

function makeCamera(container) {
    const w = Math.max(container.clientWidth, 1);
    const h = Math.max(container.clientHeight, 1);
    const cam = new THREE.PerspectiveCamera(42, w / h, 0.1, 400);
    const st = Object.assign({}, CAM_HOME);
    applyCam(cam, st);
    return { cam, st };
}

function applyCam(cam, st) {
    const cp = Math.cos(st.pitch);
    cam.position.set(
        st.tx + Math.sin(st.yaw) * cp * st.dist,
        st.ty + Math.sin(st.pitch) * st.dist,
        st.tz + Math.cos(st.yaw) * cp * st.dist
    );
    cam.lookAt(st.tx, st.ty, st.tz);
}

function bindControls(el, cam, st) {
    const pts = new Map();
    let pinch = 0;

    const onDown = (e) => {
        el.setPointerCapture && el.setPointerCapture(e.pointerId);
        pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (pts.size === 2) pinch = pinchDist();
    };
    const onMove = (e) => {
        const p = pts.get(e.pointerId);
        if (!p) return;
        const dx = e.clientX - p.x, dy = e.clientY - p.y;
        p.x = e.clientX; p.y = e.clientY;

        if (pts.size >= 2) {
            const d = pinchDist();
            if (pinch > 0 && d > 0) st.dist = clamp(st.dist * (pinch / d), 24, 130);
            pinch = d;
        } else {
            st.yaw -= dx * 0.006;
            st.pitch = clamp(st.pitch + dy * 0.005, 0.2, 1.28);
        }
        applyCam(cam, st);
    };
    const onUp = (e) => { pts.delete(e.pointerId); if (pts.size < 2) pinch = 0; };
    const onWheel = (e) => {
        e.preventDefault();
        st.dist = clamp(st.dist * (1 + e.deltaY * 0.0012), 24, 130);
        applyCam(cam, st);
    };
    function pinchDist() {
        const a = [...pts.values()];
        return Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y);
    }

    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    el.addEventListener('pointerleave', onUp);
    el.addEventListener('wheel', onWheel, { passive: false });

    return () => {
        el.removeEventListener('pointerdown', onDown);
        el.removeEventListener('pointermove', onMove);
        el.removeEventListener('pointerup', onUp);
        el.removeEventListener('pointercancel', onUp);
        el.removeEventListener('pointerleave', onUp);
        el.removeEventListener('wheel', onWheel);
    };
}

function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

/* ------------------------------------------------------------------ */
/*  СТИЛИ (инжектируются, style.css не трогаем)                        */
/* ------------------------------------------------------------------ */
function injectStyles() {
    if (document.getElementById('office3d-style')) return;
    const s = document.createElement('style');
    s.id = 'office3d-style';
    s.textContent = `
    #office-container canvas { display:block; width:100%; height:100%; touch-action:none; }
    .o3d-hud { position:absolute; top:10px; left:12px; z-index:5; pointer-events:none;
        font-family:monospace; color:#00e5ff; text-shadow:0 0 8px rgba(0,229,255,.6); }
    .o3d-hud .t { font-size:14px; font-weight:bold; letter-spacing:1px; }
    .o3d-hud .v { font-size:11px; color:#7fd8ff; opacity:.85; margin-top:2px; }
    .o3d-hint { position:absolute; bottom:14px; left:50%; transform:translateX(-50%); z-index:5;
        background:rgba(10,14,20,.72); border:1px solid rgba(0,229,255,.35); border-radius:20px;
        padding:7px 16px; font:12px monospace; color:#bfefff; pointer-events:none;
        transition:opacity .8s ease; }
    .o3d-hint.hide { opacity:0; }
    .o3d-reset { position:absolute; top:10px; right:12px; z-index:6; cursor:pointer;
        background:rgba(10,14,20,.8); border:1px solid rgba(0,229,255,.5); color:#00e5ff;
        border-radius:10px; padding:8px 12px; font:12px monospace; }
    .o3d-reset:active { background:rgba(0,229,255,.2); }
    .o3d-load { position:absolute; inset:0; display:flex; align-items:center; justify-content:center;
        font:14px monospace; color:#00e5ff; background:#070a10; z-index:4; }
    /* карточка агента должна быть поверх 3D-канваса */
    #agentModal.modal-overlay { z-index: 9999; }
    `;
    document.head.appendChild(s);
}

/* ------------------------------------------------------------------ */
/*  ОТКРЫТИЕ / ЗАКРЫТИЕ                                                */
/* ------------------------------------------------------------------ */
function showOffice() {
    injectStyles();
    const chat = document.getElementById('chatContainer');
    const office = document.getElementById('office-container');
    const btn = document.getElementById('btnOffice');
    if (!office) return;

    if (chat) chat.style.display = 'none';
    office.style.display = 'block';
    if (btn) btn.classList.add('active');

    if (!S) {
        office.innerHTML = '<div class="o3d-load">ЗАГРУЗКА 3D-ОФИСА…</div>';
        loadThree().then(() => {
            if (!isOpen) return;
            startScene(office);
        }).catch(() => {
            console.warn('[office3d] Three.js недоступен — фолбэк на 2D-офис');
            isOpen = false;
            office.innerHTML = '';
            if (origToggle) origToggle();
            const b = document.createElement('div');
            b.style.cssText = 'position:fixed;top:8px;left:50%;transform:translateX(-50%);z-index:99999;' +
                'background:#3a2a00;color:#ffd700;border:1px solid #ffd700;border-radius:8px;' +
                'padding:8px 14px;font:12px monospace;max-width:92vw;text-align:center;';
            b.textContent = '⚠️ 3D-офис: Three.js не загрузился (нет доступа к CDN). Показан 2D-офис.';
            document.body.appendChild(b);
            setTimeout(() => b.remove(), 7000);
        });
    }
}

function startScene(office) {
    office.innerHTML = '';

    const hud = document.createElement('div');
    hud.className = 'o3d-hud';
    hud.innerHTML = '<div class="t">🏢 ОФИС · 3D РЕЖИМ</div><div class="v">' + OFFICE3D_VERSION + '</div><div class="v" id="o3d-selected"></div>';
    office.appendChild(hud);

    const hint = document.createElement('div');
    hint.className = 'o3d-hint';
    hint.textContent = 'Тапни агента — карточка · Потяни — поворот · Щипок — зум';
    office.appendChild(hint);
    setTimeout(() => hint.classList.add('hide'), 6000);

    const reset = document.createElement('button');
    reset.className = 'o3d-reset';
    reset.textContent = '⟲ Сброс вида';
    office.appendChild(reset);

    const renderer = new THREE.WebGLRenderer({ antialias: (window.devicePixelRatio || 1) < 2, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.setSize(office.clientWidth, office.clientHeight);
    if ('outputColorSpace' in renderer && THREE.SRGBColorSpace) renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = false;
    office.appendChild(renderer.domElement);

    const { scene, screens, agents, groups } = buildScene();
    const { cam, st } = makeCamera(office);
    const unbind = bindControls(renderer.domElement, cam, st);

    // КОЛЬЦО ВЫДЕЛЕНИЯ АГЕНТА
    const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.52, 0.78, 28),
        new THREE.MeshBasicMaterial({
            color: 0x00e5ff, transparent: true, opacity: 0.75,
            side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false
        })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.03;
    ring.visible = false;
    scene.add(ring);

    const agentByName = {};
    agents.forEach(a => { agentByName[a.name] = a; });
    let selectedName = null;

    const selectAgent = (name) => {
        selectedName = name;
        agents.forEach(a => { a.highlight = (a.name === name); });
        if (name && agentByName[name]) {
            const m = agentByName[name].model;
            ring.position.set(m.position.x, 0.03, m.position.z);
            ring.visible = true;
            if (typeof window.showAgentInfo === 'function') window.showAgentInfo(name);
        } else {
            ring.visible = false;
        }
        const info = document.getElementById('o3d-selected');
        if (info) info.textContent = name ? ('👤 ' + name) : '';
    };

    const unbindPick = setupPick(renderer, cam, groups, selectAgent);

    // СИНХРОНИЗАЦИЯ С СИСТЕМОЙ (статусы из ui.js → 3D-агенты)
    const prevUpdate = window.updateAgentInOffice;
    window.updateAgentInOffice = function (name, status) {
        if (typeof prevUpdate === 'function') prevUpdate(name, status);
        const a = agentByName[name];
        if (!a) return;
        const busy = BUSY_STATES.includes(status);
        a.working = busy;
        if (busy && a.state !== 'walk' && a.state !== 'hidden') {
            goHome(a);
        }
    };

    reset.onclick = () => {
        Object.assign(st, CAM_HOME);
        applyCam(cam, st);
    };

    const onResize = () => {
        if (!office.clientWidth || !office.clientHeight) return;
        cam.aspect = office.clientWidth / office.clientHeight;
        cam.updateProjectionMatrix();
        renderer.setSize(office.clientWidth, office.clientHeight);
    };
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);

    const clock = new THREE.Clock();
    let raf = 0;
    let elapsed = 0;

    const tick = () => {
        raf = requestAnimationFrame(tick);
        const dt = Math.min(clock.getDelta(), 0.05);
        elapsed += dt;
        const t = elapsed;

        // лёгкое «дыхание» светильников и мерцание экранов — бесплатно для GPU
        const lamps = scene.userData.lamps || [];
        for (let i = 0; i < lamps.length; i++) {
            lamps[i].material.emissiveIntensity = 2.0 + Math.sin(t * 1.4 + lamps[i].userData.pulse) * 0.35;
        }
        for (let i = 0; i < screens.length; i++) {
            screens[i].material.emissiveIntensity = 1.35 + Math.sin(t * 3 + i) * 0.18;
        }

        // АГЕНТЫ: анимация + перемещение + потребности
        toiletTimer -= dt;
        if (toiletTimer <= 0) {
            toiletTimer = 60 + Math.random() * 60;
            if (toiletCount < 2) {
                const free = [];
                for (let i = 0; i < agents.length; i++) {
                    const a = agents[i];
                    if (a.state === 'sit' && !a.working) free.push(a);
                }
                if (free.length) sendToToilet(free[(Math.random() * free.length) | 0]);
            }
        }

        for (let i = 0; i < agents.length; i++) {
            const a = agents[i];
            agentBreak(a, dt);
            agentTick(a, dt, t);
        }

        // кольцо выделения следует за агентом
        if (ring.visible && selectedName) {
            const a = agentByName[selectedName];
            if (a) { ring.position.x = a.model.position.x; ring.position.z = a.model.position.z; }
        }

        renderer.render(scene, cam);
    };
    tick();

    S = { renderer, scene, cam, st, raf, unbind, unbindPick, prevUpdate, onResize, office };
}

function hideOffice() {
    const chat = document.getElementById('chatContainer');
    const office = document.getElementById('office-container');
    const btn = document.getElementById('btnOffice');

    if (S) {
        cancelAnimationFrame(S.raf);
        S.unbind();
        if (S.unbindPick) S.unbindPick();
        if (S.prevUpdate !== undefined) window.updateAgentInOffice = S.prevUpdate;
        window.removeEventListener('resize', S.onResize);
        window.removeEventListener('orientationchange', S.onResize);
        S.scene.traverse(o => {
            // у Sprite геометрия общая для всех — её трогать нельзя
            if (o.isSprite) {
                if (o.material) {
                    if (o.material.map) o.material.map.dispose();
                    o.material.dispose();
                }
                return;
            }
            if (o.geometry) o.geometry.dispose();
            if (o.material) {
                const list = Array.isArray(o.material) ? o.material : [o.material];
                list.forEach(m => { if (m.map) m.map.dispose(); if (m.emissiveMap) m.emissiveMap.dispose(); m.dispose(); });
            }
        });
        S.renderer.dispose();
        S = null;
    }
    GEO = null;
    toiletCount = 0;
    toiletTimer = 60 + Math.random() * 60;
    if (office) { office.innerHTML = ''; office.style.display = 'none'; }
    if (chat) chat.style.display = 'flex';
    if (btn) btn.classList.remove('active');
}

/* ------------------------------------------------------------------ */
/*  ПЕРЕХВАТ КНОПКИ «ОФИС»                                             */
/* ------------------------------------------------------------------ */
function install() {
    // Скрипты грузятся ПАРАЛЛЕЛЬНО — порядок не гарантирован.
    // 1) Ждём, пока office.js определит toggleOffice.
    // 2) Держим перехват: если кто-то (ui.js и т.п.) переопределит toggleOffice
    //    позже — оборачиваем заново.
    let tries = 0;
    const hook = () => {
        if (typeof window.toggleOffice === 'function' && !window.toggleOffice.__o3d) {
            origToggle = window.toggleOffice;
            const fn = function () {
                isOpen = !isOpen;
                if (isOpen) showOffice(); else hideOffice();
            };
            fn.__o3d = true;
            window.toggleOffice = fn;
        }
        if (tries++ < 120) setTimeout(hook, 500);
        else console.warn('[office3d] toggleOffice не найден — 3D-офис не подключён');
    };
    hook();

    // СТРАХОВКА: перехватываем сам клик по кнопке «🏢 Офис» в capture-фазе
    // на document — срабатывает РАНЬШЕ inline onclick и не даёт открыться 2D-офису.
    const grab = () => {
        if (!document.getElementById('btnOffice')) { setTimeout(grab, 300); return; }
        if (document.__o3dGrab) return;
        document.__o3dGrab = true;
        document.addEventListener('click', (e) => {
            const t = e.target && e.target.closest ? e.target.closest('#btnOffice') : null;
            if (!t) return;
            e.stopPropagation();
            e.preventDefault();
            isOpen = !isOpen;
            if (isOpen) showOffice(); else hideOffice();
        }, true);
    };
    grab();

    loadThree().catch(() => console.warn('[office3d] 3D недоступен, останется 2D-офис'));
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install);
else install();

window.OFFICE3D_VERSION = OFFICE3D_VERSION;
})();
