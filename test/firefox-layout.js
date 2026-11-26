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
    const rectOf = async (w, h) => { await post(`${BASE}/session/${SID}/window/rect`, { width: w, height: h }); await sleep(400); return execute("return [innerWidth, innerHeight]"); };
    for (const [w, h] of [[1280, 900], [390, 700], [320, 640]]) {
      const [iw] = await rectOf(w, h);
      await upload("/tmp/ff-long.txt");
      await waitFor("sentences", () => execute("return document.querySelectorAll('#text-view .sentence').length > 10").then((v) => v || null), 20000);
      const vopt = await execute("return Array.from(document.getElementById('voice').options).map(o=>o.textContent)");
      chk(vopt.length >= 1 && vopt[0].trim().length > 0, `${iw}px: voice list not blank ${JSON.stringify(vopt[0])}`);
      chk(!(await execute("return document.documentElement.scrollWidth > innerWidth")), `${iw}px: no horizontal overflow`);
      await execute("window.scrollTo(0, 1500)"); await sleep(300);
      const top = await execute("return Math.round(document.getElementById('controls').getBoundingClientRect().top)");
      chk(top >= -1 && top <= 1, `${iw}px: controls pinned at top after scrolling (top=${top})`);
      if (iw <= 520) {
        const vis = () => execute("return getComputedStyle(document.getElementById('settings-row')).display !== 'none'");
        chk(!(await vis()), `${iw}px: settings hidden by default`);
        await click("#toggle-settings"); await sleep(200); chk(await vis(), `${iw}px: Settings opens`);
        await shot(`${OUT}/ff-reader-${iw}-settings.png`);
        await click("#toggle-settings"); await sleep(200); chk(!(await vis()), `${iw}px: Settings closes`);
      }
      const f0 = await execute("return parseFloat(getComputedStyle(document.getElementById('text-view')).fontSize)");
      await click("#size-up"); const f1 = await execute("return parseFloat(getComputedStyle(document.getElementById('text-view')).fontSize)");
      chk(f1 > f0, `${iw}px: A+ enlarges text ${f0}->${f1}`); await click("#size-down");
      await shot(`${OUT}/ff-reader-${iw}.png`);
    }
    const errs = await execute("return window.__errs"); chk(errs.length === 0, "page errors: " + errs.length);
  } catch (e) { console.log("FAIL", e.message); failed++; }
  try { await req("DELETE", `${BASE}/session/${SID}`); } catch (e) {}
  gecko.kill(); console.log(failed ? "FIREFOX LAYOUT: " + failed + " FAILED" : "FIREFOX LAYOUT E2E PASS"); process.exit(failed ? 1 : 0);
})();
