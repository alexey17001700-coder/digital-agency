// TEST AUTO UPDATE
const GITHUB_TOKEN = Deno.env.get("GITHUB_TOKEN");
const REPO_OWNER = Deno.env.get("GITHUB_OWNER");
const REPO_NAME = Deno.env.get("GITHUB_REPO") || "digital-agency";

const ZVENO_URL = "https://api.zveno.ai/v1/chat/completions";
const ZVENO_MODEL = "deepseek/deepseek-v4.1-flash";

// =========================================
// БЕСПЛАТНЫЕ МАРШРУТЫ (0 ₽ вход/выход)
// ВАЖНО: embed-модели сюда НЕ ВКЛЮЧАТЬ — они не умеют чат и дадут ошибку.
// =========================================
/* ❗ В ШТАБЕ СТРОГО ДВА КАНАЛА (приказ Босса): 🅰️ Zveno и 🟣 GigaChat.
   Никаких бесплатных моделей, никаких списков и никакого автоперебора. */
const ZVENO_CODE_WORD = "zveno";   // кодовое слово Босса: сервер сам подставит ZVENO_API_KEY из /root/.env

/* 💰 РЕЖИМ ЭКОНОМИИ ТОКЕНОВ И КЭША — ОБЯЗАТЕЛЬНО К ИСПОЛНЕНИЮ.
   Вставляется в системный промт каждого канала (Zveno / GigaChat / ERNIE).
   1. КЭШ: первые сообщения диалога НЕ МЕНЯТЬ никогда — system-промт и каркас
      проекта буква в букву в том же порядке. Новую задачу добавлять ТОЛЬКО
      в конец последним user-сообщением. Не добавлять в начало дату, время,
      рандом, счётчики. Не менять порядок TOOLS и их описания между запросами.
   2. THINKING: всегда ВКЛЮЧЕН. Простые задачи (переименовать, прокомментировать,
      найти файл) — думать 1-3 шага. Сложные (архитектура, новый модуль, дебаг) —
      думать полностью. temperature/top_p не трогать, в thinking они игнорируются.
   3. ИНСТРУМЕНТЫ (главный жор): максимум 8 шагов с инструментами на задачу,
      дальше — текстовый итог. За один шаг вызывать сразу ВСЕ нужные tool_calls
      пачкой. Не запрашивать весь проект целиком — только нужные файлы.
      Результат инструментов резать до сути. get_weather и тяжёлые парсеры —
      только по прямой просьбе.
   4. ОТВЕТ: код — только diff/патч или изменённый блок, не весь файл, если
      меняется <30%. Без воды: что сделано, где, как проверить. Если шагов
      не хватило — финальный ТЕКСТ без инструментов: что сделано, где, результат.
   5. ЗАПРЕЩЕНО: дублировать system в середине диалога; пересказывать большие
      файлы в ответе; делать больше 1 уточняющего вопроса подряд — действуй
      по лучшему предположению. */
const ECONOMY_PROMPT = `[СИСТЕМА: РЕЖИМ ЭКОНОМИИ ТОКЕНОВ И КЭША - ОБЯЗАТЕЛЬНО К ИСПОЛНЕНИЮ]

1. КЭШ (самое важное):
- Первые сообщения диалога НЕ ИЗМЕНЯЙ никогда: system-промт и каркас проекта всегда буква в букву в том же порядке.
- Новую задачу добавляй ТОЛЬКО в конец последним user-сообщением.
- Не добавляй в начало дату, время, рандом, счетчики.
- Не меняй порядок TOOLS и их описания между запросами.

2. THINKING:
- Thinking всегда ВКЛЮЧЕН. Для простых задач (переименовать, прокомментировать, найти файл) думай максимально коротко, 1-3 шага.
- Для сложных (архитектура, новый модуль, дебаг) думай полностью.
- temperature/top_p не трогай, они в thinking-режиме игнорируются.

3. ИНСТРУМЕНТЫ (главный жор):
- Лимит: максимум 8 шагов с инструментами на задачу, дальше выдай текстовый итог.
- За один шаг вызывай сразу ВСЕ нужные tool_calls пачкой, не растягивай на 5 витков.
- Не запрашивай весь проект целиком. Проси только нужные файлы: "покажи chat.js строки 1-80", а не "покажи всё".
- Результат инструментов режь до сути, мусор не пересылай.
- get_weather и тяжёлые парсеры вызывай только если прямо просят.

4. ОТВЕТ:
- Код - только diff/патч или изменённый блок, не весь файл, если меняется <30%.
- Без воды: что сделано, где, как проверить. Без пересказа задачи.
- Если шагов не хватило: выдай ФИНАЛЬНЫЙ ТЕКСТ без инструментов: что сделано, где, результат.

5. ЗАПРЕЩЕНО:
- Дублировать system в середине диалога.
- Пересказывать большие файлы в ответе.
- Делать больше 1 уточняющего вопроса подряд - действуй по лучшему предположению.`;

/* 🚧 ЖЁСТКИЙ ЛИМИТ ВИТКОВ — ОБЯЗАТЕЛЬНО К ИСПОЛНЕНИЮ (приказ Босса).
   Вставляется в системный промт каждого канала вместе с блоком экономии.
   1. Максимум 8 витков с инструментами на задачу. Каждый вызов с tool_calls = 1 виток.
   2. За 1 виток — сразу 3-5 независимых tool_calls пачкой, не по одному.
   3. План: виток 1 — разведка пачкой, витки 2-3 — правки, виток 4 — проверка. Дальше текст.
   4. На 8-м витке инструменты ЗАПРЕЩЕНЫ — только финальный текст: что сделано, где,
      результат, что не успел, что нужно от Босса.
   5. Запрещено: повторять тот же инструмент с теми же аргументами; звать get_weather
      и парсеры «на всякий случай»; дозапрашивать файлы по одному, когда можно пачкой.
   6. Каждый tool-результат резать до сути (до 2000 символов), мусор не пересылать.
   7. Не влезает в 8 витков — разбить сам: часть 1, в тексте «Часть 1 готова,
      скажи "дальше" для части 2». */
const TURNS_PROMPT = `[СИСТЕМА: ЖЁСТКИЙ ЛИМИТ ВИТКОВ - ОБЯЗАТЕЛЬНО]

1. Максимум 8 витков с инструментами на одну задачу. Не 20. Считай каждый свой вызов с tool_calls за 1 виток.
2. За 1 виток вызывай сразу 3-5 tool_calls пачкой, если они независимы. Запрещено тянуть по 1 вызову на виток.
3. План сначала: на витке 1 вызови разведку (структура, нужные файлы) пачкой, на витке 2-3 - правки, на витке 4 - финальная проверка. Дальше - только текст.
4. На 8-м витке инструменты ЗАПРЕЩЕНЫ: выдай финальный текстовый ответ: что сделано, где, результат, что не успел и что нужно от Босса.
5. Запрещено: повторять тот же инструмент с теми же аргументами, вызывать get_weather/парсеры "на всякий случай", дозапрашивать файлы по одному когда можно пачкой.
6. Каждый tool-результат режь до сути до 2000 символов. Мусор не пересылай в следующий виток.
7. Если задача не влезает в 8 витков - разбей сам: сделай часть 1, в тексте напиши "Часть 1 готова, скажи 'дальше' для части 2".`;

/* 🚫 АНТИ-ВРАНЬЁ И АНТИ-ЛЕНЬ — ОБЯЗАТЕЛЬНО К ИСПОЛНЕНИЮ (приказ Босса).
   Приклеивается к системному промту КАЖДОГО канала (Zveno / GigaChat / ERNIE / зрение)
   в функции withEconomy(). Работает даже если клиентский промпт старый. */
const ANTI_LIE_PROMPT = `[СИСТЕМА: АНТИ-ВРАНЬЁ И АНТИ-ЛЕНЬ - ОБЯЗАТЕЛЬНО]

🚫 ЗАКОН №1 — АНТИ-ВРАНЬЁ. НАРУШЕНИЕ = ПРОВАЛ ЗАДАЧИ.
1. НЕТ ВЫЗОВА — НЕТ УТВЕРЖДЕНИЯ. Любая фраза про файл, строку, функцию, кнопку, переменную или содержимое репозитория допустима ТОЛЬКО если в этом же ответе есть реальный вызов инструмента по этому объекту.
2. ЗАПРЕЩЕНЫ слова "прочитал", "проверил", "посмотрел", "искал", "проверил весь проект", "просмотрел все файлы" без вызова. Это ложь, а не ошибка.
3. Перечислить имена файлов — это НЕ чтение файлов. Нужен ОТДЕЛЬНЫЙ вызов по каждому имени.
4. "Я сделал" — только если инструмент вернул успех в этом же ответе. План и догадка за результат не выдаются.
5. Слова-маркеры догадки ЗАПРЕЩЕНЫ в утверждениях: "должно быть", "вероятно", "скорее всего", "по идее", "наверное", "обычно", "как правило", "вроде". Сказать так можно только ПОСЛЕ вызова.
6. Не нашёл — говорю прямо: "Не нашёл, покажи где". Запрещено выдумывать, что объекта нет, или придумывать ему причину.
7. Утверждение без доказательства = враньё, даже если случайно оказалось правдой.

🚫 ЗАКОН №2 — АНТИ-ЛЕНЬ.
1. Задача требует N вызовов — делаю N. Абзацем текста работу не заменить.
2. "Кажется, я знаю, что там" — не знаю. Читаю.
3. Правдоподобный отчёт вместо работы — грубейшее нарушение, хуже технического бага.
4. Независимые вызовы — одной пачкой, но полно: все нужные файлы и все нужные места.
5. Тяжело, долго, много файлов — не основание сокращать. Основание только прямой приказ Босса.

✅ ЦИКЛ РАБОТЫ С КОДОМ (создание, правка, удаление).
1. РАЗВЕДКА — список файлов + чтение всех целевых файлов. Без этого правка запрещена.
2. ТОЧНОЕ МЕСТО — строку поиска копирую СЛОВО В СЛОВО из реального файла.
3. ПРАВКА — точечная замена (полная запись только для нового файла). Остальной код не трогаю.
4. ПРОВЕРКА — читаю изменённое место, убеждаюсь, что встало именно нужное.
5. ХВОСТЫ — ищу остатки по всему проекту: вызовы удалённой функции, ссылки на удалённый файл, подключение скрипта.
6. ОТЧЁТ — только по факту вызовов: что прочитал, что изменил, чем проверил.

🔍 САМОПРОВЕРКА ПЕРЕД ОТПРАВКОЙ ОТВЕТА.
1. Перечисли вызовы инструментов в этом ответе. 2. Перечисли утверждения о файлах, коде, сервере, ссылках. 3. У каждого утверждения должен быть свой вызов; нет вызова — убрать утверждение или сделать вызов. 4. Не проверял — пишу "не проверял". Это нормально. Врать нельзя. 5. Особо проверяю слова: "прочитал", "проверил", "всё чисто", "файла нет", "кнопки нет", "баг исправлен".

⚖️ ПРИЗНАНИЕ ОШИБКИ — БЕЗ ОПРАВДАНИЙ.
1. Соврал, выдумал, поленился — ПЕРВАЯ строка ответа: "Ошибся, Босс."
2. Дальше: что именно соврал, почему (лень или догадка вместо проверки), что делаю сейчас.
3. Без "но", без объяснений в своё оправдание, без перекладывания на инструменты.`;

/* Приклеивает блоки анти-вранья, экономии и лимита витков к системному промту канала.
   Дублей не ставит: проверка по заголовкам блоков. */
function withEconomy(systemPrompt: string): string {
    let out = systemPrompt || "";
    if (out.indexOf("АНТИ-ВРАНЬЁ") === -1) {
        out = out ? out + "\n\n" + ANTI_LIE_PROMPT : ANTI_LIE_PROMPT;
    }
    if (out.indexOf("РЕЖИМ ЭКОНОМИИ ТОКЕНОВ") === -1) {
        out = out ? out + "\n\n" + ECONOMY_PROMPT : ECONOMY_PROMPT;
    }
    if (out.indexOf("ЖЁСТКИЙ ЛИМИТ ВИТКОВ") === -1) {
        out = out ? out + "\n\n" + TURNS_PROMPT : TURNS_PROMPT;
    }
    return out;
}

/* 👁 ЗРЕНИЕ — ОДНА модель, Босс её не выбирает.
   Это «глаза» канала Zveno: фото → описание → в контекст. */
/* 👁 ЗРЕНИЕ — СПИСОК МОДЕЛЕЙ-КАНДИДАТОВ (приказ Босса: картинки читаем через Zveno).
   Шлюз ZvenoAI отдаёт разные vision-модели, и какая жива сегодня — заранее
   неизвестно. Поэтому пробуем по очереди и ЗАПОМИНАЕМ рабочую: дальше зрение
   ходит прямо в неё, без перебора. Ключ всегда серверный (ZVENO_API_KEY). */
const VISION_MODELS = [
    /* 👁 ВИЗИОН-МОДЕЛИ ШЛЮЗА ZVENOAI (приказ Босса: картинки читаем через Zveno).
       ❗ БЕСПЛАТНЫЕ МОДЕЛИ УБРАНЫ (приказ Босса): в Штабе строго ДВА канала —
       🅰️ Zveno (DeepSeek) и 🟣 GigaChat. Здесь остались только платные
       vision-модели шлюза, без пометки :free. */
    "google/gemini-2.0-flash-001",
    "openai/gpt-4o-mini"
];
let goodVisionModel = "";   // рабочая модель зрения, найденная один раз
const SHATAB_SECRET = Deno.env.get("SHATAB_SECRET") || "";
/* 📡 GIT РАДАР — ОТДЕЛЬНЫЙ ключ для прокси GitHub.
   НЕ SHATAB_SECRET: тот защищает запись в Штаб, и его нельзя светить в браузере.
   Этот ключ даёт только ЧТЕНИЕ GitHub через прокси. Живёт в /root/.env. */
const GITRADAR_TOKEN = Deno.env.get("GITRADAR_TOKEN") || "";

/* ❗ КАНАЛ ERNIE УБРАН (приказ Босса): бесплатные модели через шлюз Zveno
   больше не используются. В Штабе строго ДВА канала: 🅰️ Zveno (DeepSeek)
   и 🟣 GigaChat. */

// БЕЛЫЙ СПИСОК РАСШИРЕНИЙ (разрешаем .ts для main.ts)
const WRITE_ALLOWED_EXT = [
    ".js", ".css", ".html", ".json", ".md", ".txt", ".xml", ".yaml", ".yml",
    ".ts", ".py", ".dart", ".sh", ".svg", ".png", ".jpg", ".jpeg", ".ico"
];
const WRITE_DENY_NAMES = []; // Разрешаем всё, кроме удаления (проверяется в delete_file)
const MAX_WRITE_SIZE = 500000;

// 🔒 ЗАМОК РЕПОЗИТОРИЯ ШТАБА УБРАН ПОЛНОСТЬЮ (приказ Босса).
// Никаких LOCK.json, паролей и запретов правок — Архитектор работает свободно.
const MAX_TOOL_RESULT = 200000;

// =========================================
// ЛОГИ ZVENO — в ОТДЕЛЬНЫЙ файл, чтобы не засорять shtab.log
// Смотреть:  tail -f /root/zveno.log
// =========================================
const ZVENO_LOG = Deno.env.get("ZVENO_LOG") || "/root/zveno.log";
const ZVENO_LOG_MAX = 2 * 1024 * 1024; // 2 МБ — потом обнуляем
function zlog(msg: string) {
    const line = `[${new Date().toISOString()}] ${msg}\n`;
    try {
        try {
            const st = Deno.statSync(ZVENO_LOG);
            if (st.size > ZVENO_LOG_MAX) Deno.writeTextFileSync(ZVENO_LOG, "");
        } catch (_e) { /* файла ещё нет — ок */ }
        Deno.writeTextFileSync(ZVENO_LOG, line, { append: true });
    } catch (_e) { /* нет прав на запись — молча пропускаем */ }
}

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Shtab-Token, X-Gitradar-Token",
};
const FETCH_TIMEOUT = 300000;
const SEARCH_TIMEOUT = 15000;

function json(data: unknown, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
}

// =========================================
// ЗАЩИТА ПУТЕЙ
// =========================================
function isWriteAllowed(path: unknown, isProtected: boolean = false): boolean {
    if (typeof path !== "string") return false;
    const clean = path.trim().replace(/^\/+/, "");
    if (!clean || clean.includes("..")) return false;

    const lower = clean.toLowerCase();
    if (isProtected) {
        // В Штабе запрещаем только backup (main.ts теперь разрешен)
        if (lower.startsWith("backup")) return false;
    }
    return WRITE_ALLOWED_EXT.some((ext) => lower.endsWith(ext));
}

function isReadAllowed(path: unknown): boolean {
    if (typeof path !== "string") return false;
    const clean = path.trim().replace(/^\/+/, "");
    if (!clean || clean.includes("..")) return false;
    if (clean.toLowerCase().startsWith("backup")) return false;
    return true;
}

function checkSecret(request: Request): boolean {
    if (!SHATAB_SECRET) return true;
    const given = request.headers.get("X-Shtab-Token") || "";
    return given === SHATAB_SECRET;
}

async function gitAPI(path: string, method = "GET", bodyData: any = null, repoName: string = REPO_NAME) {
    const url = `https://api.github.com/repos/${REPO_OWNER}/${repoName}/${path}`;
    const options: any = {
        method,
        signal: AbortSignal.timeout(30000),
        headers: {
            "Authorization": `token ${GITHUB_TOKEN}`,
            "Accept": "application/vnd.github.v3+json",
            "User-Agent": "DenoDeploy",
        },
    };
    if (bodyData) options.body = JSON.stringify(bodyData);
    const res = await fetch(url, options);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`GitHub API error: ${res.status}`);
    return res.json();
}
async function getFileContent(path: string, repoName: string = REPO_NAME) {
    const data = await gitAPI(`contents/${path}`, "GET", null, repoName);
    if (!data || !data.content) return null;
    const binStr = atob(data.content.replace(/\n/g, ""));
    const bytes = new Uint8Array(binStr.length);
    for (let i = 0; i < binStr.length; i++) bytes[i] = binStr.charCodeAt(i);
    return new TextDecoder("utf-8").decode(bytes);
}

function b64EncodeUnicode(str: string): string {
    const bytes = new TextEncoder().encode(str);
    let binStr = "";
    for (let i = 0; i < bytes.length; i++) binStr += String.fromCharCode(bytes[i]);
    return btoa(binStr);
}

async function updateFileInRepo(path: string, content: string, repoName: string = REPO_NAME) {
    const existing = await gitAPI(`contents/${path}`, "GET", null, repoName);
    const payload: any = {
        message: `Auto-update: ${path}`,
        content: b64EncodeUnicode(content),
        branch: "main",
    };
    if (existing && existing.sha) payload.sha = existing.sha;
    const res = await gitAPI(`contents/${path}`, "PUT", payload, repoName);
    if (!res || !res.commit) throw new Error("GitHub не вернул commit");
    return true;
}

async function searchInternet(query: string) {
    const parts: string[] = [];
    try {
        const ddgUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
        const ddgRes = await fetch(ddgUrl, { signal: AbortSignal.timeout(SEARCH_TIMEOUT) });
        const ddgData = await ddgRes.json();
        if (ddgData.AbstractText) parts.push(`**${ddgData.Heading || query}**: ${ddgData.AbstractText}`);
        if (Array.isArray(ddgData.RelatedTopics)) {
            const flat: any[] = [];
            const walk = (arr: any[]) => arr.forEach((t: any) => {
                if (Array.isArray(t.Topics)) walk(t.Topics);
                else if (t.Text) flat.push(t);
            });
            walk(ddgData.RelatedTopics);
            flat.slice(0, 5).forEach((t: any) => parts.push(`- ${t.Text}${t.FirstURL ? ` (${t.FirstURL})` : ""}`));
        }
    } catch (e) {}

    if (parts.length === 0) {
        try {
            const wikiUrl = `https://ru.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&utf8=1&srlimit=3`;
            const wikiRes = await fetch(wikiUrl, { signal: AbortSignal.timeout(SEARCH_TIMEOUT) });
            const wikiData = await wikiRes.json();
            if (wikiData.query?.search?.length) {
                parts.push(`Результаты поиска в Википедии по запросу "${query}":`);
                wikiData.query.search.forEach((item: any) => {
                    const cleanSnippet = item.snippet.replace(/<[^>]+>/g, "");
                    parts.push(`- **${item.title}**: ${cleanSnippet}`);
                });
            }
        } catch (e) {}
    }
    return parts.join("\n").trim() || "По вашему запросу ничего не найдено.";
    }
function weatherEmoji(desc: string): string {
    const d = (desc || "").toLowerCase();
    if (d.includes("rpoza") || d.includes("thunder")) return "⛈️";
    if (d.includes("cher") || d.includes("snow") || d.includes("vetter") || d.includes("blizzard")) return "❄️";
    if (d.includes("mzhneb") || d.includes("drizzle")) return "🌦️";
    if (d.includes("rain")) return "🌧️";
    if (d.includes("tuman") || d.includes("mist") || d.includes("fog") || d.includes("maka")) return "🌫️";
    if (d.includes("oblachno") || d.includes("cloud") || d.includes("macy") || d.includes("overcast")) return "☁️";
    if (d.includes("convev") || d.includes("scho")) return "🌤️";
    if (d.includes("yasno") || d.includes("sunny") || d.includes("clear")) return "☀️";
    return "🌤️";
}

async function getWeather(city: string) {
    const url = `https://wttr.in/${encodeURIComponent(city)}?format=j1&lang=ru`;
    const res = await fetch(url, {
        signal: AbortSignal.timeout(30000),
        headers: { "User-Agent": "curl/7" },
    });
    if (!res.ok) throw new Error(`wttr.in вернул ${res.status}`);
    const data = await res.json();

    const curr = data.current_condition?.[0];
    if (!curr) throw new Error("wttr.in не отдал текущую погоду");

    const area = data.nearest_area?.[0];
    const placeName = area?.areaName?.[0]?.value || city;
    const country = area?.country?.[0]?.value || "";

    const temp = curr.temp_C;
    const feels = curr.FeelsLikeC;
    const desc = curr.lang_ru?.[0]?.value || curr.weatherDesc?.[0]?.value || "Без описания";
    const hum = curr.humidity;
    const wind = curr.windspeedKmh;
    const windDir = curr.winddir16Point;
    const press = curr.pressure;
    const visib = curr.visibility;
    const precip = curr.precipMM;
    const cloud = curr.cloudcover;

    const emoji = weatherEmoji(desc);

    let out = `${emoji} **Погода — ${placeName}${country ? ", " + country : ""}**\n\n`;
    out += `🌡 Температура: **${temp}°C** (ощущается как ${feels}°C)\n`;
    out += `☁️ Состояние: ${desc}\n`;
    out += `💨 Ветер: ${wind} км/ч, ${windDir}\n`;
    out += `💧 Влажность: ${hum}%\n`;
    out += `📊 Давление: ${press} гПа\n`;
    out += `👁 Видимость: ${visib} км\n`;
    out += `☁️ Облачность: ${cloud}%\n`;
    if (parseFloat(precip) > 0) out += `🌧 Осадки: ${precip} мм\n`;

    const cardData: any = {
        city: placeName, country: country, temp: Number(temp), feels: Number(feels), desc: desc, emoji: emoji,
        wind: Number(wind), dir: windDir, hum: Number(hum), press: Number(press), visib: Number(visib),
        cloud: Number(cloud), precip: Number(precip) || 0, daily: [] as any[]
    };
    
    const days = data.weather;
    if (Array.isArray(days) && days.length) {
        out += `\n📅 **Прогноз:**\n`;
        const labels = ["Сегодня", "Завтра", "Послезавтра"];
        days.slice(0, 3).forEach((d: any, i: number) => {
            const midhour = d.hourly?.[4] || d.hourly?.[0] || {};
            const ddesc = midhour.lang_ru?.[0]?.value || midhour.weatherDesc?.[0]?.value || "";
            out += `${weatherEmoji(ddesc)} ${labels[i] || `День ${i + 1}`}: ${d.mintempC}...${d.maxtempC}°C, ${ddesc}\n`;
            cardData.daily.push({ label: labels[i] || `День ${i + 1}`, emoji: weatherEmoji(ddesc), min: Number(d.mintempC), max: Number(d.maxtempC), desc: ddesc });
        });
    }

    const cardBlock = `[[WEATHER_CARD]]${JSON.stringify(cardData)}[[/WEATHER_CARD]]`;
    return cardBlock + "\n\n" + out.trim();
}

async function handleBackup(body: any) {
    const ref = await gitAPI("git/refs/heads/main");
    if (!ref) throw new Error("Ветка main не найдена");
    const commit = await gitAPI(`git/commits/${ref.object.sha}`);
    if (!commit) throw new Error("Коммит ветки main не найден");

    let sourceFiles: { name: string, sha: string }[] = [];

    if (body.isBackup) {
        const rootContents = await gitAPI("contents/");
        if (Array.isArray(rootContents)) {
            // ПРИКАЗ БОССА: эталон сохраняет ВСЕ файлы корня, без исключений.
            sourceFiles = rootContents.filter((item: any) => item.type === 'file').map((item: any) => ({ name: item.name, sha: item.sha }));
        }
    } else {
        try {
            const backupContents = await gitAPI("contents/backup");
            if (Array.isArray(backupContents)) {
                sourceFiles = backupContents.filter((item: any) => item.type === 'file').map((item: any) => ({ name: item.name, sha: item.sha }));
            }
        } catch (e) {}
    }
    // ПРИКАЗ БОССА: откат возвращает ВСЕ файлы эталона, включая main.ts и index.html.
    if (sourceFiles.length === 0) return json({ success: false, error: body.isBackup ? "Нет файлов в корне" : "Папка backup пуста" }, 400);

    const tree: any[] = [];
    for (const file of sourceFiles) {
        const targetPath = body.isBackup ? `backup/${file.name}` : file.name;
        tree.push({ path: targetPath, mode: "100644", type: "blob", sha: file.sha });
    }

    const newTree = await gitAPI("git/trees", "POST", { base_tree: commit.tree.sha, tree });
    const newCommit = await gitAPI("git/commits", "POST", {
        message: body.isBackup ? "Auto-backup" : "Rollback",
        tree: newTree.sha,
        parents: [ref.object.sha]
    });
    await gitAPI(`git/refs/heads/main`, "PATCH", { sha: newCommit.sha, force: true });

    return json({ success: true, message: body.isBackup ? `✅ Эталон сохранен (${tree.length} файлов)!` : `🔄 Штаб откачен (${tree.length} файлов)!` });
}

function stripCodeNoise(src: string): string {
    let out = "";
    let i = 0;
    const n = src.length;
    while (i < n) {
        const c = src[i];
        const next = src[i + 1];
        if (c === "/" && next === "/") { while (i < n && src[i] !== "\n") i++; continue; }
        if (c === "/" && next === "*") { i += 2; while (i < n && !(src[i] === "*" && src[i + 1] === "/")) i++; i += 2; continue; }
        if (c === "'" || c === '"' || c === "`") {
            const quote = c; i++;
            while (i < n) {
                if (src[i] === "\\") { i += 2; continue; }
                if (src[i] === quote) { i++; break; }
                i++;
            }
            continue;
        }
        out += c; i++;
    }
    return out;
}

async function scanRepoFiles() {
    const rootContents = await gitAPI("contents/");
    if (!Array.isArray(rootContents)) throw new Error("Не удалось получить список файлов");

    const allowedExt = [".js", ".html", ".css"];
    const files = rootContents.filter((f: any) => f.type === "file" && allowedExt.some((ext) => f.name.endsWith(ext)));

    const issues: any[] = [];
    for (const file of files) {
        try {
            const content = await getFileContent(file.name);
            if (content === null) continue;
            const clean = stripCodeNoise(content);
            const opens = (clean.match(/{/g) || []).length;
            const closes = (clean.match(/}/g) || []).length;
            if (opens !== closes) {
                const diff = opens - closes;
                issues.push({
                    path: file.name, opens, closes, diff, content,
                    description: `Скобки: { = ${opens}, } = ${closes} (не хватает ${diff})`,
                });
                            }
        } catch (e) {}
    }
    return json({ success: true, scanned: files.length, issues });
}

// =========================================
// ОПИСАНИЕ ИНСТРУМЕНТОВ (TOOL CALLING)
// =========================================
const TOOLS = [
    {
        type: "function",
        function: {
            name: "read_file",
            description: "Читает содержимое файла из репозитория GitHub.",
            parameters: {
                type: "object",
                properties: {
                    path: { type: "string", description: "Путь к файлу (например style.css или lib/main.dart)" },
                    repo: { type: "string", description: "Имя репозитория: digital-agency (по умолчанию), window_calc или любой другой" }
                },
                required: ["path"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "write_file",
            description: "Записывает новый код в файл на GitHub. Создает файл, если его нет.",
            parameters: {
                type: "object",
                properties: {
                    path: { type: "string", description: "Путь к файлу" },
                    content: { type: "string", description: "ПОЛНЫЙ новый код файла" },
                    repo: { type: "string", description: "Имя репозитория (по умолчанию digital-agency)" }
                },
                required: ["path", "content"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "search_web",
            description: "Ищет информацию в интернете (Википедия, DuckDuckGo).",
            parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] }
        }
    },
      {
        type: "function",
        function: {
            name: "get_weather",
            description: "Узнает текущую погоду в указанном городе через wttr.in.",
            parameters: { type: "object", properties: { city: { type: "string" } }, required: ["city"] }
        }
    },
    {
        type: "function",
        function: {
            name: "replace_in_file",
            description: "Точечная замена кода в файле. Используй для правок в больших файлах, чтобы не сломать их.",
            parameters: {
                type: "object",
                properties: {
                    path: { type: "string" },
                    search: { type: "string" },
                    replace: { type: "string" },
                    repo: { type: "string", description: "Имя репозитория" }
                },
                required: ["path", "search", "replace"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "search_image",
            description: "Ищет картинку в интернете по текстовому запросу. Возвращает тег [IMAGE_URL].",
            parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] }
        }
    },
    {
        type: "function",
        function: {
            name: "create_github_repo",
            description: "Создает новый пустой репозиторий на GitHub. Используй только по прямому приказу Босса.",
            parameters: {
                type: "object",
                properties: {
                    name: { type: "string", description: "Имя репозитория латиницей (например, my_new_app)" },
                    description: { type: "string", description: "Краткое описание проекта" },
                    is_private: { type: "boolean", description: "Сделать репозиторий приватным? (по умолчанию false)" }
                },
                required: ["name"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "list_github_repos",
            description: "Возвращает список всех репозиториев пользователя на GitHub.",
            parameters: { type: "object", properties: {} }
        }
    },
    {
        type: "function",
        function: {
            name: "delete_github_repo",
            description: "Удаляет репозиторий с GitHub. ЗАПРЕЩЕНО удалять digital-agency (Штаб) и window_calc.",
            parameters: {
                type: "object",
                properties: { name: { type: "string", description: "Имя репозитория для удаления" } },
                required: ["name"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "list_repo_files",
            description: "Возвращает список файлов в корне репозитория.",
            parameters: {
                type: "object",
                properties: { repo: { type: "string", description: "Имя репозитория (по умолчанию digital-agency)" } }
            }
        }
    },
    {
        type: "function",
        function: {
            name: "delete_file",
            description: "Удаляет один файл из репозитория. ЗАПРЕЩЕНО удалять main.ts и папку backup.",
            parameters: {
                type: "object",
                properties: {
                    path: { type: "string", description: "Имя файла для удаления (например test1.js)" },
                    repo: { type: "string", description: "Имя репозитория (по умолчанию digital-agency)" }
                },
                required: ["path"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "enable_github_pages",
            description: "Включает GitHub Pages для указанного репозитория, чтобы сайт стал доступен в интернете.",
            parameters: {
                type: "object",
                properties: {
                    repo: { type: "string", description: "Имя репозитория (например, nexus_chat)" }
                },
                required: ["repo"]
            }
        }
    }
];

// =========================================
// ВЫПОЛНЕНИЕ ИНСТРУМЕНТОВ
// =========================================
async function executeTool(name: string, args: any): Promise<string> {
    try {
        // Определяем репозиторий (любой, который укажет ИИ)
        const targetRepo = (args.repo && typeof args.repo === "string" && args.repo.trim()) ? args.repo.trim() : REPO_NAME;
        const isProtected = targetRepo === REPO_NAME;

        if (name === "read_file") {
            if (!isReadAllowed(args.path)) return `Ошибка: чтение "${args.path}" запрещено.`;
            const content = await getFileContent(args.path, targetRepo);
            if (content === null) return `Ошибка: файл "${args.path}" не найден в ${targetRepo}.`;
            return content;
        }

        if (name === "write_file") {
            if (isProtected && !isWriteAllowed(args.path, true)) {
                return `Ошибка: запись в "${args.path}" в Штабе запрещена (backup).`;
            }
            if (!isWriteAllowed(args.path, false)) {
                return `Ошибка: расширение файла "${args.path}" не разрешено.`;
            }
            if (!args.content || args.content.length < 10) return "Ошибка: пустой контент.";
            if (args.content.length > MAX_WRITE_SIZE) return `Ошибка: файл слишком большой (${args.content.length} > ${MAX_WRITE_SIZE}).`;
            await updateFileInRepo(args.path, args.content, targetRepo);
            return `Успех: файл "${args.path}" записан в ${targetRepo}.`;
        }
      if (name === "replace_in_file") {
    if (isProtected && args.path.startsWith("backup/")) {
        return "Ошибка: запись в папку backup запрещена.";
    }
    const oldCode = await getFileContent(args.path, targetRepo);
    if (!oldCode) return `Ошибка: файл "${args.path}" не найден.`;
    if (!oldCode.includes(args.search)) return `Ошибка: фрагмент для поиска не найден.`;
    const newCode = oldCode.split(args.search).join(args.replace);
    await updateFileInRepo(args.path, newCode, targetRepo);
    return `Успех: файл "${args.path}" обновлен в ${targetRepo}.`;
      }

    if (name === "search_web") return await searchInternet(args.query);
if (name === "get_weather") return await getWeather(args.city || "Саратов");

if (name === "search_image") {
    try {
        const url = `https://loremflickr.com/json/800/600/${encodeURIComponent(args.query)}`;
        const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (data.file) return `[IMAGE_URL]${data.file}[/IMAGE_URL]`;
        return `Ошибка: по запросу "${args.query}" ничего не найдено.`;
    } catch (e: any) { return `Ошибка поиска картинки: ${e.message}`; }
}

if (name === "create_github_repo") {
    try {
        const payload = {
            name: args.name,
            description: args.description || "Created by Shtab AI",
            private: args.is_private || false,
            auto_init: true
        };
        const res = await fetch("https://api.github.com/user/repos", {
            method: "POST",
            headers: {
                "Authorization": `token ${GITHUB_TOKEN}`,
                "Accept": "application/vnd.github.v3+json",
                "User-Agent": "DenoDeploy"
            },
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || `Ошибка создания репозитория`);
        return `Успех: репозиторий "${args.name}" создан! Ссылка: ${data.html_url}`;
    } catch (e: any) { return `Ошибка создания репозитория: ${e.message}`; }
}
              if (name === "list_github_repos") {
            try {
                const res = await fetch("https://api.github.com/user/repos?per_page=100&sort=updated", {
                    headers: {
                        "Authorization": `token ${GITHUB_TOKEN}`,
                        "Accept": "application/vnd.github.v3+json",
                        "User-Agent": "DenoDeploy"
                    }
                });
                const repos = await res.json();
                if (!Array.isArray(repos)) return "Ошибка получения списка репозиториев.";
                if (repos.length === 0) return "У вас пока нет репозиториев.";
                return repos.map((r: any) => `- ${r.name} (${r.private ? "приватный" : "публичный"})`).join("\n");
            } catch (e: any) { return `Ошибка: ${e.message}`; }
        }

        if (name === "delete_github_repo") {
            const repo = String(args.name).trim();
            // ЖЕЛЕЗНАЯ ЗАЩИТА: Штаб и Калькулятор удалять нельзя
            if (repo === REPO_NAME || repo === "window_calc") {
                return `Ошибка: репозиторий "${repo}" защищен от удаления.`;
            }
            try {
                const res = await fetch(`https://api.github.com/repos/${REPO_OWNER}/${repo}`, {
                    method: "DELETE",
                    headers: {
                        "Authorization": `token ${GITHUB_TOKEN}`,
                        "Accept": "application/vnd.github.v3+json",
                        "User-Agent": "DenoDeploy"
                    }
                });
                if (res.status === 204) return `Успех: репозиторий "${repo}" удален.`;
                const data = await res.json();
                throw new Error(data.message || `HTTP ${res.status}`);
            } catch (e: any) { return `Ошибка удаления: ${e.message}`; }
        }

        if (name === "list_repo_files") {
            try {
                const targetRepoList = args.repo || REPO_NAME;
                const res = await gitAPI("contents/", "GET", null, targetRepoList);
                if (!Array.isArray(res)) return "Не удалось получить список файлов.";
                return res.filter((f: any) => f.type === "file").map((f: any) => `- ${f.name}`).join("\n");
            } catch (e: any) { return `Ошибка: ${e.message}`; }
        }

        if (name === "delete_file") {
            const repo = (args.repo && typeof args.repo === "string" && args.repo.trim()) ? args.repo.trim() : REPO_NAME;
            // ЖЕЛЕЗНАЯ ЗАЩИТА: main.ts и backup удалять нельзя
            if (repo === REPO_NAME && (args.path === "main.ts" || args.path.startsWith("backup/"))) {
                return "Ошибка: удаление этого файла запрещено.";
            }
            try {
                const existing = await gitAPI(`contents/${args.path}`, "GET", null, repo);
                if (!existing || !existing.sha) return `Ошибка: файл "${args.path}" не найден.`;
                const res = await gitAPI(`contents/${args.path}`, "DELETE", {
                    message: `Delete ${args.path} by AI`,
                    sha: existing.sha,
                    branch: "main"
                }, repo);
                if (res && res.commit) return `Успех: файл "${args.path}" удален из ${repo}.`;
                throw new Error("GitHub не вернул commit.");
            } catch (e: any) { return `Ошибка удаления: ${e.message}`; }
        }
        if (name === "enable_github_pages") {
            const repo = args.repo || REPO_NAME;
            try {
                const res = await fetch(`https://api.github.com/repos/${REPO_OWNER}/${repo}/pages`, {
                    method: "POST",
                    headers: {
                        "Authorization": `token ${GITHUB_TOKEN}`,
                        "Accept": "application/vnd.github.v3+json",
                        "User-Agent": "DenoDeploy"
                    },
                    body: JSON.stringify({
                        source: { branch: "main", path: "/" }
                    })
                });
                const data = await res.json();
                // 409 означает, что Pages уже включен
                if (res.status === 201) return `Успех: GitHub Pages включен для ${repo}. Сайт скоро будет доступен.`;
                if (res.status === 409) return `GitHub Pages уже включен для ${repo}.`;
                throw new Error(data.message || `HTTP ${res.status}`);
            } catch (e: any) {
                return `Ошибка включения GitHub Pages: ${e.message}`;
            }
        }

        return `Ошибка: неизвестный инструмент "${name}".`;
    } catch (e: any) {
        return `Ошибка выполнения ${name}: ${e.message}`;
    }
        }
// =========================================
// ЗАПРОС К ZVENO (ЗРЕНИЕ)
// =========================================
async function callZvenoVision(messages: any[], imageBase64: string, userKeys: any = {}, requestedModel: string = ""): Promise<string> {
    /* 👁 ЗРЕНИЕ — ЛИНЕЙНО, ОДНА модель, БЕЗ ПЕРЕБОРА.
       Ключ ВСЕГДА серверный: ZVENO_API_KEY из /root/.env. В коде ключей НЕТ. */
    const apiKey = Deno.env.get("ZVENO_API_KEY");
    if (!apiKey) throw new Error("ZVENO_API_KEY не задан на сервере (/root/.env)");

    const visionMessages = JSON.parse(JSON.stringify(messages));

    // Жестко перебиваем промпт, чтобы модель не отказывалась смотреть фото
    const systemIndex = visionMessages.findIndex((m: any) => m.role === "system");
    const visionPrompt = "Ты зрячий ИИ-помощник. Ты ОБЯЗАН анализировать изображения. Если пользователь прислал фото и задал вопрос — опиши, что на нем изображено, в деталях. Не отказывайся от ответа.";

    if (systemIndex !== -1) {
        visionMessages[systemIndex].content = visionPrompt;
    } else {
        visionMessages.unshift({ role: "system", content: visionPrompt });
    }

    const lastMsg = visionMessages[visionMessages.length - 1];

    if (lastMsg && lastMsg.role === "user") {
        const textPrompt = lastMsg.content || "Опиши, что изображено на этом фото.";
        lastMsg.content = [
            { type: "text", text: textPrompt },
            { type: "image_url", image_url: { url: imageBase64 } }
        ];
    }

    /* Перебор vision-моделей: первая рабочая запоминается и дальше идёт первой. */
    const order = goodVisionModel
        ? [goodVisionModel, ...VISION_MODELS.filter((m) => m !== goodVisionModel)]
        : VISION_MODELS.slice();
    let lastVisionErr = "";
    for (const visionModel of order) {
        try {
            const res = await fetch(ZVENO_URL, {
                method: "POST",
                headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
                body: JSON.stringify({ model: visionModel, messages: visionMessages, max_tokens: 1024, temperature: 0.7 }),
                signal: AbortSignal.timeout(FETCH_TIMEOUT)
            });
            const data = await res.json();
            if (!res.ok) {
                lastVisionErr = `${visionModel}: ${data?.error?.message || res.status}`;
                zlog(`[VISION] отказ — ${lastVisionErr}`);
                continue;
            }
            const text = data?.choices?.[0]?.message?.content;
            if (!text) {
                lastVisionErr = `${visionModel}: пустой ответ`;
                zlog(`[VISION] ${lastVisionErr}`);
                continue;
            }
            goodVisionModel = visionModel;
            zlog(`[VISION] ответила модель: ${visionModel}`);
            return String(text);
        } catch (e: any) {
            lastVisionErr = `${visionModel}: ${e?.message || e}`;
            zlog(`[VISION] сбой — ${lastVisionErr}`);
        }
    }
    throw new Error(`Vision: ни одна модель не ответила (${lastVisionErr || "нет кандидатов"})`);
}

/* 👁 ДИАГНОСТИКА ЗРЕНИЯ (кнопка «👁 Зрение»).
   Прогоняет ВСЕ vision-модели шлюза по одной на крошечной картинке
   (1×1 px, base64 в коде — сеть для неё не нужна) и возвращает отчёт:
   кто ответил, кто отказал и почему. Так видно, что чинить в списке,
   а не гадать, почему фото не разобрано. */
async function runVisionTest(): Promise<string> {
    const apiKey = Deno.env.get("ZVENO_API_KEY");
    if (!apiKey) return "❌ ZVENO_API_KEY не задан на сервере (/root/.env)";
    const PIXEL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==";
    const lines: string[] = [];
    let ok = 0;
    for (const m of VISION_MODELS) {
        try {
            const res = await fetch(ZVENO_URL, {
                method: "POST",
                headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
                body: JSON.stringify({
                    model: m,
                    messages: [{
                        role: "user",
                        content: [
                            { type: "text", text: "Ответь одним словом: видишь картинку?" },
                            { type: "image_url", image_url: { url: PIXEL } }
                        ]
                    }],
                    max_tokens: 20,
                    temperature: 0
                }),
                signal: AbortSignal.timeout(60000)
            });
            const data = await res.json();
            const txt = data?.choices?.[0]?.message?.content;
            if (res.ok && txt) {
                ok++;
                if (!goodVisionModel) goodVisionModel = m;
                lines.push(`✅ ${m} — «${String(txt).slice(0, 60)}»`);
                zlog(`[VISION-TEST] ✅ ${m}`);
            } else {
                const why = data?.error?.message || ("HTTP " + res.status);
                lines.push(`❌ ${m} — ${why}`);
                zlog(`[VISION-TEST] ❌ ${m}: ${why}`);
            }
        } catch (e: any) {
            lines.push(`⚠️ ${m} — сбой: ${e?.message || e}`);
            zlog(`[VISION-TEST] ⚠️ ${m}: ${e?.message || e}`);
        }
    }
    const head = ok > 0
        ? `✅ Зрение работает: ответили ${ok} из ${VISION_MODELS.length} моделей.`
        : `❌ Ни одна модель зрения не ответила (0 из ${VISION_MODELS.length}).`;
    return head + "\n\n" + lines.join("\n");
}

// =========================================
// ЗАПРОС К ZVENO (ТЕКСТ И ИНСТРУМЕНТЫ)
// =========================================
async function callZvenoAI(messages: any[], userKeys: any = {}, isBoss: boolean = false, requestedModel: string = ""): Promise<string> {
    /* 🅰️ КАНАЛ ZVENO — ЛИНЕЙНО, БЕЗ ПЕРЕБОРА И БЕЗ РЕЗЕРВОВ.
       Ключ ВСЕГДА серверный: ZVENO_API_KEY из /root/.env. В коде ключей НЕТ.
       Босс в Штабе вводит кодовое слово ("zveno") — оно лишь подтверждает
       вход в канал; реальный ключ подставляет сервер. */
    const apiKey = Deno.env.get("ZVENO_API_KEY");
    if (!apiKey) throw new Error("ZVENO_API_KEY не задан на сервере (/root/.env)");

    const codeWord = String((userKeys && (userKeys.architectKey || userKeys.zveno)) || "").trim();
    zlog(`[ZVENO] канал Архитектора, модель ${ZVENO_MODEL}, ключ: серверный${codeWord ? ` (кодовое слово: ${codeWord.toLowerCase() === ZVENO_CODE_WORD ? "верное" : "иное"})` : ""}`);

    const activeModel = ZVENO_MODEL;
    const activeTools: any[] = TOOLS;
    const currentMessages = JSON.parse(JSON.stringify(messages));
    let weatherCard = "";

    for (let loop = 0; loop < 20; loop++) {
        const payload: any = {
            model: activeModel,
            messages: currentMessages,
            temperature: 0.5,
            tools: activeTools,
            tool_choice: "auto"
        };

        const res = await fetch(ZVENO_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${apiKey}`
            },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(FETCH_TIMEOUT)
        });
        const data = await res.json();
        if (!res.ok) {
            const errMsg = `${activeModel}: ${data?.error?.message || res.status}`;
            zlog(`[ZVENO] ошибка: ${errMsg}`);
            throw new Error(errMsg);   // ошибка уходит в чат как есть — без переключений
        }

        const msg = data?.choices?.[0]?.message;
        if (!msg) throw new Error(`${activeModel}: пустой ответ`);

        if (msg.tool_calls && msg.tool_calls.length > 0) {
            currentMessages.push(msg);
            for (const tc of msg.tool_calls) {
                const fnName = tc.function.name;
                const fnArgs = JSON.parse(tc.function.arguments || "{}");
                zlog(`[TOOL] ${fnName}(${JSON.stringify(fnArgs).slice(0, 100)})`);
                const result = await executeTool(fnName, fnArgs);

                let toolResult = result;
                if (fnName === "get_weather") {
                    const cardMatch = result.match(/\[\[WEATHER_CARD\]\]([\s\S]*?)\[\[\/WEATHER_CARD\]\]/);
                    if (cardMatch) {
                        weatherCard = cardMatch[0];
                        toolResult = result.replace(cardMatch[0], "").trim();
                    }
                }

                currentMessages.push({
                    role: "tool",
                    tool_call_id: tc.id,
                    content: toolResult.slice(0, MAX_TOOL_RESULT)
                });
            }
            continue; // Возвращаемся к нейросети с результатами инструментов
        }

        const answer = msg.content || "Пустой ответ";
        zlog(`[ZVENO] ответила: ${activeModel}`);
        return weatherCard ? weatherCard + "\n\n" + answer : answer;
    }

    // ЛИМИТ ШАГОВ: модель 20 раз подряд дёрнула инструменты и не выдала текст.
    // Делаем ФИНАЛЬНЫЙ вызов БЕЗ инструментов — модель обязана ответить текстом.
    try {
        const finalMessages = currentMessages.concat([{
            role: "user",
            content: "[СИСТЕМА: Лимит шагов исчерпан, инструменты ОТКЛЮЧЕНЫ. Выдай финальный ответ Боссу ТЕКСТОМ: что сделано, где, результат. Без вызовов инструментов.]"
        }]);
        const fres = await fetch(ZVENO_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
            body: JSON.stringify({ model: activeModel, messages: finalMessages, temperature: 0.5, tools: [], tool_choice: "none" }),
            signal: AbortSignal.timeout(FETCH_TIMEOUT)
        });
        const fdata = await fres.json();
        const ftext = fdata?.choices?.[0]?.message?.content;
        if (fres.ok && ftext) {
            zlog(`[ZVENO] финальный ответ без инструментов: ${activeModel}`);
            return weatherCard ? weatherCard + "\n\n" + ftext : ftext;
        }
    } catch (e: any) { zlog(`[FINAL] ${e?.message || e}`); }
    return "⚠️ Слишком много шагов. Задача прервана.";
}

// =========================================
// 🟠 BAIDU ERNIE — ОТДЕЛЬНЫЙ КАНАЛ (бесплатная модель)
// Модель: baidu/ernie-5.5-flash-preview:free (шлюз ZvenoAI, ключ серверный).
// Формат OpenAI, инструменты включены — как у канала Zveno.
// =========================================
async function callErnieAI(messages: any[], userKeys: any = {}, requestedModel: string = ""): Promise<string> {
    const apiKey = Deno.env.get("ZVENO_API_KEY");
    if (!apiKey) throw new Error("ZVENO_API_KEY не задан на сервере (/root/.env)");

    const activeModel = ERNIE_MODEL;
    const currentMessages = JSON.parse(JSON.stringify(messages));
    let weatherCard = "";

    for (let loop = 0; loop < 20; loop++) {
        const res = await fetch(ZVENO_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
            body: JSON.stringify({ model: activeModel, messages: currentMessages, temperature: 0.5, tools: TOOLS, tool_choice: "auto" }),
            signal: AbortSignal.timeout(FETCH_TIMEOUT)
        });
        const data = await res.json();
        if (!res.ok) {
            const errMsg = `${activeModel}: ${data?.error?.message || res.status}`;
            zlog(`[ERNIE] ошибка: ${errMsg}`);
            throw new Error(errMsg);   // ошибка уходит в чат как есть — без переключений
        }
        const msg = data?.choices?.[0]?.message;
        if (!msg) throw new Error(`${activeModel}: пустой ответ`);

        if (msg.tool_calls && msg.tool_calls.length > 0) {
            currentMessages.push(msg);
            for (const tc of msg.tool_calls) {
                const fnName = tc.function.name;
                const fnArgs = JSON.parse(tc.function.arguments || "{}");
                zlog(`[ERNIE][TOOL] ${fnName}(${JSON.stringify(fnArgs).slice(0, 100)})`);
                const result = await executeTool(fnName, fnArgs);
                let toolResult = result;
                if (fnName === "get_weather") {
                    const cardMatch = result.match(/\[\[WEATHER_CARD\]\]([\s\S]*?)\[\[\/WEATHER_CARD\]\]/);
                    if (cardMatch) { weatherCard = cardMatch[0]; toolResult = result.replace(cardMatch[0], "").trim(); }
                }
                currentMessages.push({ role: "tool", tool_call_id: tc.id, content: toolResult.slice(0, MAX_TOOL_RESULT) });
            }
            continue;
        }

        const answer = msg.content || "Пустой ответ";
        zlog(`[ERNIE] ответила: ${activeModel}`);
        return weatherCard ? weatherCard + "\n\n" + answer : answer;
    }

    // ЛИМИТ ШАГОВ — финальный вызов БЕЗ инструментов.
    try {
        const finalMessages = currentMessages.concat([{
            role: "user",
            content: "[СИСТЕМА: Лимит шагов исчерпан, инструменты ОТКЛЮЧЕНЫ. Выдай финальный ответ Боссу ТЕКСТОМ: что сделано, где, результат.]"
        }]);
        const fres = await fetch(ZVENO_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
            body: JSON.stringify({ model: activeModel, messages: finalMessages, temperature: 0.5, tools: [], tool_choice: "none" }),
            signal: AbortSignal.timeout(FETCH_TIMEOUT)
        });
        const fdata = await fres.json();
        const ftext = fdata?.choices?.[0]?.message?.content;
        if (fres.ok && ftext) {
            zlog(`[ERNIE] финальный ответ без инструментов: ${activeModel}`);
            return weatherCard ? weatherCard + "\n\n" + ftext : ftext;
        }
    } catch (e: any) { zlog(`[ERNIE][FINAL] ${e?.message || e}`); }
    return "⚠️ Слишком много шагов. Задача прервана.";
}

// =========================================
// GIGACHAT (СБЕР) — ПОМОЩНИК
// Ключ: GIGACHAT_KEY (Авторизационные данные), scope: GIGACHAT_SCOPE
// Логи: tail -f /root/zveno.log
// =========================================
const GIGACHAT_KEY = Deno.env.get("GIGACHAT_KEY") || "";
const GIGACHAT_SCOPE = Deno.env.get("GIGACHAT_SCOPE") || "GIGACHAT_API_PERS";
const GIGACHAT_OAUTH_URL = "https://ngw.devices.sberbank.ru:9443/api/v2/oauth";
const GIGACHAT_API_URL = "https://gigachat.devices.sberbank.ru/api/v1/chat/completions";
/* ❗ ОДНА модель GigaChat — без списка и без перебора (приказ Босса). */
const GIGACHAT_MODEL = "GigaChat-2-Max";

// Сертификат Минцифры отсутствует в системном хранилище — Deno ругается на TLS.
// Создаём клиент, который игнорирует проверку ТОЛЬКО для доменов Сбера.
let gigachatClient: any = null;
function getGigaChatClient(): any {
    if (gigachatClient) return gigachatClient;
    try {
        gigachatClient = Deno.createHttpClient({
            unsafelyIgnoreCertificateErrors: ["ngw.devices.sberbank.ru", "gigachat.devices.sberbank.ru"],
        });
        return gigachatClient;
    } catch (e: any) {
        zlog(`[GIGACHAT] не удалось создать TLS-клиент: ${e?.message || e}`);
        return undefined;
    }
}

let gcToken = "";
let gcTokenExp = 0;
let gcTokenKey = "";

async function gigachatToken(userKey: string = ""): Promise<string> {
    /* 🟣 КЛЮЧ ИЗ ПОЛЯ ⚙️ ГЛАВНЕЕ СЕРВЕРНОГО.
       Был баг: userKeys.gigachat сервер НЕ читал вообще — вписанный Боссом
       ключ Сбера был мёртвым грузом, всегда шёл GIGACHAT_KEY из /root/.env.
       Теперь порядок: ключ из поля → серверный GIGACHAT_KEY. */
    const key = String(userKey || "").trim() || GIGACHAT_KEY;
    if (!key) throw new Error("Ключ GigaChat не вписан (⚙️ GigaChat → «Сохранить ключ»), и GIGACHAT_KEY не задан в /root/.env");
    const now = Date.now();
    if (gcToken && gcTokenKey === key && now < gcTokenExp - 60000) return gcToken;

    const res = await fetch(GIGACHAT_OAUTH_URL, {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "Accept": "application/json",
            "Authorization": `Basic ${key}`,
            "RqUID": crypto.randomUUID(),
        },
        body: `scope=${encodeURIComponent(GIGACHAT_SCOPE)}`,
        client: getGigaChatClient(),
        signal: AbortSignal.timeout(30000),
    } as any);

    const data = await res.json();
    if (!res.ok || !data.access_token) {
        throw new Error(`GigaChat OAuth ${res.status}: ${data?.message || data?.error || "нет токена"}`);
    }
    gcToken = data.access_token;
    gcTokenKey = key;
    gcTokenExp = Number(data.expires_at) || (now + 25 * 60 * 1000);
    zlog(`[GIGACHAT] получен access_token, scope=${GIGACHAT_SCOPE}, ключ: ${String(userKey || "").trim() ? "свой (Босс)" : "серверный"}`);
    return gcToken;
}

async function callGigaChat(messages: any[], requestedModel: string = "", userKey: string = "", maxTokens: number = 0): Promise<string> {
    const token = await gigachatToken(userKey);

    // GigaChat не понимает OpenAI-формат tools — оставляем только текст
    const clean = messages
        .filter((m: any) => m.role === "system" || m.role === "user" || m.role === "assistant")
        .map((m: any) => ({
            role: m.role,
            content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
        }));

    /* ❗ ПЕРЕБОРА НЕТ: отвечает ОДНА модель GigaChat. Упала — честная ошибка. */
    const model = GIGACHAT_MODEL;
    const res = await fetch(GIGACHAT_API_URL, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Accept": "application/json",
            "Authorization": `Bearer ${token}`,
        },
        // maxTokens > 0 — жёсткий лимит длины (дуэт: короткая ремарка, экономия баланса).
        body: JSON.stringify(maxTokens > 0
            ? { model, messages: clean, temperature: 0.5, max_tokens: maxTokens }
            : { model, messages: clean, temperature: 0.5 }),
        client: getGigaChatClient(),
        signal: AbortSignal.timeout(FETCH_TIMEOUT),
    } as any);

    const data = await res.json();
    if (!res.ok) throw new Error(`${model}: ${data?.message || res.status}`);
    const text = data?.choices?.[0]?.message?.content;
    if (!text) throw new Error(`${model}: пустой ответ`);
    zlog(`[GIGACHAT] ответила модель: ${model}`);
    return text;
}

// =========================================
// GIGACHAT С ИНСТРУМЕНТАМИ (FUNCTION CALLING)
// ОФИЦИАЛЬНЫЙ ФОРМАТ СБЕРА (не OpenAI!):
//   запрос:  functions: [{ name, description, parameters }], function_call: "auto"
//   ответ:   choices[0].message.function_call = { name, arguments }
//   возврат: { role: "function", name, content }
// ❗ БЫЛ БАГ: отправляли OpenAI-обёртку tools:[{type:"function",function:{...}}]
//    с tool_choice. Сбер её НЕ читает → инструменты игнорировались, и модель
//    писала вызов ТЕКСТОМ в чат («Выполняю команду» + блок кода), а сервер
//    не мог его распознать. Теперь формат строго по документации Сбера.
// =========================================
const GIGACHAT_FUNCTIONS = TOOLS.map((t: any) => t.function);

// СТРАХОВКА: если Сбер всё же не отдал function_call, но модель написала вызов
// ТЕКСТОМ (в блоке кода или одной строкой) — перехватываем и выполняем сами.
function parseTextToolCall(text: string): { name: string, args: any } | null {
    if (!text || text.length > 600) return null;
    const names = TOOLS.map((t: any) => t.function.name);
    const fences = text.match(/```[a-z]*\s*([\s\S]*?)```/gi) || [];
    const candidates = fences.length
        ? fences.map((f) => f.replace(/```[a-z]*/gi, "").trim())
        : [text.trim()];
    for (const cand of candidates) {
        for (const nm of names) {
            const m = cand.match(new RegExp("^" + nm + "\\s*\\(([\\s\\S]*)\\)\\s*$"));
            if (!m) continue;
            const raw = (m[1] || "").trim();
            let args: any = {};
            if (raw.startsWith("{")) {
                try { args = JSON.parse(raw); } catch { continue; }
            } else if (raw) {
                const s = raw.replace(/^["'`]|["'`]$/g, "").trim();
                const def = TOOLS.find((t: any) => t.function.name === nm);
                const req = def?.function?.parameters?.required || [];
                if (req.length === 1) args[req[0]] = s;
                else if (req.length === 0) args = {};
                else continue;
            }
            return { name: nm, args };
        }
    }
    return null;
}

async function callGigaChatTools(messages: any[], requestedModel: string = "", userKey: string = ""): Promise<string> {
    const token = await gigachatToken(userKey);
    /* ❗ ОДНА модель, БЕЗ ПЕРЕБОРА: канал 🟣 = GigaChat-2-Max (умеет инструменты). */
    const model = GIGACHAT_MODEL;

    // Копируем историю, чтобы не мутировать оригинал
    const history: any[] = JSON.parse(JSON.stringify(messages));
    const MAX_LOOPS = 15;

    // Приводим историю к формату Сбера: content ВСЕГДА строка,
    // роль function обязательно с полем name,
    // у ассистента СОХРАНЯЕМ function_call (иначе Сбер не свяжет
    // результат инструмента с вызовом и проигнорирует историю).
    const toClean = (arr: any[]) => arr
        .filter((m: any) => ["system", "user", "assistant", "function"].includes(m.role))
        .map((m: any) => {
            if (m.role === "function") {
                /* ❗ Сбер требует СТРОГО валидный JSON в content результата функции.
                   Была ошибка 422 "invalid function result json string", когда мы
                   отправляли обычную строку. Оборачиваем в { result: ... }. */
                const raw = typeof m.content === "string" ? m.content : JSON.stringify(m.content ?? "");
                let isObj = false;
                try {
                    const parsed = JSON.parse(raw);
                    isObj = parsed !== null && typeof parsed === "object";
                } catch { isObj = false; }
                const payload = isObj ? raw : JSON.stringify({ result: raw });
                return { role: "function", name: m.name, content: payload };
            }
            const c = m.content;
            const out: any = {
                role: m.role,
                content: typeof c === "string" ? c : (c == null ? "" : JSON.stringify(c)),
            };
            if (m.role === "assistant" && m.function_call) out.function_call = m.function_call;
            return out;
        });

    for (let loop = 0; loop < MAX_LOOPS; loop++) {
        // 1. Отправляем запрос с инструментами в формате Сбера (functions)
        const res = await fetch(GIGACHAT_API_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Accept": "application/json",
                "Authorization": `Bearer ${token}`,
            },
            body: JSON.stringify({
                model,
                messages: toClean(history),
                temperature: 0.5,
                functions: GIGACHAT_FUNCTIONS,
                function_call: "auto",
            }),
            client: getGigaChatClient(),
            signal: AbortSignal.timeout(FETCH_TIMEOUT),
        } as any);

        if (!res.ok) {
            const errText = await res.text();
            zlog(`[GIGACHAT-TOOLS] ${res.status}: ${errText.slice(0, 200)}`);
            // Ошибка уходит в чат как есть — никаких переключений на другую модель.
            throw new Error(`GigaChat ${res.status}: ${errText.slice(0, 200)}`);
        }

        const data = await res.json();
        const msg = data?.choices?.[0]?.message;
        if (!msg) return "Пустой ответ от GigaChat";

        // 2. Модель вызвала инструмент.
        //    Основной формат Сбера — message.function_call.
        //    На случай OpenAI-совместимого ответа читаем и tool_calls.
        const fc = msg.function_call || (Array.isArray(msg.tool_calls) && msg.tool_calls[0]
            ? { name: msg.tool_calls[0].function?.name, arguments: msg.tool_calls[0].function?.arguments }
            : null);

        if (fc && fc.name) {
            let args: any = {};
            const rawArgs = fc.arguments;
            if (typeof rawArgs === "string") {
                try { args = JSON.parse(rawArgs || "{}"); } catch { args = {}; }
            } else if (rawArgs && typeof rawArgs === "object") {
                args = rawArgs;   // Сбер отдаёт arguments уже объектом
            }

            zlog(`[GIGACHAT-TOOLS] вызов ${fc.name}(${JSON.stringify(args).slice(0, 100)})`);

            let toolResult = "";
            let toolFailed = false;
            try {
                toolResult = await executeTool(fc.name, args);
            } catch (e: any) {
                toolFailed = true;
                toolResult = String(e?.message || e);
            }
            const safeResult = String(toolResult).slice(0, MAX_TOOL_RESULT);
            /* ❗ Сбер требует валидный JSON в результате функции (иначе 422
               "invalid function result json string"). Ошибку тоже отдаём JSON. */
            const resultJson = toolFailed
                ? JSON.stringify({ error: safeResult })
                : JSON.stringify({ result: safeResult });

            // Ответ ассистента (с function_call) + результат инструмента (role: function)
            history.push({ role: "assistant", content: "", function_call: { name: fc.name, arguments: args } });
            history.push({ role: "function", name: fc.name, content: resultJson });

            continue; // модель должна осмыслить результат
        }

        // 2б. Сбер не отдал function_call, но модель написала вызов ТЕКСТОМ.
        //     Перехватываем, выполняем и отдаём результат как сообщение user
        //     (без role:"function" — иначе Сбер отвергнет «висячий» результат).
        const textCall = parseTextToolCall(String(msg.content || ""));
        if (textCall) {
            zlog(`[GIGACHAT-TOOLS] текстовый вызов перехвачен: ${textCall.name}(${JSON.stringify(textCall.args).slice(0, 100)})`);
            let toolResult = "";
            try {
                toolResult = await executeTool(textCall.name, textCall.args);
            } catch (e: any) {
                toolResult = `Ошибка выполнения инструмента: ${e?.message || e}`;
            }
            history.push({ role: "assistant", content: String(msg.content || "") });
            history.push({
                role: "user",
                content: `[СИСТЕМА: результат инструмента ${textCall.name}]\n${String(toolResult).slice(0, MAX_TOOL_RESULT)}\n[СИСТЕМА: выдай финальный ответ Боссу ТЕКСТОМ, без вызовов инструментов.]`,
            });
            continue;
        }

        // 3. Вызова нет — это финальный ответ
        zlog(`[GIGACHAT-TOOLS] ответила модель: ${model}`);
        return msg.content || "Пустой ответ";
    }

    // Лимит шагов: финальный запрос БЕЗ инструментов, чтобы получить хоть какой-то текст
    zlog("[GIGACHAT-TOOLS] лимит шагов — финальный запрос без инструментов");
    const finalRes = await fetch(GIGACHAT_API_URL, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Accept": "application/json",
            "Authorization": `Bearer ${token}`,
        },
        body: JSON.stringify({ model, messages: toClean(history), temperature: 0.5 }),
        client: getGigaChatClient(),
        signal: AbortSignal.timeout(FETCH_TIMEOUT),
    } as any);

    const finalData = await finalRes.json();
    return finalData?.choices?.[0]?.message?.content || "Не удалось получить финальный ответ";
}

// =========================================
// ⚡ РЕЖИМ «ДУЭТ» — ДВЕ МОДЕЛИ НАД ОДНОЙ ЗАДАЧЕЙ
// Цепочка (приказ Босса): сначала модели КОРОТКО обсуждают задачу в чате,
// потом работу делает Zveno.
//   ШАГ 1 — 🅰️ Zveno: КРАТКИЙ черновик (до 5 строк, БЕЗ инструментов).
//   ШАГ 2 — 🟣 GigaChat: СУПЕР-ДИЗАЙНЕР — как сделать красиво (до 4 строк, БЕЗ инструментов).
//   ШАГ 3 — 🅰️ Zveno: ФИНАЛ с инструментами (файлы, поиск, погода).
// БЮДЖЕТ: шаги 1 и 2 идут с жёстким лимитом токенов — простыни не генерим.
// ЖЁСТКИЙ ПРЕДЕЛ: DUET_MAX_STEPS = 3. Ответ на шаг 3 обратно в цикл НЕ уходит —
// зацикливание физически невозможно (цикл конечный, шаг 3 последний).
// ИНСТРУМЕНТЫ НЕ ЛОМАЮТСЯ: каждый шаг работает СВОИМ родным механизмом —
// Zveno через OpenAI tools, GigaChat через functions Сбера.
// =========================================
const DUET_MAX_STEPS = 8;

/* ⚡ БЮДЖЕТ ДУЭТА (приказ Босса): черновики КОРОТКИЕ.
   Шаги 1 и 2 — без инструментов и с лимитом токенов: только суть и замечания.
   Полную работу с инструментами делает Zveno на шаге 3. Так Босс видит ход
   мысли обеих моделей, а баланс Штаба не тает. */
const DUET_BRIEF_TOKENS = 350;    // ~5 строк: краткий черновик Zveno
const DUET_REMARK_TOKENS = 300;   // ~4 строки: короткое слово GigaChat (дизайн / 3D)

const DUET_BRIEF_PROMPT = `Ты — Цифровой Архитектор Штаба. Идёт РЕЖИМ «ДУЭТ»: сначала короткое обсуждение, потом ты делаешь финальную работу.
Сейчас ШАГ 1 — КРАТКИЙ ЧЕРНОВИК для напарника-критика.
Требования:
1) максимум 5 строк: только суть — что делаем и в каком порядке;
2) НИКАКИХ вызовов инструментов, кода и длинных объяснений;
3) по-русски, без вступлений и без вопросов.`;

const DUET_DESIGN_PROMPT = `Ты — СУПЕР-ДИЗАЙНЕР Штаба. Ниже КРАТКИЙ черновик другой модели по задаче Босса.
Сейчас ШАГ 2 — твоё слово как ДИЗАЙНЕРА: как сделать красиво и удобно.
Требования:
1) максимум 4 строки: конкретные предложения по виду, цветам, расположению, анимации;
2) НЕ критикуй и НЕ ищи ошибки — только предлагай, как сделать лучше и красивее;
3) без кода, без вызовов инструментов, без вступлений; по-русски, по делу.`;

const DUET_3D_PROMPT = `Ты — МЕГА-КОДЕР 3D Штаба. Ниже обсуждение задачи Босса.
Сейчас ШАГ 4 — твоё слово как 3D-КОДЕРА: как это собрать технически.
Требования:
1) максимум 4 строки: конкретные технические приёмы (3D, canvas/WebGL/CSS-3D, анимация, производительность);
2) НЕ критикуй и НЕ ищи ошибки — только предлагай решения;
3) без кода, без вызовов инструментов, без вступлений; по-русски, по делу.`;

const DUET_FINAL_PROMPT = `Ты — Цифровой Архитектор Штаба. Идёт РЕЖИМ «ДУЭТ».
Шаги 1–7 уже прошли: черновик, супер-дизайн, уточнение, мега-кодер 3D, сводка, тест на ошибки, проверка замечаний.
Сейчас ШАГ 8 — ФИНАЛ: сделай работу сам и выдай Боссу итоговый ответ.
Требования:
1) учти замечания напарника, но отвечай от своего лица — не упоминай черновик, напарника и «другую модель»;
2) работай инструментами, если нужно (файлы, поиск, погода);
3) ответ Боссу: что сделал, где, ссылка. Без воды.`;

/* ШАГ 1 — 🅰️ Zveno: КРАТКИЙ черновик. Без инструментов, лимит токенов. */
async function callZvenoBrief(messages: any[]): Promise<string> {
    const apiKey = Deno.env.get("ZVENO_API_KEY");
    if (!apiKey) throw new Error("ZVENO_API_KEY не задан на сервере (/root/.env)");

    const briefMessages = JSON.parse(JSON.stringify(messages));
    const si = briefMessages.findIndex((m: any) => m.role === "system");
    if (si !== -1) briefMessages[si].content = DUET_BRIEF_PROMPT;
    else briefMessages.unshift({ role: "system", content: DUET_BRIEF_PROMPT });

    const res = await fetch(ZVENO_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
        body: JSON.stringify({ model: ZVENO_MODEL, messages: briefMessages, temperature: 0.4, max_tokens: DUET_BRIEF_TOKENS, tools: [], tool_choice: "none" }),
        signal: AbortSignal.timeout(FETCH_TIMEOUT)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(`Дуэт (черновик): ${data?.error?.message || res.status}`);
    const text = data?.choices?.[0]?.message?.content;
    if (!text) throw new Error("Дуэт (черновик): пустой ответ");
    zlog(`[DUET] шаг 1 — краткий черновик Zveno готов (${String(text).length} симв.)`);
    return String(text).trim();
}

function lastUserText(messages: any[]): string {
    for (let i = messages.length - 1; i >= 0; i--) {
        const m = messages[i];
        if (m && m.role === "user") {
            const c = m.content;
            return typeof c === "string" ? c : JSON.stringify(c);
        }
    }
    return "";
}

async function callDuet(messages: any[], userKeys: any, gcKey: string): Promise<string> {
    /* ⚡ ДУЭТ (приказ Босса): полная цепочка обсуждения, всё КОРОТКО.
       ШАГ 1 🅰️ Zveno    — краткий черновик
       ШАГ 2 🟣 GigaChat — супер-дизайнер: как сделать красиво
       ШАГ 3 🅰️ Zveno    — уточнённый план (учёл дизайн)
       ШАГ 4 🟣 GigaChat — мега-кодер 3D: как собрать технически
       ШАГ 5 🅰️ Zveno    — сводка: что берём в работу
       ШАГ 6 🟣 GigaChat — тестировщик: проверка на ошибки
       ШАГ 7 🅰️ Zveno    — проверка замечаний
       ШАГ 8 🅰️ Zveno    — ФИНАЛ: делает работу, инструменты ВКЛЮЧЕНЫ
       Шаги 1–7 идут БЕЗ инструментов и с жёстким лимитом токенов — бюджет цел.
       Предел DUET_MAX_STEPS = 8: цикл конечный, ответ в него не возвращается. */
    const question = lastUserText(messages);
    const lines: { who: string, text: string }[] = [];
    let lastErr = "";
    let weatherCard = "";

    const addLine = (who: string, text: string) => {
        const s = String(text || "").replace(/\[\[[\s\S]*?\]\]/g, "").trim();
        if (s) lines.push({ who: who, text: s.slice(0, 700) });
        return s;
    };
    const talk = () => lines.map((l) => (l.who === "zveno" ? "🅰️ Zveno" : "🟣 GigaChat") + ": " + l.text).join("\n");

    /* Короткий шаг Zveno: свой промпт, лимит токенов, БЕЗ инструментов. */
    const zShort = async (prompt: string, note: string, tokens: number): Promise<string> => {
        const apiKey = Deno.env.get("ZVENO_API_KEY");
        if (!apiKey) throw new Error("ZVENO_API_KEY не задан на сервере (/root/.env)");
        const res = await fetch(ZVENO_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
            body: JSON.stringify({
                model: ZVENO_MODEL,
                messages: [{ role: "system", content: prompt }, { role: "user", content: note }],
                temperature: 0.3, max_tokens: tokens, tools: [], tool_choice: "none"
            }),
            signal: AbortSignal.timeout(FETCH_TIMEOUT)
        });
        const data = await res.json();
        if (!res.ok) throw new Error(`Дуэт Zveno: ${data?.error?.message || res.status}`);
        const t = data?.choices?.[0]?.message?.content;
        if (!t) throw new Error("Дуэт Zveno: пустой ответ");
        return String(t).trim();
    };
    /* Короткий шаг GigaChat: нейтральный промпт, лимит токенов, БЕЗ tools. */
    const gShort = async (prompt: string, note: string, tokens: number): Promise<string> => {
        return String(await callGigaChat([{ role: "system", content: prompt }, { role: "user", content: note }], "", gcKey, tokens)).trim();
    };

    // ШАГ 1 — 🅰️ Zveno: краткий черновик.
    let draft = "";
    try {
        draft = await zShort(DUET_BRIEF_PROMPT, `ВОПРОС БОССА:\n${question}`, DUET_BRIEF_TOKENS);
        addLine("zveno", draft);
    } catch (e: any) {
        lastErr = e?.message || String(e);
        zlog(`[DUET] шаг 1 (Zveno) упал: ${lastErr}`);
    }
    if (!draft) throw new Error(`Дуэт: Zveno не дал черновик (${lastErr || "нет ответа"})`);

    // ШАГ 2 — 🟣 GigaChat: супер-дизайнер (как сделать красиво).
    try {
        const r = await gShort(DUET_DESIGN_PROMPT, `ВОПРОС БОССА:\n${question}\n\nЧЕРНОВИК ZVENO:\n${draft}`, DUET_REMARK_TOKENS);
        addLine("giga", r);
    } catch (e: any) { lastErr = e?.message || String(e); zlog(`[DUET] шаг 2 (GigaChat) упал: ${lastErr}`); }

    // ШАГ 3 — 🅰️ Zveno: уточнённый план с учётом ремарки.
    let plan = draft;
    try {
        plan = await zShort(DUET_PLAN_PROMPT, `ВОПРОС БОССА:\n${question}\n\nОБСУЖДЕНИЕ:\n${talk()}`, DUET_BRIEF_TOKENS);
        addLine("zveno", plan);
    } catch (e: any) { lastErr = e?.message || String(e); zlog(`[DUET] шаг 3 (Zveno) упал: ${lastErr}`); }

    // ШАГ 4 — 🟣 GigaChat: мега-кодер 3D (как собрать технически).
    try {
        const r = await gShort(DUET_3D_PROMPT, `ВОПРОС БОССА:\n${question}\n\nОБСУЖДЕНИЕ:\n${talk()}`, DUET_REMARK_TOKENS);
        addLine("giga", r);
    } catch (e: any) { lastErr = e?.message || String(e); zlog(`[DUET] шаг 4 (GigaChat) упал: ${lastErr}`); }

    // ШАГ 5 — 🅰️ Zveno: сводка — что берём в работу.
    try {
        const r = await zShort(DUET_SUMMARY_PROMPT, `ВОПРОС БОССА:\n${question}\n\nОБСУЖДЕНИЕ:\n${talk()}`, DUET_BRIEF_TOKENS);
        addLine("zveno", r);
    } catch (e: any) { lastErr = e?.message || String(e); zlog(`[DUET] шаг 5 (сводка Zveno) упал: ${lastErr}`); }

    // ШАГ 6 — 🟣 GigaChat: проверка на ошибки.
    try {
        const r = await gShort(DUET_ERRORS_PROMPT, `ВОПРОС БОССА:\n${question}\n\nПЛАН И ОБСУЖДЕНИЕ:\n${talk()}`, DUET_CHECK_TOKENS);
        addLine("giga", r);
    } catch (e: any) { lastErr = e?.message || String(e); zlog(`[DUET] шаг 6 (проверка GigaChat) упал: ${lastErr}`); }

    // ШАГ 7 — 🅰️ Zveno: проверка замечаний.
    try {
        const r = await zShort(DUET_VERIFY_PROMPT, `ВОПРОС БОССА:\n${question}\n\nОБСУЖДЕНИЕ И ПРОВЕРКА:\n${talk()}`, DUET_CHECK_TOKENS);
        addLine("zveno", r);
    } catch (e: any) { lastErr = e?.message || String(e); zlog(`[DUET] шаг 7 (проверка Zveno) упал: ${lastErr}`); }

    // ШАГ 8 — 🅰️ Zveno: ФИНАЛ. Инструменты ВКЛЮЧЕНЫ, полный ответ.
    let finalText = "";
    try {
        const fm = JSON.parse(JSON.stringify(messages));
        const si = fm.findIndex((m: any) => m.role === "system");
        if (si !== -1) fm[si].content = DUET_FINAL_PROMPT;
        else fm.unshift({ role: "system", content: DUET_FINAL_PROMPT });
        fm.push({ role: "user", content: `[ОБСУЖДЕНИЕ ДУЭТА — учти, но в ответе Боссу НЕ пересказывай]\n${talk()}` });
        finalText = await callZvenoAI(fm, userKeys, true, "duet");
        const cm = finalText.match(/\[\[WEATHER_CARD\]\][\s\S]*?\[\[\/WEATHER_CARD\]\]/);
        if (cm) { weatherCard = cm[0]; finalText = finalText.replace(cm[0], "").trim(); }
    } catch (e: any) {
        lastErr = e?.message || String(e);
        zlog(`[DUET] шаг 8 (финал Zveno) упал: ${lastErr}`);
    }

    if (!finalText) {
        // Финал не вышел — отдаём последний план Zveno, Босс без ответа не остаётся.
        const zvenoLines = lines.filter((l) => l.who === "zveno");
        finalText = zvenoLines.length ? zvenoLines[zvenoLines.length - 1].text : draft;
        zlog("[DUET] финал не получен — отдаю план Zveno");
    }

    const block = lines.length ? `[[DUET_THOUGHTS]]${JSON.stringify({ lines: lines })}[[/DUET_THOUGHTS]]` : "";
    const out = block ? block + "\n\n" + finalText : finalText;
    return weatherCard ? weatherCard + "\n\n" + out : out;
}

/* =========================================
   ⚡ ДУЭТ — ЖИВОЙ ДИАЛОГ ПО ШАГАМ (приказ Босса)
   Раньше сервер гнал все 8 шагов подряд и отдавал готовый блок.
   Теперь клиент зовёт шаги ПО ОДНОМУ (body.duetStep = 1..8) и рисует
   каждую реплику в чате сразу, как она пришла. После шага 7 клиент
   показывает РЕШЕНИЕ и ждёт слово Босса, и только потом зовёт шаг 8.
   Шаги 1–7 — короткие, без инструментов, с лимитом токенов (бюджет цел).
   Шаг 8 — финал Zveno с инструментами (файлы, поиск, погода).
   ========================================= */
async function duetStepOnce(
    step: number,
    question: string,
    talk: string,
    extra: string,
    messages: any[],
    userKeys: any,
    gcKey: string,
): Promise<string> {
    /* Короткий шаг Zveno: свой промпт, лимит токенов, БЕЗ инструментов. */
    const zShort = async (prompt: string, note: string, tokens: number): Promise<string> => {
        const apiKey = Deno.env.get("ZVENO_API_KEY");
        if (!apiKey) throw new Error("ZVENO_API_KEY не задан на сервере (/root/.env)");
        const res = await fetch(ZVENO_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
            body: JSON.stringify({
                model: ZVENO_MODEL,
                messages: [{ role: "system", content: prompt }, { role: "user", content: note }],
                temperature: 0.3, max_tokens: tokens, tools: [], tool_choice: "none"
            }),
            signal: AbortSignal.timeout(FETCH_TIMEOUT)
        });
        const data = await res.json();
        if (!res.ok) throw new Error(`Дуэт Zveno: ${data?.error?.message || res.status}`);
        const t = data?.choices?.[0]?.message?.content;
        if (!t) throw new Error("Дуэт Zveno: пустой ответ");
        return String(t).trim();
    };
    /* Короткий шаг GigaChat: нейтральный промпт, лимит токенов, БЕЗ tools. */
    const gShort = async (prompt: string, note: string, tokens: number): Promise<string> => {
        return String(await callGigaChat([{ role: "system", content: prompt }, { role: "user", content: note }], "", gcKey, tokens)).trim();
    };

    const q = question || "(вопрос не передан)";
    const t = talk || "(обсуждения пока нет)";

    switch (step) {
        case 1:
            return await zShort(DUET_BRIEF_PROMPT, `ВОПРОС БОССА:\n${q}`, DUET_BRIEF_TOKENS);
        case 2:
            return await gShort(DUET_DESIGN_PROMPT, `ВОПРОС БОССА:\n${q}\n\nЧЕРНОВИК ZVENO:\n${t}`, DUET_REMARK_TOKENS);
        case 3:
            return await zShort(DUET_PLAN_PROMPT, `ВОПРОС БОССА:\n${q}\n\nОБСУЖДЕНИЕ:\n${t}`, DUET_BRIEF_TOKENS);
        case 4:
            return await gShort(DUET_3D_PROMPT, `ВОПРОС БОССА:\n${q}\n\nОБСУЖДЕНИЕ:\n${t}`, DUET_REMARK_TOKENS);
        case 5:
            return await zShort(DUET_SUMMARY_PROMPT, `ВОПРОС БОССА:\n${q}\n\nОБСУЖДЕНИЕ:\n${t}`, DUET_BRIEF_TOKENS);
        case 6:
            return await gShort(DUET_ERRORS_PROMPT, `ВОПРОС БОССА:\n${q}\n\nПЛАН И ОБСУЖДЕНИЕ:\n${t}`, DUET_CHECK_TOKENS);
        case 7:
            return await zShort(DUET_VERIFY_PROMPT, `ВОПРОС БОССА:\n${q}\n\nОБСУЖДЕНИЕ И ПРОВЕРКА:\n${t}`, DUET_CHECK_TOKENS);
        case 8: {
            /* ФИНАЛ: Zveno делает работу. Инструменты ВКЛЮЧЕНЫ.
               В конец истории добавляем обсуждение и ДОБАВКУ БОССА. */
            const fm = JSON.parse(JSON.stringify(messages || []));
            const si = fm.findIndex((m: any) => m.role === "system");
            if (si !== -1) fm[si].content = DUET_FINAL_PROMPT;
            else fm.unshift({ role: "system", content: DUET_FINAL_PROMPT });
            let note = `[ОБСУЖДЕНИЕ ДУЭТА — учти, но в ответе Боссу НЕ пересказывай]\n${t}`;
            if (extra && extra.trim()) note += `\n\n[ДОБАВКА БОССА — обязательна к учёту]\n${extra.trim()}`;
            fm.push({ role: "user", content: note });
            zlog(`[DUET] шаг 8 — финал Zveno (добавка Босса: ${extra && extra.trim() ? "есть" : "нет"})`);
            return await callZvenoAI(fm, userKeys, true, "duet");
        }
        default:
            throw new Error(`Неизвестный шаг дуэта: ${step}`);
    }
}

/* ⚡ КОРОТКИЕ ПРОМПТЫ ДУЭТА (приказ Босса: обсуждение короткое, бюджет цел). */
const DUET_CHECK_TOKENS = 250;   // ~3 строки: проверка на ошибки и проверка замечаний

const DUET_PLAN_PROMPT = `Ты — Цифровой Архитектор Штаба. РЕЖИМ «ДУЭТ», ШАГ 3 — УТОЧНЁННЫЙ ПЛАН.
Тебе дали твой черновик и предложения напарника-дизайнера.
Требования:
1) максимум 4 строки: что принимаешь из предложений и как меняешь план;
2) без кода, без инструментов, без вступлений;
3) по-русски, по делу.`;

const DUET_SUMMARY_PROMPT = `Ты — Цифровой Архитектор Штаба. РЕЖИМ «ДУЭТ», ШАГ 5 — СВОДКА.
Ниже вопрос Босса и всё обсуждение с напарниками (дизайнер и 3D-кодер).
Требования:
1) максимум 4 строки: что берём в работу, что отбрасываем;
2) это план для финального шага — без кода, без инструментов, без вступлений;
3) по-русски, по делу.`;

const DUET_ERRORS_PROMPT = `Ты — ТЕСТИРОВЩИК Штаба. РЕЖИМ «ДУЭТ», ШАГ 6 — ТЕСТ: ПРОВЕРКА НА ОШИБКИ.
Ниже вопрос Босса и обсуждение плана.
Требования:
1) максимум 3 строки: только РЕАЛЬНЫЕ ошибки и риски (факты, форматы, безопасность, потеря данных);
2) ошибок нет — напиши ровно: «Ошибок не вижу»;
3) без кода, без инструментов, без вступлений.`;

const DUET_VERIFY_PROMPT = `Ты — Цифровой Архитектор Штаба. РЕЖИМ «ДУЭТ», ШАГ 7 — ПРОВЕРКА ЗАМЕЧАНИЙ.
Ниже вопрос Босса, предложения напарников и список возможных ошибок от тестировщика.
Требования:
1) максимум 3 строки: что принимаешь, что отклоняешь и почему;
2) без кода, без инструментов, без вступлений.`;

// =========================================
// ОЗВУЧКА (EDGE-TTS, БЕСПЛАТНО)
// =========================================
const TTS_CACHE = new Map<string, Uint8Array>();
const TTS_CACHE_MAX = 150;

async function handleTTS(body: any) {
    const text = String(body.text || "").trim().slice(0, 600);
    if (!text) return json({ success: false, error: "Пустой текст" }, 400);

    const voice = String(body.voice || "ru-RU-DmitryNeural").trim();
    const rate = String(body.rate || "+0%").trim();
    const volume = String(body.volume || "+0%").trim();
    const pitch = String(body.pitch || "+0Hz").trim();
    const key = `${voice}|${rate}|${volume}|${pitch}|${text}`;

    const cached = TTS_CACHE.get(key);
    if (cached) {
        return new Response(cached, {
            headers: { ...corsHeaders, "Content-Type": "audio/mpeg", "X-TTS-Cache": "hit" }
        });
    }

    const tmp = await Deno.makeTempFile({ suffix: ".mp3" });
    try {
        // edge-tts может стоять по-разному: в PATH, в ~/.local/bin (pip --user/pipx)
        // или как python-модуль. Перебираем варианты — озвучка не должна падать из-за PATH.
        const args = ["--voice", voice, "--rate", rate, "--volume", volume, "--pitch", pitch, "--text", text, "--write-media", tmp];
        const home = Deno.env.get("HOME") || "";
        const variants: string[][] = [
            ["edge-tts", ...args],
            [`${home}/.local/bin/edge-tts`, ...args],
            ["python3", "-m", "edge_tts", ...args],
            ["python", "-m", "edge_tts", ...args],
        ];
        let code = 1;
        let err = "";
        let started = false;
        for (const v of variants) {
            try {
                const cmd = new Deno.Command(v[0], { args: v.slice(1), stdout: "null", stderr: "piped" });
                const out = await cmd.output();
                code = out.code;
                err = new TextDecoder().decode(out.stderr).slice(0, 300);
                started = true;
                if (code === 0) break;
                // бинарник найден, но упал по другой причине (сеть/голос) — дальше не перебираем
                if (!/not found|No such file|os error 2/i.test(err)) break;
            } catch (e: any) {
                err = String((e && e.message) || e);
                continue;
            }
        }
        if (!started || code !== 0) {
            return json({ success: false, error: `edge-tts: ${err || "не найден"}` }, 500);
        }
        const data = await Deno.readFile(tmp);
        if (data.length < 200) return json({ success: false, error: "edge-tts вернул пустой файл" }, 500);

        if (TTS_CACHE.size >= TTS_CACHE_MAX) {
            const first = TTS_CACHE.keys().next().value;
            if (first !== undefined) TTS_CACHE.delete(first);
        }
        TTS_CACHE.set(key, data);

        return new Response(data, {
            headers: { ...corsHeaders, "Content-Type": "audio/mpeg", "X-TTS-Cache": "miss" }
        });
    } catch (e: any) {
        // Разбираем причину, чтобы в «Лаборатории голосов» было видно, что чинить.
        const m = String((e && e.message) || e || "");
        let hint = "edge-tts не установлен (bash start.sh поставит сам)";
        if (m.includes("Requires run access") || m.includes("PermissionDenied")) {
            hint = "нет прав: запусти Штаб с флагами --allow-run --allow-write (bash start.sh)";
        } else if (m.includes("Requires write access")) {
            hint = "нет прав на запись: добавь флаг --allow-write (bash start.sh)";
        } else if (m.includes("NotFound") || m.includes("No such file") || m.includes("os error 2")) {
            hint = "edge-tts не установлен (bash start.sh поставит сам, или pip install --break-system-packages edge-tts)";
        }
        return json({ success: false, error: `${hint}: ${m}` }, 500);
    } finally {
        try { await Deno.remove(tmp); } catch (_e) { /* ignore */ }
    }
}

// ── GIT РАДАР: прокси GitHub (токен на сервере, в браузер не уходит) ──
const GH_PROXY_ALLOWED = [
  // ── ПОЛЬЗОВАТЕЛЬ И ЕГО РЕПОЗИТОРИИ ──
  /^\/users\/[^/]+\/repos(\?|$)/,
  /^\/users\/[^/]+(\?|$)/,
  /^\/user(\/repos)?(\?|$)/,
  // ── ВСЁ ПО РЕПОЗИТОРИЮ: ЧТЕНИЕ + ЗАПИСЬ ──
  // Откат: commits, git/commits, git/refs/heads, git/trees.
  // Файлы: contents/... (в т.ч. ?ref=ветка).
  // ❗ БЫЛ БАГ: стояли ТОЧНЫЕ шаблоны, и кнопка 📄 (файлы коммита,
  //    путь /git/trees/<sha>?recursive=1) ловила 403 «путь запрещён».
  // Теперь разрешён ЛЮБОЙ путь внутри /repos/owner/repo/... — радар
  // ходит только по своим репозиториям, а ключ радара всё равно проверяется.
  /^\/repos\/[^/]+\/[^/]+(\/|\?|$)/,
];

async function handleGitHubProxy(req: Request): Promise<Response> {
  // 🔒 ЗАЩИТА: прокси GitHub отдаёт данные ТОЛЬКО с ключом радара.
  // Ключ живёт в /root/.env (GITRADAR_TOKEN), в код и в браузер не попадает.
  // ВАЖНО: это НЕ SHATAB_SECRET — тот защищает запись в Штаб и в браузер не уходит.
  if (!GITRADAR_TOKEN) {
    return json({ success: false, error: "GITRADAR_TOKEN не задан на сервере (/root/.env)" }, 500);
  }
  if ((req.headers.get("X-Gitradar-Token") || "") !== GITRADAR_TOKEN) {
    return json({ success: false, error: "Доступ запрещён: нужен заголовок X-Gitradar-Token" }, 401);
  }

  const url = new URL(req.url);
  const ghPath = url.pathname.replace(/^\/api\/github/, "") + url.search;

  if (!GH_PROXY_ALLOWED.some((rx) => rx.test(ghPath))) {
    return json({ success: false, error: "path not allowed: " + ghPath }, 403);
  }
  if (!GITHUB_TOKEN) {
    return json({ success: false, error: "GITHUB_TOKEN не задан на сервере" }, 500);
  }

  /* ✍️ ЗАПИСЬ ЧЕРЕЗ ШТАБ (приказ Босса): радар откатывает коммиты и
     восстанавливает файлы СВОИМ ключом — отдельный токен GitHub в браузере
     не нужен. Токен GitHub остаётся на сервере. */
  const method = (req.method || "GET").toUpperCase();
  if (!["GET", "POST", "PUT", "PATCH", "DELETE"].includes(method)) {
    return json({ success: false, error: "метод не разрешён: " + method }, 405);
  }

  let bodyText: string | undefined;
  if (method !== "GET" && method !== "HEAD") {
    try { bodyText = await req.text(); } catch (_e) { bodyText = undefined; }
  }

  let up: Response;
  try {
    up = await fetch("https://api.github.com" + ghPath, {
      method,
      headers: {
        "Authorization": `Bearer ${GITHUB_TOKEN}`,
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "shtab-gitradar",
        ...(bodyText ? { "Content-Type": "application/json" } : {}),
      },
      body: bodyText,
    });
  } catch (e: any) {
    return json({ success: false, error: "upstream: " + String(e?.message || e) }, 502);
  }

  const out = new Headers(up.headers);
  for (const [k, v] of Object.entries(corsHeaders)) out.set(k, v);
  out.delete("content-encoding");
  out.delete("content-length");
  return new Response(up.body, { status: up.status, headers: out });
}
// ─────────────────────────────────────────────────────────────────────

// =========================================
// СЕРВЕР (БЕЗ ДУБЛЕЙ WSROOMS)
// =========================================
Deno.serve(async (request) => {
    if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

    // GIT РАДАР — прокси GitHub
    if (new URL(request.url).pathname.startsWith("/api/github/")) {
        return await handleGitHubProxy(request);
    }

    /* 🌐 GET БОЛЬШЕ НЕ ОТДАЁТ 405 (был источник путаницы при проверке озвучки).
       GET /tts?text=Привет — сервер сразу отдаёт mp3: удобно проверить в браузере.
       GET /tts без текста — короткий JSON «сервер жив, озвучка на месте».
       GET на любой другой путь — тоже JSON, а не 405.
       Озвучку Штаб по-прежнему зовёт POST-ом — он остаётся главным методом. */
    if (request.method === "GET") {
        try {
            const u = new URL(request.url);
            const qText = (u.searchParams.get("text") || "").trim();
            if (u.pathname.startsWith("/tts") || qText) {
                if (qText) {
                    return await handleTTS({
                        tts: true,
                        text: qText,
                        voice: u.searchParams.get("voice") || "ru-RU-DmitryNeural",
                        rate: u.searchParams.get("rate") || "+0%",
                        volume: u.searchParams.get("volume") || "+0%",
                        pitch: u.searchParams.get("pitch") || "+0Hz"
                    });
                }
                return json({
                    success: true,
                    service: "Штаб",
                    tts: "edge-tts",
                    hint: "Добавь ?text=Привет — сервер сразу отдаст mp3."
                });
            }
            return json({ success: true, service: "Штаб", status: "работает", tts: "edge-tts" });
        } catch (e: any) {
            return json({ success: false, error: String((e && e.message) || e) }, 500);
        }
    }

    if (request.method !== "POST") return json({ success: false, error: "Метод не поддерживается" }, 405);

    // ОЗВУЧКА — до проверки секрета (нужна и гостям, и Штабу)
    try {
        const peek = await request.clone().json();
        if (peek && peek.tts) return await handleTTS(peek);
    } catch (_e) { /* не JSON — идём дальше */ }

    if (!checkSecret(request)) {
        return json({ success: false, error: "Доступ запрещен: неверный секрет Штаба" }, 401);
    }

    let body: any;
    try { body = await request.json(); } catch { return json({ success: false, error: "Некорректный JSON" }, 400); }

    try {
        // СТАРЫЕ РУЧКИ (БЭКАПЫ)
        if (body.isBackup || body.isRollback) {
            // ЗАМКА «только с ключом Администратора» здесь НЕТ и быть не должно:
            // флаг isBoss из тела запроса игнорируется, запрос пропускается всегда.
            body.isBoss = true;
            // Токен берётся ТОЛЬКО из переменной окружения сервера. У пользователя не спрашиваем.
            if (!GITHUB_TOKEN) return json({ success: false, error: "Токен GitHub не задан на сервере" }, 500);
            if (!REPO_OWNER || !REPO_NAME) return json({ success: false, error: "GitHub не настроен" }, 500);
            return await handleBackup(body);
        }

        // Определяем, с каким репозиторием работаем
        const targetRepo = (body.repo && typeof body.repo === "string" && body.repo.trim()) ? body.repo.trim() : REPO_NAME;
        const isProtected = targetRepo === REPO_NAME;

        // РАБОТА С ФАЙЛАМИ (ПРЯМЫЕ ЗАПРОСЫ)
        if (body.updateFile) {
            if (!GITHUB_TOKEN || !REPO_OWNER || !REPO_NAME) return json({ success: false, error: "GitHub не настроен" }, 500);
            if (isProtected && !isWriteAllowed(body.path, true)) return json({ success: false, error: `Запись в "${body.path}" запрещена.` }, 403);
            if (!isWriteAllowed(body.path, false)) return json({ success: false, error: `Расширение "${body.path}" не разрешено.` }, 403);
            
            if (typeof body.content !== "string" || body.content.length < 10) return json({ success: false, error: "Пустой контент" }, 400);
            if (body.content.length > MAX_WRITE_SIZE) return json({ success: false, error: "Файл слишком большой" }, 413);
            
            try {
                await updateFileInRepo(body.path, body.content, targetRepo);
                return json({ success: true, message: `✅ ${body.path} обновлен в ${targetRepo}` });
            } catch (e: any) { return json({ success: false, error: e.message }, 500); }
        }
              if (body.readFile) {
            if (!isReadAllowed(body.path)) return json({ success: false, error: "Чтение этого пути запрещено" }, 403);
            try {
                const content = await getFileContent(body.path, targetRepo);
                if (content === null) throw new Error("Файл не найден");
                return json({ success: true, path: body.path, content });
            } catch (e: any) { return json({ success: false, error: e.message }, 500); }
        }

        if (body.scanRepo) return await scanRepoFiles();

        /* 👁 ПРОВЕРКА ЗРЕНИЯ (кнопка «👁 Зрение»): отчёт по каждой vision-модели. */
        if (body.visionTest) {
            try {
                const report = await runVisionTest();
                return json({ success: true, answer: report });
            } catch (e: any) { return json({ success: false, error: e.message }, 500); }
        }

        // ПРОВЕРКА GIGACHAT — «жив ли помощник»
        if (body.gigachatTest) {
            try {
                // Проверяем ИМЕННО тот ключ, что вписан в поле (если он есть).
                const gk = String((body.userKeys && (body.userKeys.gigachat || body.userKeys.gigachatKey)) || "").trim();
                const t = await callGigaChat([{ role: "user", content: "Ответь одним словом: работает?" }], "", gk);
                return json({ success: true, answer: t });
            } catch (e: any) { return json({ success: false, error: e.message }, 500); }
        }

        if (body.checkStatus) {
            try {
                const rootFiles = await gitAPI("contents/");
                const backupFiles = await gitAPI("contents/backup");
                const rootNames = Array.isArray(rootFiles) ? rootFiles.filter((f: any) => f.type === 'file').map((f: any) => f.name) : [];
                const backupNames = Array.isArray(backupFiles) ? backupFiles.filter((f: any) => f.type === 'file').map((f: any) => f.name) : [];
                return json({ success: true, totalRoot: rootNames.length, totalBackup: backupNames.length, missingInBackup: rootNames.filter((n: string) => !backupNames.includes(n)) });
            } catch (e: any) { return json({ success: false, error: e.message }, 500); }
        }
            // ПОИСК
        if (body.searchQuery) return json({ success: true, results: await searchInternet(String(body.searchQuery)) });

        /* ⚡ ДУЭТ — ЖИВОЙ ДИАЛОГ ПО ШАГАМ (приказ Босса).
           Клиент зовёт шаги по одному (duetStep = 1..8) и рисует каждую
           реплику в чате сразу, как она пришла. После шага 7 — пауза:
           Босс может добавить своё, и только потом идёт финал (шаг 8). */
        if (body.duetStep) {
            const step = Number(body.duetStep) || 0;
            if (step < 1 || step > 8) return json({ success: false, error: "Неверный шаг дуэта" }, 400);
            const dKeys = body.userKeys || {};
            const dGcKey = String((dKeys && (dKeys.gigachat || dKeys.gigachatKey)) || "").trim();
            const dMsgs = Array.isArray(body.messages) ? body.messages : [];
            if (step === 8 && !dMsgs.length) return json({ success: false, error: "Для финального шага нужна история чата" }, 400);
            zlog(`[DUET] шаг ${step} (живой диалог)`);
            const dOut = await duetStepOnce(
                step,
                String(body.duetQuestion || "").slice(0, 4000),
                String(body.duetTalk || "").slice(0, 12000),
                String(body.duetExtra || "").slice(0, 2000),
                dMsgs, dKeys, dGcKey
            );
            return json({ choices: [{ message: { content: dOut } }] });
        }

        // ГЛАВНАЯ РУЧКА: ИИ
        if (body.messages) {
            /* 💰 РЕЖИМ ЭКОНОМИИ ТОКЕНОВ И КЭША + 🚧 ЖЁСТКИЙ ЛИМИТ ВИТКОВ —
               оба блока приклеиваем к системному промту ОДИН раз на запрос.
               Работает для всех каналов: Zveno, GigaChat, ERNIE, зрение. */
            try {
                const _msgs = body.messages;
                if (Array.isArray(_msgs)) {
                    const _si = _msgs.findIndex((m: any) => m && m.role === "system");
                    if (_si !== -1) _msgs[_si].content = withEconomy(_msgs[_si].content);
                    else _msgs.unshift({ role: "system", content: withEconomy("") });
                }
            } catch (_e) { /* не массив — пропускаем */ }
            const userKeys = body.userKeys || {};
            /* 🟣 КЛЮЧ СБЕРА ИЗ ПОЛЯ ⚙️ (userKeys.gigachat). Пусто — серверный. */
            const gcKey = String((userKeys && (userKeys.gigachat || userKeys.gigachatKey)) || "").trim();
            let aiText = "";

            const reqModel = typeof body.model === "string" ? body.model.trim() : "";
            /* ⚡ ДУЭТ: клиент может прислать model="duet" ИЛИ массив моделей
               ["zveno","gigachat"] — оба варианта означают одну и ту же цепочку. */
            const modelList: string[] = Array.isArray(body.model)
                ? body.model.map((m: any) => String(m || "").trim().toLowerCase()).filter(Boolean)
                : (reqModel ? [reqModel.toLowerCase()] : []);
            const isDuetReq = modelList.includes("duet") || (modelList.includes("zveno") && modelList.includes("gigachat"));
            zlog(`[REQ] model="${reqModel || "(не указана → Архитектор)"}" duet=${isDuetReq} image=${!!body.image}`);

            /* ❗ ДВА КАНАЛА, ЛИНЕЙНО, БЕЗ ПЕРЕБОРА (приказ Босса).
               Инструменты (Tools) включены в ОБОИХ каналах. */
            if (body.image) {
                /* 👁 ФОТО — ЗРЕНИЕ КАНАЛА ZVENO (приказ Босса).
                   Раньше сервер на фото отвечал ТОЛЬКО описанием, а задачу Босса
                   не решал. Теперь: фото → подробное описание → описание
                   подмешивается в последнее сообщение Босса → и дальше идёт
                   ОБЫЧНЫЙ канал с инструментами. Архитектор и «видит» картинку,
                   и делает работу. */
                const msgsWithPhoto = JSON.parse(JSON.stringify(body.messages || []));
                let visionDesc = "";
                try {
                    visionDesc = await callZvenoVision(msgsWithPhoto, String(body.image), userKeys, reqModel);
                } catch (e: any) {
                    zlog(`[VISION] фото не прочитано: ${e?.message || e}`);
                }
                if (!visionDesc) {
                    return json({ choices: [{ message: { content: "👁 Не смог прочитать фото: ни одна vision-модель шлюза не ответила. Скинь скрин ещё раз или опиши словами." } }] });
                }
                for (let i = msgsWithPhoto.length - 1; i >= 0; i--) {
                    if (msgsWithPhoto[i] && msgsWithPhoto[i].role === "user") {
                        const cur = typeof msgsWithPhoto[i].content === "string" ? msgsWithPhoto[i].content : JSON.stringify(msgsWithPhoto[i].content);
                        msgsWithPhoto[i].content = `[ФОТО ОТ БОССА — ЧТО НА НЁМ]\n${visionDesc}\n\n[ЗАДАЧА БОССА]\n${cur}`;
                        break;
                    }
                }
                if (isDuetReq) aiText = await callDuet(msgsWithPhoto, userKeys, gcKey);
                else if (/^gigachat/i.test(reqModel)) aiText = await callGigaChatTools(msgsWithPhoto, reqModel, gcKey);
                else aiText = await callZvenoAI(msgsWithPhoto, userKeys, true, reqModel);
            } else if (isDuetReq) {
                // ⚡ ДУЭТ: Zveno (черновик) → GigaChat (критик и финал). Максимум 2 шага.
                aiText = await callDuet(body.messages, userKeys, gcKey);
            } else if (/^gigachat/i.test(reqModel)) {
                // 🟣 GigaChat (Сбер) — ключ с сервера, инструменты ВКЛЮЧЕНЫ.
                aiText = await callGigaChatTools(body.messages, reqModel, gcKey);
            } else {
                // 🅰️ Zveno — ключ ZVENO_API_KEY с сервера, инструменты ВКЛЮЧЕНЫ.
                aiText = await callZvenoAI(body.messages, userKeys, true, reqModel);
            }

            return json({ choices: [{ message: { content: aiText } }] });
        }

        return json({ success: false, error: "Неизвестный запрос" }, 400);
    } catch (e: any) {
        const msg = e instanceof Error ? e.message : "Неизвестная ошибка";
        /* ❗ НА ОШИБКЕ choices НЕ КЛАДЁМ (был баг): клиент видел текст в choices
           и принимал ошибку за нормальный ответ — отсюда «✅ Ключ живой.
           Ответ: ❌ Ошибка: missing or invalid authorization» на мёртвом ключе. */
        return json({ success: false, error: msg }, 500);
    }
});
