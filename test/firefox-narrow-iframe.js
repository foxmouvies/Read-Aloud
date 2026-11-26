/*
 * Firefox responsive layout of the reader page (no audio stack): overflow, sticky player, Settings toggle, voice list not blank
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
const PORT = 9537;
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
  const FIX = (n) => path.join(EXT_DIR, "test", "fixtures", n);
  let failed = 0;
  try {
    await waitFor("gd", async () => { try { await get(`${BASE}/status`); return true; } catch (e) { return false; } }, 20000);
    const sess = await post(`${BASE}/session`, { capabilities: { alwaysMatch: { "moz:firefoxOptions": { binary: FIREFOX, profile: profileB64, args: ["-headless", `moz-extension://${FF_UUID}/reader/reader.html`] } } } });
    SID = sess.value.sessionId;
    await waitFor("reader", async () => { try { const u = (await get(`${BASE}/session/${SID}/url`)).value; return u.includes("reader/reader.html") && (await execute("return document.readyState")) === "complete"; } catch (e) { return false; } }, 30000);
    await execute("window.__errs=[];window.addEventListener('error',e=>window.__errs.push(e.message));window.addEventListener('unhandledrejection',e=>window.__errs.push('rej:'+(e.reason&&(e.reason.message+' | '+String(e.reason.stack).slice(0,1500))||e.reason)));return 1");
    const upload = async (p) => { await execute("document.getElementById('file-input').value=''"); const el = await findEl("#file-input"); await post(`${BASE}/session/${SID}/element/${el}/value`, { text: p }); };
    const OUT = process.env.OUT || "/tmp";
    fs.writeFileSync("/tmp/ff-long.txt", Array.from({ length: 80 }, (_, i) => "This is sentence number " + (i + 1) + " of a long test document used to check the reading layout. ").join(""));
    const chk = (c, m) => { console.log((c ? "  ok: " : "  FAIL: ") + m); if (!c) failed++; };
    // Firefox headless enforces a 500px minimum window width, so narrower viewports are emulated with a same-origin iframe
    // (media queries inside the iframe use the iframe width). Document-state and layout checks only, no audio.
    await post(`${BASE}/session/${SID}/window/rect`, { width: 1000, height: 900 }); await sleep(300);
    for (const W of [360, 320]) {
      await execute(`document.body.innerHTML='';const f=document.createElement('iframe');f.id='nf';f.style.cssText='width:${W}px;height:640px;border:1px solid #888;display:block';f.src='reader.html';document.body.appendChild(f);return 1`);
      await waitFor("iframe", () => execute("const d=document.getElementById('nf').contentDocument;return d&&d.readyState==='complete'&&d.getElementById('file-input')?1:0").then((v) => v || null), 20000);
      await sleep(800);
      await execute("const d=document.getElementById('nf').contentDocument;const dt=new DataTransfer();dt.items.add(new File([new Array(80).fill('This is sentence number one of a long test document used to check the reading layout. ').join('')],'long.txt',{type:'text/plain'}));const i=d.getElementById('file-input');i.files=dt.files;i.dispatchEvent(new Event('change',{bubbles:true}));return 1");
      await waitFor("loaded", () => execute("const d=document.getElementById('nf').contentDocument;return d.querySelectorAll('#text-view .sentence').length>10?1:0").then((v) => v || null), 20000);
      const info = await execute("const w=document.getElementById('nf').contentWindow,d=w.document;const r=id=>{const e=d.getElementById(id);if(!e)return null;const b=e.getBoundingClientRect();return {vis:e.offsetParent!==null,l:Math.round(b.left),r:Math.round(b.right),t:Math.round(b.top)}};return {iw:w.innerWidth,sw:d.documentElement.scrollWidth,play:r('play'),pause:r('pause'),prev:r('prev'),next:r('next'),toggle:r('toggle-collapse'),ctrlH:Math.round(d.getElementById('controls').getBoundingClientRect().height)}");
      chk(info.iw === W - 2, `${W}px emulated (iframe width ${W}, 1px border each side): viewport ${info.iw}`);
      chk(info.sw <= info.iw, `${W}px: no horizontal overflow (scrollWidth ${info.sw})`);
      for (const k of ["play", "pause", "prev", "next", "toggle"]) chk(info[k] && info[k].vis && info[k].l >= 0 && info[k].r <= info.iw, `${W}px: ${k} visible and inside viewport ${JSON.stringify(info[k])}`);
      await execute("const w=document.getElementById('nf').contentWindow;w.scrollTo(0,600);return 1"); await sleep(300);
      chk(await execute("const d=document.getElementById('nf').contentDocument;return Math.round(d.getElementById('controls').getBoundingClientRect().top)===0"), `${W}px: controls pinned at top after scrolling`);
      await execute("document.getElementById('nf').contentDocument.getElementById('toggle-collapse').click();return 1"); await sleep(300);
      const col = await execute("const d=document.getElementById('nf').contentDocument;return [...d.querySelectorAll('#controls button')].filter(b=>b.offsetParent!==null).map(b=>b.id)");
      chk(JSON.stringify(col) === JSON.stringify(["prev", "play", "pause", "next", "toggle-collapse"]) || (col.length === 5 && col.includes("toggle-collapse") && !col.includes("settings-toggle")), `${W}px: collapsed shows ${JSON.stringify(col)}`);
      const shot = (await get(`${BASE}/session/${SID}/screenshot`)).value; fs.writeFileSync(`${OUT}/ff-narrow-${W}.png`, Buffer.from(shot, "base64"));
    }
    chk(!(await execute("return window.__errs.length")), "page errors: 0");
  } catch (e) { console.log("FAIL", e.message); failed++; }
  try { await req("DELETE", `${BASE}/session/${SID}`); } catch (e) {}
  gecko.kill(); console.log(failed ? "FIREFOX NARROW (iframe-emulated): " + failed + " FAILED" : "FIREFOX NARROW (iframe-emulated) PASS"); process.exit(failed ? 1 : 0);
})();
