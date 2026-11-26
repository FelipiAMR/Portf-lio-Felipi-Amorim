// Geração do resumo didático com a API do Claude.
// Extensões MV3 não podem carregar código remoto nem têm bundler aqui, então a chamada é HTTP direta.

import { SYSTEM_PROMPT, buildUserContent } from "./prompt.js";

export async function generateSummary({ apiKey, model, title, transcript, notes }) {
  const userContent = buildUserContent({ title, transcript, notes });

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "server-side-fallback-2026-07-01",
      "anthropic-dangerous-direct-browser-access": "true"
    },
    body: JSON.stringify({
      model: model || "claude-opus-5-5",
      max_tokens: 16000,
      output_config: { effort: "high" },
      // Se o modelo recusar por engano, o servidor tenta novamente num modelo alternativo.
      fallbacks: "default",
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userContent }]
    })
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error?.message || res.statusText;
    throw new Error(`Claude ${res.status}: ${msg}`);
  }
  if (data.stop_reason === "refusal") {
    throw new Error("O Claude recusou gerar este resumo. Tente novamente ou revise a transcrição.");
  }
  const text = (data.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
  if (!text) throw new Error("O Claude não retornou texto.");
  if (data.stop_reason === "max_tokens") {
    return text + "\n\n> ⚠️ O resumo foi cortado por ser muito longo.";
  }
  return text;
}
