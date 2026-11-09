const BRAIN_VERSION = "80.0_STRICT";
const MAX_CONTEXT = 10;
const DENO_API_URL = "https://digital-agency.alexey17001700.deno.net";

window.__agentMemory = {};
window.__bootComplete = false;

const AGENTS_CONFIG = {
    "Регистратор": "Ты — Регистратор. Отвечай на русском. Кратко.",
    "Хакер": "Ты — Хакер. Ищи уязвимости.",
    "Охранник": "Ты — Охранник. Защищай систему.",
    "Кодер": "Ты — Кодер. Пиши только код."
};

function updateBoot(pct, status, modelsHtml) {
    if (window.parent && typeof window.parent.updateAILoading === 'function') {
        window.parent.updateAILoading(pct, status, modelsHtml);
    }
}

window.bootAllBrains = async function() {
    updateBoot(0, "Подключение...", "");
    setTimeout(() => {
        const readyHtml = Object.keys(AGENTS_CONFIG).map(a => `<div style="color:#00ff41;">✅ ${a}</div>`).join('');
        updateBoot(100, "ИИ готов!", readyHtml);
        window.__bootComplete = true;
        if (window.parent && typeof window.parent.aiLoadingComplete === 'function') window.parent.aiLoadingComplete();
        if (typeof renderMessage === "function") renderMessage("🧠 **ИИ подключен.**", "director", "DevOps");
    }, 800);
};

async function askRawBrain(agent, userMsg) {
    let systemPrompt = AGENTS_CONFIG[agent] || AGENTS_CONFIG["Регистратор"];
    const messages = [{ role: "system", content: systemPrompt }];

    if (!window.__agentMemory[agent]) window.__agentMemory[agent] = [];
    const mem = window.__agentMemory[agent];
    mem.slice(-MAX_CONTEXT).forEach(m => messages.push({ role: m.role, content: m.text }));
    messages.push({ role: "user", content: userMsg });

    // Собираем ключи из localStorage
    // ВАЖНО: Если в твоем ui.js ключи называются иначе, мы поправим это чуть позже
    const userKeys = {
        deepseekKey: localStorage.getItem('deepseekKey') || "",
        yandexKey: localStorage.getItem('yandexKey') || "",
        yandexFolder: localStorage.getItem('yandexFolder') || ""
    };

    let modelType = "";
    
    // Жесткая проверка: без ключа — никакой работы (Zveno убран)
    if (userKeys.deepseekKey) {
        modelType = "deepseek";
    } else if (userKeys.yandexKey && userKeys.yandexFolder) {
        modelType = "yandex";
    } else {
        return { text: "⚠️ **Нет API ключа!** Нажми на иконку ключа 🔑 вверху и введи свой ключ DeepSeek или Yandex.", time: "0" };
    }

    const t0 = Date.now();
    try {
        const res = await fetch(DENO_API_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ model: modelType, messages, userKeys })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Ошибка сервера");

        let finalAnswer = data.choices[0].message.content;
        const time = ((Date.now() - t0) / 1000).toFixed(1);

        mem.push({ role: 'user', text: userMsg });
        mem.push({ role: 'assistant', text: finalAnswer });
        if (mem.length > MAX_CONTEXT * 2) mem.shift();
        
        return { text: finalAnswer, time };
    } catch (e) {
        return { text: "❌ " + e.message, time: "0" };
    }
}

window.generateLocalResponse = async function(agentName, userMessage) {
    if (!window.__bootComplete) return "⏳ Штаб загружается.";
    const msg = userMessage.trim();
    
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
    if (typeof renderMessage === "function") renderMessage("🧠 Регистратор думает...", "director", "DevOps");
    const r = await askRawBrain("Регистратор", msg);
    return `**Регистратор** _(⏱ ${r.time} сек):_\n${r.text}`;
};

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', window.bootAllBrains);
else window.bootAllBrains();
