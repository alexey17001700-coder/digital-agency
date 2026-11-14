// TEST AUTO UPDATE
const GITHUB_TOKEN = Deno.env.get("GITHUB_TOKEN");
const REPO_OWNER = Deno.env.get("GITHUB_OWNER");
const REPO_NAME = Deno.env.get("GITHUB_REPO") || "digital-agency";

const ZVENO_URL = "https://api.zveno.ai/v1/chat/completions";
const ZVENO_MODEL = "deepseek/deepseek-v4.1-flash";
const SHATAB_SECRET = Deno.env.get("SHATAB_SECRET") || "";

// БЕЛЫЙ СПИСОК РАСШИРЕНИЙ (разрешаем .ts для main.ts)
const WRITE_ALLOWED_EXT = [
    ".js", ".css", ".html", ".json", ".md", ".txt", ".xml", ".yaml", ".yml",
    ".ts", ".py", ".dart", ".sh", ".svg", ".png", ".jpg", ".jpeg", ".ico"
];
const WRITE_DENY_NAMES = []; // Разрешаем всё, кроме удаления (проверяется в delete_file)
const MAX_WRITE_SIZE = 500000;
const MAX_TOOL_RESULT = 200000;

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
            sourceFiles = rootContents.filter((item: any) => item.type === 'file' && ![".gitignore", "README.md", "ai_brain.json"].includes(item.name)).map((item: any) => ({ name: item.name, sha: item.sha }));
        }
    } else {
        try {
            const backupContents = await gitAPI("contents/backup");
            if (Array.isArray(backupContents)) {
                sourceFiles = backupContents.filter((item: any) => item.type === 'file').map((item: any) => ({ name: item.name, sha: item.sha }));
            }
        } catch (e) {}
    }
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

        return `Ошибка: неизвестный инструмент "${name}".`;
    } catch (e: any) {
        return `Ошибка выполнения ${name}: ${e.message}`;
    }
}
// =========================================
// ЗАПРОС К ZVENO (ЗРЕНИЕ)
// =========================================
async function callZvenoVision(messages: any[], imageBase64: string): Promise<string> {
    const apiKey = Deno.env.get("ZVENO_API_KEY");
    if (!apiKey) throw new Error("ZVENO_API_KEY не задан");

    const visionModel = "openai/gpt-4o-mini";

    let visionMessages = JSON.parse(JSON.stringify(messages));

    // Жестко перебиваем промпт, чтобы модель не отказывалась смотреть фото
    const systemIndex = visionMessages.findIndex((m: any) => m.role === "system");
    const visionPrompt = "Ты зрячий ИИ-помощник. Ты ОБЯЗАН анализировать изображения. Если пользователь прислал фото и задал вопрос — опиши, что на нем изображено, в деталях. Не отказывайся от ответа.";

    if (systemIndex !== -1) {
        visionMessages[systemIndex].content = visionPrompt;
    } else {
        visionMessages.unshift({ role: "system", content: visionPrompt });
    }

    let lastMsg = visionMessages[visionMessages.length - 1];

    if (lastMsg && lastMsg.role === "user") {
        const textPrompt = lastMsg.content || "Опиши, что изображено на этом фото.";
        lastMsg.content = [
            { type: "text", text: textPrompt },
            { type: "image_url", image_url: { url: imageBase64 } }
        ];
    }

    const payload = {
        model: visionModel,
        messages: visionMessages,
        max_tokens: 1024,
        temperature: 0.7
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
    if (!res.ok) throw new Error(data.error?.message || `Ошибка Vision: ${res.status}`);
    return data.choices?.[0]?.message?.content || "Пустой ответ";
}
// =========================================
// ЗАПРОС К ZVENO (ТЕКСТ И ИНСТРУМЕНТЫ)
// =========================================
async function callZvenoAI(messages: any[], userKeys: any = {}): Promise<string> {
    const apiKey = Deno.env.get("ZVENO_API_KEY");
    if (!apiKey) throw new Error("ZVENO_API_KEY не задан");

    let currentMessages = [...messages];
    let maxLoops = 20; // Увеличено для сложных задач
    let weatherCard = "";

    for (let loop = 0; loop < maxLoops; loop++) {
        const payload: any = {
            model: ZVENO_MODEL,
            messages: currentMessages,
            temperature: 0.5,
            tools: TOOLS,
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
        if (!res.ok) throw new Error(data.error?.message || `Ошибка Zveno: ${res.status}`);

        const msg = data.choices?.[0]?.message;
        if (!msg) throw new Error("Пустой ответ от Zveno");

        if (msg.tool_calls && msg.tool_calls.length > 0) {
            currentMessages.push(msg);
            for (const tc of msg.tool_calls) {
                const fnName = tc.function.name;
                const fnArgs = JSON.parse(tc.function.arguments || "{}");
                console.log(`[TOOL] ${fnName}(${JSON.stringify(fnArgs).slice(0, 100)})`);
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
        return weatherCard ? weatherCard + "\n\n" + answer : answer;
    }

    return "⚠️ Слишком много шагов. Задача прервана.";
}

// =========================================
// СЕРВЕР (БЕЗ ДУБЛЕЙ WSROOMS)
// =========================================
Deno.serve(async (request) => {
    if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
    if (request.method !== "POST") return json({ success: false, error: "Метод не поддерживается" }, 405);

    if (!checkSecret(request)) {
        return json({ success: false, error: "Доступ запрещен: неверный секрет Штаба" }, 401);
    }

    let body: any;
    try { body = await request.json(); } catch { return json({ success: false, error: "Некорректный JSON" }, 400); }

    try {
        // СТАРЫЕ РУЧКИ (БЭКАПЫ)
        if (body.isBackup || body.isRollback) {
            if (!GITHUB_TOKEN || !REPO_OWNER || !REPO_NAME) return json({ success: false, error: "GitHub не настроен" }, 500);
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
            let aiText = "";

            if (body.image) {
                aiText = await callZvenoVision(body.messages, body.image);
            } else {
                aiText = await callZvenoAI(body.messages, userKeys);
            }

            return json({ choices: [{ message: { content: aiText } }] });
        }

        return json({ success: false, error: "Неизвестный запрос" }, 400);
    } catch (e: any) {
        const msg = e instanceof Error ? e.message : "Неизвестная ошибка";
        return json({ success: false, error: msg, choices: [{ message: { content: `❌ **Ошибка:** ${msg}` } }] }, 500);
    }
});
