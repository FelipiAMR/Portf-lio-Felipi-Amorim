import { extractNotionId, testNotion } from "./notion.js";

const FIELDS = ["anthropicKey", "model", "notionToken", "notionRoot", "courseName", "openaiKey", "defaultMode"];
const $ = (id) => document.getElementById(id);

function msg(text, kind = "info") {
  $("msg").textContent = text;
  $("msg").className = `status ${kind}`;
}

async function load() {
  const { settings = {} } = await chrome.storage.local.get("settings");
  for (const f of FIELDS) if (settings[f]) $(f).value = settings[f];
}

async function save() {
  const settings = {};
  for (const f of FIELDS) settings[f] = $(f).value.trim();
  if (settings.notionRoot && !extractNotionId(settings.notionRoot)) {
    msg("❌ Não encontrei o ID da página nesse link do Notion.", "error");
    return false;
  }
  await chrome.storage.local.set({ settings });
  msg("✅ Configurações salvas!", "ok");
  return true;
}

$("save").onclick = save;
$("test").onclick = async () => {
  if (!(await save())) return;
  try {
    msg("Testando…", "busy");
    const title = await testNotion($("notionToken").value.trim(), extractNotionId($("notionRoot").value));
    msg(`✅ Conectado! As aulas serão salvas dentro de “${title}”.`, "ok");
  } catch (e) {
    msg(`❌ ${e.message}. Confira o token e se a integração foi adicionada à página (••• → Conexões).`, "error");
  }
};

load();
