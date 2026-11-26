// Roda em todas as páginas e iframes (players como Vimeo/Panda/YouTube ficam em iframes).
// Captura as legendas do vídeo enquanto a gravação estiver ativa.
(() => {
  if (window.__estudaiLoaded) return;
  window.__estudaiLoaded = true;

  let active = false;
  const seen = new Set();
  const hookedTracks = new WeakSet();
  const hookedVideos = new WeakSet();
  let lastDomCaption = "";

  function send(text, t) {
    text = (text || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (!text) return;
    const key = text.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    try {
      chrome.runtime.sendMessage({ type: "caption", text, t: t ?? null });
    } catch (_) { /* extensão recarregada */ }
  }

  // 1) Legendas nativas do <video> (WebVTT / textTracks)
  function hookTrack(track) {
    if (!track || hookedTracks.has(track)) return;
    if (!["subtitles", "captions"].includes(track.kind)) return;
    hookedTracks.add(track);
    // "hidden" carrega as cues sem mostrar na tela; se já estiver "showing", mantém.
    if (track.mode === "disabled") track.mode = "hidden";
    track.addEventListener("cuechange", () => {
      if (!active || !track.activeCues) return;
      for (const cue of track.activeCues) send(cue.text, cue.startTime);
    });
  }

  function hookVideo(video) {
    if (hookedVideos.has(video)) return;
    hookedVideos.add(video);
    for (const t of video.textTracks) hookTrack(t);
    video.textTracks.addEventListener("addtrack", (e) => hookTrack(e.track));
  }

  // 2) Legendas renderizadas no DOM (players customizados)
  const CAPTION_SELECTORS = [
    ".vp-captions", // Vimeo
    ".vjs-text-track-display", // video.js
    ".ytp-caption-window-container", // YouTube
    ".plyr__captions", // Plyr
    ".jw-captions", // JW Player
    ".shaka-text-container", // Shaka
    "[class*='caption' i]",
    "[class*='subtitle' i]",
    "[class*='legenda' i]"
  ].join(",");

  function readDomCaptions() {
    if (!active) return;
    const nodes = document.querySelectorAll(CAPTION_SELECTORS);
    for (const n of nodes) {
      const txt = (n.innerText || "").trim();
      if (txt && txt.length < 400 && txt !== lastDomCaption) {
        lastDomCaption = txt;
        send(txt, null);
      }
    }
  }

  function scan() {
    document.querySelectorAll("video").forEach(hookVideo);
  }

  const observer = new MutationObserver(() => {
    scan();
    readDomCaptions();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  scan();

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === "setActive") {
      active = msg.active;
      if (active) {
        seen.clear();
        scan();
      }
      sendResponse({ ok: true });
    } else if (msg.type === "pageInfo" && window === window.top) {
      sendResponse({ title: document.title, url: location.href });
    }
  });

  // Ao recarregar/navegar dentro do curso, pergunta se já está gravando.
  try {
    chrome.runtime.sendMessage({ type: "isActive" }, (res) => {
      if (chrome.runtime.lastError) return;
      if (res && res.active) active = true;
    });
  } catch (_) {}
})();
