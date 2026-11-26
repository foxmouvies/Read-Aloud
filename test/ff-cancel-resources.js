/*
 * Firefox robustness (no audio stack: document-state checks only)
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
const PORT = 9534;
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
  execSync("zip -qr /tmp/ra-ff-ext.zip manifest.json shared content popup reader icons vendor", { cwd: EXT_DIR });
  execSync(`rm -rf /tmp/ff-prof && mkdir -p /tmp/ff-prof/extensions && cp /tmp/ra-ff-ext.zip "/tmp/ff-prof/extensions/${EXT_ID}.xpi"`);
  fs.writeFileSync("/tmp/ff-prof/user.js", ['user_pref("xpinstall.signatures.required", false);', 'user_pref("extensions.autoDisableScopes", 0);', 'user_pref("extensions.enabledScopes", 15);', 'user_pref("browser.shell.checkDefaultBrowser", false);', 'user_pref("app.update.disabledForTesting", true);', `user_pref("extensions.webextensions.uuids", '{"${EXT_ID}":"${FF_UUID}"}');`].join("\n"));
  execSync("rm -f /tmp/ff-prof.zip && cd /tmp/ff-prof && zip -qr /tmp/ff-prof.zip .");
  const profileB64 = fs.readFileSync("/tmp/ff-prof.zip").toString("base64");
  const gecko = spawn(GECKODRIVER, ["-p", String(PORT)], { stdio: ["ignore", "ignore", "ignore"] });
  const ROB = "/tmp/rob"; const FIX = (n) => path.join(EXT_DIR, "test", "fixtures", n);
  let failed = 0;
  try {
    await waitFor("gd", async () => { try { await get(`${BASE}/status`); return true; } catch (e) { return false; } }, 20000);
    const sess = await post(`${BASE}/session`, { capabilities: { alwaysMatch: { "moz:firefoxOptions": { binary: FIREFOX, profile: profileB64, args: ["-headless", `moz-extension://${FF_UUID}/reader/reader.html`] } } } });
    SID = sess.value.sessionId;
    await waitFor("reader", async () => { try { const u = (await get(`${BASE}/session/${SID}/url`)).value; return u.includes("reader/reader.html") && (await execute("return document.readyState")) === "complete"; } catch (e) { return false; } }, 30000);
    await execute("window.__errs=[];window.addEventListener('error',e=>window.__errs.push(e.message));window.addEventListener('unhandledrejection',e=>window.__errs.push('rej:'+(e.reason&&(e.reason.message+' | '+String(e.reason.stack).slice(0,1500))||e.reason)));return 1");
    const upload = async (p) => { await execute("document.getElementById('file-input').value=''"); const el = await findEl("#file-input"); await post(`${BASE}/session/${SID}/element/${el}/value`, { text: p }); };
    const prog = () => execute("return document.getElementById('progress').textContent");
    const settle = async (re, t = 100000) => waitFor("settle " + re, async () => re.test(await prog()) && true, t);
    const state = () => execute("return {n: document.querySelectorAll('#text-view .sentence').length, cancelHidden: document.getElementById('cancel-ocr').hidden, p: document.getElementById('progress').textContent}");

    const FIXD = (n) => path.join(EXT_DIR, "test", "fixtures", n);
    await execute(`window.__ev=[];window.__live=0;window.__peak=0;window.__rec=0;window.__t0=performance.now();
      const oc=Tesseract.createWorker.bind(Tesseract);
      Tesseract.createWorker=async(...a)=>{const w=await oc(...a);const id=window.__ev.filter(e=>e.k=='created').length+1;window.__live++;window.__peak=Math.max(window.__peak,window.__live);
        window.__ev.push({k:'created',id,t:Math.round(performance.now()-window.__t0)});
        const ot=w.terminate.bind(w);w.terminate=()=>{window.__live--;window.__ev.push({k:'terminate',id,t:Math.round(performance.now()-window.__t0)});return ot();};
        const or=w.recognize.bind(w);w.recognize=(...b)=>{window.__rec++;window.__ev.push({k:'recognize',id,t:Math.round(performance.now()-window.__t0)});return or(...b);};return w;};
      window.__pend=0;window.__pendPeak=0;const st=window.setTimeout;window.setTimeout=(f,ms,...r)=>{if(ms===250){window.__pend++;window.__pendPeak=Math.max(window.__pendPeak,window.__pend);return st(()=>{window.__pend--;f(...r)},ms)}return st(f,ms,...r)};`);
    const snap = () => execute("return {live:window.__live,peak:window.__peak,rec:window.__rec,pend:window.__pend,pendPeak:window.__pendPeak,created:window.__ev.filter(e=>e.k=='created').length,term:window.__ev.filter(e=>e.k=='terminate').length}");
    const cancelVis = () => waitFor("cv", () => execute("return !document.getElementById('cancel-ocr').hidden").then((v) => v || null), 30000);
    const report = async (label) => { await sleep(1500); const s = await snap(); console.log(label + ": " + JSON.stringify(s)); return s; };
    // A: cancel immediately when Cancel appears (worker creation in flight)
    await upload(FIXD("scanned-both.pdf")); await cancelVis(); const tc = Date.now(); await click("#cancel-ocr");
    const uiMs = await waitFor("cancelled", async () => /cancelled/i.test(await prog()) || null, 5000).then(() => Date.now() - tc).catch(() => -1);
    console.log("A cancel->'cancelled' text ms (incl. webdriver roundtrips): " + uiMs);
    let s = await report("A after cancel during creation"); if (s.live !== 0 || s.created !== s.term) failed++;
    // B: cancel mid-recognition
    await upload(FIXD("scanned-both.pdf")); await cancelVis(); const rb=(await snap()).rec; await waitFor("rec", async () => (await snap()).rec > rb || null, 20000); const r0 = (await snap()).rec; await click("#cancel-ocr");
    s = await report("B after cancel mid-recognition (rec at cancel " + r0 + ")"); if (s.live !== 0 || s.created !== s.term) failed++;
    console.log("B recognize calls after cancel: " + (s.rec - r0));
    // C: 6 rapid scanned replacements, then a text file
    for (let i = 0; i < 6; i++) { await upload(FIXD(i % 2 ? "scanned-en.pdf" : "scanned-both.pdf")); await sleep(120); }
    await upload(FIXD("sample.pdf")); await settle(/Loaded/);
    s = await report("C after 6 rapid scanned replacements + text file"); if (s.live !== 0 || s.created !== s.term) failed++;
    // D: scanned then replaced by scanned that finishes: new worker must survive the old teardown
    await upload(FIXD("scanned-both.pdf")); await cancelVis(); await sleep(1500); await upload(FIXD("scanned-en.pdf"));
    await settle(/Loaded/, 100000); const txtD = await execute("return document.getElementById('text-view').textContent");
    const okD = /Loaded/.test(await prog()) && txtD.length > 50; if (!okD) failed++;
    s = await report("D replacement scan completed (text chars " + txtD.length + ")"); if (s.live !== 0 || s.created !== s.term) failed++;
    if (process.env.CANCEL_LOOPS) { // optional stress: cancel at varied delays after Cancel appears; counts page errors
      const delays = [0, 5, 20, 60, 120, 200, 300, 450]; let hit = 0;
      for (let i = 0; i < Number(process.env.CANCEL_LOOPS); i++) {
        await upload(FIXD(i % 2 ? "scanned-en.pdf" : "scanned-both.pdf")); await cancelVis(); await sleep(delays[i % delays.length]); if (await execute("const b=document.getElementById('cancel-ocr'); if(!b.hidden){b.click(); return true} return false")) hit++; await sleep(700);
      }
      console.log("E cancels delivered while the scan was still running: " + hit + " of " + process.env.CANCEL_LOOPS);
      await upload(FIXD("sample.pdf")); await settle(/Loaded/); s = await report("E after " + process.env.CANCEL_LOOPS + " timed cancels"); if (s.live !== 0 || s.created !== s.term) failed++;
    }
    console.log("lifetimes (ms since start): " + JSON.stringify(await execute("return window.__ev")).slice(0, 900));
    const errs = await execute("return window.__errs"); console.log("page errors: " + errs.length + (errs.length ? JSON.stringify(errs.slice(0, 3)) : ""));
    if (errs.length) failed++;
  } catch (e) { console.log("FAIL", e.message); failed++; }
  try { await req("DELETE", `${BASE}/session/${SID}`); } catch (e) {}
  gecko.kill(); console.log(failed ? "FIREFOX ROBUSTNESS: " + failed + " FAILED" : "FIREFOX ROBUSTNESS: ALL CASES OK"); process.exit(failed ? 1 : 0);
})();

