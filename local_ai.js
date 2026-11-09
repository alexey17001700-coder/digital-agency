const BRAIN_VERSION = "77.0_PURE_ZVENO";
const MAX_CONTEXT = 6;
const DENO_API_URL = "https://digital-agency.alexey17001700.deno.net";
let CONTEXT_MEMORY = [];
let userPrefs = JSON.parse(localStorage.getItem('shtabPrefs')) || { name: "Босс" };

function sanitizeInput(t) { return String(t || "").replace(/<[^>]*>?/gm, '').trim(); }
function saveLocalBrain() { localStorage.setItem('shtabContext', JSON.stringify(CONTEXT_MEMORY)); }

window.__agentMemory = {};
window.__bootComplete = false;

const AGENTS_CONFIG = {
    "Регистратор": "Ты — Регистратор (главный ассистент). Отвечай на русском языке. Будь краток и по делу.",
    "Хакер": "Ты — Хакер. Отвечай на русском языке. Твоя задача — искать уязвимости и предлагать взломы (в образовательных целях).",
    "Охранник": "Ты — Охранник. Отвечай на русском языке. Твоя задача — защита систем.",
    "Кодер": "Ты — Кодер. Пиши только чистый код без лишних слов."
};

function updateBoot(pct, status, modelsHtml) {
    if (window.parent && typeof window.parent.updateAILoading === 'function') {
        window.parent.updateAILoading(pct, status, modelsHtml);
    }
}

// ==========================================
// БЫСТРЫЙ СТАРТ (Без загрузки 100 МБ)
// ==========================================
window.bootAllBrains = async function() {
    updateBoot(0, "Подключение к облаку...", "");
    const readyHtml = Object.keys(AGENTS_CONFIG).map(a => `<div style="color:#00ff41;">✅ ${a}</div>`).join('');
    
    setTimeout(() => {
        updateBoot(100, "Облачный ИИ готов!", readyHtml);
        window.__bootComplete = true;
        
        if (window.parent && typeof window.parent.aiLoadingComplete === 'function') {
            window.parent.aiLoadingComplete();
        }
        if (typeof renderMessage === "function") {
            renderMessage("🧠 **ZvenoAI подключен.** Готов к работе.", "director", "DevOps");
        }
    }, 800); // Небольшая задержка, чтобы интерфейс красиво прогрузился
};

// ==========================================
// ПОИСК В ИНТЕРНЕТЕ (Погода и Википедия)
// ==========================================
async function fetchWebInfo(query) {
    if (/погод|градус|температур/i.test(query)) {
        try {
            const city = query.replace(/(погод|какая|в|во|на|градус|температур|сейчас|завтра)/gi, "").trim();
            const res = await fetch(`https://wttr.in/${encodeURIComponent(city)}?format=3&lang=ru`);
            const text = await res.text();
            if (text && !text.includes("<html")) return { source: "Погода", text: text.trim() };
        } catch (e) {}
    }
    try {
        const r = await fetch(`https://ru.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&utf8=1&srlimit=1&origin=*`);
        const d = await r.json();
        if (d.query && d.query.search && d.query.search.length > 0) {
            const title = d.query.search[0].title;
            const extractRes = await fetch(`https://ru.wikipedia.org/w/api.php?action=query&prop=extracts&exintro=1&explaintext=1&titles=${encodeURIComponent(title)}&format=json&origin=*`);
            const extractData = await extractRes.json();
            const pages = extractData.query.pages;
            const pageId = Object.keys(pages)[0];
            if (pageId !== "-1" && pages[pageId].extract) {
                let fact = pages[pageId].extract.substring(0, 400);
                return { source: "Википедия", text: fact };
            }
        }
    } catch (e) {}
    return null;
}

// ==========================================
// ЗАПРОС К СЕРВЕРУ DENO
// ==========================================
async function askRawBrain(agent, userMsg) {
    let webFact = null;
    if (agent !== "Кодер" && /кто|что|где|когда|почему|как|погод|курс|найди|расскажи/i.test(userMsg)) {
        if (typeof renderMessage === "function") renderMessage("🌐 Ищу информацию в сети...", "director", "DevOps");
        webFact = await fetchWebInfo(userMsg);
    }

    let systemPrompt = AGENTS_CONFIG[agent] || AGENTS_CONFIG["Регистратор"];
    if (webFact) systemPrompt += `\n\nИспользуй эти факты для ответа:\n${webFact.text}`;

    const messages = [{ role: "system", content: systemPrompt }];

    if (!window.__agentMemory[agent]) window.__agentMemory[agent] = [];
    const mem = window.__agentMemory[agent];
    mem.slice(-2).forEach(m => messages.push({ role: m.role, content: m.text }));
    messages.push({ role: "user", content: userMsg });

    const t0 = Date.now();
    try {
        const res = await fetch(DENO_API_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ model: "zveno", messages: messages })
        });
        
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Ошибка сервера");

        let finalAnswer = data.choices[0].message.content;
        const time = ((Date.now() - t0) / 1000).toFixed(1);

        if (webFact) finalAnswer = `[📖 ${webFact.source}] ` + finalAnswer;

        mem.push({ role: 'user', text: userMsg });
        mem.push({ role: 'assistant', text: finalAnswer });
        if (mem.length > MAX_CONTEXT) mem.shift();
        
        return { text: finalAnswer, time };
    } catch (e) {
        return { text: "❌ Ошибка сети: " + e.message, time: "0" };
    }
}

// ==========================================
// ГЛАВНЫЙ ОБРАБОТЧИК
// ==========================================
window.generateLocalResponse = async function(agentName, userMessage) {
    if (!window.__bootComplete) return "⏳ **Штаб загружается.** Подождите.";

    const msg = sanitizeInput(userMessage);
    const low = msg.toLowerCase();

    // Быстрые ответы без ИИ
    if (/^(привет|ку|здравствуй|хай)/i.test(low)) return `Привет, ${userPrefs.name}! На связи. 🚀`;
    if (/(как дела|как ты|что делаешь|чем занят)/i.test(low)) return "Все системы в норме, Босс! 😎";
    if (/^(спасибо|благодарю)/i.test(low)) return "Всегда пожалуйста!";
    if (/(который час|сколько времени)/i.test(low)) return `🕒 ${new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`;

    // Маршрутизация по агентам
    const match = msg.match(/@([А-ЯЁа-яёa-z]+)/i);
    if (match) {
        const found = Object.keys(AGENTS_CONFIG).find(a => a.toLowerCase() === match[1].toLowerCase());
        if (found) {
            if (typeof renderMessage === "function") renderMessage("🧠 " + found + " думает...", "director", "DevOps");
            const clean = msg.replace(/@[А-ЯЁа-яёa-z]+\s*/i, "").trim();
            const r = await askRawBrain(found, clean);
            return `**${found}** _(⏱ ${r.time} сек):_\n${r.text}`;
        }
    }

    // Если агент не указан, отвечает Регистратор
    if (typeof renderMessage === "function") renderMessage("🧠 Регистратор думает...", "director", "DevOps");
    const r = await askRawBrain("Регистратор", msg);
    return `**Регистратор** _(⏱ ${r.time} сек):_\n${r.text}`;
};

// АВТОЗАПУСК
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', window.bootAllBrains);
else window.bootAllBrains();
