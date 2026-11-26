// Integração com a API do Notion + conversor Markdown -> blocos do Notion.
const NOTION_VERSION = "2022-06-28";
const NOTION_API = "https://api.notion.com/v1";

export function extractNotionId(input) {
  if (!input) return null;
  const clean = input.replace(/-/g, "");
  const matches = clean.match(/[0-9a-f]{32}/gi);
  if (!matches) return null;
  const id = matches[matches.length - 1];
  return `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`;
}

async function notion(token, path, method = "GET", body) {
  const res = await fetch(`${NOTION_API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json"
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Notion ${res.status}: ${data.message || res.statusText}`);
  }
  return data;
}

// ---------- "Pastas" (páginas) ----------

async function listChildPages(token, parentId) {
  const pages = [];
  let cursor;
  do {
    const q = cursor ? `?page_size=100&start_cursor=${cursor}` : "?page_size=100";
    const data = await notion(token, `/blocks/${parentId}/children${q}`);
    for (const b of data.results) {
      if (b.type === "child_page") pages.push({ id: b.id, title: b.child_page.title });
    }
    cursor = data.has_more ? data.next_cursor : null;
  } while (cursor);
  return pages;
}

async function createPage(token, parentId, title, icon, children = []) {
  const page = await notion(token, "/pages", "POST", {
    parent: { page_id: parentId },
    icon: icon ? { type: "emoji", emoji: icon } : undefined,
    properties: { title: { title: [{ type: "text", text: { content: title.slice(0, 2000) } }] } },
    children: children.slice(0, 100)
  });
  await appendBlocks(token, page.id, children.slice(100));
  return page;
}

async function findOrCreateFolder(token, parentId, title, icon) {
  const norm = (s) => s.trim().toLowerCase();
  const existing = (await listChildPages(token, parentId)).find((p) => norm(p.title) === norm(title));
  if (existing) return existing.id;
  const page = await createPage(token, parentId, title, icon);
  return page.id;
}

async function appendBlocks(token, blockId, blocks) {
  for (let i = 0; i < blocks.length; i += 100) {
    await notion(token, `/blocks/${blockId}/children`, "PATCH", { children: blocks.slice(i, i + 100) });
  }
}

/**
 * Cria a estrutura:
 *   Página raiz → 📚 Curso → 📂 Módulo (opcional) → 🎬 Aula (pasta)
 *                                                    ├── 📘 Resumo e explicação
 *                                                    └── 📝 Transcrição completa
 */
export async function saveLessonToNotion({ token, rootId, course, module, lesson, url, summaryMd, transcript, notes }) {
  let parent = rootId;
  if (course) parent = await findOrCreateFolder(token, parent, course, "📚");
  if (module) parent = await findOrCreateFolder(token, parent, module, "📂");

  const date = new Date().toLocaleDateString("pt-BR");
  const lessonHeader = [
    callout(`Aula assistida em ${date}`, "🗓️"),
    ...(url ? [paragraph([link("Abrir aula original", url)])] : []),
    { object: "block", type: "to_do", to_do: { rich_text: richText("Aula concluída"), checked: true } },
    { object: "block", type: "to_do", to_do: { rich_text: richText("Revisei o resumo"), checked: false } },
    { object: "block", type: "to_do", to_do: { rich_text: richText("Respondi as perguntas de revisão"), checked: false } }
  ];

  const lessonPage = await createPage(token, parent, lesson, "🎬", lessonHeader);

  const summaryPage = await createPage(token, lessonPage.id, "Resumo e explicação", "📘", markdownToBlocks(summaryMd));

  const transcriptBlocks = [];
  if (notes && notes.trim()) {
    transcriptBlocks.push(heading(2, "Minhas anotações"), ...textToParagraphs(notes));
  }
  transcriptBlocks.push(heading(2, "Transcrição"), ...textToParagraphs(transcript || "(sem transcrição)"));
  await createPage(token, lessonPage.id, "Transcrição completa", "📝", transcriptBlocks);

  return { lessonUrl: lessonPage.url, summaryUrl: summaryPage.url };
}

// ---------- Markdown -> blocos ----------

const MAX_TEXT = 1900; // limite do Notion é 2000 caracteres por objeto de texto

function chunk(str, size = MAX_TEXT) {
  const out = [];
  for (let i = 0; i < str.length; i += size) out.push(str.slice(i, i + size));
  return out.length ? out : [""];
}

function textObj(content, annotations = {}, href = null) {
  return chunk(content).map((c) => ({
    type: "text",
    text: { content: c, link: href ? { url: href } : null },
    annotations: { bold: false, italic: false, code: false, strikethrough: false, underline: false, color: "default", ...annotations }
  }));
}

function link(text, url) {
  return textObj(text, {}, url)[0];
}

// Suporta **negrito**, *itálico*, `código` e [link](url)
export function richText(line) {
  const out = [];
  const re = /(\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\((https?:\/\/[^)]+)\)|\*([^*]+)\*|_([^_]+)_)/g;
  let last = 0;
  let m;
  while ((m = re.exec(line))) {
    if (m.index > last) out.push(...textObj(line.slice(last, m.index)));
    if (m[2]) out.push(...textObj(m[2], { bold: true }));
    else if (m[3]) out.push(...textObj(m[3], { code: true }));
    else if (m[4]) out.push(...textObj(m[4], {}, m[5]));
    else if (m[6]) out.push(...textObj(m[6], { italic: true }));
    else if (m[7]) out.push(...textObj(m[7], { italic: true }));
    last = re.lastIndex;
  }
  if (last < line.length) out.push(...textObj(line.slice(last)));
  return out.slice(0, 100);
}

function paragraph(rt) {
  return { object: "block", type: "paragraph", paragraph: { rich_text: rt } };
}
function heading(level, text) {
  const type = `heading_${Math.min(Math.max(level, 1), 3)}`;
  return { object: "block", type, [type]: { rich_text: richText(text) } };
}
function callout(text, emoji) {
  return { object: "block", type: "callout", callout: { rich_text: richText(text), icon: { type: "emoji", emoji } } };
}
function textToParagraphs(text) {
  return text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .flatMap((p) => chunk(p).map((c) => paragraph(textObj(c))));
}

const NOTION_LANGS = new Set([
  "bash", "c", "c#", "c++", "css", "dart", "diff", "docker", "elixir", "go", "graphql", "html", "java",
  "javascript", "json", "kotlin", "markdown", "php", "plain text", "powershell", "prisma", "python", "ruby",
  "rust", "scss", "shell", "sql", "swift", "typescript", "xml", "yaml"
]);
const LANG_ALIASES = { js: "javascript", jsx: "javascript", ts: "typescript", tsx: "typescript", sh: "shell", py: "python", yml: "yaml", csharp: "c#", cpp: "c++", dockerfile: "docker", md: "markdown", text: "plain text", txt: "plain text" };

function codeLang(l) {
  const k = (l || "").toLowerCase().trim();
  const v = LANG_ALIASES[k] || k;
  return NOTION_LANGS.has(v) ? v : "plain text";
}

export function markdownToBlocks(md) {
  const lines = (md || "").replace(/\r/g, "").split("\n");
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) { i++; continue; }

    // bloco de código
    const fence = trimmed.match(/^```(.*)$/);
    if (fence) {
      const code = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) code.push(lines[i++]);
      i++;
      blocks.push({ object: "block", type: "code", code: { language: codeLang(fence[1]), rich_text: textObj(code.join("\n")) } });
      continue;
    }

    let m;
    if ((m = trimmed.match(/^(#{1,6})\s+(.*)$/))) {
      blocks.push(heading(m[1].length, m[2].replace(/\*\*/g, "")));
    } else if (/^(-{3,}|\*{3,})$/.test(trimmed)) {
      blocks.push({ object: "block", type: "divider", divider: {} });
    } else if ((m = trimmed.match(/^[-*]\s+\[( |x|X)\]\s+(.*)$/))) {
      blocks.push({ object: "block", type: "to_do", to_do: { rich_text: richText(m[2]), checked: m[1].toLowerCase() === "x" } });
    } else if ((m = trimmed.match(/^[-*+]\s+(.*)$/))) {
      blocks.push({ object: "block", type: "bulleted_list_item", bulleted_list_item: { rich_text: richText(m[1]) } });
    } else if ((m = trimmed.match(/^\d+[.)]\s+(.*)$/))) {
      blocks.push({ object: "block", type: "numbered_list_item", numbered_list_item: { rich_text: richText(m[1]) } });
    } else if ((m = trimmed.match(/^>\s?(.*)$/))) {
      // "> 💡 texto" vira callout; outras citações viram quote
      const emoji = m[1].match(/^(\p{Extended_Pictographic})\s*(.*)$/u);
      if (emoji) blocks.push(callout(emoji[2], emoji[1]));
      else blocks.push({ object: "block", type: "quote", quote: { rich_text: richText(m[1]) } });
    } else if ((m = trimmed.match(/^<details>\s*<summary>(.*?)<\/summary>\s*(.*?)\s*(<\/details>)?$/))) {
      blocks.push({ object: "block", type: "toggle", toggle: { rich_text: richText(m[1]), children: m[2] ? [paragraph(richText(m[2]))] : [] } });
    } else {
      blocks.push(paragraph(richText(trimmed)));
    }
    i++;
  }
  return blocks;
}

export async function testNotion(token, rootId) {
  const page = await notion(token, `/pages/${rootId}`);
  const title = page.properties?.title?.title?.[0]?.plain_text || "(sem título)";
  return title;
}
