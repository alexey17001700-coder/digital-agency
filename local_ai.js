const BRAIN_VERSION = "43.0";
const MAX_CONTEXT = 8;
let CONTEXT_MEMORY = [];
let userPrefs = JSON.parse(localStorage.getItem('shtabPrefs')) || { name: "Босс" };

function sanitizeInput(t) { return String(t || "").replace(/<[^>]*>?/gm, '').trim(); }
function saveLocalBrain() { localStorage.setItem('shtabContext', JSON.stringify(CONTEXT_MEMORY)); }

window.__brains = {};
window.__agentMemory = {};
window.__bootComplete = false;
window.__brainPromises = {};

const AGENTS_CONFIG = {
    "Регистратор": "Ты — Регистратор. Главный координатор. Отвечай кратко, вежливо.",
    "Хакер": "Ты — Хакер. Эксперт по взлому и уязвимостям. Отвечай технически, прямо.",
    "Охранник": "Ты — Охранник. Эксперт по кибербезопасности. Отвечай строго.",
    "Кодер": "Ты — Кодер. Пишешь только чистый код JS/HTML. Без воды."
};

// 1. Ищем экран с короной и встраиваем туда прогресс
function injectProgressUI() {
    let host = document.getElementById('loading-screen') || document.querySelector('.loader') || document.querySelector('.loading');
    if (!host) {
        // Если не нашли стандартный экран, создаем свой
        host = document.createElement('div');
        host.id = 'custom-ai-loader';
        host.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:#111;color:#00ff41;display:flex;flex-direction:column;align-items:center;justify-content:center;z-index:999999;font-family:monospace;';
        host.innerHTML = `<div style="font-size:40px;margin-bottom:20px;">👑</div><div id="ai-progress-host"></div>`;
        document.body.appendChild(host);
    } else {
        // Если нашли экран, добавляем туда контейнер
        const c = document.createElement('div');
        c.id = 'ai-progress-host';
        c.style.cssText = 'margin-top:20px; width:100%; max-width:300px; margin-left:auto; margin-right:auto;';
        host.appendChild(c);
    }
    return document.getElementById('ai-progress-host');
}

function updateBoot(pct, status, modelsHtml) {
    const container = document.getElementById('ai-progress-host');
    if (!container) return;
    container.innerHTML = `
        <div style="font-size:12px; color:#888; margin-bottom:10px; text-align:center;">${status}</div>
        <div style="width:100%; height:15px; border:1px solid #00ff41; border-radius:4px; overflow:hidden; margin-bottom:10px;">
            <div style="height:100%; width:${pct}%; background:#00ff41; transition:width 0.3s;"></div>
        </div>
        <div style="font-size:14px; font-weight:bold; text-align:center; margin-bottom:15px;">${Math.round(pct)}%</div>
        <div style="font-size:11px; color:#666; line-height:1.8; text-align:left;">${modelsHtml}</div>
    `;
}

function hideBootScreen() {
    const custom = document.getElementById('custom-ai-loader');
    if (custom) custom.remove();
    const progressHost = document.getElementById('ai-progress-host');
    if (progressHost) progressHost.remove();
    
    // Показываем Штаб (если он был скрыт)
    const app = document.getElementById('app') || document.querySelector('.app-frame');
    if (app) app.style.opacity = '1';
    window.__bootComplete = true;
}
window.bootAllBrains = async function() {
    // 1. Прячем Штаб (чат), пока грузимся
    const app = document.getElementById('app') || document.querySelector('.app-frame');
    if (app) app.style.opacity = '0';

    // 2. Внедряем UI под корону
    injectProgressUI();

    try {
        const { pipeline, env } = await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.0.0');
        env.useBrowserCache = true;
        env.allowLocalModels = false;
        const agents = Object.keys(AGENTS_CONFIG);
        
        for (let i = 0; i < agents.length; i++) {
            const agent = agents[i];
            const modelsHtml = agents.map((a, idx) => {
                if (idx < i) return `<div style="color:#0f0;">✅ ${a} — готов</div>`;
                if (idx === i) return `<div style="color:#ff0;">⏳ ${a} — качается...</div>`;
                return `<div style="color:#666;">⚪ ${a} — в очереди</div>`;
            }).join('');
            
            updateBoot((i / agents.length) * 100, `Загрузка модели ${i+1}/4`, modelsHtml);
            
            try {
                window.__brainPromises[agent] = pipeline('text-generation', 'onnx-community/Qwen2.5-0.5B-Instruct', {
                    device: 'wasm',
                    dtype: 'q4',
                    progress_callback: (p) => {
                        if (p.status === 'progress' && typeof p.progress === 'number') {
                            updateBoot(
                                ((i + p.progress) / agents.length) * 100, 
                                `Загрузка ${agent}: ${Math.round(p.progress * 100)}%`, 
                                modelsHtml
                            );
                        }
                    }
                });
                
                window.__brains[agent] = await window.__brainPromises[agent];
            } catch (e) { 
                console.error("Boot " + agent + ":", e); 
            }
        }
        
        // Когда все 4 готовы
        updateBoot(100, "Все нейросети готовы!", agents.map(a => `<div style="color:#0f0;">✅ ${a}</div>`).join(''));
        await new Promise(r => setTimeout(r, 1000));
        
        hideBootScreen();
        
        if (typeof renderMessage === "function") {
            renderMessage("🧠 **Штаб запущен.** Все 4 нейросети в памяти. Готов к работе.", "director", "DevOps");
        }
        
    } catch (e) {
        updateBoot(0, "❌ Ошибка: " + e.message, "");
        setTimeout(hideBootScreen, 3000);
    }
};
window.askBrain = async function(agent, msg) {
    let brain = window.__brains[agent];
    if (!brain && window.__brainPromises[agent]) {
        try { brain = await window.__brainPromises[agent]; window.__brains[agent] = brain; } 
        catch (e) { return { text: "Ошибка загрузки", time: "0" }; }
    }
    if (!brain) return { text: "⏳ Мозг не загружен", time: "0" };

    if (!window.__agentMemory[agent]) window.__agentMemory[agent] = [];
    const mem = window.__agentMemory[agent];

    const messages = [{ role: "system", content: AGENTS_CONFIG[agent] }];
    mem.slice(-3).forEach(m => messages.push({ role: m.role, content: m.text }));
    messages.push({ role: "user", content: msg });

    const t0 = Date.now();
    try {
        const out = await brain(messages, { max_new_tokens: 90, temperature: 0.7, do_sample: true, repetition_penalty: 1.1 });
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

window.generateLocalResponse = async function(agentName, userMessage) {
    if (!window.__bootComplete) {
        return "⏳ **Штаб еще загружается.** Нейросети качаются в память телефона. Пожалуйста, подождите.";
    }

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

    const r = await window.askBrain("Регистратор", msg);
    return `**Регистратор** _(⏱ ${r.time} сек):_\n${r.text}`;
};

// АВТОЗАПУСК
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', window.bootAllBrains);
} else {
    window.bootAllBrains();
}
