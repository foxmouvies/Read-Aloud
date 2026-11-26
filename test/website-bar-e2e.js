/* Website reader (on-page control bar), Chromium, MOCK speech (not real audio): bar fits a phone-size viewport,
 * shows a visible language selector defaulting to English, switching language works when a voice exists and is
 * refused with a notice when it does not. Also checks the popup's default language is English. */
const fs = require("node:fs"), os = require("node:os"), path = require("node:path"), http = require("node:http");
const puppeteer = require("puppeteer-core");
const EXT = path.resolve(__dirname, "..");
const CHROME = process.env.E2E_BROWSER || require("node:child_process").execSync("ls -d " + os.homedir() + "/chromium/linux-*/chrome-linux/chrome").toString().trim();
function extId(dir) { const m = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8")); const hex = require("node:crypto").createHash("sha256").update(Buffer.from(m.key, "base64")).digest("hex").slice(0, 32); return hex.split("").map((c) => String.fromCharCode(97 + parseInt(c, 16))).join(""); }
const para = "The harbour festival starts on Friday evening. Everyone is welcome at the pier and the music is free for all visitors. The lanterns float across the bay at night. ";
(async () => {
  const server = http.createServer((q, r) => { r.setHeader("content-type", "text/html; charset=utf-8"); if (q.url === "/nested") { r.end(`<html lang="en"><head><meta name="viewport" content="width=device-width"></head><body><div style="border:2px solid #888;padding:8px"><div style="border:2px solid #36c;padding:8px"><div style="border:2px solid #c63;padding:8px"><div style="border:2px solid #3a3;padding:8px">${para.repeat(2)}<div style="border:2px solid #a3a;padding:8px">${para.repeat(2)}<canvas>Canvas fallback silent.</canvas></div></div></div></div></div></body></html>`); return; }
    if (q.url === "/long") { r.end(`<html lang="en"><head><meta name="viewport" content="width=device-width"></head><body><article>${Array.from({ length: 14 }, (_, i) => "<p>Paragraph " + (i + 1) + ". " + para.repeat(3) + "</p>").join("")}</article></body></html>`); return; }
    r.end(`<html lang="en"><head><meta name="viewport" content="width=device-width"></head><body><article>${"<p>" + para.repeat(3) + "</p>".repeat(1)}${"<p>" + para.repeat(3) + "</p>"}</article></body></html>`); });
  await new Promise((r) => server.listen(0, "127.0.0.1", r)); const port = server.address().port;
  const dst = fs.mkdtempSync(path.join(os.tmpdir(), "ra-web-ext-"));
  for (const item of ["shared", "content", "popup", "reader", "icons", "vendor"]) fs.cpSync(path.join(EXT, item), path.join(dst, item), { recursive: true });
  fs.mkdirSync(path.join(dst, "test")); fs.copyFileSync(path.join(EXT, "test/fixtures/mock-speech.js"), path.join(dst, "test/mock-speech.js"));
  const mf = JSON.parse(fs.readFileSync(path.join(EXT, "manifest.json"), "utf8")); mf.host_permissions = ["http://*/*"]; fs.writeFileSync(path.join(dst, "manifest.json"), JSON.stringify(mf, null, 2));
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox", "--disable-gpu", "--disable-features=DisableLoadExtensionCommandLineSwitch", `--load-extension=${dst}`, "--disable-extensions-except=" + dst, `--user-data-dir=${fs.mkdtempSync(path.join(os.tmpdir(), "ra-web-prof-"))}`] });
  const id = extId(dst); let fail = 0; const chk = (c, m) => { console.log(c ? "  ok:" : "  FAIL:", m); if (!c) fail++; };
  const V = (n, l) => ({ name: n, lang: l, voiceURI: n, localService: true });
  const ext = await browser.newPage(); await ext.goto(`chrome-extension://${id}/popup/popup.html`);
  chk((await ext.$eval("#lang", (s) => s.value)) === "en-US", "popup language default is English (United States)");
  async function run(w, h, voices, route) {
    const p = await browser.newPage(); await p.setViewport({ width: w, height: h, isMobile: w < 600, hasTouch: w < 600, deviceScaleFactor: 2 });
    await p.goto(`http://127.0.0.1:${port}/${route || ""}`);
    const resp = await ext.evaluate(async (url, voices) => {
      const tab = (await chrome.tabs.query({})).reverse().find((t) => (t.url || "").includes(url));
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["/test/mock-speech.js"] });
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: (v) => { Object.defineProperty(window.speechSynthesis, "getVoices", { value: () => v, configurable: true }); }, args: [voices] });
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["/shared/store.js", "/shared/text.js", "/shared/tts-engine.js", "/content/read-page.js"] });
      return chrome.tabs.sendMessage(tab.id, { type: "READ_PAGE", rate: 1 });
    }, `127.0.0.1:${port}/${route || ""}`, voices);
    return { p, resp };
  }
  for (const [w, h] of [[360, 640], [320, 568], [1024, 768]]) {
    const { p, resp } = await run(w, h, [V("Eng", "en-US"), V("Fra", "fr-FR")]);
    chk(resp && resp.ok && resp.lang === "en-US", `${w}: no language sent -> reads in English (${resp && resp.lang})`);
    await p.waitForSelector("#readaloud-control-bar"); await new Promise((r) => setTimeout(r, 400));
    const m = await p.evaluate(() => { const b = document.getElementById("readaloud-control-bar").getBoundingClientRect(), s = document.getElementById("readaloud-lang"); const sr = s.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, bt: b.bottom, vw: innerWidth, vh: innerHeight, sel: s.value, sw: sr.width, sh: sr.height }; });
    chk(m.l >= 0 && m.r <= m.vw + 0.5 && m.bt <= m.vh + 0.5 && m.t >= 0, `${w}: bar fully inside viewport ${JSON.stringify(m)}`);
    chk(m.sel === "en-US" && m.sw > 30 && m.sh > 10, `${w}: language selector visible, English selected`);
    if (w === 360) {
      await p.screenshot({ path: path.join(process.env.OUT || os.tmpdir(), "website-bar-360.png") });
      await p.select("#readaloud-lang", "fr-FR"); await new Promise((r) => setTimeout(r, 500));
      chk((await p.$eval("#readaloud-lang", (s) => s.value)) === "fr-FR", "switch to French accepted (voice exists)");
      await p.select("#readaloud-lang", "ar-MA"); await new Promise((r) => setTimeout(r, 500));
      chk((await p.$eval("#readaloud-lang", (s) => s.value)) === "fr-FR", "Arabic refused (no Arabic voice): selection stays French");
      chk(await p.evaluate(() => [...document.querySelectorAll("[role=status]")].some((e) => /(No voice for|Only online voices are available for) Arabic/.test(e.textContent))), "notice says no Arabic voice");
      await p.screenshot({ path: path.join(process.env.OUT || os.tmpdir(), "website-bar-360-notice.png") });
      // Dispatch assertions (mock speech records the utterance's lang and voice; NOT audible voice proof).
      const log = () => p.evaluate(() => [...document.querySelectorAll("#__mock_speech_log span")].map((e) => ({ t: e.textContent, l: e.dataset.lang, v: e.dataset.voice })));
      const L0 = await log(); const n0 = L0.length;
      await p.select("#readaloud-lang", "ar-MA"); await new Promise((r) => setTimeout(r, 400));
      chk((await log()).length === n0, "rejected Arabic: no new utterance dispatched");
      chk((await log()).every((u, i) => i < L0.findIndex((x) => x.l === "fr-FR") || true) && !(await log()).some((u) => /ar|Ara/.test(u.l + u.v)), "no utterance ever used Arabic lang/voice");
      await p.select("#readaloud-lang", "en-US"); await new Promise((r) => setTimeout(r, 500));
      const L1 = await log(); const last = L1[L1.length - 1];
      chk(last.l === "en-US" && last.v === "Eng", `after switching to English: utterance lang=${last.l} voice=${last.v}`);
      chk(L1.slice(n0).length >= 1 && L1.slice(n0)[0].t === L0[n0 - 1].t, "language switch continues from the same sentence (first new utterance = last pre-switch sentence)");
      const frU = L0.filter((u) => u.l === "fr-FR"); chk(frU.length >= 1 && frU.every((u) => u.v === "Fra"), `French switch dispatched lang=fr-FR voice=Fra (${frU.length} utterance(s))`);
      chk(L0[0].l === "en-US" && L0[0].v === "Eng", `initial utterance lang=${L0[0].l} voice=${L0[0].v}`);
    }
    await p.close();
  }
  {
    const { p } = await run(360, 640, [V("Eng", "en-US")], "long");
    await p.waitForSelector("#readaloud-control-bar"); await new Promise((r) => setTimeout(r, 300));
    await p.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight)); await new Promise((r) => setTimeout(r, 300));
    const g = await p.evaluate(() => { const ps = document.querySelectorAll("article p"); const lastP = ps[ps.length - 1].getBoundingClientRect(); const bar = document.getElementById("readaloud-control-bar").getBoundingClientRect(); return { lastBottom: lastP.bottom, barTop: bar.top }; });
    chk(g.lastBottom <= g.barTop, `document end: last paragraph above the bar ${JSON.stringify(g)}`);
    await p.screenshot({ path: path.join(process.env.OUT || os.tmpdir(), "website-bar-docend.png") });
    await p.evaluate(() => document.getElementById("readaloud-control-bar").querySelector("button[aria-label=Stop]").click()); await new Promise((r) => setTimeout(r, 300));
    chk(await p.evaluate(() => document.documentElement.style.paddingBottom === ""), "padding removed after Stop");
  }
  {
    // Online-voice fallback: the privacy notice must already be on screen when the first utterance with the online voice is dispatched.
    const { p } = await run(360, 640, [V("Eng", "en-US"), { name: "FraOnline", lang: "fr-FR", voiceURI: "FraOnline", localService: false }]);
    await p.waitForSelector("#readaloud-control-bar"); await new Promise((r) => setTimeout(r, 300));
    // The content script lives in the extension's isolated world, so the speak hook is installed there too.
    const tabUrl = `127.0.0.1:${port}/`;
    await ext.evaluate(async (url) => { const tab = (await chrome.tabs.query({})).reverse().find((t) => (t.url || "").includes(url)); await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => { window.__log = []; const sp = speechSynthesis.speak.bind(speechSynthesis); speechSynthesis.speak = (u) => { window.__log.push({ voice: u.voice && u.voice.name, notice: [...document.querySelectorAll("[role=status]")].some((e) => /online voice/.test(e.textContent)) }); return sp(u); }; } }); }, tabUrl);
    await p.select("#readaloud-lang", "fr-FR"); await new Promise((r) => setTimeout(r, 600));
    const log = await ext.evaluate(async (url) => { const tab = (await chrome.tabs.query({})).reverse().find((t) => (t.url || "").includes(url)); return (await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => window.__log })) [0].result; }, tabUrl);
    const first = log.find((e) => e.voice === "FraOnline");
    chk(!!first && first.notice === true, `online fallback: notice present before first online-voice utterance is dispatched (mock speech, dispatch only; provider transmission not observable) ${JSON.stringify(log.slice(0, 3))}`);
  }
  {
    const { p, resp } = await run(360, 640, [V("Eng", "en-US"), V("Fra", "fr-FR")], "nested");
    chk(resp && resp.ok && resp.sentences >= 2, `nested boxes: page read (${resp && resp.sentences} sentences)`);
    await p.waitForSelector("#readaloud-control-bar"); await new Promise((r) => setTimeout(r, 300));
    await p.screenshot({ path: path.join(process.env.OUT || os.tmpdir(), "website-bar-nested.png") });
    for (let i = 0; i < 6; i++) { await p.evaluate((i) => { const b = document.getElementById("readaloud-control-bar"); const s = b.querySelector("#readaloud-lang"); s.value = i % 2 ? "en-US" : "fr-FR"; s.dispatchEvent(new Event("change", { bubbles: true })); const pb = b.querySelector("button[aria-label=Pause]") || b.querySelector("button[aria-label=Play]"); if (pb) pb.click(); }, i); }
    await new Promise((r) => setTimeout(r, 500));
    const m = await p.evaluate(() => { const b = document.getElementById("readaloud-control-bar"); return { bars: document.querySelectorAll("#readaloud-control-bar").length, ok: !!b && b.getBoundingClientRect().right <= innerWidth + 0.5 }; });
    chk(m.bars === 1 && m.ok, `rapid language/pause toggling: one bar, inside viewport ${JSON.stringify(m)}`);
    await p.screenshot({ path: path.join(process.env.OUT || os.tmpdir(), "website-bar-nested-rapid.png") });
  }
  await browser.close(); console.log(fail ? "WEBSITE BAR: " + fail + " FAILED" : "WEBSITE BAR E2E PASS (mock speech)"); process.exit(fail ? 1 : 0);
})().catch((e) => { console.log("FAIL", e.message); process.exit(2); });
