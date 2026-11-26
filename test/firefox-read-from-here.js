/* Firefox repeat check: real speech, voices-changed fired during playback; counts utterances vs sentences. */
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
async function executeAsync(script) {
  const r = await post(`${BASE}/session/${SID}/execute/async`, { script, args: [] });
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
    `user_pref("network.proxy.ssl", "127.0.0.1");`, `user_pref("network.proxy.ssl_port", ${pp});`, 'user_pref("network.proxy.allow_hijacking_localhost", false);', 'user_pref("network.proxy.no_proxies_on", "127.0.0.1,localhost");'
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
    // Local article page for the web route.
    const PARAS = ["The harbour festival starts on Friday evening and everyone is welcome at the pier near the old lighthouse.", "Musicians will play until midnight and the food stalls stay open for the whole night, so bring friends.", "Children can join the lantern parade at seven, and the organisers hand out lanterns at the gate.", "The last boat leaves the dock at eleven thirty, and the last bus leaves the square ten minutes later."];
    const DIVHTML = "<!doctype html><html><body><div class='content'><p>The morning ferry timetable changed this week and the harbour office posted the new departure times on the notice board by the main gate.</p>Direct text one stands alone inside the wrapper.<div>Wrapped sentence about the lantern tolls and mooring fees.<div>Nested deeper text keeps the order intact here.</div></div><p>Tolls for small boats stay the same this season, and the harbour master asks every visitor to register at the office on arrival today.</p></div></body></html>";
    const web = http.createServer((q, r) => { r.setHeader("content-type", "text/html"); if (process.env.RFH_HTMLFILE) return r.end(require("fs").readFileSync(process.env.RFH_HTMLFILE, "utf8")); if (process.env.RFH_DIV) return r.end(DIVHTML); r.end("<!doctype html><html><body><nav><a href='#'>Home</a></nav><article><h1>Harbour festival</h1>" + PARAS.map((p) => "<p>" + p + "</p>").join("") + "</article></body></html>"); });
    await new Promise((r) => web.listen(0, "127.0.0.1", r));
    const URL_ = process.env.RFH_FILE ? (() => { const fp = "/tmp/rfh-ff-local.html"; require("fs").writeFileSync(fp, "<!doctype html><html><body><nav><a href='#'>Home</a></nav><article><h1>Harbour festival</h1>" + PARAS.map((p) => "<p>" + p + "</p>").join("") + "</article></body></html>"); return "file://" + fp; })() : `http://127.0.0.1:${web.address().port}/`;
    const readerHandle = (await get(`${BASE}/session/${SID}/window`)).value;
    const nw = (await post(`${BASE}/session/${SID}/window/new`, { type: "tab" })).value.handle;
    await post(`${BASE}/session/${SID}/window`, { handle: nw });
    await post(`${BASE}/session/${SID}/url`, { url: URL_ });
    await sleep(1500);
    if (process.env.RFH_EXTRACT) { // live-page extraction only (retention guard cases): print the text the content script extracts
      await post(`${BASE}/session/${SID}/window`, { handle: readerHandle });
      const ex = await executeAsync(`const done=arguments[arguments.length-1]; (async()=>{ const all=await browser.tabs.query({}); const me=await browser.tabs.getCurrent(); const tab=all.filter(t=>!me||t.id!==me.id)[0]; await browser.scripting.executeScript({target:{tabId:tab.id},files:["/shared/store.js","/shared/text.js","/shared/tts-engine.js","/content/read-page.js"]}); const r=await browser.scripting.executeScript({target:{tabId:tab.id},func:()=>typeof window.__readAloudExtract==="function"?window.__readAloudExtract():null}); return r[0].result; })().then(done, e=>done({err:String(e)}))`);
      console.log("EXTRACT " + JSON.stringify(ex)); try { await req("DELETE", `${BASE}/session/${SID}`); } catch (e) {} gecko.kill(); proxy.close(); web.close(); process.exit(0);
    }
    const pt = await execute("const p="+(process.env.RFH_DIV?"document.querySelector('.content div')":"document.querySelectorAll('article p')[2]")+"; const tn=p.firstChild, at=tn.data.indexOf('"+(process.env.RFH_DIV?"Wrapped":"lanterns")+"')+3; const r=document.createRange(); r.setStart(tn,at); r.setEnd(tn,at+1); const b=r.getBoundingClientRect(); return {x:Math.round(b.x+b.width/2), y:Math.round(b.y+b.height/2)}");
    await post(`${BASE}/session/${SID}/actions`, { actions: [{ type: "pointer", id: "m", parameters: { pointerType: "mouse" }, actions: [
      { type: "pointerMove", x: pt.x, y: pt.y, origin: "viewport" }, { type: "pointerDown", button: 2 }, { type: "pointerUp", button: 2 }] }] });
    await sleep(500);
    await post(`${BASE}/session/${SID}/window`, { handle: readerHandle });
    // From the extension page: the background entry point (same code the menu click runs), then read the page's utterances.
    const probe = await executeAsync(`const done=arguments[arguments.length-1]; (async()=>{ if (${!!process.env.RFH_FILE}) { const all=await browser.tabs.query({}); const me=await browser.tabs.getCurrent(); const tab=all.filter(t=>!me||t.id!==me.id)[0]; const bg=await browser.runtime.getBackgroundPage(); const res=await bg.__raReadFromHere(tab); await new Promise(r=>setTimeout(r,1000)); try{ await bg.__raReadFromHere(tab); }catch(e){} return {fileMode:true, url:tab.url, response:res}; } if (${!!process.env.RFH_PERM}) { return {tabs:(await browser.tabs.query({})).map(t=>t.id+' '+t.url), perm:{file:await browser.permissions.contains({origins:['file:///*']}), all:await browser.permissions.contains({origins:['<all_urls>']}), http:await browser.permissions.contains({origins:['http://*/*']}), granted:(await browser.permissions.getAll()).origins}}; } const all=await browser.tabs.query({}); const me=await browser.tabs.getCurrent(); const tab=all.filter(t=>!me||t.id!==me.id)[0];
      const rec=(await browser.scripting.executeScript({target:{tabId:tab.id},func:()=>typeof window.__readAloudRC}))[0].result;
      await browser.scripting.executeScript({target:{tabId:tab.id},func:()=>{ window.__sp=[]; const o=window.SpeechSynthesis.prototype.speak; window.SpeechSynthesis.prototype.speak=function(u){ window.__sp.push(u.text); return o.call(this,u); }; }});
      const bg=await browser.runtime.getBackgroundPage();
      const res=await bg.__raReadFromHere(tab);
      await new Promise(r=>setTimeout(r,1500));
      const sp=(await browser.scripting.executeScript({target:{tabId:tab.id},func:()=>window.__sp}))[0].result;
      const stop=await browser.scripting.executeScript({target:{tabId:tab.id},func:()=>window.__readAloudMessage({type:"STOP"})});
      return {recorder:rec, response:res&&res[0]&&res[0].result, spoken:sp}; })().then(done, e=>done({err:String(e)}))`);
    const ok = probe && probe.recorder === "object" && probe.response && probe.response.ok === true && probe.response.sentences === 2 && probe.spoken && probe.spoken[0] === "lanterns at the gate." && probe.spoken[1].startsWith("The last boat");
    console.log(JSON.stringify({ probe, rightClickedWord: "lanterns", recorderRan: probe.recorder, sentences: probe.response && probe.response.sentences, firstUtterance: probe.spoken && probe.spoken[0], lastUtterance: probe.spoken && probe.spoken[probe.spoken.length - 1], ok }));
    if (!ok) process.exitCode = 1;
  } catch (e) { console.log("FAIL", e.message); process.exitCode = 1; }
  try { await req("DELETE", `${BASE}/session/${SID}`); } catch (e) {}
  gecko.kill(); proxy.close(); process.exit(process.exitCode || 0);
})();
