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
let userChoseLang = false; // set when the user picks a language; detection never overrides it
let voiceLang = "en-US"; // chosen by the user in the Language control; English by default; not stored
let connNote = ""; // connection message shown in the voice notice
let blockedNotice = false;
let currentFileKey = null;
let lastPosSave = 0;

const voiceNotice = document.getElementById("voice-notice");

function voiceChoice() {
  const voices = window.speechSynthesis ? window.speechSynthesis.getVoices() : [];
  return window.RATTS.chooseVoice(voices, savedVoiceURI, voiceLang);
}

// Online voices are listed automatically with local ones. The browser or OS
// decides which voices are online; spoken text for an online voice is sent
// to that provider, so the notice says so whenever one is selected.
function updateVoiceNotice(choice) {
  const lines = [];
  if (choice.savedMissing) {
    lines.push("Your selected voice is not in the list right now (an online voice is unavailable while the connection is down). " +
      "Reading is paused. It will come back when the voice list refreshes, or choose another voice.");
  } else if (choice.needsChoice) {
    lines.push("Only online voices are available for this language. Choose a voice from the list to start reading; spoken text for an online voice is sent to your browser's or system's voice provider.");
  } else if (choice.noLangVoice) {
    const names = langSelect.options[langSelect.selectedIndex] ? langSelect.options[langSelect.selectedIndex].textContent : voiceLang;
    const have = [...new Set((window.speechSynthesis ? window.speechSynthesis.getVoices() : []).map((v) => v.lang))].sort().join(", ");
    lines.push(`No voice for ${names} is available in this browser or system, so playback is paused and no other voice is substituted. ` +
      (have ? `Voice languages installed: ${have}. ` : "") + "Add a voice for this language in your system speech settings, or choose another language.");
  } else if (choice.voice && choice.voice.localService === false) {
    lines.push("This is an online voice: spoken text is sent to your browser's or system's voice provider.");
  }
  if (langNote) lines.push(langNote);
  if (connNote) lines.push(connNote);
  voiceNotice.hidden = !lines.length;
  voiceNotice.textContent = lines.join(" ");
}

// Gate every playback entry point: no eligible voice means explain, never
// speak with a voice of another language or a voice the user did not choose.
function playbackAllowed() {
  const c = voiceChoice();
  if (c.savedMissing || c.noLangVoice || c.needsChoice) {
    updateVoiceNotice(c);
    blockedNotice = true;
    progressEl.textContent = c.savedMissing
      ? "The selected voice is unavailable, so playback is paused. Choose another voice or wait for the list to refresh."
      : c.needsChoice
        ? "Choose a voice from the list to start reading."
        : "No voice for this language is available, so playback is paused.";
    return false;
  }
  return true;
}

function scheduleSaveSettings() {
  RAStore.saveSettings({
    rate: parseFloat(rateInput.value),
    pitch: parseFloat(pitchInput.value),
    voiceURI: savedVoiceURI
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
let ocrGen = 0;
function endLater(w) {
  setTimeout(() => { try { Promise.resolve(w.terminate()).catch(() => {}); } catch (e) { /* already gone */ } }, 250);
}
async function getOcrWorker() {
  if (ocrWorker) return ocrWorker;
  const gen = ocrGen;
  const base = new URL("../vendor/tesseract/", location.href).href;
  const created = await Tesseract.createWorker("eng+ara+fra", 1, {
    workerPath: base + "worker.min.js",
    corePath: base,
    langPath: base + "lang",
    workerBlobURL: false,
    cacheMethod: "none",
    gzip: true
  });
  // Cancelled or replaced while the engine was starting: do not keep it.
  if (gen !== ocrGen) { endLater(created); throw new Error("cancelled"); }
  ocrWorker = created;
  return ocrWorker;
}
async function stopOcr() {
  const w = ocrWorker;
  ocrWorker = null;
  ocrGen++;
  // Terminate shortly after, not in the same instant: ending the engine within
  // its first milliseconds of a recognition leaves an internal step failing
  // on a missing worker (an unhandled rejection in Firefox). The interface
  // does not wait for the teardown, so Cancel stays immediate.
  if (w) endLater(w);
}

async function pageToCanvas(page) {
  const viewport = page.getViewport({ scale: 2 });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
  return canvas;
}


// Scan layout helpers (local, pixel-only). A page whose ink has an empty
// vertical gutter all the way down is OCR'd one column at a time so lines of
// neighbouring columns are not read across. Anything ambiguous (a heading
// spanning the columns, noisy gutter) falls back to whole-page recognition.
function findColumnRanges(canvas) {
  const scale = Math.min(1, 700 / canvas.width);
  const w = Math.max(1, Math.round(canvas.width * scale)), h = Math.max(1, Math.round(canvas.height * scale));
  const small = document.createElement("canvas");
  small.width = w; small.height = h;
  const g = small.getContext("2d", { willReadFrequently: true });
  g.drawImage(canvas, 0, 0, w, h);
  const px = g.getImageData(0, 0, w, h).data;
  const col = new Array(w).fill(0);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    if (px[i + 3] > 0 && (px[i] * 0.3 + px[i + 1] * 0.59 + px[i + 2] * 0.11) < 140) col[x]++;
  }
  small.width = small.height = 0;
  const noise = Math.max(0, Math.floor(h * 0.002));
  let first = col.findIndex((c) => c > noise), last = -1;
  for (let x = w - 1; x >= 0; x--) if (col[x] > noise) { last = x; break; }
  if (first < 0 || last - first < w * 0.3) return null;
  const minGap = Math.max(6, Math.round(w * 0.04)), minSide = Math.round((last - first) * 0.15);
  const cuts = [];
  let x = first;
  while (x <= last) {
    if (col[x] > noise) { x++; continue; }
    let e = x; while (e <= last && col[e] <= noise) e++;
    if (e - x >= minGap && x - first >= minSide && last - e >= minSide) cuts.push([x, e]);
    x = e;
  }
  if (!cuts.length || cuts.length > 3) return null;
  const ranges = []; let from = first;
  for (const [a, b] of cuts) { ranges.push([from, a]); from = b; }
  ranges.push([from, last + 1]);
  return ranges.map(([a, b]) => [Math.max(0, Math.floor(a / scale) - 12), Math.min(canvas.width, Math.ceil(b / scale) + 12)]);
}
function cropColumn(canvas, x0, x1) {
  const pad = 30;
  const c = document.createElement("canvas");
  c.width = x1 - x0 + pad * 2; c.height = canvas.height;
  const g = c.getContext("2d");
  g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height);
  g.drawImage(canvas, x0, 0, x1 - x0, canvas.height, pad, 0, x1 - x0, canvas.height);
  return c;
}
function rotatedCopy(canvas, deg) {
  const c = document.createElement("canvas");
  const swap = deg === 90 || deg === 270;
  c.width = swap ? canvas.height : canvas.width; c.height = swap ? canvas.width : canvas.height;
  const g = c.getContext("2d");
  g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height);
  g.translate(c.width / 2, c.height / 2); g.rotate(deg * Math.PI / 180);
  g.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
  return c;
}
function wordLikeShare(text) {
  const compact = (text || "").replace(/[\s\u200e\u200f]/g, "");
  if (!compact.length) return 1;
  const words = (text.match(/[A-Za-z\u00C0-\u024F]{3,}|[\u0600-\u06FF]{3,}/g) || []).join("");
  return words.length / compact.length;
}
async function recognizePage(worker, canvas, alive) {
  const rec = async (c) => { if (!alive()) throw new Error("cancelled"); return worker.recognize(c); };
  const ranges = findColumnRanges(canvas);
  if (ranges) {
    const parts = [];
    for (const [a, b] of ranges) {
      const c = cropColumn(canvas, a, b);
      const r = await rec(c);
      c.width = c.height = 0;
      parts.push((r.data.text || "").trim());
    }
    const all = parts.join(" ");
    const ar = (all.match(/[\u0600-\u06FF]/g) || []).length, la = (all.match(/[A-Za-z]/g) || []).length;
    if (ar > la) parts.reverse(); // right-to-left page: first column is on the right
    return RAText.splitOnScriptSwitch(parts.filter(Boolean).join("\n\n"));
  }
  const res = await rec(canvas);
  let best = res.data, bestText = best.text || "";
  // Wrong orientation (a sideways or upside-down scan) produces scattered
  // one- and two-character fragments, even when the engine reports a middling
  // confidence. When the text does not look like words, try the other
  // orientations and keep one only if it is clearly more word-like.
  if (wordLikeShare(bestText) < 0.45) {
    let bestShare = wordLikeShare(bestText);
    for (const deg of [90, 270, 180]) {
      const rc = rotatedCopy(canvas, deg);
      const r = await rec(rc);
      rc.width = rc.height = 0;
      const share = wordLikeShare(r.data.text || "");
      if (share >= bestShare + 0.25 && (r.data.confidence || 0) >= 60) { best = r.data; bestText = r.data.text || ""; bestShare = share; }
    }
  }
  return RAText.splitOnScriptSwitch(bestText.trim());
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
      const pageText = await recognizePage(worker, canvas, () => token === loadToken);
      canvas.width = canvas.height = 0;
      if (token !== loadToken) throw new Error("cancelled");
      segments.push({ ocr: true, text: pageText + "\n" });
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
      (connNote.startsWith("The online voice stopped") ? " (see the voice notice)." : " — your system may have no speech voices installed.");
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

// Initial language for a newly loaded document: detected from its text
// (OCR text for scans), mapped English -> English (United States), Arabic ->
// Arabic (Morocco), French -> French (France). Only at load, when nothing is
// playing, and never over a language the user chose by hand. If the browser
// has no voice for that language the notice says so; no other voice is used.
const DETECTED_LANG = { en: "en-US", ar: "ar-MA", fr: "fr-FR" };
let langNote = "";
function applyDetectedLanguage(text, name) {
  langNote = "";
  if (userChoseLang) return;
  const target = DETECTED_LANG[RAText.detectLanguage(text, 0.5)] || "en-US";
  const cur = voiceLang === "en" ? "en-US" : voiceLang;
  if (target === cur) return;
  voiceLang = target;
  langSelect.value = target;
  savedVoiceURI = null;
  langNote = "Detected " + langSelect.options[langSelect.selectedIndex].textContent + " in " + name + ". Change it with the Language control.";
  populateVoices();
}

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
    applyDetectedLanguage(sentences.join(" "), file.name);
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
    // Superseded or cancelled: the newer load (or the Cancel handler) owns the
    // UI and the shared recognition worker. Tearing it down here could kill
    // the new load's worker mid-recognition.
    if (token !== loadToken) return;
    cancelOcrBtn.hidden = true;
    await stopOcr();
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
  const choice = window.RATTS.chooseVoice(voices, savedVoiceURI, voiceLang);
  voiceSelect.innerHTML = "";
  const listed = voices
    .map((v, i) => ({ v, i }))
    .filter(({ v }) => window.RATTS.voiceMatches(v, voiceLang));
  engine.setLang(voiceLang);
  if (!voices.length) {
    const def = document.createElement("option");
    def.value = "";
    def.textContent = "Default (voices unavailable)";
    voiceSelect.appendChild(def);
  } else if (!listed.length || choice.savedMissing || choice.needsChoice) {
    const none = document.createElement("option");
    none.value = "";
    none.textContent = choice.savedMissing ? "Selected voice unavailable" : choice.needsChoice ? "Choose a voice" : "No voices for this language";
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
    voiceSelect.value = String(voices.indexOf(choice.voice));
    engine.setVoice(choice.voice);
  } else if (voices.length) {
    // Never keep speaking with a voice of another language, or silently
    // swap the user's chosen voice for another one.
    engine.setVoice(null);
  }
  updateVoiceNotice(choice);
  voiceSelect.onchange = () => {
    const i = voiceSelect.value === "" ? -1 : parseInt(voiceSelect.value, 10);
    savedVoiceURI = i >= 0 ? voices[i].voiceURI : null;
    engine.setVoice(i >= 0 ? voices[i] : null);
    connNote = connNote.startsWith("The online voice stopped") ? "" : connNote;
    updateVoiceNotice(voiceChoice());
    scheduleSaveSettings();
  };
}

const langSelect = document.getElementById("language");
langSelect.addEventListener("change", (e) => {
  userChoseLang = true; langNote = ""; // manual choice wins over document detection from now on
  voiceLang = e.target.value;
  savedVoiceURI = null;
  populateVoices();
});

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
  populateVoices();
});

engine.on("state", updateProgress);
engine.on("progress", updateProgress);
engine.on("end", updateProgress);
engine.on("error", (e) => {
  lastSpeechError = e.error || "unknown";
  const cur = voiceChoice().voice;
  if (cur && cur.localService === false) {
    connNote = "The online voice stopped (connection problem or the voice service is unavailable). Position kept: " +
      "check the connection and press Play to continue from this sentence, or choose another voice.";
    populateVoices();
  }
  updateProgress(e.state || engine.getState());
});

// Connection changes: refresh the voice list on every change. Nothing is
// switched or restarted automatically: a lost connection pauses reading only
// when an online voice is in use, and after reconnecting the user presses
// Play or Resume.
window.addEventListener("offline", () => {
  const cur = voiceChoice().voice;
  const usingOnline = cur && cur.localService === false;
  if (usingOnline && engine.getState().state === "speaking") engine.pause();
  connNote = usingOnline
    ? "Connection lost. Reading is paused on the online voice. Reconnect and press Resume, or choose a local voice."
    : "Connection lost. Online voices may not work until it returns; local voices are unaffected.";
  populateVoices();
});
window.addEventListener("online", () => {
  connNote = "Connection restored. The voice list was refreshed; nothing was restarted. Press Play or Resume to continue.";
  populateVoices();
  [1000, 3000].forEach((ms) => setTimeout(populateVoices, ms));
});
