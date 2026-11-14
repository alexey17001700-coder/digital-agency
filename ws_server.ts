// =========================================
// NEXUS CHAT — WebSocket relay server
// Отдельный файл. main.ts НЕ ТРОГАЕТ.
// Деплой: Deno Deploy (entrypoint: ws_server.ts)
// =========================================

const MAX_HISTORY = 80;          // сколько последних сообщений храним в комнате
const MAX_MSG_SIZE = 900_000;    // ~900 КБ (фото / файлы / голосовые)
const PING_INTERVAL = 25_000;    // keep-alive пинг
const MAX_ROOMS = 500;

type Client = {
    socket: WebSocket;
    room: string;
    id: string;
    alive: boolean;
};

const rooms = new Map<string, Set<Client>>();
const history = new Map<string, string[]>();
const allClients = new Set<Client>();

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
};

function json(data: unknown, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
}

function getRoom(name: string): Set<Client> {
    let r = rooms.get(name);
    if (!r) {
        if (rooms.size >= MAX_ROOMS) {
            // чистим пустые комнаты, чтобы не росло бесконечно
            for (const [k, v] of rooms) if (v.size === 0) { rooms.delete(k); history.delete(k); }
        }
        r = new Set();
        rooms.set(name, r);
    }
    return r;
}

function send(client: Client, obj: any) {
    try {
        if (client.socket.readyState === WebSocket.OPEN) {
            client.socket.send(JSON.stringify(obj));
        }
    } catch (_) { /* ignore */ }
}

function broadcast(room: string, obj: any, except?: Client) {
    const r = rooms.get(room);
    if (!r || r.size === 0) return;
    const payload = JSON.stringify(obj);
    for (const c of r) {
        if (c === except) continue;
        try {
            if (c.socket.readyState === WebSocket.OPEN) c.socket.send(payload);
        } catch (_) { /* ignore */ }
    }
}

function pushHistory(room: string, raw: string) {
    let h = history.get(room);
    if (!h) { h = []; history.set(room, h); }
    h.push(raw);
    if (h.length > MAX_HISTORY) h.splice(0, h.length - MAX_HISTORY);
}

function leaveRoom(client: Client) {
    const r = rooms.get(client.room);
    if (!r) return;
    r.delete(client);
    broadcast(client.room, { t: "presence", room: client.room, count: r.size });
}

function joinRoom(client: Client, room: string) {
    if (client.room === room) return;
    leaveRoom(client);
    client.room = room;
    const r = getRoom(room);
    r.add(client);

    // отдаём историю комнаты
    const h = history.get(room) || [];
    const items: any[] = [];
    for (const raw of h) {
        try { items.push(JSON.parse(raw)); } catch (_) { /* skip */ }
    }
    send(client, { t: "history", room, items });
    send(client, { t: "welcome", room, id: client.id, count: r.size });
    broadcast(room, { t: "presence", room, count: r.size }, client);
}

function handleMessage(client: Client, raw: string) {
    if (raw.length > MAX_MSG_SIZE) {
        send(client, { t: "error", error: "Сообщение слишком большое" });
        return;
    }

    let msg: any;
    try { msg = JSON.parse(raw); } catch { return; }
    if (!msg || typeof msg !== "object") return;

    // --- служебные ---
    if (msg.t === "ping") { send(client, { t: "pong", ts: Date.now() }); return; }

    if (msg.t === "join") {
        const room = String(msg.room || "").slice(0, 120);
        if (!room) return;
        if (msg.id) client.id = String(msg.id).slice(0, 80);
        joinRoom(client, room);
        return;
    }

    if (msg.t === "leave") { leaveRoom(client); client.room = ""; return; }

    if (msg.t === "typing") {
        if (!client.room) return;
        broadcast(client.room, { t: "typing", room: client.room, nick: String(msg.nick || "").slice(0, 40) }, client);
        return;
    }

    // --- основное: сообщение в комнату ---
    if (msg.t === "msg") {
        const room = String(msg.room || client.room || "").slice(0, 120);
        if (!room || !msg.d) return;
        if (client.room !== room) joinRoom(client, room);

        const envelope = { t: "msg", room, d: msg.d, ts: Date.now() };
        const packed = JSON.stringify(envelope);

        // в истории держим только «постоянные» сообщения (без typing/служебных)
        if (msg.d && msg.d.kind !== "typing") pushHistory(room, packed);

        broadcast(room, envelope);
        return;
    }

    // --- синхронизация справочника каналов (замена MQTT/ntfy) ---
    if (msg.t === "dir") {
        const room = "__dir__";
        if (client.room !== room) joinRoom(client, room);
        const envelope = { t: "dir", room, d: msg.d, ts: Date.now() };
        pushHistory(room, JSON.stringify(envelope));
        broadcast(room, envelope);
        return;
    }
}

// =========================================
// СЕРВЕР
// =========================================
Deno.serve((request) => {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

    // --- WebSocket ---
    const upgrade = (request.headers.get("upgrade") || "").toLowerCase();
    if (upgrade === "websocket") {
        const { socket, response } = Deno.upgradeWebSocket(request);

        const client: Client = {
            socket,
            room: "",
            id: crypto.randomUUID().slice(0, 8),
            alive: true,
        };

        socket.onopen = () => {
            allClients.add(client);
            send(client, { t: "hello", id: client.id, server: "nexus-ws", ts: Date.now() });
        };

        socket.onmessage = (e) => {
            client.alive = true;
            try { handleMessage(client, String(e.data)); } catch (_) { /* ignore */ }
        };

        socket.onclose = () => {
            leaveRoom(client);
            allClients.delete(client);
        };

        socket.onerror = () => {
            try { socket.close(); } catch (_) { /* ignore */ }
        };

        return response;
    }

    // --- health / stats ---
    if (url.pathname === "/stats" || url.pathname === "/") {
        const roomStats: any = {};
        for (const [name, set] of rooms) roomStats[name] = set.size;
        return json({
            ok: true,
            server: "nexus-ws",
            clients: allClients.size,
            rooms: rooms.size,
            history: history.size,
            roomStats,
            ts: Date.now(),
        });
    }

    return json({ ok: false, error: "Not found" }, 404);
});

// =========================================
// KEEP-ALIVE: чистим мёртвые соединения
// =========================================
setInterval(() => {
    for (const c of allClients) {
        if (!c.alive) {
            try { c.socket.close(); } catch (_) { /* ignore */ }
            leaveRoom(c);
            allClients.delete(c);
            continue;
        }
        c.alive = false;
        try {
            if (c.socket.readyState === WebSocket.OPEN) c.socket.send(JSON.stringify({ t: "ping", ts: Date.now() }));
        } catch (_) { /* ignore */ }
    }
}, PING_INTERVAL);
