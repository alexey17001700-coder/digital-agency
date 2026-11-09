const GITHUB_TOKEN = Deno.env.get("GITHUB_TOKEN");
const REPO_OWNER = Deno.env.get("GITHUB_OWNER");
const REPO_NAME = Deno.env.get("GITHUB_REPO");
const ZVENO_URL = "https://api.zveno.ai/v1/chat/completions";
const ZVENO_MODEL = "deepseek/deepseek-v4.1-flash";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Credentials": "true"
};
const FETCH_TIMEOUT = 30000;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

async function callZvenoAI(messages: any[]): Promise<string> {
  const apiKey = Deno.env.get("ZVENO_API_KEY");
  if (!apiKey) throw new Error("ZVENO_API_KEY не задан");
  const payload = { model: ZVENO_MODEL, messages, temperature: 0.7, max_tokens: 1024, stream: false };
  const res = await fetch(ZVENO_URL, { method: "POST", headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` }, body: JSON.stringify(payload), signal: AbortSignal.timeout(FETCH_TIMEOUT) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || `Ошибка ZvenoAI: ${res.status}`);
  return data.choices?.[0]?.message?.content || "Пустой ответ";
}

async function gitAPI(path: string, method = "GET", bodyData: any = null) {
  const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/${path}`;
  const options: any = { method, signal: AbortSignal.timeout(FETCH_TIMEOUT), headers: { "Authorization": `token ${GITHUB_TOKEN}`, "Accept": "application/vnd.github.v3+json", "User-Agent": "DenoDeploy" } };
  if (bodyData) options.body = JSON.stringify(bodyData);
  const res = await fetch(url, options);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub API error: ${res.status}`);
  return res.json();
}

async function getFileContent(path: string) {
  const data = await gitAPI(`contents/${path}`);
  if (!data || data.encoding !== "base64" || !data.content) return null;
  const binStr = atob(data.content.replace(/\n/g, ""));
  const bytes = new Uint8Array(binStr.length);
  for (let i = 0; i < binStr.length; i++) bytes[i] = binStr.charCodeAt(i);
  return new TextDecoder("utf-8").decode(bytes);
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
    tree.push({ path: body.isBackup ? `backup/${file.name}` : file.name, mode: "100644", type: "blob", sha: file.sha });
  }
  const newTree = await gitAPI("git/trees", "POST", { base_tree: commit.tree.sha, tree });
  const newCommit = await gitAPI("git/commits", "POST", { message: body.isBackup ? "Auto-backup" : "Rollback", tree: newTree.sha, parents: [ref.object.sha] });
  await gitAPI(`git/refs/heads/main`, "PATCH", { sha: newCommit.sha, force: true });
  return json({ success: true, message: body.isBackup ? `Эталон сохранен (${tree.length} файлов)!` : `Штаб откачен (${tree.length} файлов)!` });
}

async function searchInternet(query: string) {
  let resultText = "";
  try {
    const ddgUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
    const ddgRes = await fetch(ddgUrl, { signal: AbortSignal.timeout(FETCH_TIMEOUT) });
    const ddgData = await ddgRes.json();
    if (ddgData.AbstractText) resultText += `**${ddgData.Heading}**: ${ddgData.AbstractText}\n\n`;
  } catch (e) {}
  if (!resultText.trim()) {
    try {
      const wikiUrl = `https://ru.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&utf8=1&srlimit=3`;
      const wikiRes = await fetch(wikiUrl, { signal: AbortSignal.timeout(FETCH_TIMEOUT) });
      const wikiData = await wikiRes.json();
      if (wikiData.query?.search?.length) {
        resultText += `Результаты поиска в Википедии по запросу "${query}":\n`;
        wikiData.query.search.forEach((item: any) => {
          const cleanSnippet = item.snippet.replace(/<[^>]+>/g, "");
          resultText += `- **${item.title}**: ${cleanSnippet}\n`;
        });
      }
    } catch (e) {}
  }
  return resultText.trim() || "По вашему запросу ничего не найдено.";
}

async function getWeather(city: string, day: number = 0) {
  try {
    const dayParam = day === 1 ? '1' : '0';
    const res = await fetch(`https://wttr.in/${encodeURIComponent(city)}?${dayParam}&format=3&lang=ru`, { signal: AbortSignal.timeout(FETCH_TIMEOUT) });
    if (!res.ok) throw new Error("Ошибка сервиса погоды");
    const text = await res.text();
    if (!text.trim() || text.toLowerCase().includes("<html")) return `Не удалось получить погоду для города ${city}. Попробуйте позже.`;
    return text.trim();
  } catch (e) {
    return `Не удалось получить погоду для города ${city}. Попробуйте позже.`;
  }
}

async function getDictionary(word: string) {
  try {
    const res = await fetch(`https://ru.wiktionary.org/api/rest_v1/page/definition/${encodeURIComponent(word)}`, { signal: AbortSignal.timeout(FETCH_TIMEOUT) });
    if (res.ok) {
        const data = await res.json();
        let definitions: string[] = [];
        if (data.ru) data.ru.forEach((s: any) => s.definitions.forEach((d: any) => definitions.push(d.definition)));
        return { success: true, definition: { definitions } };
    }
    return { success: false };
  } catch(e) { return { success: false }; }
}

function b64EncodeUnicode(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binStr = "";
  for (let i = 0; i < bytes.length; i++) binStr += String.fromCharCode(bytes[i]);
  return btoa(binStr);
}

async function updateFileInRepo(body: any) {
  const path = String(body.path || "").trim();
  const content = String(body.content ?? "");
  const message = String(body.message || `Auto-fix: ${path}`);
  if (!path) throw new Error("Путь не указан");
  if (path.includes("..") || path.startsWith("/") || path.startsWith("\\")) throw new Error("Недопустимый путь");
  if (!content) throw new Error("Контент пуст");
  if (content.length > 5000000) throw new Error("Файл слишком большой (>5MB)");
  const existing = await gitAPI(`contents/${path}`);
  if (!existing || !existing.sha) throw new Error(`Файл "${path}" не найден`);
  const payload = { message, content: b64EncodeUnicode(content), sha: existing.sha, branch: "main" };
  const res = await gitAPI(`contents/${path}`, "PUT", payload);
  if (!res || !res.commit) throw new Error("GitHub не вернул commit");
  return json({ success: true, message: `✅ ${path} обновлён (commit ${String(res.commit.sha).slice(0, 7)})`, commit: res.commit.sha, path, size: content.length });
}

async function readFileFromRepo(body: any) {
  const path = String(body.path || "").trim();
  if (!path) throw new Error("Путь не указан");
  if (path.includes("..") || path.startsWith("/") || path.startsWith("\\")) throw new Error("Недопустимый путь");
  const content = await getFileContent(path);
  if (content === null) throw new Error(`Файл "${path}" не найден`);
  return json({ success: true, path, content, size: content.length });
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
      const opens = (content.match(/{/g) || []).length;
      const closes = (content.match(/}/g) || []).length;
      if (opens !== closes) issues.push({ path: file.name, opens, closes, diff: opens - closes, content, description: `Скобки: { = ${opens}, } = ${closes} (не хватает ${opens - closes})` });
    } catch (e) {}
  }
  return json({ success: true, scanned: files.length, issues });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (request.method !== "POST") return json({ success: false, error: "Метод не поддерживается" }, 405);

  let body: any;
  try { body = await request.json(); } catch { return json({ success: false, error: "Некорректный JSON" }, 400); }

  try {
    if (body.isBackup || body.isRollback) {
      if (!GITHUB_TOKEN || !REPO_OWNER || !REPO_NAME) return json({ success: false, error: "GitHub не настроен" }, 500);
      return await handleBackup(body);
    }
    if (body.updateFile) {
      if (!GITHUB_TOKEN || !REPO_OWNER || !REPO_NAME) return json({ success: false, error: "GitHub не настроен" }, 500);
      return await updateFileInRepo(body);
    }
    if (body.readFile) {
      if (!GITHUB_TOKEN || !REPO_OWNER || !REPO_NAME) return json({ success: false, error: "GitHub не настроен" }, 500);
      return await readFileFromRepo(body);
    }
    if (body.scanRepo) {
      if (!GITHUB_TOKEN || !REPO_OWNER || !REPO_NAME) return json({ success: false, error: "GitHub не настроен" }, 500);
      return await scanRepoFiles();
    }
    if (body.checkStatus) {
      try {
        const rootFiles = await gitAPI("contents/");
        const backupFiles = await gitAPI("contents/backup");
        const rootNames = Array.isArray(rootFiles) ? rootFiles.filter((f:any) => f.type === 'file').map((f:any) => f.name) : [];
        const backupNames = Array.isArray(backupFiles) ? backupFiles.filter((f:any) => f.type === 'file').map((f:any) => f.name) : [];
        const missingInBackup = rootNames.filter((n: string) => !backupNames.includes(n));
        return json({ success: true, totalRoot: rootNames.length, totalBackup: backupNames.length, missingInBackup });
      } catch(e: any) { return json({ success: false, error: e.message }, 500); }
    }
    if (body.searchQuery) return json({ success: true, results: await searchInternet(String(body.searchQuery)) });
    if (body.weatherQuery) return json({ success: true, results: await getWeather(String(body.weatherQuery), body.day || 0) });
    if (body.dictQuery) return json(await getDictionary(String(body.dictQuery)));

    if (body.messages) {
      const modelType = body.model || "yandex";
      const userKeys = body.userKeys || {};
      let aiText = "";

      if (modelType === "deepseek") {
        if (!userKeys.deepseekKey) throw new Error("Нет ключа DeepSeek");
        const res = await fetch("https://api.deepseek.com/chat/completions", {
          method: "POST", headers: { "Content-Type": "application/json", "Authorization": `Bearer ${userKeys.deepseekKey}` },
          body: JSON.stringify({ model: "deepseek-chat", messages: body.messages, temperature: 0.7 })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error?.message || "Ошибка DeepSeek");
        aiText = data.choices[0].message.content;
      } else if (modelType === "zveno") {
        aiText = await callZvenoAI(body.messages);
      } else {
        if (!userKeys.yandexKey || !userKeys.yandexFolder) throw new Error("Нет ключей Yandex");
        const yandexMessages = body.messages.filter((m: any) => m.content && m.content.trim() !== "").map((m: any) => ({ role: m.role, text: m.content }));
        const res = await fetch("https://llm.api.cloud.yandex.net/foundationModels/v1/completion", {
          method: "POST", headers: { "Content-Type": "application/json", "Authorization": `Api-Key ${userKeys.yandexKey}` },
          body: JSON.stringify({ modelUri: `gpt://${userKeys.yandexFolder}/yandexgpt/latest`, completionOptions: { stream: false, temperature: 0.7, maxTokens: "2000" }, messages: yandexMessages })
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
