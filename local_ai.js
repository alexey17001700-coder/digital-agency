const BRAIN_VERSION = "78.0_FINAL_PURE";
const MAX_CONTEXT = 10; // Память диалога (10 последних сообщений)
const DENO_API_URL = "https://digital-agency.alexey17001700.deno.net";
let userPrefs = JSON.parse(localStorage.getItem('shtabPrefs')) || { name: "Босс" };

function sanitizeInput(t) { return String(t || "").replace(/<[^>]*>?/gm, '').trim(); }

window.__agentMemory = {};
window.__bootComplete = false;

const AGENTS_CONFIG = {
    "Регистратор": "Ты — Регистратор (главный ассистент). Отвечай на русском языке. Будь краток и по делу.",
    "Хакер": "Ты — Хакер. Отвечай на русском языке. Ищи уязвимости.",
    "Охранник": "Ты — Охранник. Отвечай на русском языке. Защищай систему.",
    "Кодер": "Ты — Кодер. Пиши только чистый код без лишних слов."
};

function updateBoot(pct, status, modelsHtml) {
    if (window.parent && typeof window.parent.updateAILoading === 'function') {
        window.parent.updateAILoading(pct, status, modelsHtml);
    }
}

// ==========================================
// ЗАПУСК (Мгновенный)
// ==========================================
window.bootAllBrains = async function() {
    updateBoot(0, "Подключение к Deno...", "");
    const readyHtml = Object.keys(AGENTS_CONFIG).map(a => `<div style="color:#00ff41;">✅ ${a}</div>`).join('');
    
    setTimeout(() => {
        updateBoot(100, "Облачный ИИ готов!", readyHtml);
        window.__bootComplete = true;
        
        if (window.parent && typeof window.parent.aiLoadingComplete === 'function') {
            window.parent.aiLoadingComplete();
        }
        if (typeof renderMessage === "function") {
            renderMessage("🧠 **DeepSeek (Zveno) подключен.** Готов к работе.", "director", "DevOps");
        }
    }, 800); 
};

// ==========================================
// ЧИСТЫЙ ЗАПРОС К СЕРВЕРУ (БЕЗ КОСТЫЛЕЙ)
// ==========================================
async function askRawBrain(agent, userMsg) {
    let systemPrompt = AGENTS_CONFIG[agent] || AGENTS_CONFIG["Регистратор"];
    const messages = [{ role: "system", content: systemPrompt }];

    // Достаем историю диалога
    if (!window.__agentMemory[agent]) window.__agentMemory[agent] = [];
    const mem = window.__agentMemory[agent];
    mem.slice(-MAX_CONTEXT).forEach(m => messages.push({ role: m.role, content: m.text }));
    
    // Добавляем текущий вопрос
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

        // Сохраняем в память
        mem.push({ role: 'user', text: userMsg });
        mem.push({ role: 'assistant', text: finalAnswer });
        if (mem.length > MAX_CONTEXT * 2) mem.shift();
        
        return { text: finalAnswer, time };
    } catch (e) {
        return { text: "❌ Ошибка: " + e.message, time: "0" };
    }
}

// ==========================================
// ОБРАБОТЧИК СООБЩЕНИЙ
// ==========================================
window.generateLocalResponse = async function(agentName, userMessage) {
    if (!window.__bootComplete) return "⏳ **Штаб загружается.** Подождите.";

    const msg = sanitizeInput(userMessage);
    const low = msg.toLowerCase();

    // Приветствия
    if (/^(привет|ку|здравствуй|хай)/i.test(low)) return `Привет, ${userPrefs.name}! На связи. 🚀`;
    
    // Выбор агента
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

    // По умолчанию отвечает Регистратор
    if (typeof renderMessage === "function") renderMessage("🧠 Регистратор думает...", "director", "DevOps");
    const r = await askRawBrain("Регистратор", msg);
    return `**Регистратор** _(⏱ ${r.time} сек):_\n${r.text}`;
};

// АВТОЗАПУСК
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', window.bootAllBrains);
else window.bootAllBrains();
