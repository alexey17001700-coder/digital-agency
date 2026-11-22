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

/* 👁 ЗРЕНИЕ — ОДНА модель, Босс её не выбирает.
   Это «глаза» канала Zveno: фото → описание → в контекст. */
const VISION_MODEL = "nvidia/nemotron-3.5-super-vl:free";
const SHATAB_SECRET = Deno.env.get("SHATAB_SECRET") || "";

// БЕЛЫЙ СПИСОК РАСШИРЕНИЙ (разрешаем .ts для main.ts)
const WRITE_ALLOWED_EXT = [
    ".js", ".css", ".html", ".json", ".md", ".txt", ".xml", ".yaml", ".yml",
    ".ts", ".py", ".dart", ".sh", ".svg", ".png", ".jpg", ".jpeg", ".ico"
];
const WRITE_DENY_NAMES = []; // Разрешаем всё, кроме удаления (проверяется в delete_file)
const MAX_WRITE_SIZE = 500000;
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
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Shtab-Token",
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

    const res = await fetch(ZVENO_URL, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`
        },
        body: JSON.stringify({ model: VISION_MODEL, messages: visionMessages, max_tokens: 1024, temperature: 0.7 }),
        signal: AbortSignal.timeout(FETCH_TIMEOUT)
    });

    const data = await res.json();
    if (!res.ok) throw new Error(`Vision: ${data?.error?.message || res.status}`);
    const text = data.choices?.[0]?.message?.content;
    if (!text) throw new Error("Vision: пустой ответ");
    zlog(`[VISION] ответила модель: ${VISION_MODEL}`);
    return text;
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

async function callGigaChat(messages: any[], requestedModel: string = "", userKey: string = ""): Promise<string> {
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
        body: JSON.stringify({ model, messages: clean, temperature: 0.5 }),
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
// Цепочка: 🅰️ Zveno пишет ЧЕРНОВИК (инструменты вкл.) →
//          🟣 GigaChat проверяет, дополняет и выдаёт ФИНАЛ (инструменты вкл.).
// ЖЁСТКИЙ ПРЕДЕЛ: DUET_MAX_STEPS = 2. Ответ GigaChat обратно в Zveno НЕ уходит —
// зацикливание физически невозможно (цикл конечный, шаг 2 последний).
// ИНСТРУМЕНТЫ НЕ ЛОМАЮТСЯ: каждый шаг работает СВОИМ родным механизмом —
// Zveno через OpenAI tools, GigaChat через functions Сбера. Оба шага с Tools.
// =========================================
const DUET_MAX_STEPS = 2;

const DUET_CRITIC_PROMPT = `Ты — критик и эксперт. Ниже ответ от другой модели. Проверь его на ошибки, дополни и выдай финальный идеальный ответ от лица Штаба.
Требования:
1) исправь фактические ошибки и неточности;
2) добавь то, что пропущено;
3) код, ссылки, имена файлов и служебные метки ([FILE: ...], [TASK: ...], [ЭТАП N/M], [[WEATHER_CARD]]...[[/WEATHER_CARD]]) сохрани БЕЗ изменений;
4) не упоминай черновик и другую модель — это твой собственный ответ;
5) отвечай по-русски, чётко и по делу, без вступлений.`;

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
    let draft = "";
    let finalText = "";
    let weatherCard = "";
    let lastErr = "";

    for (let step = 1; step <= DUET_MAX_STEPS; step++) {
        if (step === 1) {
            // ШАГ 1 — 🅰️ Zveno: черновик. Инструменты включены.
            try {
                draft = await callZvenoAI(messages, userKeys, true, "duet");
                const cm = draft.match(/\[\[WEATHER_CARD\]\][\s\S]*?\[\[\/WEATHER_CARD\]\]/);
                if (cm) { weatherCard = cm[0]; draft = draft.replace(cm[0], "").trim(); }
            } catch (e: any) {
                lastErr = e?.message || String(e);
                zlog(`[DUET] шаг 1 (Zveno) упал: ${lastErr}`);
            }
            if (!draft) break;   // черновика нет — критиковать нечего, дальше не идём
        } else {
            // ШАГ 2 — 🟣 GigaChat: критик и финальный ответ. Инструменты включены.
            const criticMessages = [
                { role: "system", content: DUET_CRITIC_PROMPT },
                { role: "user", content: `ВОПРОС БОССА:\n${lastUserText(messages)}\n\nЧЕРНОВИК ОТ ДРУГОЙ МОДЕЛИ:\n${draft}` }
            ];
            try {
                finalText = await callGigaChatTools(criticMessages, "duet", gcKey);
            } catch (e: any) {
                lastErr = e?.message || String(e);
                zlog(`[DUET] шаг 2 (GigaChat) упал: ${lastErr}`);
            }
        }
    }

    if (finalText && finalText.trim()) {
        zlog("[DUET] финал от GigaChat получен");
        return weatherCard ? weatherCard + "\n\n" + finalText.trim() : finalText.trim();
    }
    if (draft) {
        // GigaChat упал — отдаём черновик Zveno, чтобы Босс не остался без ответа.
        zlog("[DUET] финал от GigaChat не получен — отдаю черновик Zveno");
        return weatherCard ? weatherCard + "\n\n" + draft : draft;
    }
    throw new Error(`Дуэт: обе модели не ответили (${lastErr || "нет ответа"})`);
}

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

// =========================================
// СЕРВЕР (БЕЗ ДУБЛЕЙ WSROOMS)
// =========================================
Deno.serve(async (request) => {
    if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
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

        // ГЛАВНАЯ РУЧКА: ИИ
        if (body.messages) {
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
                // 👁 Фото — зрение канала Zveno.
                aiText = await callZvenoVision(body.messages, body.image, userKeys, reqModel);
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
