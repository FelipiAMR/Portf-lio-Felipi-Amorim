// Geração do resumo com a API gratuita do Google Gemini (chave do Google AI Studio).
import { SYSTEM_PROMPT, buildUserContent } from "./prompt.js";

const API = "https://generativelanguage.googleapis.com/v1beta";
const FALLBACK_MODEL = "gemini-2.5-flash";

// Escolhe o modelo "Flash" mais recente disponível para a chave (o plano grátis cobre os Flash).
async function pickBestFlash(apiKey) {
  try {
    const res = await fetch(`${API}/models?pageSize=200`, { headers: { "x-goog-api-key": apiKey } });
    if (!res.ok) return FALLBACK_MODEL;
    const { models = [] } = await res.json();
    const candidates = models
      .filter((m) => (m.supportedGenerationMethods || []).includes("generateContent"))
      .map((m) => m.name.replace(/^models\//, ""))
      .filter((n) => /^gemini-\d+(\.\d+)?-flash$/.test(n)); // só Flash estável (sem lite/preview/tts/image)
    const version = (n) => parseFloat(n.match(/^gemini-(\d+(?:\.\d+)?)/)[1]);
    candidates.sort((a, b) => version(b) - version(a));
    return candidates[0] || FALLBACK_MODEL;
  } catch (_) {
    return FALLBACK_MODEL;
  }
}

async function callGemini(apiKey, model, userContent) {
  const res = await fetch(`${API}/models/${model}:generateContent`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ role: "user", parts: [{ text: userContent }] }],
      generationConfig: { maxOutputTokens: 32768, temperature: 0.4 }
    })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(`Gemini ${res.status}: ${data?.error?.message || res.statusText}`);
    err.status = res.status;
    throw err;
  }
  if (data.promptFeedback?.blockReason) {
    throw new Error(`O Gemini bloqueou o pedido (${data.promptFeedback.blockReason}).`);
  }
  const cand = data.candidates?.[0];
  const text = (cand?.content?.parts || [])
    .filter((p) => p.text && !p.thought)
    .map((p) => p.text)
    .join("")
    .trim();
  if (!text) throw new Error(`O Gemini não retornou texto (${cand?.finishReason || "sem motivo"}).`);
  return cand.finishReason === "MAX_TOKENS" ? text + "\n\n> ⚠️ O resumo foi cortado por ser muito longo." : text;
}

export async function generateSummaryGemini({ apiKey, model, title, transcript, notes }) {
  const userContent = buildUserContent({ title, transcript, notes });
  const chosen = !model || model === "auto" ? await pickBestFlash(apiKey) : model;
  try {
    return await callGemini(apiKey, chosen, userContent);
  } catch (e) {
    // Modelo inexistente ou sem cota grátis: tenta o 2.5 Flash.
    if ((e.status === 404 || e.status === 429 || e.status === 400) && chosen !== FALLBACK_MODEL) {
      return await callGemini(apiKey, FALLBACK_MODEL, userContent);
    }
    if (e.status === 429) {
      throw new Error("Limite diário grátis do Gemini atingido. Tente de novo mais tarde (a cota renova todo dia).");
    }
    throw e;
  }
}
