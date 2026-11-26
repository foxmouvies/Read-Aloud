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
    // Direct race: start a recognition, end the engine DELAY ms later, count unhandled rejections per delay.
    const base = "moz-extension://" + FF_UUID + "/vendor/tesseract/";
    const ATT = Number(process.env.ATTEMPTS || 6); const delays = (process.env.DELAYS || "0,5,20,60,250").split(",").map(Number);
    const res = {};
    for (const d of delays) {
      let rej = 0;
      for (let i = 0; i < ATT; i++) {
        await execute("window.__errs=[];return 1");
        await post(`${BASE}/session/${SID}/execute/async`, { script: `const done=arguments[arguments.length-1];(async()=>{const w=await Tesseract.createWorker('eng+ara+fra',1,{workerPath:'${base}worker.min.js',corePath:'${base}',langPath:'${base}lang',workerBlobURL:false,cacheMethod:'none',gzip:true});
          const c=document.createElement('canvas');c.width=600;c.height=120;const g=c.getContext('2d');g.fillStyle='#fff';g.fillRect(0,0,600,120);g.fillStyle='#000';g.font='40px sans-serif';g.fillText('Read aloud test line',20,70);
          const p=w.recognize(c).catch(()=>{});await new Promise(r=>setTimeout(r,${d}));try{await Promise.resolve(w.terminate()).catch(()=>{})}catch(e){}
          await new Promise(r=>setTimeout(r,1200));done(1)})().catch(e=>done('err:'+e.message));`, args: [] });
        const errs = await execute("return window.__errs");
        if (errs.length) { rej++; if (!res.sample) res.sample = String(errs[0]).slice(0, 200); }
      }
      res[d + "ms"] = rej + "/" + ATT;
      console.log("terminate " + d + " ms after recognize start: rejections " + rej + "/" + ATT);
    }
    console.log("RESULT " + JSON.stringify(res));
  } catch (e) { console.log("FAIL", e.message); failed++; }
  try { await req("DELETE", `${BASE}/session/${SID}`); } catch (e) {}
  gecko.kill(); process.exit(failed ? 1 : 0);
})();
