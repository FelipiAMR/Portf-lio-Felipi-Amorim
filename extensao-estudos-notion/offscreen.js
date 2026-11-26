// Documento offscreen: grava o áudio da aba em trechos de 60s e manda cada trecho
// para um serviço de transcrição (speech-to-text). O Claude não transcreve áudio,
// por isso este modo usa a API de transcrição da OpenAI (opcional).

const CHUNK_MS = 60_000;
let stream = null;
let audioCtx = null;
let recorder = null;
let running = false;
let cfg = null;
let pending = 0;

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.target !== "offscreen") return;
  if (msg.type === "offscreenStart") startCapture(msg);
  if (msg.type === "offscreenStop") stopCapture();
});

async function startCapture({ streamId, openaiKey, language }) {
  cfg = { openaiKey, language };
  if (running) return;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { mandatory: { chromeMediaSource: "tab", chromeMediaSourceId: streamId } }
    });
    // Capturar a aba silencia o som; isto devolve o áudio para você continuar ouvindo a aula.
    audioCtx = new AudioContext();
    audioCtx.createMediaStreamSource(stream).connect(audioCtx.destination);
    running = true;
    recordChunk();
  } catch (e) {
    chrome.runtime.sendMessage({ type: "audioError", error: "Falha ao capturar áudio: " + e.message });
  }
}

function recordChunk() {
  if (!running) return;
  const parts = [];
  recorder = new MediaRecorder(stream, { mimeType: "audio/webm;codecs=opus" });
  recorder.ondataavailable = (e) => e.data.size && parts.push(e.data);
  recorder.onstop = () => {
    const blob = new Blob(parts, { type: "audio/webm" });
    if (blob.size > 2000) transcribe(blob);
    recordChunk(); // começa o próximo trecho (cada arquivo precisa ser independente)
  };
  recorder.start();
  setTimeout(() => recorder && recorder.state === "recording" && recorder.stop(), CHUNK_MS);
}

async function transcribe(blob) {
  pending++;
  try {
    const form = new FormData();
    form.append("file", blob, "trecho.webm");
    form.append("model", "whisper-1");
    form.append("language", cfg.language || "pt");
    const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.openaiKey}` },
      body: form
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error?.message || res.statusText);
    if (data.text && data.text.trim()) {
      chrome.runtime.sendMessage({ type: "audioTranscript", text: data.text.trim() });
    }
  } catch (e) {
    chrome.runtime.sendMessage({ type: "audioError", error: "Erro na transcrição: " + e.message });
  } finally {
    pending--;
  }
}

function stopCapture() {
  running = false;
  if (recorder && recorder.state === "recording") recorder.stop();
  recorder = null;
  setTimeout(() => {
    stream?.getTracks().forEach((t) => t.stop());
    audioCtx?.close();
    stream = null;
    audioCtx = null;
  }, 500);
}
