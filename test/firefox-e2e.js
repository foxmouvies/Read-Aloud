/*
 * Real-Firefox end-to-end test via geckodriver (Firefox ESR).
 * The extension is sideloaded from a prepared profile (ESR honors
 * xpinstall.signatures.required=false) and the reader page is opened as the
 * startup URL, so no WebDriver navigation to moz-extension:// is needed.
 * Verifies: extension active in real Firefox, real local speech-dispatcher
 * voices, real PDF extraction, trusted Play click, FULL playback completion
 * (onstart..onend with real synthesized audio), pause/resume, screenshots.
 * Run with the speech stack (speech-dispatcher + PulseAudio null sink) up.
 */
"use strict";
const { spawn, execSync } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

const EXT_DIR = path.resolve(__dirname, "..");
const GECKODRIVER = path.join(os.homedir(), "browsers", "geckodriver");
const FIREFOX = process.env.FIREFOX_BIN || path.join(os.homedir(), "browsers", "firefox-esr", "firefox");
const EXT_ID = "readaloud@instinct.local";
// Firefox addresses extension pages by an internal UUID, not the addon id.
// Pin it via the extensions.webextensions.uuids pref for deterministic URLs.
const FF_UUID = "aaaaaaaa-1111-2222-3333-bbbbbbbbbbbb";
const PORT = 9522;
const BASE = `http://127.0.0.1:${PORT}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function req(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${url} -> ${res.status}: ${JSON.stringify(json).slice(0, 300)}`);
  return json;
}
const get = (url) => req("GET", url);
const post = (url, body) => req("POST", url, body || {});

let SID = null;
async function execute(script, args) {
  const r = await post(`${BASE}/session/${SID}/execute/sync`, { script, args: args || [] });
  return r.value;
}
async function findEl(css) {
  const r = await post(`${BASE}/session/${SID}/element`, { using: "css selector", value: css });
  return r.value["element-6066-11e4-a52e-4f735466cecf"];
}
async function click(css) {
  const eid = await findEl(css);
  await post(`${BASE}/session/${SID}/element/${eid}/click`, {});
}
async function shot(name) {
  const r = await get(`${BASE}/session/${SID}/screenshot`);
  fs.writeFileSync(name, Buffer.from(r.value, "base64"));
}
async function waitFor(desc, fn, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await fn();
    if (last) return last;
    await sleep(500);
  }
  throw new Error("TIMEOUT waiting for: " + desc + " (last: " + JSON.stringify(last) + ")");
}

(async () => {
  // Fresh sideload profile from the current source every run.
  execSync("zip -qr /tmp/ra-ff-ext.zip manifest.json shared content popup reader icons vendor", { cwd: EXT_DIR });
  execSync(`rm -rf /tmp/ff-prof && mkdir -p /tmp/ff-prof/extensions && cp /tmp/ra-ff-ext.zip "/tmp/ff-prof/extensions/${EXT_ID}.xpi"`);
  fs.writeFileSync("/tmp/ff-prof/user.js", [
    'user_pref("xpinstall.signatures.required", false);',
    'user_pref("extensions.autoDisableScopes", 0);',
    'user_pref("extensions.enabledScopes", 15);',
    'user_pref("browser.shell.checkDefaultBrowser", false);',
    'user_pref("app.update.disabledForTesting", true);',
    'user_pref("datareporting.policy.dataSubmissionEnabled", false);',
    'user_pref("browser.newtabpage.enabled", false);',
    'user_pref("media.webspeech.synth.enabled", true);',
    `user_pref("extensions.webextensions.uuids", '{"${EXT_ID}":"${FF_UUID}"}');`
  ].join("\n"));
  execSync("rm -f /tmp/ff-prof.zip && cd /tmp/ff-prof && zip -qr /tmp/ff-prof.zip .");
  const profileB64 = fs.readFileSync("/tmp/ff-prof.zip").toString("base64");

  const gecko = spawn(GECKODRIVER, ["-p", String(PORT)], { stdio: ["ignore", "ignore", "inherit"] });
  const cleanup = async () => {
    try { if (SID) await req("DELETE", `${BASE}/session/${SID}`); } catch (e) {}
    gecko.kill();
  };
  process.on("SIGINT", async () => { await cleanup(); process.exit(1); });

  await waitFor("geckodriver ready", async () => {
    try { await get(`${BASE}/status`); return true; } catch (e) { return false; }
  }, 20000);

  const sess = await post(`${BASE}/session`, {
    capabilities: {
      alwaysMatch: {
        "moz:firefoxOptions": {
          binary: FIREFOX,
          profile: profileB64,
          args: ["-headless", `moz-extension://${FF_UUID}/reader/reader.html`]
        }
      }
    }
  });
  SID = sess.value.sessionId;
  console.log("session:", SID);

  // The reader page must be the current tab.
  await waitFor("reader page loaded", async () => {
    try {
      const u = (await get(`${BASE}/session/${SID}/url`)).value;
      if (u.includes("reader/reader.html")) {
        const ready = await execute("return document.readyState");
        return ready === "complete" ? u : null;
      }
      return null;
    } catch (e) { return null; }
  }, 30000);
  const title = (await get(`${BASE}/session/${SID}/title`)).value;
  if (!/ReadAloud/.test(title)) throw new Error("reader page title wrong: " + title);
  console.log("reader page open in Firefox, title OK");

  // Real voices from the local speech-dispatcher (espeak-ng) stack.
  const voices = await waitFor("speech voices", async () => {
    const v = await execute("return window.speechSynthesis ? speechSynthesis.getVoices().map(x => x.name + ' [' + x.lang + ']' + (x.localService ? ' local' : ' remote')) : []");
    return v && v.length ? v : null;
  }, 45000);
  console.log("FIREFOX VOICES (" + voices.length + "):", JSON.stringify(voices.slice(0, 6)));
  // Enumeration sanity: dedupe and local/remote split, so an anomalous
  // all-remote count is attributed to this environment, not generalized.
  const vstats = await execute(`return (() => {
    const vs = speechSynthesis.getVoices();
    return { total: vs.length,
      uniqueNames: new Set(vs.map(v => v.name)).size,
      uniqueURIs: new Set(vs.map(v => v.voiceURI)).size,
      local: vs.filter(v => v.localService).length,
      remote: vs.filter(v => !v.localService).length };
  })()`);
  console.log("VOICE ENUMERATION:", JSON.stringify(vstats));

  // Real PDF through the file input (trusted upload).
  const input = await findEl("#file-input");
  await post(`${BASE}/session/${SID}/element/${input}/value`, { text: path.join(EXT_DIR, "test", "fixtures", "sample.pdf") });
  const sentenceCount = await waitFor("PDF sentences", () =>
    execute("return document.querySelectorAll('#text-view .sentence').length").then((n) => n > 0 && n), 30000);
  const extracted = await execute("return document.getElementById('text-view').innerText");
  if (!/reads text aloud/i.test(extracted)) throw new Error("PDF text missing expected content");
  if (!/3\.5 decimals/.test(extracted)) throw new Error("decimal not preserved");
  console.log("PDF extracted:", sentenceCount, "sentences, content verified");
  await shot("/tmp/ff-reader-loaded.png");

  // Instrument speak() to record the pitch and text of every real utterance
  // (proves B1 pitch wiring and B2 chunking at runtime).
  await execute(`
    window.__pitches = [];
    window.__texts = [];
    window.__voices = [];
    const r = document.getElementById("rate");
    r.value = "2.0";
    r.dispatchEvent(new Event("input", { bubbles: true }));
    const origSpeak = speechSynthesis.speak.bind(speechSynthesis);
    speechSynthesis.speak = function (u) {
      window.__pitches.push(u.pitch);
      window.__texts.push(u.text);
      window.__voices.push(u.voice ? u.voice.name : null);
      return origSpeak(u);
    };
    return true;
  `);

  // Voice privacy gate: with only remote voices and no opt-in, playback must
  // be blocked with an explanation, and the disclosure must be visible.
  const disclosure = await waitFor("online-voice disclosure", () =>
    execute("return (document.getElementById('voice-notice')||{}).textContent || ''")
      .then((t) => /spoken text is sent to (that|the voice) provider/.test(t) && t), 10000);
  await click("#play");
  const blockedMsg = await waitFor("blocked playback explanation", () =>
    execute("return document.getElementById('progress').textContent").then((t) => /paused/.test(t) && t), 10000);
  console.log("PLAYBACK BLOCKED WITHOUT OPT-IN:", blockedMsg);
  await shot("/tmp/ff-voice-blocked.png");
  await click("#allow-online");
  const optInNotice = await execute("return (document.getElementById('voice-notice')||{}).textContent || ''");
  if (!/Online voices are allowed/.test(optInNotice)) throw new Error("opt-in confirmation missing: " + optInNotice);
  console.log("ONLINE VOICES ENABLED VIA DISCLOSED OPT-IN");
  const staleMsg = await execute("return document.getElementById('progress').textContent");
  if (/paused|Allow online voices/.test(staleMsg)) throw new Error("stale blocked explanation after opt-in: " + staleMsg);
  console.log("BLOCKED EXPLANATION CLEARED AFTER OPT-IN");
  await shot("/tmp/ff-voice-opted-in.png");

  // Opt-in is revocable: Disallow hides online voices again and re-blocks
  // playback behind the same gate (v1.0.8).
  const disallowVisible = await execute("return !document.getElementById('disallow-online').hidden");
  if (!disallowVisible) throw new Error("Disallow online voices button not shown after opt-in");
  await click("#disallow-online");
  await waitFor("online voices hidden again after revoke", () =>
    execute("return (document.getElementById('voice-notice')||{}).textContent || ''")
      .then((t) => /Only local voices are used/.test(t) && t), 10000);
  const allowAgain = await execute("return !document.getElementById('allow-online').hidden");
  if (!allowAgain) throw new Error("Allow button not restored after revoke");
  const disallowGone = await execute("return document.getElementById('disallow-online').hidden");
  if (!disallowGone) throw new Error("Disallow button still visible after revoke");
  await click("#play");
  await waitFor("playback blocked again after revoke", () =>
    execute("return document.getElementById('progress').textContent").then((t) => /paused/.test(t) && t), 10000);
  console.log("ONLINE VOICE OPT-IN REVOKED: online voices hidden, playback blocked again");
  await shot("/tmp/ff-voice-revoked.png");
  // Re-opt-in so the real playback checks below can run.
  await click("#allow-online");
  await waitFor("opt-in confirmation after re-opt-in", () =>
    execute("return (document.getElementById('voice-notice')||{}).textContent || ''")
      .then((t) => /Online voices are allowed/.test(t) && t), 10000);

  // Real playback: trusted Play click, speaking state, then FULL completion.
  await click("#play");
  await waitFor("speaking state", async () => {
    const p = await execute("return document.getElementById('progress').textContent");
    return /speaking/.test(p) && p;
  }, 15000);
  await shot("/tmp/ff-reader-playing.png");
  const finished = await waitFor("full playback completion", async () => {
    const p = await execute("return document.getElementById('progress').textContent");
    return /idle/.test(p) && p;
  }, 120000);
  console.log("PLAYBACK COMPLETED IN FIREFOX:", finished);

  // Real-audio regression (v1.0.8): Space on a focused sentence seeks and
  // PLAYS - the sentence keydown handler and the page-level shortcut handler
  // must not both act (seek-then-pause). Read synchronously at dispatch.
  const spaceState = await execute(
    "const el = document.querySelectorAll('#text-view .sentence')[2];" +
    "el.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }));" +
    "return document.getElementById('progress').textContent");
  if (!/speaking/.test(spaceState)) throw new Error("Space on a sentence did not start playback: " + spaceState);
  console.log("SPACE ON SENTENCE SEEKS AND PLAYS (REAL AUDIO):", spaceState);
  await click("#stop");

  // Storage runtime proof: re-uploading the same PDF resumes at the saved
  // position (file name+size key) instead of starting from sentence 1.
  await post(`${BASE}/session/${SID}/element/${input}/value`, { text: path.join(EXT_DIR, "test", "fixtures", "sample.pdf") });
  const resumed = await waitFor("resume notice", () =>
    execute("return document.getElementById('progress').textContent").then((t) => /resumed at sentence/.test(t) && t), 15000);
  console.log("POSITION RESUMED IN FIREFOX:", resumed);

  // B1 runtime proof: moving the pitch slider must change the NEXT utterance's
  // pitch (and previously wiped the voice selection instead).
  await execute(`
    window.__pitches = [];
    window.__voices = [];
    // Pick a concrete voice first: the old bug silently cleared the selected
    // voice when the pitch slider moved.
    const v = document.getElementById("voice");
    v.selectedIndex = Math.min(1, v.options.length - 1);
    v.dispatchEvent(new Event("change", { bubbles: true }));
    window.__chosenVoice = v.options[v.selectedIndex].text;
    const p = document.getElementById("pitch");
    p.value = "1.6";
    p.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  `);
  await click("#play");
  await waitFor("pitch pass speaking", async () => {
    const p = await execute("return document.getElementById('progress').textContent");
    return /speaking/.test(p) && p;
  }, 40000);
  let pitchVal = null;
  for (let i = 0; i < 25 && !pitchVal; i++) {
    const ps = await execute("return window.__pitches");
    const vs = await execute("return window.__voices");
    // pitch is stored float32 in the utterance; compare with tolerance
    if (ps && vs && ps.some((p) => Math.abs(p - 1.6) < 0.001) && vs.some((x) => x)) {
      pitchVal = JSON.stringify({ pitches: ps, voices: vs });
    } else await new Promise((r) => setTimeout(r, 1000));
  }
  if (!pitchVal) {
    const dbg = await execute("return JSON.stringify({pitches: window.__pitches, voices: window.__voices, texts: (window.__texts||[]).length, progress: document.getElementById('progress').textContent})");
    throw new Error("pitch 1.6 with voice not recorded. debug: " + dbg);
  }
  const chosenVoice = await execute("return window.__chosenVoice");
  const pitchVoices = await execute("return window.__voices");
  const kept = pitchVoices && chosenVoice && pitchVoices.some((n) => n && chosenVoice.indexOf(n) !== -1);
  if (!kept) throw new Error("selected voice lost after pitch change: chose " + chosenVoice + ", utterances used " + JSON.stringify(pitchVoices));
  console.log("PITCH 1.6 APPLIED TO LIVE UTTERANCE WITH VOICE KEPT:", pitchVal);
  await click("#stop");

  // Pause/resume on a second pass.
  await click("#play");
  await waitFor("second pass speaking", async () => {
    const p = await execute("return document.getElementById('progress').textContent");
    return /speaking/.test(p) && p;
  }, 40000);
  await click("#pause");
  await waitFor("paused state", async () => {
    const p = await execute("return document.getElementById('progress').textContent");
    return /paused/.test(p) && p;
  }, 10000);
  await click("#resume");
  await waitFor("resumed state", async () => {
    const p = await execute("return document.getElementById('progress').textContent");
    return /speaking/.test(p) && p;
  }, 10000);
  await click("#stop");
  console.log("pause/resume/stop verified in Firefox");

  // Hyphenation fixture too.
  const input2 = await findEl("#file-input");
  await post(`${BASE}/session/${SID}/element/${input2}/value`, { text: path.join(EXT_DIR, "test", "fixtures", "sample-hyphen.pdf") });
  await waitFor("hyphen PDF", () =>
    execute("return document.getElementById('text-view').innerText.includes('spoken aloud')").then((v) => v || null), 30000);
  const hyphenText = await execute("return document.getElementById('text-view').innerText");
  if (!/extraordinarily/.test(hyphenText)) throw new Error("hyphenation not joined in Firefox");
  console.log("hyphenation joined in Firefox: OK");

  // HTML upload in real Firefox: inert local parse (text checks, then network
  // and script checks kept separate), then real-voice playback of the text.
  {
    const hits = [];
    const tracker = http.createServer((rq, rs) => { hits.push(rq.url); rs.end("x"); });
    await new Promise((r) => tracker.listen(0, "127.0.0.1", r));
    const tport = tracker.address().port;
    const htmlPath = "/tmp/ra-inert-ff-" + tport + ".html";
    fs.writeFileSync(htmlPath, fs.readFileSync(path.join(EXT_DIR, "test", "fixtures", "sample-inert.html"), "utf8").replace(/__PORT__/g, String(tport)));
    const inputH = await findEl("#file-input");
    await post(`${BASE}/session/${SID}/element/${inputH}/value`, { text: htmlPath });
    await waitFor("HTML loaded", () =>
      execute("return /^Loaded ra-inert/.test(document.getElementById('progress').textContent)").then((v) => v || null), 30000);
    const ht = await execute("return document.getElementById('text-view').textContent");
    for (const want of ["Harbour Lights Festival", "lantern parade", "local musicians", "shuttle bus"]) {
      if (!ht.includes(want)) throw new Error("Firefox HTML text missing: " + want);
    }
    for (const bad of ["Navigation menu", "Secret hidden", "Another hidden", "Vector label", "Footer legal", "Hidden title"]) {
      if (ht.includes(bad)) throw new Error("Firefox HTML text should exclude: " + bad);
    }
    await sleep(1500);
    if (hits.length) throw new Error("Firefox HTML upload made network requests: " + JSON.stringify(hits));
    if (await execute("return window.__pwned === true")) throw new Error("script from the HTML file ran in Firefox");
    if (await execute("return document.querySelectorAll('#text-view img, #text-view iframe, #text-view script, #text-view object, #text-view a').length")) throw new Error("markup inserted into the Firefox reader");
    tracker.close();
    await click("#play");
    await waitFor("HTML playback speaking", async () => {
      const p = await execute("return document.getElementById('progress').textContent");
      return /speaking/.test(p) && p;
    }, 15000);
    await click("#stop");
    console.log("Firefox HTML upload: text kept/excluded OK; inert (0 network requests, no script ran, no markup inserted); real-voice playback started");
  }

  {
    const seg = await execute(`return { has: typeof Intl.Segmenter === "function",
      fr: RAText.splitIntoSentences("M. Dupont est arrivé à 3.5 heures. Il a dit « Bonjour. » Puis il est parti ! Vraiment ?"),
      ar: RAText.splitIntoSentences("ذهب أحمد إلى السوق. هل رأيته؟ نعم! ثم عاد إلى البيت."),
      en: RAText.splitIntoSentences('Dr. Lee paid 3.5 MAD. He left. Then he said "Stop." She agreed.') }`);
    const want = {
      fr: ["M. Dupont est arrivé à 3.5 heures.", "Il a dit « Bonjour. »", "Puis il est parti !", "Vraiment ?"],
      ar: ["ذهب أحمد إلى السوق.", "هل رأيته؟", "نعم!", "ثم عاد إلى البيت."],
      en: ["Dr. Lee paid 3.5 MAD.", "He left.", 'Then he said "Stop."', "She agreed."]
    };
    if (!seg.has) throw new Error("Intl.Segmenter missing in Firefox");
    for (const k of Object.keys(want)) if (JSON.stringify(seg[k]) !== JSON.stringify(want[k])) throw new Error("Firefox sentence split " + k + ": " + JSON.stringify(seg[k]));
    console.log("Firefox sentence splitting (Intl.Segmenter present): English, French, Arabic OK");
  }

  // OCR in real Firefox: scanned English/Arabic, mixed text+scanned, replacement
  // race and cancel. Recognition runs in a packaged worker with packaged WASM.
  {
    const fx = (n) => path.join(EXT_DIR, "test", "fixtures", n);
    const up = async (n) => {
      await execute("document.getElementById('file-input').value = ''");
      const el = await findEl("#file-input");
      await post(`${BASE}/session/${SID}/element/${el}/value`, { text: fx(n) });
    };
    const loadedRe = (re) => waitFor("loaded " + re, () =>
      execute("return /" + re + "/.test(document.getElementById('progress').textContent)").then((v) => v || null), 80000);
    const tv = () => execute("return document.getElementById('text-view').textContent");
    await execute("document.getElementById('progress').textContent = ''");
    let t0 = Date.now(); await up("scanned-en.pdf"); await loadedRe("^Loaded scanned-en");
    const enMs = Date.now() - t0;
    let ot = (await tv()).toLowerCase();
    for (const w of ["lantern parade", "seven in the evening", "shuttle buses"]) if (!ot.includes(w)) throw new Error("Firefox English OCR missing: " + w + " got: " + ot);
    await shot("/tmp/ff-ocr-english.png");
    // Play the OCR'd text through real Firefox speech: it must start speaking
    // and run to the end of the recognised sentences.
    await click("#play");
    await waitFor("OCR playback speaking", async () => { const p = await execute("return document.getElementById('progress').textContent"); return /speaking/.test(p) && p; }, 20000);
    await waitFor("OCR playback finished", async () => { const p = await execute("return document.getElementById('progress').textContent"); return /idle/.test(p) && p; }, 60000);
    console.log("Firefox OCR playback: recognised English text spoken to the end through the real speech stack");
    await execute("document.getElementById('progress').textContent = ''");
    t0 = Date.now(); await up("scanned-ar.pdf"); await loadedRe("^Loaded scanned-ar");
    const arMs = Date.now() - t0;
    ot = await tv();
    for (const w of ["مهرجان", "الميناء"]) if (!ot.includes(w)) throw new Error("Firefox Arabic OCR missing: " + w + " got: " + ot);
    await shot("/tmp/ff-ocr-arabic.png");
    await up("mixed-text-scanned.pdf"); await loadedRe("^Loaded mixed-text-scanned");
    ot = await tv();
    if (!/reads text aloud/i.test(ot) || !ot.toLowerCase().includes("lantern parade")) throw new Error("Firefox mixed PDF wrong: " + ot.slice(0, 200));
    await up("scanned-both.pdf"); await sleep(400); await up("sample.pdf"); await loadedRe("^Loaded sample\\.pdf");
    await sleep(8000);
    ot = await tv();
    if (!/reads text aloud/i.test(ot) || /lantern|مهرجان/.test(ot)) throw new Error("Firefox race: stale OCR text");
    await up("scanned-both.pdf");
    await waitFor("cancel visible", () => execute("return !document.getElementById('cancel-ocr').hidden").then((v) => v || null), 30000);
    await click("#cancel-ocr");
    await waitFor("cancelled", () => execute("return /cancelled/.test(document.getElementById('progress').textContent)").then((v) => v || null), 15000);
    await sleep(6000);
    const after = await execute("return [document.querySelectorAll('#text-view .sentence').length, document.getElementById('progress').textContent, document.getElementById('cancel-ocr').hidden]");
    if (after[0] !== 0 || !/cancelled/.test(after[1]) || !after[2]) throw new Error("Firefox cancel left state: " + JSON.stringify(after));
    console.log("Firefox OCR: English, Arabic, mixed PDF, replacement race, cancel/cleanup OK; timings " + JSON.stringify({ english_ms: enMs, arabic_ms: arMs }));
    // restore a loaded document for the following checks
    await up("sample.pdf"); await loadedRe("^Loaded sample\\.pdf");
  }

  // B2 runtime proof: an overlong sentence must be split into <=260-char
  // utterances with nothing truncated. Speed up speech to keep the run short.
  const input3 = await findEl("#file-input");
  await post(`${BASE}/session/${SID}/element/${input3}/value`, { text: path.join(EXT_DIR, "test", "fixtures", "sample-long.pdf") });
  const longSentenceCount = await waitFor("long PDF extracted", () =>
    execute("return document.querySelectorAll('#text-view .sentence').length").then((n) => n >= 2 && n), 30000);
  await execute("window.__texts = []; return true");
  await click("#play");
  const longDone = await waitFor("long fixture playback completion", async () => {
    const p = await execute("return document.getElementById('progress').textContent");
    return /idle/.test(p) && p;
  }, 180000);
  const utterances = await execute("return window.__texts");
  if (utterances.length <= longSentenceCount) {
    throw new Error("no chunking happened at runtime: " + utterances.length + " utterances for " + longSentenceCount + " sentences (overlong sentence not split)");
  }
  const tooLong = utterances.filter((t) => t.length > 260);
  if (tooLong.length) throw new Error("utterance over 260 chars reached speechSynthesis: " + JSON.stringify(tooLong[0].slice(0, 80)));
  const joined = utterances.join(" ");
  if (!/End of the long sentence/.test(joined) || !/Short closing line/.test(joined) || !/deliberately made very long/.test(joined)) {
    throw new Error("long-sentence speech lost content (truncation): got " + utterances.length + " utterances");
  }
  console.log("LONG SENTENCE FULLY SPOKEN:", longSentenceCount, "sentences ->", utterances.length,
    "utterances, max length", Math.max.apply(null, utterances.map((t) => t.length)), "-", longDone);

  // Content-script extraction in real Firefox: load the page fixtures over
  // localhost, inject shared/text.js + content/read-page.js directly, and
  // call the extraction hook (message flow stays covered on Chromium/Brave).
  const { ARTICLE_HTML, COMPLEX_HTML } = require("./fixtures/pages");
  const pageServer = require("http").createServer((rq, rs) => {
    rs.setHeader("content-type", "text/html; charset=utf-8");
    rs.end((rq.url || "").includes("complex") ? COMPLEX_HTML : ARTICLE_HTML);
  });
  await new Promise((r) => pageServer.listen(0, "127.0.0.1", r));
  const pagePort = pageServer.address().port;
  const textJs = fs.readFileSync(path.join(EXT_DIR, "shared", "text.js"), "utf8");
  const readPageJs = fs.readFileSync(path.join(EXT_DIR, "content", "read-page.js"), "utf8");
  async function extractInFirefox(pathname) {
    await post(`${BASE}/session/${SID}/url`, { url: `http://127.0.0.1:${pagePort}/${pathname}` });
    await waitFor("page loaded", async () =>
      (await execute("return document.readyState")) === "complete" ? true : null, 15000);
    await execute(textJs);
    await execute(readPageJs);
    return execute("return window.__readAloudExtract ? window.__readAloudExtract() : 'HOOK-MISSING'");
  }
  const artText = await extractInFirefox("article.html");
  if (typeof artText !== "string" || !artText.includes("Why reading aloud matters")
      || !artText.includes("final thought")) throw new Error("Firefox article extraction wrong: " + String(artText).slice(0, 120));
  if (artText.includes("Menu link one") || artText.includes("Copyright footer"))
    throw new Error("Firefox article extraction leaked boilerplate");
  console.log("Firefox content-script article extraction: OK");
  const cpxText = await extractInFirefox("complex.html");
  if (!cpxText.includes("Article body marker Sentex closes"))
    throw new Error("Firefox complex extraction missed the article: " + String(cpxText).slice(0, 120));
  for (const marker of ["Navigation marker Northex", "Sidebar marker Zelphia", "Related marker Quorin",
      "Footer marker Davron", "Hidden marker Invisia"]) {
    if (cpxText.includes(marker)) throw new Error("Firefox complex extraction leaked: " + marker);
  }
  console.log("Firefox content-script complex-page extraction: OK (article kept, boilerplate excluded)");
  pageServer.close();

  console.log("FIREFOX E2E: PASS");
  await cleanup();
  process.exit(0);
})().catch(async (e) => {
  console.error("FIREFOX E2E: FAIL:", e.message);
  try { await shot("/tmp/ff-failure.png"); } catch (e2) {}
  process.exit(1);
});
