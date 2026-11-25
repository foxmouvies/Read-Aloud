/*
 * ReadAloud reader page: loads a PDF (via bundled pdf.js), an HTML file or a .txt file,
 * splits it into sentences, renders them as clickable spans and reads them
 * aloud with the shared TTS engine. Module script so it can import pdf.js.
 */
import * as pdfjsLib from "../vendor/pdfjs/pdf.min.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc = "../vendor/pdfjs/pdf.worker.min.mjs";

const RAText = window.RAText;
const RAStore = window.RAStore;
const engine = window.RATTS.createEngine({ rate: 1, pitch: 1 });

const dropZone = document.getElementById("drop-zone");
const fileInput = document.getElementById("file-input");
const controls = document.getElementById("controls");
const textView = document.getElementById("text-view");
const progressEl = document.getElementById("progress");
const rateInput = document.getElementById("rate");
const pitchInput = document.getElementById("pitch");
const voiceSelect = document.getElementById("voice");

let sentences = [];
let sentenceEls = [];
let lastSpeechError = null;
let savedVoiceURI = null;
let onlineOptIn = false;
let blockedNotice = false;
let currentFileKey = null;
let lastPosSave = 0;

const voiceNotice = document.getElementById("voice-notice");
const allowOnlineBtn = document.getElementById("allow-online");
const disallowOnlineBtn = document.getElementById("disallow-online");

// Local-only is the safe default: without an explicit opt-in, playback uses
// only voices the browser marks as local and never the ambiguous default.
function voiceChoice() {
  const voices = window.speechSynthesis ? window.speechSynthesis.getVoices() : [];
  return window.RATTS.chooseVoice(voices, savedVoiceURI, onlineOptIn);
}

function updateVoiceNotice(choice) {
  if (!window.speechSynthesis || (choice.localCount === 0 && choice.onlineCount === 0)) {
    voiceNotice.hidden = true;
    allowOnlineBtn.hidden = true;
    disallowOnlineBtn.hidden = true;
    return;
  }
  if (onlineOptIn) {
    voiceNotice.hidden = false;
    voiceNotice.textContent = "Online voices are allowed: spoken text may be sent to the voice provider. " +
      choice.onlineCount + " online and " + choice.localCount + " local voices shown.";
    allowOnlineBtn.hidden = true;
    disallowOnlineBtn.hidden = false;
  } else if (choice.onlineCount > 0) {
    voiceNotice.hidden = false;
    voiceNotice.textContent = choice.onlineCount + " online voice(s) are hidden. Online voices are provided by " +
      "your browser or OS vendor and spoken text is sent to that provider. Only local voices are used unless you allow online voices.";
    allowOnlineBtn.hidden = false;
    disallowOnlineBtn.hidden = true;
  } else {
    voiceNotice.hidden = true;
    allowOnlineBtn.hidden = true;
    disallowOnlineBtn.hidden = true;
  }
}

allowOnlineBtn.addEventListener("click", () => {
  onlineOptIn = true;
  scheduleSaveSettings();
  populateVoices();
  // Clear a stale blocked-playback explanation: the Allow button it points
  // to is gone once the opt-in is granted.
  if (blockedNotice) {
    blockedNotice = false;
    progressEl.textContent = "";
  }
});

// Revoking the opt-in is always possible: it hides online voices again and
// switches playback back to local voices only.
disallowOnlineBtn.addEventListener("click", () => {
  onlineOptIn = false;
  savedVoiceURI = null;
  scheduleSaveSettings();
  populateVoices(); // applies the best local voice, when one exists
  if (!voiceChoice().voice && engine.getState().state !== "idle") {
    // No local voice to fall back to: stop rather than keep speaking with
    // a voice the user just revoked.
    engine.stop();
    playbackAllowed(); // shows the blocked-playback explanation again
  }
});

// Gate every playback entry point: without local voices and without the
// opt-in, explain instead of silently sending text to a remote voice.
function playbackAllowed() {
  const c = voiceChoice();
  if (c.needsChoice) {
    updateVoiceNotice(c);
    blockedNotice = true;
    progressEl.textContent = "No local voice is installed, so playback is paused. Install a system voice, " +
      'or choose "Allow online voices" - spoken text will then be sent to the voice provider.';
    return false;
  }
  return true;
}

function scheduleSaveSettings() {
  RAStore.saveSettings({
    rate: parseFloat(rateInput.value),
    pitch: parseFloat(pitchInput.value),
    voiceURI: savedVoiceURI,
    onlineOptIn: onlineOptIn
  });
}

function scheduleSavePosition(index) {
  if (!currentFileKey) return;
  const now = Date.now();
  if (now - lastPosSave < 1500) return;
  lastPosSave = now;
  RAStore.savePosition(currentFileKey, index);
}

/* ---------- PDF and TXT extraction ---------- */

// Local OCR for scanned pages. Everything is loaded from packaged files
// (worker, WASM core, language data); no image or text leaves the device.
let ocrWorker = null;
async function getOcrWorker() {
  if (ocrWorker) return ocrWorker;
  const base = new URL("../vendor/tesseract/", location.href).href;
  ocrWorker = await Tesseract.createWorker("eng+ara", 1, {
    workerPath: base + "worker.min.js",
    corePath: base,
    langPath: base + "lang",
    workerBlobURL: false,
    cacheMethod: "none",
    gzip: true
  });
  return ocrWorker;
}
async function stopOcr() {
  const w = ocrWorker;
  ocrWorker = null;
  if (w) { try { await w.terminate(); } catch (e) { /* already gone */ } }
}

async function pageToCanvas(page) {
  const viewport = page.getViewport({ scale: 2 });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
  return canvas;
}

async function extractPdfText(file, token) {
  const data = new Uint8Array(await file.arrayBuffer());
  const loadingTask = pdfjsLib.getDocument({ data });
  const pdf = await loadingTask.promise;
  try {
  // segments: text-layer pages keep the existing visual-order RTL repair as
  // one run; OCR output is already in logical order and is never repaired.
  const segments = [];
  let out = [];
  let ocrPages = 0;
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    if (token !== loadToken) throw new Error("cancelled");
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();
    const hasText = content.items.some((it) => it.str && it.str.trim());
    if (!hasText) {
      // No text layer: recognise the page image locally.
      if (typeof Tesseract === "undefined") { out.push(""); continue; }
      if (out.length) { segments.push({ ocr: false, text: out.join("\n") }); out = []; }
      ocrPages++;
      progressEl.textContent = "Recognising text on page " + pageNum + " of " + pdf.numPages + " (scanned page, done on this device)…";
      cancelOcrBtn.hidden = false;
      const worker = await getOcrWorker();
      if (token !== loadToken) throw new Error("cancelled");
      const canvas = await pageToCanvas(page);
      const res = await worker.recognize(canvas);
      canvas.width = canvas.height = 0;
      if (token !== loadToken) throw new Error("cancelled");
      segments.push({ ocr: true, text: (res.data.text || "").trim() + "\n" });
      continue;
    }
    // Rebuild lines from positioned items, then paragraphs between pages.
    // Multi-column pages: rebuild each column independently so columns do
    // not interleave line by line (RAText.splitColumns returns one column
    // for ordinary single-column pages, leaving behavior unchanged).
    for (const columnItems of RAText.splitColumns(content.items)) {
      let lastY = null;
      let line = "";
      for (const item of columnItems) {
        const y = item.transform ? item.transform[5] : null;
        if (lastY !== null && y !== null && Math.abs(y - lastY) > 2) {
          out.push(line.trim());
          line = "";
        }
        line += item.str + (item.hasEOL ? "" : " ");
        lastY = y;
        // Empty hasEOL items are line-break markers: flush the pending line
        // once, never as a blank line (a blank line here would break
        // de-hyphenation of words split across lines).
        if (item.hasEOL) { if (line.trim()) out.push(line.trim()); line = ""; lastY = null; }
      }
      if (line.trim()) out.push(line.trim());
    }
    out.push(""); // paragraph break between pages
  }
  if (out.length) segments.push({ ocr: false, text: out.join("\n") });
  cancelOcrBtn.hidden = true;
  await stopOcr();
  const joined = segments.map((sg) => sg.ocr ? sg.text : RAText.fixVisualOrderRtl(sg.text)).join("\n");
  lastOcrPages = ocrPages;
  return RAText.normalizeExtractedText(joined);
  } finally {
    // Release the parsed document and its worker-side page data.
    try { await loadingTask.destroy(); } catch (e) { /* already released */ }
  }
}

async function extractHtmlText(file) {
  return RAText.normalizeExtractedText(RAHtml.htmlToText(await file.text()));
}

async function extractTxtText(file) {
  return RAText.normalizeExtractedText(await file.text());
}

/* ---------- Rendering and playback ---------- */

function renderSentences() {
  textView.innerHTML = "";
  sentenceEls = sentences.map((s, i) => {
    const span = document.createElement("span");
    span.className = "sentence";
    span.textContent = s + " ";
    // Click-to-seek, made keyboard-operable (B8): focusable, button role,
    // Enter/Space starts reading from this sentence.
    span.tabIndex = 0;
    span.setAttribute("role", "button");
    span.setAttribute("aria-label", "Read from sentence " + (i + 1));
    span.addEventListener("click", () => {
      if (playbackAllowed()) engine.play(i); // click any sentence to start reading from it
    });
    span.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" || ev.key === " " || ev.key === "Spacebar") {
        ev.preventDefault();
        if (playbackAllowed()) engine.play(i);
      }
    });
    textView.appendChild(span);
    return span;
  });
}

function updateProgress(st) {
  if (st.state === "idle" && lastSpeechError) {
    progressEl.textContent = "Speech error: " + lastSpeechError +
      " — your system may have no speech voices installed.";
  } else {
    progressEl.textContent = st.total
      ? `Sentence ${Math.min(st.index + 1, st.total)} of ${st.total} — ${st.state}`
      : "";
  }
  // Overlong sentences are split into several queue entries; highlight the
  // original sentence the current entry belongs to.
  const hi = typeof st.sentenceIndex === "number" ? st.sentenceIndex : st.index;
  sentenceEls.forEach((el, i) => {
    el.classList.toggle("speaking", st.state !== "idle" && i === hi);
    el.classList.toggle("done", st.state !== "idle" && i < hi);
  });
  if (st.state !== "idle" && sentenceEls[hi]) {
    sentenceEls[hi].scrollIntoView({ block: "center", behavior: "smooth" });
  }
  if (st.state !== "idle" && sentences.length) scheduleSavePosition(hi);
}

let loadToken = 0;
let lastOcrPages = 0;
const cancelOcrBtn = document.getElementById("cancel-ocr");
cancelOcrBtn.addEventListener("click", async () => {
  loadToken++;
  cancelOcrBtn.hidden = true;
  await stopOcr();
  resetDocument();
  progressEl.textContent = "Text recognition cancelled.";
});

async function handleFile(file) {
  if (!file) return;
  const token = ++loadToken;
  await stopOcr();
  // Drop the previous document before parsing the new file, so Play pressed
  // while the file is still loading can never replay the old document.
  resetDocument();
  progressEl.textContent = "Loading " + file.name + "…";
  controls.hidden = false;
  try {
    const isPdf = /\.pdf$/i.test(file.name) || file.type === "application/pdf";
    const isHtml = /\.html?$/i.test(file.name) || file.type === "text/html";
    lastOcrPages = 0;
    const text = isPdf ? await extractPdfText(file, token) : isHtml ? await extractHtmlText(file) : await extractTxtText(file);
    if (token !== loadToken) return; // replaced or cancelled while loading
    sentences = RAText.splitIntoSentences(text);
    if (!sentences.length) {
      resetDocument();
      progressEl.textContent = "No readable text found in this file.";
      return;
    }
    renderSentences();
    currentFileKey = RAStore.fileKey(file.name, file.size);
    const savedIdx = await new Promise((r) => RAStore.loadPosition(currentFileKey, r));
    const startAt = savedIdx && savedIdx > 0 && savedIdx < sentences.length ? savedIdx : 0;
    engine.load(sentences, startAt);
    updateProgress(engine.getState());
    progressEl.textContent = startAt > 0
      ? `Loaded ${file.name}: resumed at sentence ${startAt + 1} of ${sentences.length}. Press Play.`
      : `Loaded ${file.name}: ${sentences.length} sentences. Press Play.`;
  } catch (e) {
    cancelOcrBtn.hidden = true;
    await stopOcr();
    if (token !== loadToken) return; // superseded: the newer load owns the UI
    resetDocument();
    progressEl.textContent = "Could not read that file: " + e.message;
  }
}

// A failed load means no document: stop any current playback and clear the
// engine queue, so Play can never replay a previous document while the
// interface says the new file could not be read (B15).
function resetDocument() {
  sentences = [];
  sentenceEls = [];
  currentFileKey = null;
  textView.innerHTML = "";
  engine.stop();
  engine.load([], 0);
}

/* ---------- Voices ---------- */

function populateVoices() {
  const voices = window.speechSynthesis ? window.speechSynthesis.getVoices() : [];
  const choice = window.RATTS.chooseVoice(voices, savedVoiceURI, onlineOptIn);
  updateVoiceNotice(choice);
  voiceSelect.innerHTML = "";
  // The ambiguous "browser default" (which may be a remote voice) is only
  // offered after an explicit online-voice opt-in.
  const listed = voices
    .map((v, i) => ({ v, i }))
    .filter(({ v }) => onlineOptIn || v.localService !== false);
  if (onlineOptIn || !voices.length) {
    const def = document.createElement("option");
    def.value = "";
    def.textContent = voices.length ? "Browser default" : "Default (voices unavailable)";
    voiceSelect.appendChild(def);
  }
  if (!listed.length && voices.length) {
    const none = document.createElement("option");
    none.value = "";
    none.textContent = "No local voices installed";
    voiceSelect.appendChild(none);
  }
  listed.forEach(({ v, i }) => {
    const opt = document.createElement("option");
    opt.value = String(i);
    const where = v.localService === false ? "online" : "local";
    opt.textContent = `${v.name} (${v.lang}, ${where})`;
    voiceSelect.appendChild(opt);
  });
  if (choice.voice) {
    const idx = voices.indexOf(choice.voice);
    voiceSelect.value = String(idx);
    engine.setVoice(choice.voice);
  }
  voiceSelect.onchange = () => {
    const i = voiceSelect.value === "" ? -1 : parseInt(voiceSelect.value, 10);
    savedVoiceURI = i >= 0 ? voices[i].voiceURI : null;
    engine.setVoice(i >= 0 ? voices[i] : null);
    scheduleSaveSettings();
  };
}

if (window.speechSynthesis) {
  populateVoices();
  window.speechSynthesis.onvoiceschanged = populateVoices;
  // Firefox can populate the voice list without a voiceschanged event that
  // page scripts observe; poll briefly so the list and the online-voice
  // notice settle to the real state.
  [250, 1000, 3000].forEach((ms) => setTimeout(populateVoices, ms));
}

/* ---------- Wiring ---------- */

dropZone.addEventListener("click", (e) => {
  if (e.target !== fileInput) fileInput.click();
});
dropZone.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") fileInput.click();
});
fileInput.addEventListener("change", () => handleFile(fileInput.files[0]));
dropZone.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropZone.classList.add("dragover");
});
dropZone.addEventListener("dragleave", () => dropZone.classList.remove("dragover"));
dropZone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropZone.classList.remove("dragover");
  handleFile(e.dataTransfer.files[0]);
});

document.getElementById("play").addEventListener("click", () => {
  if (!playbackAllowed()) return;
  lastSpeechError = null;
  engine.play();
});
document.getElementById("pause").addEventListener("click", () => engine.pause());
document.getElementById("resume").addEventListener("click", () => engine.resume());
function stopPlayback() { lastSpeechError = null; engine.stop(); updateProgress(engine.getState()); }
document.getElementById("stop").addEventListener("click", stopPlayback);
document.getElementById("prev").addEventListener("click", () => engine.prev());
document.getElementById("next").addEventListener("click", () => engine.next());

// Keyboard shortcuts (reader page only; skipped while typing in a control):
// Space toggles play/pause/resume, arrows move a sentence, Escape stops.
document.addEventListener("keydown", (e) => {
  // A sentence span's own keydown handler already acted on this event
  // (Enter/Space seek); without this guard a Space on a focused sentence
  // would seek AND immediately toggle pause here.
  if (e.defaultPrevented) return;
  const tag = e.target && e.target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
  if (e.key === " " || e.key === "Spacebar") {
    e.preventDefault();
    const st = engine.getState ? engine.getState() : { state: "idle" };
    if (st.state === "speaking") engine.pause();
    else if (st.state === "paused") engine.resume();
    else if (playbackAllowed()) { lastSpeechError = null; engine.play(); }
  } else if (e.key === "ArrowLeft") { e.preventDefault(); engine.prev(); }
  else if (e.key === "ArrowRight") { e.preventDefault(); engine.next(); }
  else if (e.key === "Escape") { stopPlayback(); }
});

rateInput.addEventListener("input", () => {
  document.getElementById("rate-value").textContent = parseFloat(rateInput.value).toFixed(1) + "×";
  engine.setRate(parseFloat(rateInput.value));
  scheduleSaveSettings();
});
pitchInput.addEventListener("input", () => {
  document.getElementById("pitch-value").textContent = parseFloat(pitchInput.value).toFixed(1);
  engine.setPitch(parseFloat(pitchInput.value));
  scheduleSaveSettings();
});

// Restore saved settings (local only: rate, pitch, voice - never text).
RAStore.loadSettings((s) => {
  if (s.rate !== null) {
    rateInput.value = String(s.rate);
    document.getElementById("rate-value").textContent = s.rate.toFixed(1) + "×";
    engine.setRate(s.rate);
  }
  if (s.pitch !== null) {
    pitchInput.value = String(s.pitch);
    document.getElementById("pitch-value").textContent = s.pitch.toFixed(1);
    engine.setPitch(s.pitch);
  }
  if (s.voiceURI) savedVoiceURI = s.voiceURI;
  onlineOptIn = s.onlineOptIn === true;
  populateVoices();
});

engine.on("state", updateProgress);
engine.on("progress", updateProgress);
engine.on("end", updateProgress);
engine.on("error", (e) => {
  lastSpeechError = e.error || "unknown";
  updateProgress(e.state || engine.getState());
});
