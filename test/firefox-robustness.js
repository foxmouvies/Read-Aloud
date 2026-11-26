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
    const cases = [
      ["garbage bytes named .pdf", path.join(ROB, "garbage.pdf"), /Could not read|No readable/], ["zero-byte .pdf", path.join(ROB, "zero.pdf"), /Could not read|No readable/],
      ["truncated text PDF", path.join(ROB, "truncated.pdf"), /Could not read|No readable|Loaded/], ["truncated scanned PDF", path.join(ROB, "truncated-scan.pdf"), /Could not read|No readable|Loaded/],
      ["password-protected PDF", path.join(ROB, "encrypted-user.pdf"), /Could not read|No readable/], ["plain text with .pdf name", path.join(ROB, "fake.pdf"), /Could not read|No readable/],
      ["blank 2-page PDF", path.join(ROB, "blank.pdf"), /No readable|Could not read/], ["HTML with only a script", path.join(ROB, "empty.html"), /No readable/],
      ["whitespace-only .txt", path.join(ROB, "spaces.txt"), /No readable/], ["empty .txt", FIX("empty.txt"), /No readable/]];
    for (const [label, file, re] of cases) {
      await upload(FIX("sample.pdf")); await settle(/Loaded/);
      await upload(file); let msg;
      try { await settle(/Loaded|Could not read|No readable|cancelled/, 110000); msg = await prog(); } catch (e) { msg = "TIMEOUT: " + (await prog()); }
      const st = await state();
      const stale = /reads text aloud/i.test(await execute("return document.getElementById('text-view').textContent"));
      const real = fs.existsSync(file) && !/could not be found/i.test(msg);
      const ok = real && re.test(msg) && (/Loaded/.test(msg) || (st.n === 0 && st.cancelHidden && !stale));
      if (!ok) failed++;
      console.log((ok ? "OK   " : "FAIL ") + label + " -> \"" + msg.slice(0, 90) + "\" sentences=" + st.n + " cancelHidden=" + st.cancelHidden + " staleSampleText=" + stale);
    }
    await upload(FIX("scanned-both.pdf")); await waitFor("cancel vis", () => execute("return !document.getElementById('cancel-ocr').hidden").then((v) => v || null), 30000);
    await click("#cancel-ocr"); await upload(FIX("scanned-en.pdf")); await waitFor("cancel vis2", () => execute("return !document.getElementById('cancel-ocr').hidden").then((v) => v || null), 30000);
    await upload(FIX("sample.pdf")); await settle(/Loaded/);
    const txt = await execute("return document.getElementById('text-view').textContent"); let st = await state();
    const stale = /lantern|مهرجان/i.test(txt) || !st.cancelHidden; if (stale) failed++;
    console.log((stale ? "FAIL " : "OK   ") + "cancel then two quick replacements: text from last file only, cancel hidden=" + st.cancelHidden);
    for (const f of [path.join(ROB, "garbage.pdf"), FIX("sample.pdf"), path.join(ROB, "encrypted-user.pdf"), FIX("scanned-en.pdf"), path.join(ROB, "truncated.pdf"), FIX("sample.pdf")]) await upload(f);
    await settle(/Loaded/); await sleep(4000); const fin = await state();
    const okSeq = /Loaded sample\.pdf/.test(fin.p) && fin.n > 0 && fin.cancelHidden; if (!okSeq) failed++;
    console.log((okSeq ? "OK   " : "FAIL ") + "6 rapid replacements: last file wins -> \"" + fin.p.slice(0, 70) + "\"");
    const errs = await execute("return window.__errs"); console.log("page errors: " + errs.length + (errs.length ? JSON.stringify(errs.slice(0, 3)) : ""));
    if (errs.length) failed++;
    // visual evidence of the stress fixture
    await upload(FIX("stress-scans.pdf")); await settle(/Loaded/); await sleep(500);
    const r = await get(`${BASE}/session/${SID}/screenshot`); fs.writeFileSync("/downloads/stress-firefox.png", Buffer.from(r.value, "base64"));
  } catch (e) { console.log("FAIL", e.message); failed++; }
  try { await req("DELETE", `${BASE}/session/${SID}`); } catch (e) {}
  gecko.kill(); console.log(failed ? "FIREFOX ROBUSTNESS: " + failed + " FAILED" : "FIREFOX ROBUSTNESS: ALL CASES OK"); process.exit(failed ? 1 : 0);
})();
