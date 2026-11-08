// ==========================================
// local_ai.js - Часть 1 (Настройки и UI)
// ==========================================
const BRAIN_VERSION = "41.0";
const MAX_CONTEXT = 8;
let CONTEXT_MEMORY = [];
let userPrefs = JSON.parse(localStorage.getItem('shtabPrefs')) || { name: "Босс" };

// Очистка входного текста от HTML и мусора
function sanitizeInput(t) { 
    return String(t || "").replace(/<[^>]*>?/gm, '').trim(); 
}

// Сохранение контекста в localStorage
function saveLocalBrain() { 
    localStorage.setItem('shtabContext', JSON.stringify(CONTEXT_MEMORY)); 
}

// Глобальные хранилища для моделей и памяти агентов
window.__brains = {};
window.__agentMemory = {};

// Конфигурация агентов: их системные промпты
const AGENTS_CONFIG = {
    "Регистратор": "Ты — Регистратор. Главный координатор. Отвечай кратко, вежливо.",
    "Хакер": "Ты — Хакер. Эксперт по взлому и уязвимостям. Отвечай технически, прямо.",
    "Охранник": "Ты — Охранник. Эксперт по кибербезопасности. Отвечай строго.",
    "Кодер": "Ты — Кодер. Пишешь только чистый код JS/HTML. Без воды."
};

// ==========================================
// ФУНКЦИИ ЭКРАНА ЗАГРУЗКИ
// ==========================================

// Показывает черный экран с прогресс-баром
function showBootScreen() {
    if (document.getElementById('wd-boot')) return;
    const b = document.createElement('div');
    b.id = 'wd-boot';
    b.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:#000;color:#00ff41;z-index:9999999;display:flex;flex-direction:column;align-items:center;justify-content:center;font-family:monospace;padding:20px;box-sizing:border-box;';
    b.innerHTML = `
        <div style="font-size:20px;margin-bottom:20px;">🧠 Запуск Локального ИИ</div>
        <div id="wd-boot-status" style="font-size:12px;color:#888;margin-bottom:15px;text-align:center;">Инициализация...</div>
        <div style="width:100%;max-width:320px;height:20px;border:1px solid #00ff41;border-radius:4px;overflow:hidden;">
            <div id="wd-boot-bar" style="height:100%;width:0%;background:#00ff41;transition:width 0.3s;"></div>
        </div>
        <div id="wd-boot-pct" style="margin-top:10px;font-size:16px;font-weight:bold;">0%</div>
        <div id="wd-boot-models" style="margin-top:20px;font-size:11px;color:#666;line-height:1.8;text-align:left;"></div>
    `;
    document.body.appendChild(b);
}

// Обновляет прогресс-бар и текст статуса
function updateBoot(pct, status, models) {
    const bar = document.getElementById('wd-boot-bar');
    const pctEl = document.getElementById('wd-boot-pct');
    const st = document.getElementById('wd-boot-status');
    const m = document.getElementById('wd-boot-models');
    if (bar) bar.style.width = pct + '%';
    if (pctEl) pctEl.innerText = Math.round(pct) + '%';
    if (st && status) st.innerText = status;
    if (m && models) m.innerHTML = models;
}

// Убирает экран загрузки
function hideBootScreen() {
    const b = document.getElementById('wd-boot');
    if (b) b.remove();
}

// ==========================================
// ЗАГРУЗКА ВСЕХ МОДЕЛЕЙ
// ==========================================

// Эта функция запускается при старте
// Она проходит по всем агентам и качает для них модели
window.bootAllBrains = async function() {
    showBootScreen();
    try {
        // Динамически подгружаем библиотеку Transformers.js
        const { pipeline, env } = await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.0.0');
        
        // Включаем кэш, чтобы не качать 350МБ каждый раз
        env.useBrowserCache = true;
        env.allowLocalModels = false;
        
        // Получаем список всех агентов
        const agents = Object.keys(AGENTS_CONFIG);
        
        // Проходим по каждому агенту
        for (let i = 0; i < agents.length; i++) {
            const agent = agents[i];
            
            // Формируем красивый список для отображения
            const modelsHtml = agents.map((a, idx) => {
                if (idx < i) return `<div style="color:#0f0;">✅ ${a}</div>`;
                if (idx === i) return `<div style="color:#ff0;">⏳ ${a} (загрузка)</div>`;
                return `<div style="color:#666;">⚪ ${a}</div>`;
            }).join('');
            
            // Обновляем экран перед загрузкой
            updateBoot((i / agents.length) * 100, `Загрузка: ${agent}`, modelsHtml);
            
            // Пытаемся загрузить модель
            try {
                window.__brains[agent] = await pipeline('text-generation', 'onnx-community/Qwen2.5-0.5B-Instruct', {
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
            } catch (e) { 
                console.error("Boot " + agent + ":", e); 
            }
        }
        // ==========================================
// local_ai.js - Часть 2 (Завершение загрузки и Запросы)
// ==========================================

        // Когда все модели загружены
        updateBoot(100, "Все модели готовы", agents.map(a => `<div style="color:#0f0;">✅ ${a}</div>`).join(''));
        
        // Небольшая пауза, чтобы пользователь увидел 100%
        await new Promise(r => setTimeout(r, 600));
        
        // Прячем экран
        hideBootScreen();
        
    } catch (e) {
        // Если произошла ошибка, показываем её
        updateBoot(0, "❌ " + e.message, "");
        setTimeout(hideBootScreen, 3000);
    }
};

// ==========================================
// ФУНКЦИЯ ЗАПРОСА К КОНКРЕТНОЙ НЕЙРОСЕТИ
// ==========================================

window.askBrain = async function(agent, msg) {
    // Берем нужный мозг из памяти
    const brain = window.__brains[agent];
    
    // Если мозг еще не загрузился, говорим об этом
    if (!brain) {
        return { text: "⏳ Мозг " + agent + " ещё грузится...", time: "0" };
    }

    // Инициализируем память агента, если её нет
    if (!window.__agentMemory[agent]) {
        window.__agentMemory[agent] = [];
    }
    const mem = window.__agentMemory[agent];

    // Собираем историю сообщений (системный промпт + последние 3)
    const messages = [{ role: "system", content: AGENTS_CONFIG[agent] }];
    mem.slice(-3).forEach(m => messages.push({ role: m.role, content: m.text }));
    messages.push({ role: "user", content: msg });

    // Засекаем время
    const t0 = Date.now();
    
    try {
        // Отправляем запрос в модель
        const out = await brain(messages, { 
            max_new_tokens: 90, 
            temperature: 0.7, 
            do_sample: true, 
            repetition_penalty: 1.1 
        });
        
        // Извлекаем текст из ответа
        let ans = "";
        const gen = out?.[0]?.generated_text;
        
        if (Array.isArray(gen)) {
            ans = gen[gen.length - 1]?.content || "";
        } else if (typeof gen === "string") {
            ans = gen.split('<|im_start|>assistant\n').pop().split('<|im_end|>')[0].trim();
        }

        // Считаем время выполнения
        const time = ((Date.now() - t0) / 1000).toFixed(1);
        
        // Сохраняем контекст
        mem.push({ role: 'user', text: msg });
        mem.push({ role: 'assistant', text: ans });
        if (mem.length > MAX_CONTEXT) mem.shift();
        
        // Возвращаем объект с ответом и временем
        return { text: ans || "(пусто)", time };
        
    } catch (e) {
        return { text: "Ошибка: " + e.message, time: "0" };
    }
};

// ==========================================
// ФУНКЦИЯ СОВЕТА АГЕНТОВ (MULTI-AGENT)
// ==========================================

window.runCouncil = async function(msg) {
    // Приводим сообщение к нижнему регистру
    const t = msg.toLowerCase();
    let tasks = [];
    
    // Определяем, каких агентов привлечь
    if (/код|функци|напиши|скрипт|программ/i.test(t)) {
        tasks = [
            { a: "Кодер", m: msg }, 
            { a: "Хакер", m: "Проверь на уязвимости: " + msg }
        ];
    } else if (/взлом|уязвим|атак|хакер/i.test(t)) {
        tasks = [
            { a: "Хакер", m: msg }, 
            { a: "Охранник", m: "Защита от: " + msg }
        ];
    } else if (/защит|безопасн|парол/i.test(t)) {
        tasks = [
            { a: "Охранник", m: msg }, 
            { a: "Хакер", m: "Как обойти: " + msg }
        ];
    } else {
        // Если тема не подходит под сложные, совет не собираем
        return null;
    }

    // Массив для результатов
    const results = [];
    
    // Запускаем агентов по очереди
    for (const tk of tasks) {
        if (typeof renderMessage === "function") {
            renderMessage("⏳ **" + tk.a + "** думает...", "director", "DevOps");
        }
        // Ждем ответа от каждого
        const r = await window.askBrain(tk.a, tk.m);
        results.push({ agent: tk.a, text: r.text, time: r.time });
    }
    // ==========================================
// local_ai.js - Часть 3 (Завершение)
// ==========================================

    // Формируем отчет
    let report = "🏛 **Совет Агентов**\n\n";
    
    // Проходим по каждому результату
    results.forEach(r => { 
        report += "**" + r.agent + "** _(⏱ " + r.time + " сек):_\n" + r.text + "\n\n"; 
    });

    // Формируем промпт для финального синтеза
    // Передаем исходную задачу и мнения всех участников
    const sumPrompt = "Задача: \"" + msg + "\"\nМнения:\n" + 
                      results.map(r => "- " + r.agent + ": " + r.text).join("\n") + 
                      "\nФинальный ответ кратко.";
                      
    // Просим Регистратора подвести итог
    if (typeof renderMessage === "function") {
        renderMessage("⏳ **Регистратор** собирает итог...", "director", "DevOps");
    }
    
    const s = await window.askBrain("Регистратор", sumPrompt);
    report += "---\n**📋 Итог:**\n" + s.text;
    
    // Возвращаем собранный отчет
    return report;
};

// ==========================================
// ГЛАВНАЯ ФУНКЦИЯ ОБРАБОТКИ СООБЩЕНИЙ
// ==========================================

window.generateLocalResponse = async function(agentName, userMessage) {
    // Очищаем входной текст
    const msg = sanitizeInput(userMessage);
    const low = msg.toLowerCase();

    // ==========================================
    // 1. МГНОВЕННЫЕ ОТВЕТЫ (БЕЗ НЕЙРОСЕТИ)
    // ==========================================
    // Эти ответы не требуют загрузки моделей
    // Они работают даже если модели еще качаются
    // Это экономит время и ресурсы телефона
    
    if (/^(привет|ку|здравствуй|хай)/i.test(low)) {
        return `Привет, ${userPrefs.name}! На связи. 🚀`;
    }
    if (/(как дела|как ты|что делаешь|чем занят)/i.test(low)) {
        return "Все системы в норме, Босс! Совет готов. 😎";
    }
    if (/^(спасибо|благодарю)/i.test(low)) {
        return "Всегда пожалуйста!";
    }
    if (/(который час|сколько времени)/i.test(low)) {
        return `🕒 ${new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`;
    }
    if (/(какое сегодня число|какая дата)/i.test(low)) {
        return `📅 ${new Date().toLocaleDateString('ru-RU')}`;
    }

    // ==========================================
    // 2. ОБРАЩЕНИЕ К КОНКРЕТНОМУ АГЕНТУ
    // ==========================================
    // Если пользователь пишет @Хакер, @Кодер и т.д.
    // Мы ищем совпадение в конфиге и вызываем нужный мозг
    
    const match = msg.match(/@([А-ЯЁа-яёa-z]+)/i);
    if (match) {
        const found = Object.keys(AGENTS_CONFIG).find(a => a.toLowerCase() === match[1].toLowerCase());
        if (found) {
            const clean = msg.replace(/@[А-ЯЁа-яёa-z]+\s*/i, "").trim();
            const r = await window.askBrain(found, clean);
            return `**${found}** _(⏱ ${r.time} сек):_\n${r.text}`;
        }
    }

    // ==========================================
    // 3. СЛОЖНЫЕ ЗАДАЧИ (СОВЕТ АГЕНТОВ)
    // ==========================================
    // Если задача касается кода, взлома или защиты
    // Запускаем коллективное обсуждение
    
    if (/код|напиши|функци|скрипт|взлом|уязвим|атак|защит|безопасн/i.test(low)) {
        const council = await window.runCouncil(msg);
        if (council) return council;
    }

    // ==========================================
    // 4. ОБЫЧНЫЙ ВОПРОС (РЕГИСТРАТОР)
    // ==========================================
    // Все остальные вопросы идут к Регистратору
    // Он отвечает на основе своих знаний
    
    const r = await window.askBrain("Регистратор", msg);
    return `**Регистратор** _(⏱ ${r.time} сек):_\n${r.text}`;
};

// ==========================================
// АВТОЗАПУСК ПРИ СТАРТЕ
// ==========================================
// Запускаем загрузку моделей сразу при открытии Штаба
// Если DOM еще не готов, ждем его загрузки
// Если готов, запускаем немедленно

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', window.bootAllBrains);
} else {
    window.bootAllBrains();
            }
