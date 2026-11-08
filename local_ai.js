const BRAIN_VERSION = "46.0";
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

// Находим твой экран с короной и вставляем статусы ПОД неё
function injectProgressUI() {
    // Ищем элемент, где есть текст "ЦИФРОВОЕ АГЕНТСТВО" или "👑"
    const elements = document.querySelectorAll('body *');
    let crownElement = null;
    
    for (let el of elements) {
        if (el.children.length === 0) { // Берем только конечные элементы (текст)
            if (el.textContent.includes('ЦИФРОВОЕ АГЕНТСТВО') || el.textContent.includes('👑')) {
                crownElement = el;
                break;
            }
        }
    }

    // Создаем контейнер для статусов
    let host = document.getElementById('ai-progress-host');
    if (!host) {
        host = document.createElement('div');
        host.id = 'ai-progress-host';
        host.style.cssText = 'margin-top:20px; width:100%; max-width:320px; display:flex; flex-direction:column; align-items:center; z-index:10000; position:relative;';
        
        if (crownElement && crownElement.parentNode) {
            // Вставляем сразу после короны
            crownElement.parentNode.insertBefore(host, crownElement.nextSibling);
        } else {
            // Если не нашли корону, ставим по центру экрана
            host.style.position = 'fixed';
            host.style.top = '50%';
            host.style.left = '50%';
            host.style.transform = 'translate(-50%, -50%)';
            document.body.appendChild(host);
        }
    }
    return host;
}

// Обновляем строчки с моделями
function updateBoot(pct, status, modelsHtml) {
    const host = document.getElementById('ai-progress-host');
    if (!host) return;
    host.innerHTML = `
        <div style="width:100%; height:6px; background:#222; border-radius:3px; overflow:hidden; margin-bottom:10px;">
            <div style="height:100%; width:${pct}%; background:#00e5ff; transition:width 0.3s;"></div>
        </div>
        <div style="font-size:12px; color:#aaa; margin-bottom:15px; text-align:center;">${status}</div>
        <div style="font-size:11px; color:#888; line-height:1.6; text-align:left; width:100%; padding:0 20px; box-sizing:border-box;">${modelsHtml}</div>
    `;
}

function hideBootScreen() {
    const host = document.getElementById('ai-progress-host');
    if (host) host.remove();
    window.__bootComplete = true;
}
window.bootAllBrains = async function() {
    // Внедряем UI (ничего не перекрываем)
    injectProgressUI();

    try {
        const { pipeline, env } = await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.0.0');
        env.useBrowserCache = true;
        env.allowLocalModels = false;
        const agents = Object.keys(AGENTS_CONFIG);
        
        for (let i = 0; i < agents.length; i++) {
            const agent = agents[i];
            
            const modelsHtml = agents.map((a, idx) => {
                if (idx < i) return `<div style="color:#00ff41;">✅ ${a} — готов</div>`;
                if (idx === i) return `<div style="color:#ffd700;">⏳ ${a} — загрузка...</div>`;
                return `<div style="color:#555;">⚪ ${a} — в очереди</div>`;
            }).join('');
            
            updateBoot((i / agents.length) * 100, `Загрузка модели ${i+1} из ${agents.length}`, modelsHtml);
            
            try {
                window.__brainPromises[agent] = pipeline('text-generation', 'onnx-community/Qwen2.5-0.5B-Instruct', {
                    device: 'wasm',
                    dtype: 'q4',
                    progress_callback: (p) => {
                        if (p.status === 'progress' && typeof p.progress === 'number') {
                            updateBoot(((i + p.progress) / agents.length) * 100, `Загрузка ${agent}: ${Math.round(p.progress * 100)}%`, modelsHtml);
                        }
                    }
                });
                window.__brains[agent] = await window.__brainPromises[agent];
            } catch (e) { console.error("Boot " + agent + ":", e); }
        }
        
        updateBoot(100, "Все ИИ готовы!", agents.map(a => `<div style="color:#00ff41;">✅ ${a} — готов</div>`).join(''));
        await new Promise(r => setTimeout(r, 1000));
        
        // Скрываем прогресс-бар, но НЕ трогаем экран с короной (он уберется сам в ui.js или chat.js)
        hideBootScreen();

        // Скрываем экран с короной, чтобы открылся Штаб
        const loader = document.getElementById('loading-screen') || document.querySelector('.loading');
        if (loader) loader.style.display = 'none';

        if (typeof renderMessage === "function") {
            renderMessage("🧠 **Все 4 нейросети загружены.** Штаб готов.", "director", "DevOps");
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
    if (!brain) return { text: "⏳ Мозг " + agent + " не загружен.", time: "0" };

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
    if (!window.__bootComplete) return "⏳ **Штаб загружается.** Нейросети качаются. Подождите.";
    
    const msg = sanitizeInput(userMessage);
    const low = msg.toLowerCase();

    if (/^(привет|ку|здравствуй|хай)/i.test(low)) return `Привет, ${userPrefs.name}! На связи. 🚀`;
    if (/(как дела|как ты|что делаешь|чем занят)/i.test(low)) return "Все системы в норме, Босс! 😎";
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

// Запуск
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', window.bootAllBrains);
} else {
    window.bootAllBrains();
}
