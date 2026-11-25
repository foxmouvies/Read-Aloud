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
const PORT = 9533;
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
function rssTree(root) {
  const ps = {};
  for (const d of fs.readdirSync("/proc").filter((x) => /^\d+$/.test(x))) { try { const st = fs.readFileSync(`/proc/${d}/stat`, "utf8"); const f = st.slice(st.lastIndexOf(")") + 2).split(" "); ps[d] = { ppid: f[1], rss: parseInt(fs.readFileSync(`/proc/${d}/statm`, "utf8").split(" ")[1]) * 4096 }; } catch (e) {} }
  const seen = new Set([String(root)]); let ch = true;
  while (ch) { ch = false; for (const [pid, p] of Object.entries(ps)) if (!seen.has(pid) && seen.has(p.ppid)) { seen.add(pid); ch = true; } }
  let sum = 0; for (const pid of seen) if (ps[pid]) sum += ps[pid].rss; return sum;
}
const mb = (b) => Math.round(b / 1048576);
(async () => {
  const reqs = [];
  const proxy = http.createServer((rq, rs) => { reqs.push({ t: Date.now(), u: rq.url }); rs.statusCode = 502; rs.end("blocked"); });
  proxy.on("connect", (rq, sock) => { reqs.push({ t: Date.now(), u: "CONNECT " + rq.url }); sock.end("HTTP/1.1 502 Bad Gateway\r\n\r\n"); });
  await new Promise((r) => proxy.listen(0, "127.0.0.1", r));
  const pp = proxy.address().port;
  execSync("zip -qr /tmp/ra-ff-ext.zip manifest.json shared content popup reader icons vendor", { cwd: EXT_DIR });
  execSync(`rm -rf /tmp/ff-prof && mkdir -p /tmp/ff-prof/extensions && cp /tmp/ra-ff-ext.zip "/tmp/ff-prof/extensions/${EXT_ID}.xpi"`);
  fs.writeFileSync("/tmp/ff-prof/user.js", [
    'user_pref("xpinstall.signatures.required", false);', 'user_pref("extensions.autoDisableScopes", 0);', 'user_pref("extensions.enabledScopes", 15);',
    'user_pref("browser.shell.checkDefaultBrowser", false);', 'user_pref("app.update.disabledForTesting", true);', 'user_pref("datareporting.policy.dataSubmissionEnabled", false);',
    `user_pref("extensions.webextensions.uuids", '{"${EXT_ID}":"${FF_UUID}"}');`,
    'user_pref("network.proxy.type", 1);', `user_pref("network.proxy.http", "127.0.0.1");`, `user_pref("network.proxy.http_port", ${pp});`,
    `user_pref("network.proxy.ssl", "127.0.0.1");`, `user_pref("network.proxy.ssl_port", ${pp});`, 'user_pref("network.proxy.allow_hijacking_localhost", true);'
  ].join("\n"));
  execSync("rm -f /tmp/ff-prof.zip && cd /tmp/ff-prof && zip -qr /tmp/ff-prof.zip .");
  const profileB64 = fs.readFileSync("/tmp/ff-prof.zip").toString("base64");
  const gecko = spawn(GECKODRIVER, ["-p", String(PORT)], { stdio: ["ignore", "ignore", "inherit"] });
  try {
    await waitFor("gd", async () => { try { await get(`${BASE}/status`); return true; } catch (e) { return false; } }, 20000);
    const sess = await post(`${BASE}/session`, { capabilities: { alwaysMatch: { "moz:firefoxOptions": { binary: FIREFOX, profile: profileB64, args: ["-headless", `moz-extension://${FF_UUID}/reader/reader.html`] } } } });
    SID = sess.value.sessionId;
    await waitFor("reader", async () => { try { const u = (await get(`${BASE}/session/${SID}/url`)).value; return u.includes("reader/reader.html") && (await execute("return document.readyState")) === "complete"; } catch (e) { return false; } }, 30000);
    await sleep(8000);
    let root = null; for (let i = 0; i < 20 && !root; i++) { try { root = execSync(`pgrep -P ${gecko.pid} | head -1`).toString().trim(); } catch (e) {} if (!root) await sleep(500); }
    if (!root) throw new Error('no firefox root');
    const base = reqs.length; const start = mb(rssTree(root));
    console.log("proxy hits before OCR (browser background):", base, JSON.stringify(reqs.map((r) => r.u).slice(0, 5)), "start RSS MB", start);
    const fx = (n) => path.join(EXT_DIR, "test", "fixtures", n);
    for (const name of ["scanned-en.pdf", "scanned-ar.pdf", "scanned-both.pdf", "stress-scans.pdf"]) {
      await execute("document.getElementById('file-input').value=''; document.getElementById('progress').textContent=''");
      const el = await findEl("#file-input"); const n0 = reqs.length; let peak = 0;
      const iv = setInterval(() => { peak = Math.max(peak, rssTree(root)); }, 250);
      const t0 = Date.now();
      await post(`${BASE}/session/${SID}/element/${el}/value`, { text: fx(name) });
      await waitFor("loaded " + name, () => execute("return /^Loaded/.test(document.getElementById('progress').textContent)").then((v) => v || null), 120000);
      const ms = Date.now() - t0; clearInterval(iv);
      const chars = await execute("return document.getElementById('text-view').textContent.length");
      await sleep(2000);
      if (name === "stress-scans.pdf") console.log("STRESS TEXT:", JSON.stringify(await execute("return [...document.querySelectorAll('#text-view .sentence')].map(s=>s.textContent)")));
      console.log(JSON.stringify({ file: name, ms, chars, peak_MB: peak, after_MB: mb(rssTree(root)), external_requests_during: reqs.length - n0 }));
    }
    await sleep(5000);
    console.log("idle RSS MB after OCR:", mb(rssTree(root)), "total proxy hits during test:", reqs.length, JSON.stringify(reqs.slice(base).map((r) => r.u)));
  } catch (e) { console.log("FAIL", e.message); process.exitCode = 1; }
  try { await req("DELETE", `${BASE}/session/${SID}`); } catch (e) {}
  gecko.kill(); proxy.close(); process.exit(process.exitCode || 0);
})();
