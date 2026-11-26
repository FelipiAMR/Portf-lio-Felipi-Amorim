const $ = (id) => document.getElementById(id);

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function send(msg) {
  return chrome.runtime.sendMessage(msg).then((res) => {
    if (res && res.error) throw new Error(res.error);
    return res;
  });
}

async function render() {
  const { session, status, lastResult, settings, draft } = await chrome.storage.local.get([
    "session", "status", "lastResult", "settings", "draft"
  ]);
  const s = session || { active: false, lines: [] };

  $("setupWarning").classList.toggle("hidden", !!(settings?.anthropicKey && settings?.notionToken && settings?.notionRoot));
  $("startBtn").classList.toggle("hidden", s.active);
  $("stopBtn").classList.toggle("hidden", !s.active);
  $("startBtn").textContent = s.lines?.length ? "▶️ Continuar captura" : "▶️ Começar captura";
  $("dot").classList.toggle("on", s.active);
  $("counter").textContent = `${s.lines?.length || 0} trechos capturados${s.active ? " • gravando" : ""}`;
  $("preview").textContent = (s.lines || []).slice(-40).join("\n") || "(nada ainda)";

  if (status) {
    $("status").textContent = status.text;
    $("status").className = `status ${status.kind}`;
    $("generateBtn").disabled = status.kind === "busy";
  }
  if (lastResult && status?.kind === "ok" && status.text.startsWith("✅")) {
    $("result").innerHTML = "";
    const a = document.createElement("a");
    a.href = lastResult.summaryUrl;
    a.target = "_blank";
    a.textContent = `Abrir “${lastResult.title}” no Notion →`;
    $("result").appendChild(a);
  } else {
    $("result").textContent = "";
  }

  if (draft && document.activeElement !== $("notes") && !$("notes").value) $("notes").value = draft.notes || "";
  if (draft && document.activeElement !== $("moduleName") && !$("moduleName").value) $("moduleName").value = draft.moduleName || "";
}

async function init() {
  const tab = await activeTab();
  const { session, settings } = await chrome.storage.local.get(["session", "settings"]);
  $("lessonTitle").value = session?.lines?.length ? session.title : tab?.title || "";
  if (session?.mode) $("mode").value = session.mode;
  else if (settings?.defaultMode) $("mode").value = settings.defaultMode;
  await render();
}

const saveDraft = () =>
  chrome.storage.local.set({ draft: { notes: $("notes").value, moduleName: $("moduleName").value } });
$("notes").addEventListener("input", saveDraft);
$("moduleName").addEventListener("input", saveDraft);

$("startBtn").onclick = async () => {
  try {
    const tab = await activeTab();
    await send({ type: "start", tabId: tab.id, mode: $("mode").value });
  } catch (e) {
    $("status").textContent = "❌ " + e.message;
    $("status").className = "status error";
  }
  render();
};

$("stopBtn").onclick = async () => {
  await send({ type: "stop" });
  render();
};

$("generateBtn").onclick = async () => {
  $("generateBtn").disabled = true;
  await send({
    type: "generate",
    notes: $("notes").value,
    lessonTitle: $("lessonTitle").value,
    moduleName: $("moduleName").value
  });
  render();
};

$("resetBtn").onclick = async () => {
  if (!confirm("Apagar a transcrição atual e começar uma nova aula?")) return;
  await send({ type: "reset" });
  await chrome.storage.local.set({ draft: { notes: "", moduleName: $("moduleName").value } });
  $("notes").value = "";
  $("lessonTitle").value = (await activeTab())?.title || "";
  render();
};

$("openOptions").onclick = $("goSetup").onclick = (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
};

chrome.storage.onChanged.addListener(render);
init();
