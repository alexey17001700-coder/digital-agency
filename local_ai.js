const BRAIN_VERSION = "35.0";
const MAX_CONTEXT = 10;
let CONTEXT_MEMORY = [];
let userPrefs = JSON.parse(localStorage.getItem('shtabPrefs')) || { name: "Босс" };

function saveLocalBrain() {
    localStorage.setItem('shtabContext', JSON.stringify(CONTEXT_MEMORY));
}
function sanitizeInput(text) {
    return text.replace(/<[^>]*>?/gm, '').trim();
}
window.__brains = {};
window.__agentMemory = {};

const AGENTS_CONFIG = {
    "Регистратор": {
        prompt: "Ты — Регистратор. Главный координатор. Отвечай кратко, вежливо, по делу.",
        model: "onnx-community/Qwen2.5-0.5B-Instruct"
    },
    "Хакер": {
        prompt: "Ты — Хакер. Эксперт по взлому и уязвимостям. Отвечай технически, дерзко, прямо.",
        model: "onnx-community/Qwen2.5-0.5B-Instruct"
    },
    "Охранник": {
        prompt: "Ты — Охранник. Эксперт по кибербезопасности. Отвечай строго, следи за защитой.",
        model: "onnx-community/Qwen2.5-0.5B-Instruct"
    },
    "Кодер": {
        prompt: "Ты — Кодер. Пишешь только чистый код JS/HTML. Без воды, только код и краткие пояснения.",
        model: "onnx-community/Qwen2.5-0.5B-Instruct"
    }
};

async function initBrain(agentName) {
    if (window.__brains[agentName]) return window.__brains[agentName];
    
    if (typeof renderMessage === 'function') {
        renderMessage(`⏳ Загружаю мозг **${agentName}**...`, "director", "DevOps");
    }
    
    try {
        const { pipeline, env } = await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.0.0');
        env.useBrowserCache = true;
        env.allowLocalModels = false;
        
        const brain = await pipeline('text-generation', AGENTS_CONFIG[agentName].model, {
            device: 'wasm',
            dtype: 'q4'
        });
        
        window.__brains[agentName] = brain;
        if (typeof renderMessage === 'function') {
            renderMessage(`🧠 Мозг **${agentName}** готов.`, "director", "DevOps");
        }
        return brain;
    } catch (e) {
        return null;
    }
}
async function askBrain(agentName, userMessage) {
    const config = AGENTS_CONFIG[agentName];
    if (!config) return null;

    const brain = await initBrain(agentName);
    if (!brain) return "❌ Мозг " + agentName + " не загрузился.";

    if (!window.__agentMemory[agentName]) window.__agentMemory[agentName] = [];
    const mem = window.__agentMemory[agentName];

    let messages = [{ role: "system", content: config.prompt }];
    mem.slice(-3).forEach(m => messages.push({ role: m.role, content: m.text }));
    messages.push({ role: "user", content: userMessage });

    const start = Date.now();
    try {
        const output = await brain(messages, {
            max_new_tokens: 80,
            temperature: 0.7,
            do_sample: true,
            repetition_penalty: 1.1
        });

        let finalAnswer = "";
        const generated = output[0].generated_text;
        if (Array.isArray(generated)) {
            finalAnswer = generated[generated.length - 1].content;
        } else if (typeof generated === 'string') {
            finalAnswer = generated.split('<|im_start|>assistant\n').pop().split('<|im_end|>')[0].trim();
        }

        const timeSec = ((Date.now() - start) / 1000).toFixed(1);
        mem.push({ role: 'user', text: userMessage });
        mem.push({ role: 'assistant', text: finalAnswer });
        if (mem.length > MAX_CONTEXT) mem.shift();

        return { text: finalAnswer, time: timeSec };
    } catch (e) {
        return { text: "Ошибка: " + e.message, time: "0" };
    }
            }
async function runCouncil(userMessage) {
    const msg = userMessage.toLowerCase();
    let tasks = [];
    
    // Оркестратор определяет тему
    if (/код|функци|напиши|скрипт|программ/i.test(msg)) {
        tasks = [
            { agent: "Кодер", task: userMessage },
            { agent: "Хакер", task: "Проверь этот код на уязвимости и слабые места: " + userMessage }
        ];
    } else if (/взлом|уязвим|атак|хакер/i.test(msg)) {
        tasks = [
            { agent: "Хакер", task: userMessage },
            { agent: "Охранник", task: "Предложи защиту от этой атаки: " + userMessage }
        ];
    } else if (/защит|безопасн|парол/i.test(msg)) {
        tasks = [
            { agent: "Охранник", task: userMessage },
            { agent: "Хакер", task: "Как можно обойти эту защиту? " + userMessage }
        ];
    } else {
        // Общий вопрос — только Регистратор
        tasks = [{ agent: "Регистратор", task: userMessage }];
    }

    // Запускаем последовательно (чтобы не убить CPU)
    let results = [];
    for (const t of tasks) {
        if (typeof renderMessage === 'function') {
            renderMessage(`⏳ **${t.agent}** думает...`, "director", "DevOps");
        }
        const res = await askBrain(t.agent, t.task);
        results.push({ agent: t.agent, text: res.text, time: res.time });
    }

    // Собираем финальный отчёт
    let report = `🏛 **Совет Агентов**\n\n`;
    results.forEach(r => {
        report += `**${r.agent}** _(⏱ ${r.time} сек):_\n${r.text}\n\n`;
    });

    // Финальный синтез от Оркестратора
    const summaryPrompt = `Задача: "${userMessage}"\n\nМнения агентов:\n` + 
        results.map(r => `- ${r.agent}: ${r.text}`).join("\n") + 
        `\n\nСформулируй финальный ответ кратко.`;
    
    if (typeof renderMessage === 'function') {
        renderMessage(`⏳ **Регистратор** собирает итог...`, "director", "DevOps");
    }
    const summary = await askBrain("Регистратор", summaryPrompt);
    
    report += `---\n**📋 Итог (Регистратор):**\n${summary.text}`;
    return report;
}
async function generateLocalResponse(agentName, userMessage, proxyUrl, signal) {
    const msg = sanitizeInput(userMessage);

    // Быстрые ответы без нейросети
    if (/^(привет|ку|здравствуй|хай)/i.test(msg)) return `Привет, ${userPrefs.name}! На связи. 🚀`;
    if (/^(спасибо|благодарю)/i.test(msg)) return "Всегда пожалуйста!";
    if (/который час|сколько времени/i.test(msg)) return `🕒 ${new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`;

    // Явное обращение к агенту (@Хакер, @Кодер, @Охранник)
    const match = msg.match(/@([А-ЯЁа-яёa-z]+)/i);
    if (match) {
        const found = Object.keys(AGENTS_CONFIG).find(a => a.toLowerCase() === match[1].toLowerCase());
        if (found) {
            const cleanMsg = msg.replace(/@[А-ЯЁа-яёa-z]+\s*/i, "").trim();
            const res = await askBrain(found, cleanMsg);
            return `**${found}** _(⏱ ${res.time} сек):_\n${res.text}`;
        }
    }

    // Иначе — Совет агентов
    return await runCouncil(msg);
}
setTimeout(() => {
    if (typeof renderMessage === 'function') {
        renderMessage("🧠 **Совет Агентов запущен.**\nОбращайся к конкретному: `@Хакер`, `@Кодер`, `@Охранник`.\nИли задай общий вопрос — Оркестратор соберёт Совет.", "director", "DevOps");
    }
}, 2000);
