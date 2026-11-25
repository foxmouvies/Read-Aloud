/* Toolbar page/selection reading language (Chromium/Brave). Drives the same
 * message protocol the popup sends (READ_PAGE / READ_SELECTION with lang) from
 * an extension page, with MOCK speech and a configurable voice list. Not a
 * physical toolbar click. Also screenshots the real popup page. */
const assert = require("node:assert"), fs = require("node:fs"), os = require("node:os"), path = require("node:path"), http = require("node:http");
const puppeteer = require("puppeteer-core");
const EXT_DIR = path.resolve(__dirname, "..");
const CHROME = process.env.E2E_BROWSER || require("node:child_process").execSync("ls -d " + os.homedir() + "/chromium/linux-*/chrome-linux/chrome").toString().trim();
function extId(dir) { const m = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8")); const hex = require("node:crypto").createHash("sha256").update(Buffer.from(m.key, "base64")).digest("hex").slice(0, 32); return hex.split("").map((c) => String.fromCharCode(97 + parseInt(c, 16))).join(""); }
const PAGES = {
  en: "The harbour festival starts on Friday evening. Everyone is welcome at the pier and the music is free for all visitors. The lanterns float across the bay at night.",
  fr: "Le festival du port commence vendredi soir. Nous vous attendons tous à côté du café de la gare. Les enfants dansent près de la jetée et les musiciens jouent pour tout le monde.",
  ar: "مرحبا بكم في مهرجان الفوانيس عند الميناء. يبدأ العرض في الساعة السابعة مساء. الدخول مجاني للجميع في الميناء الكبير."
};
(async () => {
  const server = http.createServer((q, r) => { const k = q.url.slice(1, 3); r.setHeader("content-type", "text/html; charset=utf-8"); r.end(`<html lang="en"><body><article><p>${PAGES[k] || ""}</p><p>${PAGES[k] || ""}</p></article></body></html>`); });
  await new Promise((r) => server.listen(0, "127.0.0.1", r)); const port = server.address().port;
  const dst = fs.mkdtempSync(path.join(os.tmpdir(), "ra-pop-ext-"));
  for (const item of ["shared", "content", "popup", "reader", "icons", "vendor"]) fs.cpSync(path.join(EXT_DIR, item), path.join(dst, item), { recursive: true });
  fs.mkdirSync(path.join(dst, "test")); fs.copyFileSync(path.join(EXT_DIR, "test/fixtures/mock-speech.js"), path.join(dst, "test/mock-speech.js"));
  const mf = JSON.parse(fs.readFileSync(path.join(EXT_DIR, "manifest.json"), "utf8")); mf.host_permissions = ["http://*/*", "https://*/*"]; // test copy only; shipped manifest unchanged
  fs.writeFileSync(path.join(dst, "manifest.json"), JSON.stringify(mf, null, 2));
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox", "--disable-gpu", "--disable-features=DisableLoadExtensionCommandLineSwitch", `--load-extension=${dst}`, "--disable-extensions-except=" + dst, `--user-data-dir=${fs.mkdtempSync(path.join(os.tmpdir(), "ra-pop-prof-"))}`] });
  const id = extId(dst);
  const V = (n, l) => ({ name: n, lang: l, voiceURI: n, localService: true });
  const ALL = [V("Eng", "en-US"), V("Ara", "ar-MA"), V("Fra", "fr-FR")];
  const ext = await browser.newPage(); await ext.goto(`chrome-extension://${id}/reader/reader.html`);
  let fail = 0; const chk = (c, m) => { if (!c) { fail++; console.log("  FAIL:", m); } };
  async function read(pageKey, voices, msg) {
    const p = await browser.newPage(); await p.goto(`http://127.0.0.1:${port}/${pageKey}`);
    const resp = await ext.evaluate(async (url, voices, msg) => {
      const tab = (await chrome.tabs.query({})).find((t) => (t.url || "").includes(url));
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["/test/mock-speech.js"] });
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: (v) => { Object.defineProperty(window.speechSynthesis, "getVoices", { value: () => v, configurable: true }); }, args: [voices] });
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["/shared/store.js", "/shared/text.js", "/shared/tts-engine.js", "/content/read-page.js"] });
      return chrome.tabs.sendMessage(tab.id, msg);
    }, `127.0.0.1:${port}/${pageKey}`, voices, msg);
    await ext.evaluate(async (url) => { const tab = (await chrome.tabs.query({})).find((t) => (t.url || "").includes(url)); try { await chrome.tabs.sendMessage(tab.id, { type: "STOP" }); } catch (e) {} }, `127.0.0.1:${port}/${pageKey}`);
    await p.close(); return resp;
  }
  const show = (l, r) => console.log(l, JSON.stringify(r));
  let r = await read("fr", ALL, { type: "READ_PAGE", rate: 1, lang: "auto" }); show("auto, French page, all voices:", r); chk(r.ok && r.lang === "fr-FR" && r.detected, "auto -> fr-FR");
  r = await read("ar", ALL, { type: "READ_PAGE", rate: 1, lang: "auto" }); show("auto, Arabic page:", r); chk(r.ok && r.lang === "ar-MA", "auto -> ar-MA");
  r = await read("en", ALL, { type: "READ_PAGE", rate: 1, lang: "auto" }); show("auto, English page:", r); chk(r.ok && r.lang === "en-US", "auto -> en-US");
  r = await read("fr", ALL, { type: "READ_PAGE", rate: 1, lang: "en-US" }); show("manual English on French page:", r); chk(r.ok && r.lang === "en-US" && !r.detected, "manual choice wins");
  r = await read("fr", ALL, { type: "READ_PAGE", rate: 1, lang: "fr-FR" }); show("manual French:", r); chk(r.ok && r.lang === "fr-FR" && !r.detected, "manual French");
  r = await read("fr", [V("Eng", "en-US"), V("ArSA", "ar-SA")], { type: "READ_PAGE", rate: 1, lang: "auto" }); show("auto French, no French voice:", r); chk(!r.ok && r.reason === "no-lang-voice" && /ar-SA/.test(r.installed), "unavailable, nothing substituted, installed list");
  r = await read("ar", [V("Eng", "en-US"), V("ArSA", "ar-SA")], { type: "READ_PAGE", rate: 1, lang: "auto" }); show("auto Arabic, only ar-SA:", r); chk(!r.ok && r.reason === "no-lang-voice", "ar-SA not substituted for ar-MA");
  r = await read("en", ALL, { type: "READ_PAGE", rate: 1 }); show("no lang in message (old callers):", r); chk(r.ok && r.lang === "en-US", "default stays English (United States)");
  // popup UI proof
  const pop = await browser.newPage(); await pop.setViewport({ width: 360, height: 420 }); await pop.goto(`chrome-extension://${id}/popup/popup.html`);
  const opts = await pop.evaluate(() => [...document.querySelectorAll("#lang option")].map((o) => o.value + "=" + o.textContent));
  console.log("popup options:", JSON.stringify(opts)); chk(opts.length === 4, "popup has 4 language options");
  if (process.env.SHOT) await pop.screenshot({ path: process.env.SHOT });
  console.log(fail ? "POPUP LANGUAGE E2E FAIL" : "POPUP LANGUAGE E2E PASS"); await browser.close(); server.close(); process.exit(fail ? 1 : 0);
})().catch((e) => { console.log("FAIL", e.message); process.exit(1); });
