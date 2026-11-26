import { generateSummary } from "./claude.js";
import { generateSummaryGemini } from "./gemini.js";
import { saveLessonToNotion, extractNotionId } from "./notion.js";

const DEFAULT_SESSION = { active: false, mode: "captions", tabId: null, title: "", url: "", startedAt: null, lines: [] };

// ---------- estado (persistido em storage.local para sobreviver ao service worker dormir) ----------
let lock = Promise.resolve();
function withLock(fn) {
  const run = lock.then(fn, fn);
  lock = run.catch(() => {});
  return run;
}
async function getSession() {
  const { session } = await chrome.storage.local.get("session");
  return { ...DEFAULT_SESSION, ...(session || {}) };
}
async function setSession(patch) {
  const s = await getSession();
  const next = { ...s, ...patch };
  await chrome.storage.local.set({ session: next });
  return next;
}
async function setStatus(text, kind = "info") {
  await chrome.storage.local.set({ status: { text, kind, at: Date.now() } });
}
async function getSettings() {
  const { settings } = await chrome.storage.local.get("settings");
  return settings || {};
}

function appendLine(text) {
  return withLock(async () => {
    const s = await getSession();
    if (!s.active) return;
    const last = s.lines[s.lines.length - 1];
    // evita duplicar quando a legenda "cresce" (ex.: "Olá" -> "Olá pessoal")
    if (last && text.startsWith(last)) s.lines[s.lines.length - 1] = text;
    else if (last && last.endsWith(text)) return;
    else s.lines.push(text);
    await chrome.storage.local.set({ session: s });
  });
}

// ---------- mensagens ----------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    switch (msg.type) {
      case "caption": {
        const s = await getSession();
        if (s.active && s.mode === "captions" && sender.tab?.id === s.tabId) await appendLine(msg.text);
        return {};
      }
      case "isActive": {
        const s = await getSession();
        return { active: s.active && s.mode === "captions" && sender.tab?.id === s.tabId };
      }
      case "audioTranscript": {
        await appendLine(msg.text);
        return {};
      }
      case "audioError": {
        await setStatus(msg.error, "error");
        return {};
      }
      case "start":
        return start(msg);
      case "stop":
        return stop();
      case "generate":
        generate(msg).catch(() => {}); // roda em segundo plano; popup acompanha via storage
        return { ok: true };
      case "reset":
        await stop();
        await chrome.storage.local.set({ session: DEFAULT_SESSION });
        await setStatus("Pronto para a próxima aula.");
        return { ok: true };
      default:
        return {};
    }
  })()
    .then(sendResponse)
    .catch((e) => sendResponse({ error: e.message }));
  return true;
});

async function ensureContentScript(tabId) {
  try {
    await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: ["content.js"] });
  } catch (_) {
    /* páginas do Chrome não permitem injeção */
  }
}

async function start({ tabId, mode }) {
  const tab = await chrome.tabs.get(tabId);
  const s = await getSession();
  const sameLesson = s.tabId === tabId && s.lines.length > 0 && s.url === tab.url;

  await setSession({
    active: true,
    mode,
    tabId,
    title: tab.title || "Aula",
    url: tab.url,
    startedAt: sameLesson ? s.startedAt : Date.now(),
    lines: sameLesson ? s.lines : []
  });

  if (mode === "captions") {
    await ensureContentScript(tabId);
    await chrome.tabs.sendMessage(tabId, { type: "setActive", active: true }).catch(() => {});
    await setStatus("Capturando legendas… deixe as legendas/CC do player ligadas.", "ok");
  } else {
    const settings = await getSettings();
    if (!settings.openaiKey) {
      await setSession({ active: false });
      throw new Error("Para o modo áudio, configure a chave de transcrição nas opções.");
    }
    const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });
    await ensureOffscreen();
    await chrome.runtime.sendMessage({
      type: "offscreenStart",
      target: "offscreen",
      streamId,
      openaiKey: settings.openaiKey,
      language: "pt"
    });
    await setStatus("Gravando o áudio da aba e transcrevendo a cada minuto…", "ok");
  }
  return { ok: true };
}

async function stop() {
  const s = await getSession();
  if (s.tabId != null) chrome.tabs.sendMessage(s.tabId, { type: "setActive", active: false }).catch(() => {});
  if (s.mode === "audio" && (await chrome.offscreen.hasDocument())) {
    await chrome.runtime.sendMessage({ type: "offscreenStop", target: "offscreen" }).catch(() => {});
    // espera o último trecho ser transcrito
    await new Promise((r) => setTimeout(r, 4000));
  }
  await setSession({ active: false });
  await setStatus(`Captura pausada. ${s.lines.length} trechos capturados.`);
  return { ok: true };
}

async function ensureOffscreen() {
  if (await chrome.offscreen.hasDocument()) return;
  await chrome.offscreen.createDocument({
    url: "offscreen.html",
    reasons: ["USER_MEDIA"],
    justification: "Gravar o áudio da aba da aula para transcrição."
  });
}

// ---------- gerar resumo + enviar ao Notion ----------
async function generate({ notes, lessonTitle, moduleName }) {
  // mantém o service worker acordado durante a chamada longa
  const keepAlive = setInterval(() => chrome.runtime.getPlatformInfo(() => {}), 20000);
  try {
    const s = await getSession();
    if (s.active) await stop();
    const settings = await getSettings();
    const transcript = s.lines.join("\n");

    const provider = settings.provider || "gemini";
    if (provider === "gemini" && !settings.geminiKey) throw new Error("Configure a chave grátis do Gemini nas opções.");
    if (provider === "claude" && !settings.anthropicKey) throw new Error("Configure a chave da API do Claude nas opções.");
    if (!settings.notionToken || !settings.notionRoot) throw new Error("Configure o token e a página do Notion nas opções.");
    if (transcript.trim().length < 50 && !(notes || "").trim()) {
      throw new Error("Quase nada foi capturado. Ligue as legendas do player ou use o modo áudio.");
    }

    const title = (lessonTitle || s.title || "Aula").trim();
    const aiName = provider === "gemini" ? "Gemini" : "Claude";
    await setStatus(`🧠 Gerando resumo e explicações com o ${aiName}… (pode levar alguns minutos)`, "busy");
    const summaryMd =
      provider === "gemini"
        ? await generateSummaryGemini({ apiKey: settings.geminiKey, model: settings.geminiModel, title, transcript, notes })
        : await generateSummary({ apiKey: settings.anthropicKey, model: settings.model, title, transcript, notes });
    await chrome.storage.local.set({ lastSummary: { title, summaryMd, at: Date.now() } });

    await setStatus("📤 Criando a pasta da aula no Notion…", "busy");
    const result = await saveLessonToNotion({
      token: settings.notionToken,
      rootId: extractNotionId(settings.notionRoot),
      course: (settings.courseName || "").trim(),
      module: (moduleName || "").trim(),
      lesson: title,
      url: s.url,
      summaryMd,
      transcript,
      notes
    });

    await chrome.storage.local.set({ lastResult: { ...result, title, at: Date.now() } });
    await setStatus("✅ Aula salva no Notion!", "ok");
  } catch (e) {
    await setStatus(`❌ ${e.message}`, "error");
    throw e;
  } finally {
    clearInterval(keepAlive);
  }
}
