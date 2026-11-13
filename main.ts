// TEST AUTO UPDATE
const GITHUB_TOKEN = Deno.env.get("GITHUB_TOKEN");
const REPO_OWNER = Deno.env.get("GITHUB_OWNER");
const REPO_NAME = Deno.env.get("GITHUB_REPO");

const ZVENO_URL = "https://api.zveno.ai/v1/chat/completions";
const ZVENO_MODEL = "deepseek/deepseek-v4.1-flash";

const SHATAB_SECRET = Deno.env.get("SHATAB_SECRET") || "";

const WRITE_ALLOWED_EXT = [".js", ".css", ".html", ".dart", ".yaml"];
const WRITE_DENY_NAMES = ["main.ts"];
const MAX_WRITE_SIZE = 400000;  
const MAX_TOOL_RESULT = 40000;  

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

function isWriteAllowed(path: unknown): boolean {
  if (typeof path !== "string") return false;
  const clean = path.trim().replace(/^\.\//, "");
  if (!clean || clean.includes("..")) return false;
  if (clean.includes("/") || clean.includes("\\")) return false;
  const lower = clean.toLowerCase();
  if (WRITE_DENY_NAMES.includes(lower)) return false;
  if (lower.startsWith("backup")) return false;
  return WRITE_ALLOWED_EXT.some((ext) => lower.endsWith(ext));
}

function isReadAllowed(path: unknown): boolean {
  if (typeof path !== "string") return false;
  const clean = path.trim().replace(/^\.\//, "");
  if (!clean || clean.includes("..")) return false;
  if (clean.includes("/") || clean.includes("\\")) return false;
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
  if (!data || data.encoding !== "base64" || !data.content) return null;
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
  if (d.includes("гроза") || d.includes("thunder")) return "⛈️";
  if (d.includes("снег") || d.includes("snow") || d.includes("метель") || d.includes("blizzard")) return "🌨️";
  if (d.includes("ливень") || d.includes("дождь") || d.includes("rain") || d.includes("морос") || d.includes("drizzle")) return "🌧️";
  if (d.includes("туман") || d.includes("mist") || d.includes("fog") || d.includes("дымка")) return "🌫️";
  if (d.includes("облач") || d.includes("cloud") || d.includes("пасмур") || d.includes("overcast")) return "☁️";
  if (d.includes("солнеч") || d.includes("ясно") || d.includes("sunny") || d.includes("clear")) return "☀️";
  return "🌡️";
}

async function getWeather(city: string) {
  const url = `https://wttr.in/${encodeURIComponent(city)}?format=j1&lang=ru`;
  const res = await fetch(url, {
    signal: AbortSignal.timeout(30000),
    headers: { "User-Agent": "curl" },
  });
  if (!res.ok) throw new Error(`wttr.in вернул ${res.status}`);
  const data = await res.json();

  const cur = data?.current_condition?.[0];
  if (!cur) throw new Error("wttr.in не отдал текущую погоду");

  const area = data?.nearest_area?.[0];
  const placeName = area?.areaName?.[0]?.value || city;
  const country = area?.country?.[0]?.value || "";

  const temp = cur.temp_C;
  const feels = cur.FeelsLikeC;
  const desc = cur.lang_ru?.[0]?.value || cur.weatherDesc?.[0]?.value || "без описания";
  const hum = cur.humidity;
  const wind = cur.windspeedKmph;
  const windDir = cur.winddir16Point;
  const press = cur.pressure;
  const visib = cur.visibility;
  const precip = cur.precipMM;
  const cloud = cur.cloudcover;

  const emoji = weatherEmoji(desc);

  let out = `${emoji} **Погода — ${placeName}${country ? ", " + country : ""}**\n`;
  out += `━━━━━━━━━━━━━━━━━━\n`;
  out += `🌡️ Температура: **${temp}°C** (ощущается как ${feels}°C)\n`;
  out += `☁️ Состояние: ${desc}\n`;
  out += `💨 Ветер: ${wind} км/ч, ${windDir}\n`;
  out += `💧 Влажность: ${hum}%\n`;
  out += `📊 Давление: ${press} гПа\n`;
  out += `👁️ Видимость: ${visib} км\n`;
  out += `☁️ Облачность: ${cloud}%\n`;
  if (parseFloat(precip) > 0) out += `🌧️ Осадки: ${precip} мм\n`;

  const cardData: any = {
    city: placeName, country: country, temp: Number(temp), feels: Number(feels), desc: desc, emoji: emoji,
    wind: Number(wind), dir: windDir, hum: Number(hum), press: Number(press), visib: Number(visib),
    cloud: Number(cloud), precip: Number(precip) || 0, daily: [] as any[]
  };

  const days = data?.weather;
  if (Array.isArray(days) && days.length) {
    out += `━━━━━━━━━━━━━━━━━━\n📅 **Прогноз:**\n`;
    const labels = ["Сегодня", "Завтра", "Послезавтра"];
    days.slice(0, 3).forEach((d: any, i: number) => {
      const midHour = d.hourly?.[4] || d.hourly?.[0] || {};
      const dDesc = midHour.lang_ru?.[0]?.value || midHour.weatherDesc?.[0]?.value || "";
      out += `${weatherEmoji(dDesc)} ${labels[i] || ("День " + (i + 1))}: ${d.mintempC}…${d.maxtempC}°C, ${dDesc}\n`;
      cardData.daily.push({ label: labels[i] || ("День " + (i + 1)), emoji: weatherEmoji(dDesc), min: Number(d.mintempC), max: Number(d.maxtempC), desc: dDesc });
    });
  }

  const cardBlock = `[[WEATHER_CARD]]${JSON.stringify(cardData)}[[/WEATHER_CARD]]`;
  return cardBlock + "\n" + out.trim();
}

async function handleBackup(body: any) {
  const ref = await gitAPI(`git/refs/heads/main`);
  if (!ref) throw new Error("Ветка main не найдена");
  const commit = await gitAPI(`git/commits/${ref.object.sha}`);
  if (!commit) throw new Error("Коммит ветки main не найден");

  let sourceFiles: { name: string, sha: string }[] = [];

  if (body.isBackup) {
    const rootContents = await gitAPI("contents/");
    if (Array.isArray(rootContents)) {
      sourceFiles = rootContents.filter((item: any) => item.type === 'file').filter((item: any) => !['.gitignore', 'README.md', 'ai_brain.json'].includes(item.name)).map((item: any) => ({ name: item.name, sha: item.sha }));
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
  const newCommit = await gitAPI("git/commits", "POST", { message: body.isBackup ? "Auto-backup" : "Rollback", tree: newTree.sha, parents: [ref.object.sha] });
  await gitAPI(`git/refs/heads/main`, "PATCH", { sha: newCommit.sha, force: true });

  return json({ success: true, message: body.isBackup ? `Эталон сохранен (${tree.length} файлов)!` : `Штаб откачен (${tree.length} файлов)!` });
}
// ============================================
// ОПИСАНИЕ ИНСТРУМЕНТОВ (TOOL CALLING)
// ============================================
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
          repo: { type: "string", description: "Имя репозитория: digital-agency (по умолчанию) или window_calc" }
        },
        required: ["path"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "write_file",
      description: "Записывает новый код в файл на GitHub.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Путь к файлу" },
          content: { type: "string", description: "ПОЛНЫЙ новый код файла" },
          repo: { type: "string", description: "Имя репозитория: digital-agency (по умолчанию) или window_calc" }
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
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Поисковый запрос" }
        },
        required: ["query"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_weather",
      description: "Узнаёт текущую погоду в указанном городе через wttr.in.",
      parameters: {
        type: "object",
        properties: {
          city: { type: "string", description: "Название города" }
        },
        required: ["city"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "replace_in_file",
      description: "Точечная замена кода в файле.",
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
      description: "Ищет картинку в интернете по текстовому запросу. Возвращает прямую ссылку на изображение.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Что искать" }
        },
        required: ["query"]
      }
    }
  }
];
// ============================================
// ВЫПОЛНЕНИЕ ИНСТРУМЕНТОВ
// ============================================
async function executeTool(name: string, args: any): Promise<string> {
  try {
    // Определяем репозиторий (по умолчанию digital-agency)
    const targetRepo = args.repo === "window_calc" ? "window_calc" : REPO_NAME;

    if (name === "read_file") {
      if (!isReadAllowed(args.path)) return `Ошибка: чтение "${args.path}" запрещено.`;
      const content = await getFileContent(args.path, targetRepo);
      if (content === null) return `Ошибка: файл "${args.path}" не найден.`;
      return content;
    }
    if (name === "write_file") {
      if (!isWriteAllowed(args.path)) return `Ошибка: запись в "${args.path}" запрещена. Разрешены только .js/.css/.html/.dart/.yaml в корне (кроме main.ts и backup/).`;
      if (!args.content || args.content.length < 10) return "Ошибка: пустой контент.";
      if (args.content.length > MAX_WRITE_SIZE) return `Ошибка: файл слишком большой (${args.content.length} символов, лимит ${MAX_WRITE_SIZE}).`;
      await updateFileInRepo(args.path, args.content, targetRepo);
      return `Успех: файл "${args.path}" обновлён в репозитории ${targetRepo}.`;
    }
    if (name === "search_web") {
      return await searchInternet(args.query);
    }
    if (name === "get_weather") {
      return await getWeather(args.city || "Саратов");
    }
    if (name === "replace_in_file") {
      if (args.path === "main.ts" || args.path.startsWith("backup/")) {
        return "Ошибка: запись в этот файл запрещена системой безопасности.";
      }
      const oldCode = await getFileContent(args.path, targetRepo);
      if (!oldCode) return `Ошибка: файл "${args.path}" не найден.`;
      if (!oldCode.includes(args.search)) return `Ошибка: фрагмент для поиска не найден.`;
      
      const newCode = oldCode.split(args.search).join(args.replace);
      
      await updateFileInRepo(args.path, newCode, targetRepo);
      return `Успех: файл "${args.path}" обновлен в репозитории ${targetRepo}.`;
    }
    if (name === "search_image") {
      try {
        const url = `https://api.openverse.org/v1/images/?q=${encodeURIComponent(args.query)}&page_size=1`;
        const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
        const data = await res.json();
        
        if (data.results && data.results.length > 0) {
          const image = data.results[0];
          return `[IMAGE_URL]${image.url}[/IMAGE_URL]`;
        }
        return `Ошибка: по запросу "${args.query}" ничего не найдено.`;
      } catch (e: any) {
        return `Ошибка поиска картинки: ${e.message}`;
      }
    }

    return `Ошибка: неизвестный инструмент ${name}`;
    
  } catch (e: any) {
    return `Ошибка выполнения ${name}: ${e.message}`;
  }
    }
// ============================================
// ЗАПРОС К ZVENO (ЗРЕНИЕ)
// ============================================
async function callZvenoVision(messages: any[], imageBase64: string): Promise<string> {
  const apiKey = Deno.env.get("ZVENO_API_KEY");
  if (!apiKey) throw new Error("ZVENO_API_KEY не задан");
  
  const visionModel = "openai/gpt-4o-mini"; 
  
  let visionMessages = JSON.parse(JSON.stringify(messages)); 
  
  const systemIndex = visionMessages.findIndex((m: any) => m.role === 'system');
  const visionPrompt = "Ты — зрячий ИИ-помощник. Ты ОБЯЗАН анализировать изображения. Если пользователь прислал фото и задал вопрос — опиши, что на нем изображено, в деталях. Не отказывайся от ответа.";
  
  if (systemIndex !== -1) {
      visionMessages[systemIndex].content = visionPrompt;
  } else {
      visionMessages.unshift({ role: "system", content: visionPrompt });
  }
  
  let lastMsg = visionMessages[visionMessages.length - 1];
  
  if (lastMsg && lastMsg.role === 'user') {
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

// ============================================
// ЗАПРОС К ZVENO (ТЕКСТ И ИНСТРУМЕНТЫ)
// ============================================
async function callZvenoAI(messages: any[], userKeys: any = {}): Promise<string> {
  const apiKey = Deno.env.get("ZVENO_API_KEY");
  if (!apiKey) throw new Error("ZVENO_API_KEY не задан");

  let currentMessages = [...messages];
  let maxLoops = 5;
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
          const cardMatch = result.match(/\[\[WEATHER_CARD\]\][\s\S]*?\[\[\/WEATHER_CARD\]\]/);
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
      continue;
    }

    const answer = msg.content || "Пустой ответ";
    return weatherCard ? weatherCard + "\n\n" + answer : answer;
  }

  return "⚠️ Слишком много шагов. Задача прервана.";
}
Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (request.method !== "POST") return json({ success: false, error: "Метод не поддерживается" }, 405);

  if (!checkSecret(request)) {
    return json({ success: false, error: "Доступ запрещён: неверный секрет Штаба" }, 401);
  }

  let body: any;
  try { body = await request.json(); } catch { return json({ success: false, error: "Некорректный JSON" }, 400); }

  try {
    // СТАРЫЕ РУЧКИ (БЭКАПЫ И ФАЙЛЫ)
    if (body.isBackup || body.isRollback) {
      if (!GITHUB_TOKEN || !REPO_OWNER || !REPO_NAME) return json({ success: false, error: "GitHub не настроен" }, 500);
      return await handleBackup(body);
    }
    
    // Определяем репозиторий для прямых запросов (если передан)
    const targetRepo = body.repo === "window_calc" ? "window_calc" : REPO_NAME;

    if (body.updateFile) {
      if (!GITHUB_TOKEN || !REPO_OWNER || !REPO_NAME) return json({ success: false, error: "GitHub не настроен" }, 500);
      if (!isWriteAllowed(body.path)) return json({ success: false, error: `Запись в "${body.path}" запрещена.` }, 403);
      if (typeof body.content !== "string" || body.content.length < 10) return json({ success: false, error: "Пустой контент" }, 400);
      if (body.content.length > MAX_WRITE_SIZE) return json({ success: false, error: `Файл слишком большой` }, 413);
      try {
        await updateFileInRepo(body.path, body.content, targetRepo);
        return json({ success: true, message: `✅ ${body.path} обновлён` });
      } catch(e: any) { return json({ success: false, error: e.message }, 500); }
    }
    
    if (body.readFile) {
      if (!isReadAllowed(body.path)) return json({ success: false, error: "Чтение этого пути запрещено" }, 403);
      try {
        const content = await getFileContent(body.path, targetRepo);
        if (content === null) throw new Error("Файл не найден");
        return json({ success: true, path: body.path, content });
      } catch(e: any) { return json({ success: false, error: e.message }, 500); }
    }
    
    if (body.scanRepo) {
      return await scanRepoFiles();
    }
    
    if (body.checkStatus) {
      try {
        const rootFiles = await gitAPI("contents/");
        const backupFiles = await gitAPI("contents/backup");
        const rootNames = Array.isArray(rootFiles) ? rootFiles.filter((f:any) => f.type === 'file').map((f:any) => f.name) : [];
        const backupNames = Array.isArray(backupFiles) ? backupFiles.filter((f:any) => f.type === 'file').map((f:any) => f.name) : [];
        return json({ success: true, totalRoot: rootNames.length, totalBackup: backupNames.length, missingInBackup: rootNames.filter((n: string) => !backupNames.includes(n)) });
      } catch(e: any) { return json({ success: false, error: e.message }, 500); }
    }

    // ПОИСК
    if (body.searchQuery) return json({ success: true, results: await searchInternet(String(body.searchQuery)) });

    // ГЛАВНАЯ РУЧКА: ИИ
    if (body.messages) {
      const modelType = body.model || "yandex";
      const userKeys = body.userKeys || {};
      let aiText = "";

      if (body.image) {
        aiText = await callZvenoVision(body.messages, body.image);
      } else if (modelType === "zveno") {
        aiText = await callZvenoAI(body.messages, userKeys);
      } else if (modelType === "deepseek") {
        if (!userKeys.deepseekKey) throw new Error("Нет ключа DeepSeek");
        const res = await fetch("https://api.deepseek.com/chat/completions", {
          method: "POST", headers: { "Content-Type": "application/json", "Authorization": `Bearer ${userKeys.deepseekKey}` },
          body: JSON.stringify({ model: "deepseek-chat", messages: body.messages, temperature: 0.7 }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error?.message || "Ошибка DeepSeek");
        aiText = data.choices[0].message.content;
      } else {
        if (!userKeys.yandexKey || !userKeys.yandexFolder) throw new Error("Нет ключей Yandex");
        const yandexMessages = body.messages.filter((m: any) => m.content && m.content.trim() !== "").map((m: any) => ({ role: m.role, text: m.content }));
        const res = await fetch("https://llm.api.cloud.yandex.net/foundationModels/v1/completion", {
          method: "POST", headers: { "Content-Type": "application/json", "Authorization": `Api-Key ${userKeys.yandexKey}` },
          body: JSON.stringify({ modelUri: `gpt://${userKeys.yandexFolder}/yandexgpt/latest`, completionOptions: { stream: false, temperature: 0.7, maxTokens: "2000" }, messages: yandexMessages }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error?.message || "Ошибка Yandex");
        aiText = data.result?.alternatives?.[0]?.message?.text || "Пустой ответ";
      }
      return json({ choices: [{ message: { content: aiText } }] });
    }

    return json({ success: false, error: "Неизвестный запрос" }, 400);
  } catch (e: any) {
    const msg = e instanceof Error ? e.message : "Неизвестная ошибка";
    return json({ success: false, error: msg, choices: [{ message: { content: `❌ **Ошибка:** ${msg}` } }] }, 500);
  }
});
