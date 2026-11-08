const BRAIN_VERSION = "70.0";
const MAX_CONTEXT = 8;
let CONTEXT_MEMORY = [];
let userPrefs = JSON.parse(localStorage.getItem('shtabPrefs')) || { name: "Босс" };

function sanitizeInput(t) { return String(t || "").replace(/<[^>]*>?/gm, '').trim(); }
function saveLocalBrain() { localStorage.setItem('shtabContext', JSON.stringify(CONTEXT_MEMORY)); }

window.__sharedBrain = null;
window.__brainPromise = null;
window.__agentMemory = {};
window.__bootComplete = false;
window.__markovs = {};

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
    updateBoot(0, "Подготовка...", "");
    try {
        const { pipeline, env } = await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.0.0');
        env.useBrowserCache = true;
        env.allowLocalModels = false;

        const modelsHtml = Object.keys(AGENTS_CONFIG).map(a => `<div style="color:#555;">⚪ ${a}</div>`).join('');
        updateBoot(10, `Загрузка мозга (100 МБ)...`, modelsHtml);

        let isDownloaded = false;

        window.__brainPromise = pipeline('text-generation', 'HuggingFaceTB/SmolLM2-135M-Instruct', {
            device: 'wasm',
            dtype: 'q4',
            progress_callback: (p) => {
                if (p.status === 'progress' && typeof p.progress === 'number') {
                    const safe = Math.min(1, Math.max(0, p.progress));
                    updateBoot(safe * 100, `Загрузка: ${Math.round(safe * 100)}%`, modelsHtml);
                    if (safe >= 1 && !isDownloaded) {
                        isDownloaded = true;
                        updateBoot(100, `⏳ Компиляция нейросети...`, modelsHtml);
                    }
                }
            }
        });

        window.__sharedBrain = await window.__brainPromise;
        
        const readyHtml = Object.keys(AGENTS_CONFIG).map(a => `<div style="color:#00ff41;">✅ ${a}</div>`).join('');
        updateBoot(100, "Нейросеть готова!", readyHtml);
        window.__bootComplete = true;
        
        if (window.parent && typeof window.parent.aiLoadingComplete === 'function') {
            window.parent.aiLoadingComplete();
        }
        
        if (typeof renderMessage === "function") {
            renderMessage("🧠 **Нейросеть загружена.** Готова к работе.", "director", "DevOps");
        }
    } catch (e) {
        console.error("Критическая ошибка:", e);
        updateBoot(0, "❌ " + e.message, "");
        if (window.parent && typeof window.parent.aiLoadingError === 'function') window.parent.aiLoadingError(e.message);
    }
};
function getMarkov(id) {
    id = (id || "default").toLowerCase();
    if (window.__markovs[id]) return window.__markovs[id];
    const m = {
        bi: {}, start: [], key: "shtab_markov_" + id,
        train(text) {
            const toks = (String(text).toLowerCase().match(/[а-яёa-z0-9]+|[.!?]/g) || []);
            if (toks.length < 3) return false;
            for (let i = 0; i < toks.length - 1; i++) {
                const w1 = toks[i], w2 = toks[i+1];
                if (!this.bi[w1]) this.bi[w1] = {};
                this.bi[w1][w2] = (this.bi[w1][w2] || 0) + 1;
            }
            this.start = Object.keys(this.bi);
            try { localStorage.setItem(this.key, JSON.stringify(this.bi)); } catch(e){}
            return true;
        },
        generate(n) {
            if (!this.start.length) return null;
            let res = [], w1 = this.start[Math.floor(Math.random() * this.start.length)];
            res.push(w1);
            for (let i = 0; i < n; i++) {
                const opts = this.bi[w1];
                if (!opts) break;
                let total = 0; for (const k in opts) total += opts[k];
                let r = Math.random() * total, next = null;
                for (const k in opts) { r -= opts[k]; if (r <= 0) { next = k; break; } }
                if (!next) break;
                res.push(next); w1 = next;
            }
            return res.join(" ");
        },
        status() { return { agent: id, words: Object.keys(this.bi).length }; }
    };
    try {
        const s = localStorage.getItem(m.key);
        if (s) { m.bi = JSON.parse(s); m.start = Object.keys(m.bi); }
    } catch(e){}
    window.__markovs[id] = m;
    return m;
}

function trainMarkov(agent, text) {
    return getMarkov(agent).train(text);
}

registerLayerHelper = null; // placeholder
async function askRawBrain(systemPrompt, userMsg) {
    if (!window.__sharedBrain && window.__brainPromise) {
        try { window.__sharedBrain = await window.__brainPromise; } 
        catch (e) { return null; }
    }
    if (!window.__sharedBrain) return null;

    const messages = [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMsg }
    ];

    try {
        const out = await window.__sharedBrain(messages, {
            max_new_tokens: 100,
            temperature: 0.6,
            do_sample: true,
            repetition_penalty: 1.1
        });
        let ans = "";
        const gen = out?.[0]?.generated_text;
        if (Array.isArray(gen)) ans = gen[gen.length - 1]?.content || "";
        else if (typeof gen === "string") ans = gen.split('<|im_start|>assistant\n').pop().split('<|im_end|>')[0].trim();
        return ans || null;
    } catch (e) {
        return null;
    }
}

// СИНТЕЗАТОР: 2 прохода SmolLM + стиль Маркова
async function askBrainWithSynthesis(agent, userMsg) {
    const t0 = Date.now();
    const sysPrompt = AGENTS_CONFIG[agent] || AGENTS_CONFIG["Регистратор"];

    // ПРОХОД 1: Смысл (черновик)
    const draft = await askRawBrain(sysPrompt, userMsg);
    if (!draft) return { text: "❌ Мозг не отвечает.", time: "0" };

    // Пробуем взять стиль Маркова
    const markov = getMarkov(agent);
    const styleSample = markov.generate(30);

    let finalAnswer = draft;

    // ПРОХОД 2: Стиль (если Марков обучен)
    if (styleSample && styleSample.length > 10) {
        const stylePrompt = `Ты — ${agent}. Перепиши ответ в стиле этого текста: "${styleSample}". Сохрани смысл, но используй похожие слова и манеру.`;
        const styled = await askRawBrain(stylePrompt, `Вопрос: ${userMsg}\n\nЧерновик ответа: ${draft}\n\nПерепиши его в стиле.`);
        if (styled && styled.length > 5) finalAnswer = styled;
    }

    const time = ((Date.now() - t0) / 1000).toFixed(1);
    if (!window.__agentMemory[agent]) window.__agentMemory[agent] = [];
    window.__agentMemory[agent].push({ role: "user", text: userMsg });
    window.__agentMemory[agent].push({ role: "assistant", text: finalAnswer });
    if (window.__agentMemory[agent].length > MAX_CONTEXT) window.__agentMemory[agent].shift();

    return { text: finalAnswer, time };
}
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
        const r = await askBrainWithSynthesis(tk.a, tk.m);
        results.push({ agent: tk.a, text: r.text, time: r.time });
    }

    let report = "🏛 **Совет Агентов**\n\n";
    results.forEach(r => { report += "**" + r.agent + "** _(⏱ " + r.time + " сек):_\n" + r.text + "\n\n"; });
    return report;
};

// Плагин обучения Маркова (вызывается вручную)
const markovController = async function(userMessage) {
    const t = userMessage.toLowerCase();
    if (!/^\s*марков\s+(обучись|сгенерируй|статус)/i.test(t)) return null;

    const match = userMessage.match(/@([А-ЯЁа-яёa-z]+)/i);
    const agent = match ? match[1] : "Регистратор";

    if (/обучись/i.test(t)) {
        const text = userMessage.replace(/.*обучись\s*/i, "").replace(/@[А-ЯЁа-яёa-z]+\s*/i, "").trim();
        if (text.length < 10) return "⚠️ Дай текст для обучения (10+ символов).";
        if (trainMarkov(agent, text)) return `✅ @${agent} обучен.`;
        return "⚠️ Мало текста (нужно 3+ слов).";
    }
    if (/сгенерируй/i.test(t)) {
        const sample = getMarkov(agent).generate(30);
        return sample ? `📖 @${agent}: ${sample}` : "⚠️ Модель пуста. Сначала обучи.";
    }
    if (/статус/i.test(t)) {
        const s = getMarkov(agent).status();
        return `📊 @${s.agent}: ${s.words} слов в памяти.`;
    }
    return null;
};
window.generateLocalResponse = async function(agentName, userMessage) {
    if (!window.__bootComplete) return "⏳ **Штаб загружается.** Подождите.";

    // Команды Маркова (приоритет)
    const markovResult = await markovController(userMessage);
    if (markovResult) return markovResult;

    const msg = sanitizeInput(userMessage);
    const low = msg.toLowerCase();

    // Мгновенные ответы (без нейросети)
    if (/^(привет|ку|здравствуй|хай)/i.test(low)) return `Привет, ${userPrefs.name}! На связи. 🚀`;
    if (/(как дела|как ты|что делаешь|чем занят)/i.test(low)) return "Все системы в норме, Босс! 😎";
    if (/^(спасибо|благодарю)/i.test(low)) return "Всегда пожалуйста!";
    if (/(который час|сколько времени)/i.test(low)) return `🕒 ${new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`;

    // Обращение к конкретному агенту
    const match = msg.match(/@([А-ЯЁа-яёa-z]+)/i);
    if (match) {
        const found = Object.keys(AGENTS_CONFIG).find(a => a.toLowerCase() === match[1].toLowerCase());
        if (found) {
            if (typeof renderMessage === "function") renderMessage("🧠 " + found + " думает (2 прохода, ~2-3 мин)...", "director", "DevOps");
            const clean = msg.replace(/@[А-ЯЁа-яёa-z]+\s*/i, "").trim();
            const r = await askBrainWithSynthesis(found, clean);
            return `**${found}** _(⏱ ${r.time} сек):_\n${r.text}`;
        }
    }

    // Сложные задачи — Совет
    if (/код|напиши|функци|скрипт|взлом|уязвим|атак|защит|безопасн/i.test(low)) {
        const council = await window.runCouncil(msg);
        if (council) return council;
    }

    // Обычный вопрос — Регистратор
    if (typeof renderMessage === "function") renderMessage("🧠 Регистратор думает (2 прохода, ~2-3 мин)...", "director", "DevOps");
    const r = await askBrainWithSynthesis("Регистратор", msg);
    return `**Регистратор** _(⏱ ${r.time} сек):_\n${r.text}`;
};

// Автозапуск
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', window.bootAllBrains);
else window.bootAllBrains();
