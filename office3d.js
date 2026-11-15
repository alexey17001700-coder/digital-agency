/* ============================================================================
   office3d.js — 3D-ОФИС ШТАБА (Three.js)
   ЭТАП 1: Интерьер. Изометрия, комната, мебель, атмосферный свет.
   ВАЖНО: office.js (2D-версия) НЕ тронут и работает как фолбэк,
          если Three.js не загрузился.
   ============================================================================ */
(function () {
'use strict';

const OFFICE3D_VERSION = 'v1.0 · build 1';

const THREE_URLS = [
    'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js',
    'https://unpkg.com/three@0.160.0/build/three.module.js'
];

let THREE = null;
let loadPromise = null;
let isOpen = false;
let S = null;          // активная сцена-контекст
let origToggle = null; // оригинальный 2D toggleOffice

/* ------------------------------------------------------------------ */
/*  ЗАГРУЗКА THREE.JS                                                  */
/* ------------------------------------------------------------------ */
function loadThree() {
    if (THREE) return Promise.resolve(THREE);
    if (loadPromise) return loadPromise;
    loadPromise = (async () => {
        for (const url of THREE_URLS) {
            try {
                const mod = await import(url);
                THREE = mod;
                return THREE;
            } catch (e) {
                console.warn('[office3d] Three.js не загрузился:', url);
            }
        }
        throw new Error('Three.js недоступен');
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
    t.repeat.set(5, 4);
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
    t.repeat.set(4, 1.6);
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

/* ------------------------------------------------------------------ */
/*  МАТЕРИАЛЫ                                                          */
/* ------------------------------------------------------------------ */
function mats() {
    return {
        metal: new THREE.MeshStandardMaterial({ color: 0x8d99ab, metalness: 0.85, roughness: 0.35 }),
        dark: new THREE.MeshStandardMaterial({ color: 0x2b3240, metalness: 0.6, roughness: 0.5 }),
        desk: new THREE.MeshStandardMaterial({ color: 0x3b4657, metalness: 0.55, roughness: 0.45 }),
        plastic: new THREE.MeshStandardMaterial({ color: 0x1a1f28, metalness: 0.2, roughness: 0.7 }),
        neon: (col) => new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 2.2, metalness: 0.2, roughness: 0.4 }),
        glass: new THREE.MeshStandardMaterial({ color: 0x9fd8ff, transparent: true, opacity: 0.35, metalness: 0.1, roughness: 0.1 })
    };
}

/* ------------------------------------------------------------------ */
/*  МЕБЕЛЬ                                                             */
/* ------------------------------------------------------------------ */
function buildDesk(M, screenTex) {
    const g = new THREE.Group();

    const top = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.16, 1.7), M.desk);
    top.position.y = 1.05; g.add(top);

    const legGeo = new THREE.BoxGeometry(0.14, 1.0, 0.14);
    [[-1.55, -0.72], [1.55, -0.72], [-1.55, 0.72], [1.55, 0.72]].forEach(p => {
        const l = new THREE.Mesh(legGeo, M.dark);
        l.position.set(p[0], 0.5, p[1]); g.add(l);
    });

    // монитор
    const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.14, 0.5, 8), M.plastic);
    stand.position.set(0, 1.38, -0.45); g.add(stand);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.06, 12), M.plastic);
    base.position.set(0, 1.16, -0.45); g.add(base);

    const frame = new THREE.Mesh(new THREE.BoxGeometry(1.75, 1.05, 0.1), M.plastic);
    frame.position.set(0, 2.05, -0.45); g.add(frame);

    const screen = new THREE.Mesh(
        new THREE.PlaneGeometry(1.6, 0.9),
        new THREE.MeshStandardMaterial({ map: screenTex, emissive: 0xffffff, emissiveMap: screenTex, emissiveIntensity: 1.5, metalness: 0, roughness: 1 })
    );
    screen.position.set(0, 2.05, -0.39); g.add(screen);
    g.userData.screen = screen;

    // клавиатура + мышь
    const kb = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.06, 0.36), M.plastic);
    kb.position.set(0, 1.16, 0.35); g.add(kb);
    const mouse = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), M.plastic);
    mouse.scale.set(1, 0.6, 1.4); mouse.position.set(0.85, 1.18, 0.35); g.add(mouse);

    // кружка
    const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.09, 0.22, 10), M.metal);
    cup.position.set(-1.3, 1.24, 0.3); g.add(cup);

    // кресло
    const chair = new THREE.Group();
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.14, 0.9), M.plastic);
    seat.position.y = 0.62; chair.add(seat);
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.85, 0.14), M.plastic);
    back.position.set(0, 1.05, -0.42); chair.add(back);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.55, 8), M.metal);
    pole.position.y = 0.32; chair.add(pole);
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.07, 12), M.metal);
    foot.position.y = 0.05; chair.add(foot);
    chair.position.set(0, 0, 1.35);
    g.add(chair);

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
    for (let i = 0; i < 5; i++) {
        const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.85, 6), new THREE.MeshStandardMaterial({ color: 0x2f7a4a, roughness: 0.9 }));
        leaf.position.set(Math.cos(i * 1.3) * 0.16, 0.85, Math.sin(i * 1.3) * 0.16);
        leaf.rotation.z = Math.cos(i * 1.3) * 0.4;
        leaf.rotation.x = Math.sin(i * 1.3) * 0.4;
        g.add(leaf);
    }
    return g;
}

/* ------------------------------------------------------------------ */
/*  СБОРКА СЦЕНЫ                                                       */
/* ------------------------------------------------------------------ */
function buildScene() {
    const M = mats();
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x070a10);
    scene.fog = new THREE.Fog(0x070a10, 34, 78);

    const ROOM_W = 26, ROOM_D = 20, ROOM_H = 6.4;

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
    for (let i = 0; i < 4; i++) {
        const beam = new THREE.Mesh(new THREE.BoxGeometry(ROOM_W, 0.22, 0.3), M.dark);
        beam.position.set(0, ROOM_H - 0.2, -7.5 + i * 5);
        scene.add(beam);
        const lamp = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.12, 0.6), lampMat);
        lamp.position.set(0, ROOM_H - 0.36, -7.5 + i * 5);
        scene.add(lamp);
        lamp.userData.pulse = Math.random() * 6;
        if (!scene.userData.lamps) scene.userData.lamps = [];
        scene.userData.lamps.push(lamp);
    }

    // СТОЛЫ + МОНИТОРЫ
    const screenTexes = [texScreen('#00ff9d'), texScreen('#00e5ff'), texScreen('#ffd700')];
    const desks = [];
    const COLS = [-8, 0, 8], ROWS = [-4.2, 3.4];
    ROWS.forEach((z, ri) => {
        COLS.forEach((x, ci) => {
            const d = buildDesk(M, screenTexes[(ri + ci) % 3]);
            d.position.set(x, 0, z);
            scene.add(d);
            desks.push(d);
        });
    });

    // КУЛЕР
    const cooler = buildCooler(M);
    cooler.position.set(-11.2, 0, -8.2);
    scene.add(cooler);

    // ДВЕРЬ «ВЫХОД»
    const doorG = new THREE.Group();
    const frame = new THREE.Mesh(new THREE.BoxGeometry(2.6, 4.2, 0.25), M.metal);
    frame.position.y = 2.1; doorG.add(frame);
    const leaf = new THREE.Mesh(new THREE.BoxGeometry(2.2, 3.8, 0.14), M.dark);
    leaf.position.set(0, 2.0, 0.14); doorG.add(leaf);
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.5, 8), M.metal);
    handle.rotation.z = Math.PI / 2; handle.position.set(0.85, 2.0, 0.24); doorG.add(handle);
    const sign = new THREE.Mesh(
        new THREE.PlaneGeometry(1.5, 0.56),
        new THREE.MeshStandardMaterial({ map: texSign('ВЫХОД', '#00ff88'), emissive: 0xffffff, emissiveMap: texSign('ВЫХОД', '#00ff88'), emissiveIntensity: 1.6 })
    );
    sign.position.set(0, 4.6, 0.16); doorG.add(sign);
    doorG.position.set(9.5, 0, -ROOM_D / 2 + 0.2);
    scene.add(doorG);

    // СЕРВЕРНАЯ СТОЙКА + РАСТЕНИЯ
    const rack = buildRack(M, screenTexes[1]);
    rack.position.set(-11.4, 0, 3.5);
    scene.add(rack);

    [[-11.5, 8.2], [11.5, 8.2], [11.5, -8.2]].forEach(p => {
        const pl = buildPlant(M);
        pl.position.set(p[0], 0, p[1]);
        scene.add(pl);
    });

    // СВЕТ: ровно 2 источника (без теней — экономия FPS)
    scene.add(new THREE.AmbientLight(0x8fa8c8, 1.15));
    const dir = new THREE.DirectionalLight(0xffffff, 1.7);
    dir.position.set(9, 15, 8);
    scene.add(dir);

    return { scene, desks };
}

/* ------------------------------------------------------------------ */
/*  КАМЕРА + УПРАВЛЕНИЕ (изометрия, drag / pinch / wheel)              */
/* ------------------------------------------------------------------ */
function makeCamera(container) {
    const w = Math.max(container.clientWidth, 1);
    const h = Math.max(container.clientHeight, 1);
    const cam = new THREE.PerspectiveCamera(42, w / h, 0.1, 300);
    const st = { yaw: Math.PI * 0.25, pitch: 0.62, dist: 30, tx: 0, ty: 1.4, tz: 0 };
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
            if (pinch > 0 && d > 0) st.dist = clamp(st.dist * (pinch / d), 13, 58);
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
        st.dist = clamp(st.dist * (1 + e.deltaY * 0.0012), 13, 58);
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
            console.warn('[office3d] фолбэк на 2D-офис');
            isOpen = false;
            office.innerHTML = '';
            if (origToggle) origToggle();
        });
    }
}

function startScene(office) {
    office.innerHTML = '';

    const hud = document.createElement('div');
    hud.className = 'o3d-hud';
    hud.innerHTML = '<div class="t">🏢 ОФИС · 3D РЕЖИМ</div><div class="v">' + OFFICE3D_VERSION + '</div>';
    office.appendChild(hud);

    const hint = document.createElement('div');
    hint.className = 'o3d-hint';
    hint.textContent = 'Потяни — повернуть · Щипок / колесо — зум';
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

    const { scene, desks } = buildScene();
    const { cam, st } = makeCamera(office);
    const unbind = bindControls(renderer.domElement, cam, st);

    reset.onclick = () => {
        st.yaw = Math.PI * 0.25; st.pitch = 0.62; st.dist = 30;
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

    const tick = () => {
        raf = requestAnimationFrame(tick);
        const t = clock.getElapsedTime();

        // лёгкое «дыхание» светильников и мерцание экранов — бесплатно для GPU
        const lamps = scene.userData.lamps || [];
        for (let i = 0; i < lamps.length; i++) {
            lamps[i].material.emissiveIntensity = 2.0 + Math.sin(t * 1.4 + lamps[i].userData.pulse) * 0.35;
        }
        for (let i = 0; i < desks.length; i++) {
            const sc = desks[i].userData.screen;
            if (sc) sc.material.emissiveIntensity = 1.35 + Math.sin(t * 3 + i) * 0.18;
        }

        renderer.render(scene, cam);
    };
    tick();

    S = { renderer, scene, cam, st, raf, unbind, onResize, office };
}

function hideOffice() {
    const chat = document.getElementById('chatContainer');
    const office = document.getElementById('office-container');
    const btn = document.getElementById('btnOffice');

    if (S) {
        cancelAnimationFrame(S.raf);
        S.unbind();
        window.removeEventListener('resize', S.onResize);
        window.removeEventListener('orientationchange', S.onResize);
        S.scene.traverse(o => {
            if (o.geometry) o.geometry.dispose();
            if (o.material) {
                const list = Array.isArray(o.material) ? o.material : [o.material];
                list.forEach(m => { if (m.map) m.map.dispose(); if (m.emissiveMap) m.emissiveMap.dispose(); m.dispose(); });
            }
        });
        S.renderer.dispose();
        S = null;
    }
    if (office) { office.innerHTML = ''; office.style.display = 'none'; }
    if (chat) chat.style.display = 'flex';
    if (btn) btn.classList.remove('active');
}

/* ------------------------------------------------------------------ */
/*  ПЕРЕХВАТ КНОПКИ «ОФИС»                                             */
/* ------------------------------------------------------------------ */
function install() {
    // Скрипты грузятся параллельно — ждём, пока office.js определит toggleOffice
    let tries = 0;
    const hook = () => {
        if (typeof window.toggleOffice === 'function') {
            if (!window.toggleOffice.__o3d) {
                origToggle = window.toggleOffice;
                const fn = function () {
                    isOpen = !isOpen;
                    if (isOpen) showOffice(); else hideOffice();
                };
                fn.__o3d = true;
                window.toggleOffice = fn;
            }
            return;
        }
        if (tries++ < 60) setTimeout(hook, 100);
        else console.warn('[office3d] toggleOffice не найден — 3D-офис не подключён');
    };
    hook();
    loadThree().catch(() => console.warn('[office3d] 3D недоступен, останется 2D-офис'));
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install);
else install();

window.OFFICE3D_VERSION = OFFICE3D_VERSION;
})();
