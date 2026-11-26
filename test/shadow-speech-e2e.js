/* "Read this page" on a page whose article lives in an open shadow root (Chromium/Brave): the page's injected
 * content script extracts it and queues it to the speech engine. MOCK speech (queueing only, not audio). Test
 * build adds host_permissions to stand in for the activeTab grant. No block highlight for shadow text (limit). */
const fs = require("node:fs"), os = require("node:os"), path = require("node:path"), http = require("node:http");
const puppeteer = require("puppeteer-core");
const EXT_DIR = path.resolve(__dirname, "..");
const CHROME = process.env.E2E_BROWSER || require("node:child_process").execSync("ls -d " + os.homedir() + "/chromium/linux-*/chrome-linux/chrome").toString().trim();
const S = ["The harbour festival starts on Friday evening at the pier near the old lighthouse.", "Musicians will play until midnight and the food stalls stay open all night.", "The last bus leaves the square ten minutes after the final song ends."];
const HTML = `<!doctype html><html><body><x-article></x-article><x-nav class="sidebar"></x-nav><script>
document.querySelector("x-article").attachShadow({mode:"open"}).innerHTML=${JSON.stringify("<h1>Festival</h1>" + S.map((p) => "<p>" + p + "</p>").join(""))};
document.querySelector("x-nav").attachShadow({mode:"open"}).innerHTML="<p>Sidebar promo text that must stay silent here.</p>";</script></body></html>`;
(async () => {
  const srv = http.createServer((q, r) => { r.setHeader("content-type", "text/html; charset=utf-8"); r.end(HTML); }); await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const URL_ = `http://127.0.0.1:${srv.address().port}/`;
  const dst = fs.mkdtempSync(path.join(os.tmpdir(), "ra-shs-ext-"));
  for (const item of ["shared", "content", "popup", "reader", "icons", "vendor", "test/fixtures"]) fs.cpSync(path.join(EXT_DIR, item), path.join(dst, item), { recursive: true });
  const m = JSON.parse(fs.readFileSync(path.join(EXT_DIR, "manifest.json"), "utf8")); m.host_permissions = ["http://*/*"]; fs.writeFileSync(path.join(dst, "manifest.json"), JSON.stringify(m, null, 2));
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox", "--disable-gpu", "--disable-features=DisableLoadExtensionCommandLineSwitch", `--load-extension=${dst}`, "--disable-extensions-except=" + dst, `--user-data-dir=${fs.mkdtempSync(path.join(os.tmpdir(), "ra-shs-prof-"))}`] });
  let fail = 0; const chk = (c, m2) => { console.log(c ? "  ok:" : "  FAIL:", m2); if (!c) fail++; };
  const page = await browser.newPage(); await page.goto(URL_);
  const expr = `(async () => { const tab = (await chrome.tabs.query({ url: ${JSON.stringify(URL_ + "*")} }))[0];
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["/shared/store.js", "/shared/text.js", "/shared/tts-engine.js", "/content/read-page.js"] });
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["/test/fixtures/mock-speech.js"] });
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => { document.documentElement.setAttribute("data-mock-auto-end", "5"); Object.defineProperty(window.speechSynthesis, "getVoices", { value: () => [{ name: "Eng", lang: "en-US", voiceURI: "Eng", localService: true, default: false }] }); } });
    const r = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => window.__readAloudMessage({ type: "READ_PAGE", rate: 1 }) });
    return JSON.stringify(r[0].result); })()`;
  let r, lastErr;
  for (let k = 0; k < 4 && !r; k++) {
    try {
      const t = await browser.waitForTarget((x) => x.type() === "service_worker" && x.url().includes("shared/background.js"), { timeout: 20000 });
      const c = await t.createCDPSession(); await c.send("Runtime.enable");
      r = await c.send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
    } catch (e) { lastErr = e; r = null; await new Promise((r2) => setTimeout(r2, 800)); }
  }
  if (!r) throw lastErr;
  if (r.exceptionDetails) { console.log("FAIL worker exception", r.exceptionDetails.exception && r.exceptionDetails.exception.description); process.exit(1); }
  console.log("READ_PAGE response:", r.result.value);
  await new Promise((r2) => setTimeout(r2, 900));
  const spoken = await page.evaluate(() => Array.from(document.querySelectorAll("#__mock_speech_log span")).map((x) => x.textContent));
  const text = spoken.join(" ");
  console.log("spoken:", JSON.stringify(spoken));
  chk(S.every((s) => text.includes(s.slice(0, 30))), "all three shadow-root sentences are queued to the speech engine");
  chk(!text.includes("Sidebar promo"), "shadow host with a boilerplate class stays silent");
  console.log(fail ? "SHADOW SPEECH E2E FAIL" : "SHADOW SPEECH E2E PASS"); await browser.close(); srv.close(); process.exit(fail ? 1 : 0);
})().catch((e) => { console.log("FAIL", e.message); process.exit(1); });
