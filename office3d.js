/* ============================================================================
   office3d.js — 3D-ОФИС ШТАБА (Three.js)
   ЭТАП 1: Интерьер. Изометрия, комната, мебель, атмосферный свет.
   ЭТАП 2: 3D-агенты, анимация, перемещение, клик (Raycaster).
   ЭТАП 3 (v1.5): масштабирование до 25 агентов, зонирование с стеклянными
                  перегородками, санузел с душем, логика «туалет», оптимизация
                  (InstancedMesh для столов, общие геометрии/материалы).
   ЭТАП 3 (v2.2): стол Босса, агенты ходят с докладом, облачка-реплики,
                  «задача» в руках, вспышка голо-панели, внешний API
                  (window.office3dSay / window.office3dTask).
   ВАЖНО: office.js (2D-версия) НЕ тронут и работает как фолбэк,
          если Three.js не загрузился.
   ============================================================================ */
(function () {
'use strict';

const OFFICE3D_VERSION = 'v2.6 · build 18';

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
        chairPole: new THREE.CylinderGeometry(0.09, 0.09, 0.40, 8),
        chairFoot: new THREE.CylinderGeometry(0.42, 0.42, 0.07, 12),
        /* --- АГЕНТ: реалистичные пропорции (origin модели — на уровне бёдер).
           Рост ~1,70 м, ноги 0,90 м (53% роста), голова 0,23 м (7,4 головы).
           Торс — LatheGeometry по анатомическому профилю (бёдра → талия →
           грудь → плечи → основание шеи), а не цилиндр. --- */
        aTorso: new THREE.LatheGeometry([
            new THREE.Vector2(0.148, 0.000),   // бёдра
            new THREE.Vector2(0.170, 0.050),
            new THREE.Vector2(0.164, 0.120),   // талия
            new THREE.Vector2(0.178, 0.200),
            new THREE.Vector2(0.202, 0.285),   // грудь
            new THREE.Vector2(0.214, 0.360),
            new THREE.Vector2(0.206, 0.425),   // плечи
            new THREE.Vector2(0.140, 0.470),
            new THREE.Vector2(0.088, 0.500)    // основание шеи
        ], 12),
        aChest: new THREE.BoxGeometry(0.15, 0.10, 0.05),
        aBelt: new THREE.CylinderGeometry(0.172, 0.172, 0.055, 12),
        aNeck: new THREE.CylinderGeometry(0.052, 0.062, 0.09, 8),
        aHead: new THREE.SphereGeometry(0.115, 14, 12),
        aHair: new THREE.SphereGeometry(0.118, 12, 10),
        aEar: new THREE.SphereGeometry(0.028, 6, 5),
        aNose: new THREE.ConeGeometry(0.020, 0.045, 6),
        aEye: new THREE.SphereGeometry(0.014, 6, 5),
        aBrow: new THREE.BoxGeometry(0.042, 0.011, 0.011),
        aVisor: new THREE.BoxGeometry(0.20, 0.05, 0.05),
        aAnt: new THREE.CylinderGeometry(0.008, 0.008, 0.13, 5),
        aAntTip: new THREE.SphereGeometry(0.020, 6, 5),
        aPad: new THREE.SphereGeometry(0.085, 8, 6),
        aShoulder: new THREE.SphereGeometry(0.062, 8, 6),
        aUpArm: new THREE.CapsuleGeometry(0.050, 0.190, 3, 8),
        aForearm: new THREE.CapsuleGeometry(0.043, 0.200, 3, 8),
        aHand: new THREE.SphereGeometry(0.052, 8, 6),
        aThigh: new THREE.CapsuleGeometry(0.072, 0.276, 3, 8),
        aShin: new THREE.CapsuleGeometry(0.056, 0.308, 3, 8),
        aFoot: new THREE.BoxGeometry(0.105, 0.07, 0.235),
        aToe: new THREE.BoxGeometry(0.098, 0.05, 0.085)
    };
    return GEO;
}

/* Общие материалы агентов (телесный, обувь, тёмный) — создаются ОДИН раз
   на всех 25 агентов, а не по копии на каждого. */
let SHARED_M = null;
function sharedMats() {
    if (SHARED_M) return SHARED_M;
    SHARED_M = {
        skin: new THREE.MeshStandardMaterial({ color: 0xf2c49b, metalness: 0.04, roughness: 0.72 }),
        hair: new THREE.MeshStandardMaterial({ color: 0x2a1f1a, metalness: 0.05, roughness: 0.9 }),
        shoe: new THREE.MeshStandardMaterial({ color: 0x14181f, metalness: 0.35, roughness: 0.65 }),
        dark: new THREE.MeshStandardMaterial({ color: 0x1b2028, metalness: 0.5, roughness: 0.6 })
    };
    return SHARED_M;
}

/* ------------------------------------------------------------------ */
/*  МЕБЕЛЬ                                                             */
/* ------------------------------------------------------------------ */
function buildChair(M) {
    const G = geos();
    const g = new THREE.Group();
    const seat = new THREE.Mesh(G.chairSeat, M.plastic); seat.position.y = 0.46; g.add(seat);
    const back = new THREE.Mesh(G.chairBack, M.plastic); back.position.set(0, 0.90, 0.42); g.add(back);
    const pole = new THREE.Mesh(G.chairPole, M.metal); pole.position.y = 0.24; g.add(pole);
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

/* Стол Босса и точка доклада (ЭТАП 3) */
const BOSS_DESK = { x: -5.3, z: 7.0 };
const BOSS_SPOT = { x: -5.3, z: 4.6 };
const BOSS_AISLE_Z = 4.4;

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

/* Облачко-реплика над агентом (ЭТАП 3) */
function texBubble(text, color) {
    const { c, x } = cv(320, 128);
    x.clearRect(0, 0, 320, 128);
    x.fillStyle = 'rgba(6,12,20,0.9)';
    x.strokeStyle = color; x.lineWidth = 4;
    roundRect(x, 8, 8, 304, 86, 18);
    x.fill(); x.stroke();
    x.beginPath();
    x.moveTo(142, 92); x.lineTo(178, 92); x.lineTo(160, 120);
    x.closePath();
    x.fillStyle = 'rgba(6,12,20,0.9)'; x.fill();
    x.strokeStyle = color; x.lineWidth = 3; x.stroke();
    x.fillStyle = color; x.font = 'bold 22px monospace';
    x.textAlign = 'center'; x.textBaseline = 'middle';
    const words = String(text).split(' ');
    const lines = []; let cur = '';
    for (let i = 0; i < words.length; i++) {
        const test = cur ? cur + ' ' + words[i] : words[i];
        if (x.measureText(test).width > 276 && cur) { lines.push(cur); cur = words[i]; }
        else cur = test;
    }
    if (cur) lines.push(cur);
    const shown = lines.slice(0, 3);
    const y0 = 51 - (shown.length - 1) * 13;
    shown.forEach((l, i) => x.fillText(l, 160, y0 + i * 26));
    return new THREE.CanvasTexture(c);
}

/* Низкополигональная модель агента — человеческие пропорции (рост ~1.75 м).
   Плечи шире талии, есть шея, голова уменьшена, конечности длинные и тонкие.
   Геометрии и часть материалов — ОБЩИЕ (не создаются на каждого агента).
   Origin модели — на уровне бёдер (ноги уходят вниз до y ≈ −0.7). */
function createAgentModel(color) {
    const G = geos();
    const SH = sharedMats();
    const g = new THREE.Group();

    const base = new THREE.Color(color);
    const accent = base.clone().lerp(new THREE.Color(0xffffff), 0.45);
    const suit = new THREE.MeshStandardMaterial({ color: base, metalness: 0.25, roughness: 0.62 });
    const suitDark = new THREE.MeshStandardMaterial({ color: base.clone().multiplyScalar(0.5), metalness: 0.35, roughness: 0.6 });
    const glow = new THREE.MeshStandardMaterial({ color: accent, emissive: accent, emissiveIntensity: 1.5, metalness: 0.2, roughness: 0.4 });
    const visorMat = new THREE.MeshStandardMaterial({
        color: 0x0b1119, emissive: accent, emissiveIntensity: 0.45,
        metalness: 0.85, roughness: 0.12, transparent: true, opacity: 0.82
    });

    /* --- ТОРС (Group в бёдрах: наклон корпуса идёт от бёдер, а не от центра) --- */
    const torso = new THREE.Group();
    g.add(torso);

    const body = new THREE.Mesh(G.aTorso, suit);
    body.scale.set(1, 1, 0.74);          // сечение овальное — как у человека
    torso.add(body);

    const belt = new THREE.Mesh(G.aBelt, SH.dark);
    belt.position.y = 0.045; belt.scale.set(1, 1, 0.78);
    torso.add(belt);

    const chest = new THREE.Mesh(G.aChest, glow);
    chest.position.set(0, 0.32, 0.152);
    torso.add(chest);

    [-1, 1].forEach(s => {
        const pad = new THREE.Mesh(G.aPad, suitDark);
        pad.position.set(s * 0.205, 0.415, 0);
        pad.scale.set(1, 0.7, 1);
        torso.add(pad);
    });

    /* --- ШЕЯ + ГОЛОВА --- */
    const neck = new THREE.Mesh(G.aNeck, SH.skin);
    neck.position.y = 0.535;
    torso.add(neck);

    const head = new THREE.Group();
    head.position.y = 0.655;
    torso.add(head);

    const skull = new THREE.Mesh(G.aHead, SH.skin);
    skull.scale.set(0.94, 1.05, 1.0);
    head.add(skull);

    const hair = new THREE.Mesh(G.aHair, SH.hair);
    hair.position.set(0, 0.020, -0.014);
    hair.scale.set(0.98, 1.02, 1.02);
    head.add(hair);

    [-1, 1].forEach(s => {
        const ear = new THREE.Mesh(G.aEar, SH.skin);
        ear.position.set(s * 0.108, -0.004, -0.006);
        ear.scale.set(0.55, 1, 0.85);
        head.add(ear);

        const eye = new THREE.Mesh(G.aEye, SH.dark);
        eye.position.set(s * 0.042, 0.016, 0.098);
        head.add(eye);

        const brow = new THREE.Mesh(G.aBrow, SH.hair);
        brow.position.set(s * 0.044, 0.048, 0.098);
        brow.rotation.z = -s * 0.12;
        head.add(brow);
    });

    const nose = new THREE.Mesh(G.aNose, SH.skin);
    nose.position.set(0, -0.008, 0.104);
    nose.rotation.x = Math.PI / 2;
    head.add(nose);

    const visor = new THREE.Mesh(G.aVisor, visorMat);
    visor.position.set(0, 0.016, 0.094);
    head.add(visor);

    const ant = new THREE.Mesh(G.aAnt, SH.dark);
    ant.position.set(0.072, 0.125, -0.02);
    head.add(ant);
    const antTip = new THREE.Mesh(G.aAntTip, glow);
    antTip.position.set(0.072, 0.195, -0.02);
    head.add(antTip);

    /* --- РУКИ: плечо → локоть → кисть (два сегмента, как у человека) --- */
    const mkArm = (side) => {
        const sh = new THREE.Group();
        sh.position.set(side * 0.215, 0.415, 0);
        torso.add(sh);

        const cap = new THREE.Mesh(G.aShoulder, suit);
        sh.add(cap);

        const up = new THREE.Mesh(G.aUpArm, suit);
        up.position.y = -0.145;
        sh.add(up);

        const el = new THREE.Group();
        el.position.y = -0.29;
        sh.add(el);

        const fore = new THREE.Mesh(G.aForearm, suit);
        fore.position.y = -0.143;
        el.add(fore);

        const hand = new THREE.Mesh(G.aHand, SH.skin);
        hand.position.y = -0.286;
        hand.scale.set(0.85, 1.15, 0.72);
        el.add(hand);

        return { sh, el };
    };
    const armL = mkArm(-1), armR = mkArm(1);

    /* --- НОГИ: бедро → колено → ступня (два сегмента) --- */
    const mkLeg = (side) => {
        const hip = new THREE.Group();
        hip.position.set(side * 0.105, 0, 0);
        g.add(hip);

        const thigh = new THREE.Mesh(G.aThigh, suit);
        thigh.position.y = -0.210;
        hip.add(thigh);

        const kn = new THREE.Group();
        kn.position.y = -0.420;
        hip.add(kn);

        const shin = new THREE.Mesh(G.aShin, suit);
        shin.position.y = -0.210;
        kn.add(shin);

        const foot = new THREE.Mesh(G.aFoot, SH.shoe);
        foot.position.set(0, -0.455, 0.040);
        kn.add(foot);

        const toe = new THREE.Mesh(G.aToe, SH.shoe);
        toe.position.set(0, -0.465, 0.130);
        kn.add(toe);

        return { hip, kn };
    };
    const legL = mkLeg(-1), legR = mkLeg(1);

    g.userData.rig = {
        torso, head, glow,
        armL: armL.sh, armR: armR.sh, elbowL: armL.el, elbowR: armR.el,
        legL: legL.hip, legR: legR.hip, kneeL: legL.kn, kneeR: legR.kn
    };
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
        { geo: geos().chairSeat, mat: M.plastic, offs: [[0, 0.46, 1.35]] },
        { geo: geos().chairBack, mat: M.plastic, offs: [[0, 0.90, 1.77]] },
        { geo: geos().chairPole, mat: M.metal, offs: [[0, 0.24, 1.35]] },
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

    // Таблички зон — «приклеены» к полу (плоские декали, а не парящие спрайты)
    const zones = [
        { t: 'ОПЕНСПЕЙС',    c: '#00e5ff', x: -15, z: 4.6,  w: 7.0, h: 1.75 },
        { t: 'СЕРВЕРНАЯ',    c: '#00ff88', x: 14,  z: -11.6, w: 6.4, h: 1.6 },
        { t: 'ПЕРЕГОВОРНАЯ', c: '#ffd700', x: 14,  z: 3.4,  w: 7.4, h: 1.85 },
        { t: 'ПРИЕМНАЯ',     c: '#ff69b4', x: 14,  z: 9.8,  w: 6.4, h: 1.6 },
        { t: 'САНУЗЕЛ',      c: '#9fd8ff', x: 26,  z: 1.5,  w: 3.8, h: 1.0 }
    ];
    zones.forEach(z => {
        const decal = new THREE.Mesh(
            new THREE.PlaneGeometry(z.w, z.h),
            new THREE.MeshBasicMaterial({
                map: texZone(z.t, z.c), transparent: true, depthWrite: false,
                blending: THREE.AdditiveBlending
            })
        );
        decal.rotation.x = -Math.PI / 2;
        decal.position.set(z.x, 0.035, z.z);
        decal.renderOrder = 1;
        scene.add(decal);
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

/* --- СТОЛ БОССА (ЭТАП 3) --- */
function buildBossDesk(scene, M, screenTex) {
    const g = new THREE.Group();

    const top = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.2, 2.2), M.desk);
    top.position.y = 1.05; g.add(top);
    const legGeo = new THREE.BoxGeometry(0.18, 1.0, 0.18);
    [[-2.1, -0.95], [2.1, -0.95], [-2.1, 0.95], [2.1, 0.95]].forEach(p => {
        const l = new THREE.Mesh(legGeo, M.dark);
        l.position.set(p[0], 0.5, p[1]); g.add(l);
    });

    // два монитора (экраны смотрят на Босса, т.е. в +z)
    [-1.15, 1.15].forEach(x => {
        const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.14, 0.5, 8), M.plastic);
        stand.position.set(x, 1.4, -0.5); g.add(stand);
        const body = new THREE.Mesh(new THREE.BoxGeometry(1.95, 1.2, 0.1), M.plastic);
        body.position.set(x, 2.15, -0.5); g.add(body);
        const scr = new THREE.Mesh(
            new THREE.PlaneGeometry(1.76, 1.0),
            new THREE.MeshStandardMaterial({ map: screenTex, emissive: 0xffffff, emissiveMap: screenTex, emissiveIntensity: 1.7 })
        );
        scr.position.set(x, 2.15, -0.44); g.add(scr);
    });

    // голо-панель задач (вспыхивает при докладе)
    const holo = new THREE.Mesh(
        new THREE.CylinderGeometry(1.0, 1.0, 0.06, 24),
        new THREE.MeshStandardMaterial({ color: 0xffd700, emissive: 0xffd700, emissiveIntensity: 1.4, transparent: true, opacity: 0.45 })
    );
    holo.position.set(0, 1.22, 0.25);
    holo.userData.flash = 0;
    g.add(holo);
    scene.userData.bossHolo = holo;

    // кресло Босса
    const chair = buildChair(M);
    chair.position.set(0, 0, 1.5);
    g.add(chair);

    // табличка
    const plate = new THREE.Sprite(new THREE.SpriteMaterial({
        map: texZone('СТОЛ БОССА', '#ffd700'), transparent: true, depthWrite: false
    }));
    plate.scale.set(5.6, 1.4, 1);
    plate.position.set(0, 3.6, 0);
    g.add(plate);

    // приподнятая площадка + золотое кольцо — стол Босса видно издалека
    const pad = new THREE.Mesh(
        new THREE.CylinderGeometry(3.0, 3.0, 0.12, 32),
        new THREE.MeshStandardMaterial({ color: 0x2a3446, metalness: 0.6, roughness: 0.4 })
    );
    pad.position.y = 0.06;
    g.add(pad);
    const padRing = new THREE.Mesh(
        new THREE.RingGeometry(2.86, 3.16, 40),
        new THREE.MeshBasicMaterial({
            color: 0xffd700, transparent: true, opacity: 0.5,
            side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false
        })
    );
    padRing.rotation.x = -Math.PI / 2;
    padRing.position.y = 0.13;
    g.add(padRing);

    g.position.set(BOSS_DESK.x, 0, BOSS_DESK.z);
    scene.add(g);

    // маркер точки доклада
    const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.72, 1.02, 28),
        new THREE.MeshBasicMaterial({
            color: 0xffd700, transparent: true, opacity: 0.5,
            side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false
        })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(BOSS_SPOT.x, 0.03, BOSS_SPOT.z);
    scene.add(ring);

    return g;
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

    // СТОЛ БОССА
    buildBossDesk(scene, M, screenMats[2].map);

    // СЕРВЕРНАЯ
    [[9.5, -15.6], [11.4, -15.6], [13.3, -15.6], [15.2, -15.6]].forEach(p => {
        const r = buildRack(M, screenMats[1].map);
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
        tag.renderOrder = 2;
        tag.userData.agentName = def.name;
        model.add(tag);

        // облачко-реплика
        const bubble = new THREE.Sprite(new THREE.SpriteMaterial({
            map: texBubble('…', '#00e5ff'), transparent: true, depthTest: false, depthWrite: false
        }));
        bubble.scale.set(3.5, 1.4, 1);
        bubble.position.y = 2.85;
        bubble.renderOrder = 3;
        bubble.visible = false;
        bubble.userData.agentName = def.name;
        model.add(bubble);

        // «задача» в руках — светящийся куб
        const taskCube = new THREE.Mesh(
            new THREE.BoxGeometry(0.34, 0.34, 0.34),
            new THREE.MeshStandardMaterial({ color: 0x00e5ff, emissive: 0x00e5ff, emissiveIntensity: 1.8, metalness: 0.3, roughness: 0.3 })
        );
        taskCube.position.set(0, 0.74, 0.44);
        taskCube.visible = false;
        taskCube.userData.agentName = def.name;
        model.add(taskCube);

        scene.add(model);
        groups.push(model);

        agents.push({
            name: def.name, color: def.color, model, rig: model.userData.rig, tag,
            bubble, taskCube, bubbleTimer: 0, task: null,
            home, homeYaw: Math.PI,
            state: 'sit', working: false, highlight: false,
            path: null, pi: 0, onDone: null,
            breakTimer: 12 + Math.random() * 25,
            toiletTimer: 45 + Math.random() * 75,
            taskTimer: 25 + Math.random() * 45,
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
    a.model.position.y = 0.52;
    a.rig.legL.rotation.x = -1.45;
    a.rig.legR.rotation.x = -1.45;
    a.rig.kneeL.rotation.x = 1.40;
    a.rig.kneeR.rotation.x = 1.40;
}

function poseStand(a) {
    a.model.position.y = 0.90;
    a.rig.legL.rotation.x = 0;
    a.rig.legR.rotation.x = 0;
    a.rig.kneeL.rotation.x = 0;
    a.rig.kneeR.rotation.x = 0;
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

/* --- ЭТАП 3: доклад Боссу -------------------------------------------
   Маршрут внутри опенспейса: за креслами → передний проход → стол Босса. */
function routeToBoss(homeX, homeZ) {
    return [
        new THREE.Vector3(2.2, 0, homeZ + 1.0),
        new THREE.Vector3(2.2, 0, BOSS_AISLE_Z),
        new THREE.Vector3(BOSS_SPOT.x, 0, BOSS_AISLE_Z),
        new THREE.Vector3(BOSS_SPOT.x, 0, BOSS_SPOT.z)
    ];
}

function routeFromBoss(homeX, homeZ) {
    return [
        new THREE.Vector3(BOSS_SPOT.x, 0, BOSS_AISLE_Z),
        new THREE.Vector3(2.2, 0, BOSS_AISLE_Z),
        new THREE.Vector3(2.2, 0, homeZ + 1.0),
        new THREE.Vector3(homeX, 0, homeZ)
    ];
}

/* Реплика над головой агента */
function say(a, text, ms, color) {
    const col = color || ('#' + new THREE.Color(a.color).getHexString());
    if (a.bubble.material.map) a.bubble.material.map.dispose();
    a.bubble.material.map = texBubble(text, col);
    a.bubble.material.needsUpdate = true;
    a.bubble.visible = true;
    a.bubbleTimer = (ms || 3200) / 1000;
}

const TASK_TEXTS = [
    'Проверить логи сервера', 'Собрать отчёт по заявкам', 'Обновить карту уровней',
    'Протестировать сборку', 'Ответить клиенту', 'Проверить замер окон',
    'Свести смету по кондиционерам', 'Проверить связь с сервером',
    'Разобрать очередь задач', 'Подготовить сводку дня'
];
const DONE_TEXTS = ['Готово, Босс!', 'Выполнено!', 'Задача закрыта', 'Есть результат!'];

let bossCount = 0;
let bossTimer = 6 + Math.random() * 8;

function sendToBoss(a, taskText) {
    if (a.state !== 'sit' || a.working) return false;
    bossCount++;
    a.task = taskText || TASK_TEXTS[(Math.random() * TASK_TEXTS.length) | 0];
    a.taskCube.visible = true;
    say(a, a.task, 6000);
    goTo(a, routeToBoss(a.home.x, a.home.z), () => {
        a.state = 'report';
        a.waitTimer = 4 + Math.random() * 3;
        a.taskCube.visible = false;
        say(a, DONE_TEXTS[(Math.random() * DONE_TEXTS.length) | 0], 5200, '#00ff88');
        if (S && S.scene && S.scene.userData.bossHolo) S.scene.userData.bossHolo.userData.flash = 1;
    });
    return true;
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
            rig.legL.rotation.x = s * 0.52;
            rig.legR.rotation.x = -s * 0.52;
            rig.kneeL.rotation.x = Math.max(0, s) * 0.95;      // колено сгибается на заднем шаге
            rig.kneeR.rotation.x = Math.max(0, -s) * 0.95;
            rig.armL.rotation.x = -s * 0.42;
            rig.armR.rotation.x = s * 0.42;
            rig.elbowL.rotation.x = -0.12 - Math.max(0, -s) * 0.45;
            rig.elbowR.rotation.x = -0.12 - Math.max(0, s) * 0.45;
            a.model.position.y = 0.90 + Math.abs(s) * 0.045;
            rig.torso.rotation.x = 0.06;
        }
    } else if (a.state === 'sit') {
        poseSit(a);
        rig.torso.rotation.x = 0.12 + Math.sin(t * 2.2 + a.phase) * 0.03;
        rig.armL.rotation.x = -1.30 + Math.sin(t * 7 + a.phase) * 0.10;
        rig.armR.rotation.x = -1.30 + Math.sin(t * 7 + a.phase + 1.6) * 0.10;
        rig.elbowL.rotation.x = -0.55;
        rig.elbowR.rotation.x = -0.55;
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
    } else if (a.state === 'report') {
        poseStand(a);
        rig.torso.rotation.x = -0.10 + Math.sin(t * 2.0 + a.phase) * 0.03;
        rig.armL.rotation.x = -0.55 + Math.sin(t * 6 + a.phase) * 0.28;
        rig.armR.rotation.x = -0.55 + Math.sin(t * 6 + a.phase + 1.2) * 0.28;
        rig.elbowL.rotation.x = -0.72;
        rig.elbowR.rotation.x = -0.72;
        rig.head.rotation.y = Math.sin(t * 1.1 + a.phase) * 0.16;
        a.waitTimer -= dt;
        if (a.waitTimer <= 0) {
            bossCount = Math.max(0, bossCount - 1);
            a.task = null;
            goTo(a, routeFromBoss(a.home.x, a.home.z), () => {
                a.state = 'sit';
                a.model.rotation.y = a.homeYaw;
                poseSit(a);
                say(a, 'На месте', 2000);
            });
        }
    } else {
        poseStand(a);
        const s = Math.sin(t * 1.8 + a.phase);
        rig.torso.rotation.x = s * 0.04;
        rig.armL.rotation.x = s * 0.10;
        rig.armR.rotation.x = -s * 0.10;
        rig.elbowL.rotation.x = -0.16;
        rig.elbowR.rotation.x = -0.16;
        rig.head.rotation.y = Math.sin(t * 0.9 + a.phase) * 0.35;
        a.waitTimer -= dt;
        if (a.waitTimer <= 0) goHome(a);
    }

    if (a.bubbleTimer > 0) {
        a.bubbleTimer -= dt;
        if (a.bubbleTimer <= 0) a.bubble.visible = false;
    }
    if (a.taskCube.visible) {
        a.taskCube.rotation.y += dt * 1.8;
        a.taskCube.rotation.x += dt * 0.9;
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
const CAM_HOME = { yaw: Math.PI * 0.25, pitch: 0.62, dist: 64, tx: -3, ty: 1.6, tz: 1.5 };

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

/* Пределы панорамирования — камера не улетает за пределы офиса */
const CAM_PAN_LIMIT = { x: 26, z: 21 };

/* RTS-управление (как в Diablo / мобильных стратегиях):
   угол камеры ЖЁСТКО ЗАФИКСИРОВАН (yaw + pitch из CAM_HOME) — вращения нет.
   Один палец — панорамирование по полу («схватывание карты»),
   два пальца — зум, колесо — зум. */
function bindControls(el, cam, st) {
    const pts = new Map();
    let pinch = 0;

    /* Мировые оси по земле: r — «вправо по экрану», u — «вверх по экрану».
       Считаются от текущего yaw, поэтому движение всегда естественное. */
    function axes() {
        const s = Math.sin(st.yaw), c = Math.cos(st.yaw);
        return { rx: c, rz: -s, ux: -s, uz: -c };
    }

    /* Сколько мировых метров приходится на один пиксель экрана
       (чтобы панорамирование было 1:1 с пальцем при любом зуме). */
    function pxToWorld() {
        const h = Math.max(el.clientHeight, 1);
        return (2 * st.dist * Math.tan((cam.fov * Math.PI / 180) / 2)) / h;
    }

    /* Панорамирование: палец вправо → офис едет вправо (эффект схватывания),
       то есть цель камеры смещается в противоположную сторону. */
    function pan(dx, dy) {
        const a = axes();
        const k = pxToWorld();
        st.tx = clamp(st.tx + (-dx * a.rx + dy * a.ux) * k, -CAM_PAN_LIMIT.x, CAM_PAN_LIMIT.x);
        st.tz = clamp(st.tz + (-dx * a.rz + dy * a.uz) * k, -CAM_PAN_LIMIT.z, CAM_PAN_LIMIT.z);
        applyCam(cam, st);
    }

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
            // ЩИПОК — только зум. Камера сама опускается/поднимается,
            // т.к. смотрит на st.tx / st.tz.
            const d = pinchDist();
            if (pinch > 0 && d > 0) st.dist = clamp(st.dist * (pinch / d), 24, 130);
            pinch = d;
            applyCam(cam, st);
        } else {
            // ОДИН ПАЛЕЦ — панорамирование по полу (yaw и pitch не меняются)
            pan(dx, dy);
        }
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
            try {
                startScene(office);
            } catch (e) {
                if (e && !e.__stage) e.__stage = 'startScene';
                throw e;
            }
        }).catch(async (err) => {
            console.warn('[office3d] Three.js недоступен — фолбэк на 2D-офис', err);
            isOpen = false;
            office.innerHTML = '';
            if (origToggle) origToggle();
            const probe = await probeLocal();
            const first = (err && err.details && err.details[0]) ? err.details[0] : ((err && err.message) || '?');
            const b = document.createElement('div');
            b.style.cssText = 'position:fixed;top:8px;left:50%;transform:translateX(-50%);z-index:99999;' +
                'background:#3a2a00;color:#ffd700;border:1px solid #ffd700;border-radius:8px;' +
                'padding:10px 14px;font:11px monospace;max-width:92vw;text-align:left;line-height:1.5;' +
                'word-break:break-word;';
            const stack = (err && err.stack) ? String(err.stack).split('\n').slice(0, 5).join('  ⟶  ') : '—';
            b.innerHTML = '<b>⚠️ 3D-офис: сбой.</b><br>' +
                'Этап: ' + esc((err && err.__stage) || 'загрузка Three.js') + '<br>' +
                'Причина: ' + esc(first) + '<br>' +
                'Стек: ' + esc(stack) + '<br>' +
                'Локальный файл: ' + esc(probe) + '<br>' +
                '<span style="opacity:.75">Показан 2D-офис. Пришли этот текст — починю точно.</span>';
            document.body.appendChild(b);
            setTimeout(() => b.remove(), 25000);
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
    hint.textContent = 'Тапни агента — карточка · Потяни — панорама · Щипок — зум';
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

    let built;
    try {
        built = buildScene();
    } catch (e) {
        if (e && !e.__stage) e.__stage = 'buildScene';
        throw e;
    }
    const { scene, screens, agents, groups } = built;
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

    // ВНЕШНИЙ API (ЭТАП 3): другие модули могут заставить агента говорить
    // и сходить с докладом к Боссу.
    window.office3dSay = function (name, text, ms) {
        const a = agentByName[name];
        if (a) say(a, text, ms || 3500);
    };
    window.office3dTask = function (name, text) {
        const a = agentByName[name];
        if (a) sendToBoss(a, text);
    };

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

        // голо-панель Босса вспыхивает при докладе
        const bh = scene.userData.bossHolo;
        if (bh) {
            bh.userData.flash = Math.max(0, bh.userData.flash - dt * 0.8);
            bh.material.opacity = 0.45 + bh.userData.flash * 0.5;
            bh.material.emissiveIntensity = 1.4 + bh.userData.flash * 2.2;
        }

        // ЭТАП 3: агенты ходят с докладом к Боссу
        bossTimer -= dt;
        if (bossTimer <= 0) {
            bossTimer = 22 + Math.random() * 28;
            if (bossCount < 2) {
                const freeB = [];
                for (let i = 0; i < agents.length; i++) {
                    const a = agents[i];
                    if (a.state === 'sit' && !a.working) freeB.push(a);
                }
                if (freeB.length) sendToBoss(freeB[(Math.random() * freeB.length) | 0]);
            }
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
    SHARED_M = null;
    toiletCount = 0;
    toiletTimer = 60 + Math.random() * 60;
    bossCount = 0;
    bossTimer = 6 + Math.random() * 8;
    delete window.office3dSay;
    delete window.office3dTask;
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
