const BRAIN_VERSION = "63.0";
const MAX_CONTEXT = 8;
let CONTEXT_MEMORY = [];
let userPrefs = JSON.parse(localStorage.getItem('shtabPrefs')) || { name: "Босс" };

function sanitizeInput(t) { return String(t || "").replace(/<[^>]*>?/gm, '').trim(); }
function saveLocalBrain() { localStorage.setItem('shtabContext', JSON.stringify(CONTEXT_MEMORY)); }

window.__sharedBrain = null;
window.__brainPromise = null;
window.__agentMemory = {};
window.__bootComplete = false;

const AGENTS_CONFIG = {
    "Регистратор": "Ты — Регистратор. Главный координатор. Отвечай кратко, вежливо.",
    "Хакер": "Ты — Хакер. Эксперт по взлому и уязвимостям. Отвечай технически, прямо.",
    "Охранник": "Ты — Охранник. Эксперт по кибербезопасности. Отвечай строго.",
    "Кодер": "Ты — Кодер. Пишешь только чистый код JS/HTML. Без воды."
};

function updateBoot(pct, status, modelsHtml) {
    if (window.parent && typeof window.parent.updateAILoading === 'function') {
        window.parent.updateAILoading(pct, status, modelsHtml);
    }
}

window.bootAllBrains = async function() {
    updateBoot(0, "Подготовка движка...", "");
    try {
        const { pipeline, env } = await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.0.0');
        env.useBrowserCache = true;
        env.allowLocalModels = false;

        const modelsHtml = Object.keys(AGENTS_CONFIG).map(a => `<div style="color:#555;">⚪ ${a} — ждет</div>`).join('');
        updateBoot(10, `Загрузка единого мозга ИИ (350 МБ)...`, modelsHtml);

        window.__brainPromise = pipeline('text-generation', 'onnx-community/Qwen2.5-0.5B-Instruct', {
            device: 'wasm',
            dtype: 'q4',
            progress_callback: (p) => {
                if (p.status === 'progress' && typeof p.progress === 'number') {
                    const safeProgress = Math.min(1, Math.max(0, p.progress));
                    updateBoot(safeProgress * 100, `Загрузка ядра: ${Math.round(safeProgress * 100)}%`, modelsHtml);
                }
            }
        });

        window.__sharedBrain = await window.__brainPromise;
        
        const allReadyHtml = Object.keys(AGENTS_CONFIG).map(a => `<div style="color:#00ff41;">✅ ${a} — готов</div>`).join('');
        updateBoot(100, "Нейросеть готова к работе!", allReadyHtml);
        window.__bootComplete = true;
        
        if (window.parent && typeof window.parent.aiLoadingComplete === 'function') {
            window.parent.aiLoadingComplete();
        }
        
        if (typeof renderMessage === "function") {
            renderMessage("🧠 **Нейросеть загружена.** Все агенты готовы.", "director", "DevOps");
        }

    } catch (e) {
        console.error("Критическая ошибка загрузки:", e);
        updateBoot(0, "❌ ОШИБКА: " + e.message, "");
        if (window.parent && typeof window.parent.aiLoadingError === 'function') {
            window.parent.aiLoadingError(e.message);
        }
    }
};

window.askBrain = async function(agent, msg) {
    if (!window.__sharedBrain && window.__brainPromise) {
        try { window.__sharedBrain = await window.__brainPromise; } 
        catch (e) { return { text: "Ошибка загрузки мозга: " + e.message, time: "0" }; }
    }
    if (!window.__sharedBrain) return { text: "⏳ Мозг еще не загружен.", time: "0" };

    if (!window.__agentMemory[agent]) window.__agentMemory[agent] = [];
    const mem = window.__agentMemory[agent];

    const messages = [{ role: "system", content: AGENTS_CONFIG[agent] }];
    mem.slice(-3).forEach(m => messages.push({ role: m.role, content: m.text }));
    messages.push({ role: "user", content: msg });

    const t0 = Date.now();
    try {
        const out = await window.__sharedBrain(messages, { max_new_tokens: 90, temperature: 0.7, do_sample: true, repetition_penalty: 1.1 });
        let ans = "";
        const gen = out?.[0]?.generated_text;
        if (Array.isArray(gen)) ans = gen[gen.length - 1]?.content || "";
        else if (typeof gen === "string") ans = gen.split('<|im_start|>assistant\n').pop().split('<|im_end|>')[0].trim();

        const time = ((Date.now() - t0) / 1000).toFixed(1);
        mem.push({ role: 'user', text: msg });
        mem.push({ role: 'assistant', text: ans });
        if (mem.length > MAX_CONTEXT) mem.shift();
        return { text: ans || "(пусто)", time };
    } catch (e) {
        return { text: "Ошибка: " + e.message, time: "0" };
    }
};

window.runCouncil = async function(msg) {
    const t = msg.toLowerCase();
    let tasks = [];
    if (/код|функци|напиши|скрипт|программ/i.test(t)) tasks = [{ a: "Кодер", m: msg }, { a: "Хакер", m: "Проверь на уязвимости: " + msg }];
    else if (/взлом|уязвим|атак|хакер/i.test(t)) tasks = [{ a: "Хакер", m: msg }, { a: "Охранник", m: "Защита от: " + msg }];
    else if (/защит|безопасн|парол/i.test(t)) tasks = [{ a: "Охранник", m: msg }, { a: "Хакер", m: "Как обойти: " + msg }];
    else return null;

    const results = [];
    for (const tk of tasks) {
        if (typeof renderMessage === "function") renderMessage("⏳ **" + tk.a + "** думает...", "director", "DevOps");
        const r = await window.askBrain(tk.a, tk.m);
        results.push({ agent: tk.a, text: r.text, time: r.time });
    }

    let report = "🏛 **Совет Агентов**\n\n";
    results.forEach(r => { report += "**" + r.agent + "** _(⏱ " + r.time + " сек):_\n" + r.text + "\n\n"; });

    const sumPrompt = "Задача: \"" + msg + "\"\nМнения:\n" + results.map(r => "- " + r.agent + ": " + r.text).join("\n") + "\nФинальный ответ кратко.";
    if (typeof renderMessage === "function") renderMessage("⏳ **Регистратор** собирает итог...", "director", "DevOps");
    const s = await window.askBrain("Регистратор", sumPrompt);
    report += "---\n**📋 Итог:**\n" + s.text;
    return report;
};

window.generateLocalResponse = async function(agentName, userMessage) {
    if (!window.__bootComplete) return "⏳ **Штаб еще загружается.** Пожалуйста, подождите.";

    const msg = sanitizeInput(userMessage);
    const low = msg.toLowerCase();

    if (/^(привет|ку|здравствуй|хай)/i.test(low)) return `Привет, ${userPrefs.name}! На связи. 🚀`;
    if (/(как дела|как ты|что делаешь|чем занят)/i.test(low)) return "Все системы в норме, Босс! Совет готов. 😎";
    if (/^(спасибо|благодарю)/i.test(low)) return "Всегда пожалуйста!";
    if (/(который час|сколько времени)/i.test(low)) return `🕒 ${new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`;

    const match = msg.match(/@([А-ЯЁа-яёa-z]+)/i);
    if (match) {
        const found = Object.keys(AGENTS_CONFIG).find(a => a.toLowerCase() === match[1].toLowerCase());
        if (found) {
            const clean = msg.replace(/@[А-ЯЁа-яёa-z]+\s*/i, "").trim();
            const r = await window.askBrain(found, clean);
            return `**${found}** _(⏱ ${r.time} сек):_\n${r.text}`;
        }
    }

    if (/код|напиши|функци|скрипт|взлом|уязвим|атак|защит|безопасн/i.test(low)) {
        const council = await window.runCouncil(msg);
        if (council) return council;
    }

    const r = await window.askBrain("Регистратор", msg);
    return `**Регистратор** _(⏱ ${r.time} сек):_\n${r.text}`;
};

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', window.bootAllBrains);
else window.bootAllBrains();
