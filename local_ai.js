const BRAIN_VERSION = "37.0";
const MAX_CONTEXT = 10;
let CONTEXT_MEMORY = [];
let userPrefs = JSON.parse(localStorage.getItem('shtabPrefs')) || { name: "Босс" };

function sanitizeInput(text) { return text.replace(/<[^>]*>?/gm, '').trim(); }
function saveLocalBrain() { localStorage.setItem('shtabContext', JSON.stringify(CONTEXT_MEMORY)); }
function showBootScreen() {
    if (document.getElementById('wd-boot')) return;
    const boot = document.createElement('div');
    boot.id = 'wd-boot';
    boot.style.cssText = `position:fixed;top:0;left:0;width:100%;height:100%;background:#000;color:#00ff41;z-index:9999999;display:flex;flex-direction:column;align-items:center;justify-content:center;font-family:'Fira Code',monospace;padding:20px;box-sizing:border-box;`;
    boot.innerHTML = `
        <div style="font-size:22px;margin-bottom:20px;">🧠 Запуск Локального ИИ</div>
        <div id="wd-boot-status" style="font-size:13px;color:#888;margin-bottom:15px;text-align:center;max-width:90%;">Инициализация...</div>
        <div style="width:100%;max-width:350px;height:22px;border:1px solid #00ff41;border-radius:4px;overflow:hidden;">
            <div id="wd-boot-bar" style="height:100%;width:0%;background:#00ff41;transition:width 0.3s;"></div>
        </div>
        <div id="wd-boot-pct" style="margin-top:10px;font-size:18px;font-weight:bold;">0%</div>
        <div id="wd-boot-models" style="margin-top:25px;font-size:11px;color:#666;text-align:left;max-width:90%;line-height:1.8;"></div>
        <div style="margin-top:20px;font-size:11px;color:#555;text-align:center;">Первая загрузка: ~1.4 ГБ (4 модели)<br>Дальше — из кэша (мгновенно)</div>
    `;
    document.body.appendChild(boot);
}
function updateBoot(pct, status, modelsList) {
    const bar = document.getElementById('wd-boot-bar');
    const pctEl = document.getElementById('wd-boot-pct');
    const statusEl = document.getElementById('wd-boot-status');
    const modelsEl = document.getElementById('wd-boot-models');
    if (bar) bar.style.width = pct + '%';
    if (pctEl) pctEl.innerText = Math.round(pct) + '%';
    if (statusEl && status) statusEl.innerText = status;
    if (modelsEl && modelsList) modelsEl.innerHTML = modelsList;
}
function hideBootScreen() { const b = document.getElementById('wd-boot'); if (b) b.remove(); }
window.__brains = {};
window.__agentMemory = {};

const AGENTS_CONFIG = {
    "Регистратор": { prompt: "Ты — Регистратор. Главный координатор. Отвечай кратко, вежливо, по делу." },
    "Хакер": { prompt: "Ты — Хакер. Эксперт по взлому и уязвимостям. Отвечай технически, дерзко, прямо." },
    "Охранник": { prompt: "Ты — Охранник. Эксперт по кибербезопасности. Отвечай строго, следи за защитой." },
    "Кодер": { prompt: "Ты — Кодер. Пишешь только чистый код JS/HTML. Без воды." }
};
const MODEL_NAME = "onnx-community/Qwen2.5-0.5B-Instruct";
async function bootAllBrains() {
    showBootScreen();
    try {
        const { pipeline, env } = await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.0.0');
        env.useBrowserCache = true;
        env.allowLocalModels = false;

        const agents = Object.keys(AGENTS_CONFIG);
        const total = agents.length;
        let modelsHtml = agents.map(a => `<div>⚪ ${a} — ждёт</div>`).join('');

        for (let i = 0; i < agents.length; i++) {
            const agent = agents[i];
            modelsHtml = agents.map((a, idx) => {
                if (idx < i) return `<div style="color:#0f0;">✅ ${a} — готов</div>`;
                if (idx === i) return `<div style="color:#ff0;">⏳ ${a} — качается...</div>`;
                return `<div style="color:#666;">⚪ ${a} — ждёт</div>`;
            }).join('');
            updateBoot((i / total) * 100, `Загрузка: ${agent}`, modelsHtml);

            try {
                const brain = await pipeline('text-generation', MODEL_NAME, {
                    device: 'wasm',
                    dtype: 'q4',
                    progress_callback: (p) => {
                        if (p.status === 'progress' && p.progress !== undefined) {
                            const agentProgress = (i + p.progress) / total * 100;
                            updateBoot(agentProgress, `Загрузка ${agent}: ${(p.progress * 100).toFixed(0)}%`, modelsHtml);
                        }
                    }
                });
                window.__brains[agent] = brain;
            } catch (e) {
                console.error(`[Boot] Ошибка загрузки ${agent}:`, e);
            }
        }

        updateBoot(100, "Все модели загружены!", agents.map(a => `<div style="color:#0f0;">✅ ${a} — готов</div>`).join(''));
        await new Promise(r => setTimeout(r, 800));
        hideBootScreen();
        
        if (typeof renderMessage === 'function') {
            renderMessage("🧠 **Все 4 нейросети загружены.** Совет Агентов готов к работе.", "director", "DevOps");
        }
    } catch (e) {
        updateBoot(0, "❌ Ошибка: " + e.message, "");
        setTimeout(() => hideBootScreen(), 3000);
    }
}

// Запуск при старте
if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bootAllBrains);
    else bootAllBrains();
                    }
async function askBrain(agentName, userMessage) {
    const config = AGENTS_CONFIG[agentName];
    if (!config) return { text: "Агент не найден", time: "0" };

    const brain = window.__brains[agentName];
    if (!brain) return { text: "❌ Мозг " + agentName + " не загружен", time: "0" };

    if (!window.__agentMemory[agentName]) window.__agentMemory[agentName] = [];
    const mem = window.__agentMemory[agentName];

    let messages = [{ role: "system", content: config.prompt }];
    mem.slice(-3).forEach(m => messages.push({ role: m.role, content: m.text }));
    messages.push({ role: "user", content: userMessage });

    const start = Date.now();
    try {
        const output = await brain(messages, { max_new_tokens: 100, temperature: 0.7, do_sample: true, repetition_penalty: 1.1 });
        let finalAnswer = "";
        const generated = output[0].generated_text;
        if (Array.isArray(generated)) finalAnswer = generated[generated.length - 1].content;
        else if (typeof generated === 'string') finalAnswer = generated.split('<|im_start|>assistant\n').pop().split('<|im_end|>')[0].trim();

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
    if (/код|функци|напиши|скрипт|программ/i.test(msg)) {
        tasks = [{ agent: "Кодер", task: userMessage }, { agent: "Хакер", task: "Проверь на уязвимости: " + userMessage }];
    } else if (/взлом|уязвим|атак|хакер/i.test(msg)) {
        tasks = [{ agent: "Хакер", task: userMessage }, { agent: "Охранник", task: "Предложи защиту: " + userMessage }];
    } else if (/защит|безопасн|парол/i.test(msg)) {
        tasks = [{ agent: "Охранник", task: userMessage }, { agent: "Хакер", task: "Как обойти? " + userMessage }];
    } else {
        tasks = [{ agent: "Регистратор", task: userMessage }];
    }

    let results = [];
    for (const t of tasks) {
        if (typeof renderMessage === 'function') renderMessage(`⏳ **${t.agent}** думает...`, "director", "DevOps");
        const res = await askBrain(t.agent, t.task);
        results.push({ agent: t.agent, text: res.text, time: res.time });
    }

    let report = `🏛 **Совет Агентов**\n\n`;
    results.forEach(r => { report += `**${r.agent}** _(⏱ ${r.time} сек):_\n${r.text}\n\n`; });

    const summaryPrompt = `Задача: "${userMessage}"\nМнения:\n` + results.map(r => `- ${r.agent}: ${r.text}`).join("\n") + `\nСформулируй финальный ответ.`;
    if (typeof renderMessage === 'function') renderMessage(`⏳ **Регистратор** собирает итог...`, "director", "DevOps");
    const summary = await askBrain("Регистратор", summaryPrompt);
    report += `---\n**📋 Итог (Регистратор):**\n${summary.text}`;
    return report;
}

async function generateLocalResponse(agentName, userMessage, proxyUrl, signal) {
    const msg = sanitizeInput(userMessage);
    const lowerMsg = msg.toLowerCase();

    if (/^(привет|ку|здравствуй|хай)/i.test(lowerMsg)) return `Привет, ${userPrefs.name}! На связи. 🚀`;
    if (/как дела|как ты|что делаешь|чем занят/i.test(lowerMsg)) return "Все системы в норме, Босс! Совет готов. 😎";
    if (/^(спасибо|благодарю)/i.test(lowerMsg)) return "Всегда пожалуйста!";
    if (/который час|сколько времени/i.test(lowerMsg)) return `🕒 ${new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`;

    const match = msg.match(/@([А-ЯЁа-яёa-z]+)/i);
    if (match) {
        const found = Object.keys(AGENTS_CONFIG).find(a => a.toLowerCase() === match[1].toLowerCase());
        if (found) {
            const cleanMsg = msg.replace(/@[А-ЯЁа-яёa-z]+\s*/i, "").trim();
            const res = await askBrain(found, cleanMsg);
            return `**${found}** _(⏱ ${res.time} сек):_\n${res.text}`;
        }
    }

    if (/код|напиши|функци|скрипт|взлом|уязвим|атак|защит|безопасн/i.test(lowerMsg)) {
        return await runCouncil(msg);
    }

    const res = await askBrain("Регистратор", msg);
    return `**Регистратор** _(⏱ ${res.time} сек):_\n${res.text}`;
}
