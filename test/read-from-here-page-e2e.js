/* "Read from here" on a web page (Chromium/Brave): a REAL right-click (mouse button 2) on a word, then the
 * context-menu handler's entry point is called in the extension's service worker (a headless browser cannot
 * click a native menu item). MOCK speech with a stand-in en-US voice: queueing only, not audio.
 * Test build adds host_permissions to stand in for the activeTab grant that a real menu click gives. */
const fs = require("node:fs"), os = require("node:os"), path = require("node:path"), http = require("node:http");
const puppeteer = require("puppeteer-core");
const EXT_DIR = path.resolve(__dirname, "..");
const CHROME = process.env.E2E_BROWSER || require("node:child_process").execSync("ls -d " + os.homedir() + "/chromium/linux-*/chrome-linux/chrome").toString().trim();
const PARAS = ["The harbour festival starts on Friday evening and everyone is welcome at the pier near the old lighthouse.", "Musicians will play until midnight and the food stalls stay open for the whole night, so bring friends.", "Children can join the lantern parade at seven, and the organisers hand out lanterns at the gate.", "The last boat leaves the dock at eleven thirty, and the last bus leaves the square ten minutes later."];
const HTML = `<!doctype html><html><body><nav><a href="#">Home</a> <a href="#">News</a></nav><article><h1>Harbour festival</h1>${PARAS.map((p) => "<p>" + p + "</p>").join("")}</article><aside class="sidebar"><p>Sidebar promo text that should never be read from here.</p></aside></body></html>`;
(async () => {
  const P1 = "The morning ferry timetable changed this week and the harbour office posted the new departure times on the notice board by the main gate.", P2 = "Tolls for small boats stay the same this season, and the harbour master asks every visitor to register at the office on arrival today.";
  const HTML2 = `<!doctype html><html><body><div class="content"><p>${P1}</p>Direct text one stands alone inside the wrapper.<div>Wrapped sentence about the lantern tolls and mooring fees.<div>Nested deeper text keeps the order intact here.</div></div><p>${P2}</p></div></body></html>`;
  const HTMLAR = `<!doctype html><html lang="ar" dir="rtl"><body><div class="content"><p>ذهب الولد الصغير إلى المدرسة القديمة صباحا مع أصدقائه من الحي القريب من البحر والميناء الكبير.</p>وصل المعلم إلى الفصل بعد قليل وبدأ الدرس الأول عن تاريخ المدينة.<p>انتهى اليوم الدراسي عند الظهر وعاد الجميع إلى بيوتهم سعداء بما تعلموا في ذلك اليوم الطويل.</p></div></body></html>`;
  let PATH_ = "", INFO_ = null;
  const HTMLFR = `<!doctype html><html><body><article>${PARAS.map((p) => "<p>" + p + "</p>").join("")}<iframe id="f" srcdoc="<p>Text inside an embedded frame that must never be read from here.</p>" style="width:600px;height:80px"></iframe></article></body></html>`;
  const srv = http.createServer((q, r) => { r.setHeader("content-type", "text/html; charset=utf-8"); r.end(q.url === "/divs" ? HTML2 : q.url === "/ar" ? HTMLAR : q.url === "/frame" ? HTMLFR : HTML); }); await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const URL_ = `http://127.0.0.1:${srv.address().port}/`;
  const dst = fs.mkdtempSync(path.join(os.tmpdir(), "ra-rfh-ext-"));
  for (const item of ["shared", "content", "popup", "reader", "icons", "vendor", "test/fixtures"]) fs.cpSync(path.join(EXT_DIR, item), path.join(dst, item), { recursive: true });
  const m = JSON.parse(fs.readFileSync(path.join(EXT_DIR, "manifest.json"), "utf8")); m.host_permissions = ["http://*/*"]; fs.writeFileSync(path.join(dst, "manifest.json"), JSON.stringify(m, null, 2));
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox", "--disable-gpu", "--disable-features=DisableLoadExtensionCommandLineSwitch", `--load-extension=${dst}`, "--disable-extensions-except=" + dst, `--user-data-dir=${fs.mkdtempSync(path.join(os.tmpdir(), "ra-rfh-prof-"))}`] });
  // Evaluate in the extension's service worker over a raw CDP session (re-attaches if the worker restarted).
  const sw = { async evaluate(fn, arg) {
    let err;
    for (let k = 0; k < 4; k++) {
      try {
        const t = await browser.waitForTarget((x) => x.type() === "service_worker" && x.url().includes("shared/background.js"), { timeout: 20000 });
        const c = await t.createCDPSession(); await c.send("Runtime.enable");
        const r = await c.send("Runtime.evaluate", { expression: `(${fn.toString()})(${JSON.stringify(arg)})`, awaitPromise: true, returnByValue: true });
        await c.detach().catch(() => {});
        if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception && r.exceptionDetails.exception.description || "worker exception");
        return r.result.value;
      } catch (e) { err = e; await new Promise((r) => setTimeout(r, 800)); }
    }
    throw err;
  } };
  let fail = 0; const chk = (c, m2) => { console.log(c ? "  ok:" : "  FAIL:", m2); if (!c) fail++; };
  async function scenario(label, pickPoint, expectFn, afterClick) {
    const page = await browser.newPage(); await page.setViewport({ width: 1000, height: 800 }); await page.goto(URL_ + PATH_);
    const p = pickPoint === null ? null : await page.evaluate(pickPoint);
    if (pickPoint !== null) await page.mouse.click(p.x, p.y, { button: "right" });
    if (afterClick) await page.evaluate(afterClick);
        await sw.evaluate(async (urlPrefix) => {
      const tab = (await chrome.tabs.query({ url: urlPrefix + "*" }))[0];
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["/test/fixtures/mock-speech.js"] });
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => { document.documentElement.setAttribute("data-mock-auto-end", "5"); Object.defineProperty(window.speechSynthesis, "getVoices", { value: () => [{ name: "Eng", lang: "en-US", voiceURI: "Eng", localService: true, default: false }, { name: "Ar", lang: "ar-MA", voiceURI: "Ar", localService: true, default: false }] }); } });
    }, URL_);
    await sw.evaluate(async (a) => { const tab = (await chrome.tabs.query({ url: a.urlPrefix + "*" }))[0]; await self.__raReadFromHere(tab, a.info); }, { urlPrefix: URL_, info: INFO_ });
    await new Promise((r) => setTimeout(r, 900));
    const out = await page.evaluate(() => ({ spoken: Array.from(document.querySelectorAll("#__mock_speech_log span")).map((x) => x.textContent), toast: (document.querySelector("[role=status]") || {}).textContent || "" }));
    if (process.env.SHOT_DIR) await page.screenshot({ path: process.env.SHOT_DIR + "/" + label.replace(/[^a-z0-9]+/gi, "_").slice(0, 30) + ".png" });
    expectFn(out); await page.close();
  }
  const wordPoint = (pi, word, inside) => `(() => { const p = document.querySelectorAll("article p")[${pi}]; const tn = p.firstChild, at = tn.data.indexOf(${JSON.stringify(word)}) + ${inside}; const r = document.createRange(); r.setStart(tn, at); r.setEnd(tn, at + 1); const b = r.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; })()`;
  await scenario("middle of 'lanterns' in paragraph 3", wordPoint(2, "lanterns", 3), (o) => {
    const text = o.spoken.join(" ");
    chk(o.spoken[0] && o.spoken[0].startsWith("lanterns at the gate"), "starts exactly at the clicked word: " + JSON.stringify(o.spoken[0]));
    chk(text.includes("the last bus leaves the square ten minutes later"), "continues to the last word of the article");
    chk(!text.includes("Musicians") && !text.includes("Children can join"), "nothing before the click is read");
    chk(!text.includes("Sidebar promo"), "sidebar text is not read");
  });
  await scenario("first word of paragraph 2", wordPoint(1, "Musicians", 0), (o) => {
    chk(o.spoken[0] && o.spoken[0].startsWith("Musicians will play") && o.spoken.join(" ").includes("ten minutes later") && !o.spoken.join(" ").includes("harbour festival starts"), "paragraph 2 whole, then the rest, nothing earlier");
  });
  await scenario("click in the sidebar (outside the article)", `(() => { const b = document.querySelector("aside p").getBoundingClientRect(); return { x: b.x + 20, y: b.y + b.height / 2 }; })()`, (o) => {
    chk(o.spoken.length === 0 && /outside it/.test(o.toast), "outside the article text: nothing read, page says why: " + JSON.stringify(o.toast.slice(0, 60)));
  });
  await scenario("clicked paragraph removed before the menu action", wordPoint(2, "lanterns", 3), (o) => {
    chk(o.spoken.length === 0 && /right-click a word|outside it/.test(o.toast), "stale caret (DOM changed): nothing read, page says why");
  }, `document.querySelectorAll("article p")[2].remove()`);
  await scenario("menu action without any right-click on a word", null, (o) => {
    chk(o.spoken.length === 0 && /right-click a word/.test(o.toast), "no remembered click: nothing read, page says why");
  });
  PATH_ = "divs";
  const divPoint = (word, inside) => `(() => { const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); let n; while ((n = walker.nextNode())) { const at = n.data.indexOf(${JSON.stringify(word)}); if (at >= 0) { const r = document.createRange(); r.setStart(n, at + ${inside}); r.setEnd(n, at + ${inside} + 1); const b = r.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; } } })()`;
  await scenario("direct div text, mid word", divPoint("Wrapped", 3), (o) => {
    const text = o.spoken.join(" ");
    chk(o.spoken[0] === "pped sentence about the lantern tolls and mooring fees." || o.spoken[0] === "Wrapped sentence about the lantern tolls and mooring fees.", "div text: starts at the clicked word: " + JSON.stringify(o.spoken[0]));
    chk(text.includes("Nested deeper text keeps the order intact here.") && text.indexOf("Nested deeper") === text.lastIndexOf("Nested deeper"), "nested div text read once");
    chk(text.trim().endsWith("register at the office on arrival today."), "continues through the following paragraph to the last word");
    chk(!text.includes("Direct text one") && !text.includes("ferry timetable"), "nothing before the click is read");
  });
  await scenario("direct div text before the click", divPoint("Direct", 0), (o) => {
    const text = o.spoken.join(" ");
    chk(o.spoken[0] === "Direct text one stands alone inside the wrapper." && text.includes("Wrapped sentence") && text.includes("Tolls for small boats"), "click on direct wrapper text starts there and reads the div text and the paragraph after it, in order");
    chk(text.indexOf("Direct") < text.indexOf("Wrapped") && text.indexOf("Wrapped") < text.indexOf("Nested") && text.indexOf("Nested") < text.indexOf("Tolls for"), "source order kept");
  });
  PATH_ = "ar";
  await scenario("arabic direct div text, mid word", divPoint("المعلم", 2), (o) => {
    chk(o.spoken[0] && o.spoken[0].startsWith("المعلم إلى الفصل") && o.spoken.join(" ").includes("انتهى اليوم الدراسي") && !o.spoken.join(" ").includes("ذهب الولد"), "Arabic div text (RTL): starts at the clicked word, reads on to the last paragraph: " + JSON.stringify(o.spoken[0]));
  });
  // Right-click in the page, then right-click inside an embedded frame: the menu click reports frameId > 0
  // (set by hand here: a headless browser cannot click the native menu). Nothing may be read from the earlier point.
  PATH_ = "frame"; INFO_ = { frameId: 1 };
  await scenario("right-click inside an embedded frame", `(() => { const p = document.querySelectorAll("article p")[2]; const tn = p.firstChild, at = tn.data.indexOf("lanterns") + 3; const r = document.createRange(); r.setStart(tn, at); r.setEnd(tn, at + 1); const b = r.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; })()`, (o) => {
    chk(o.spoken.length === 0 && /embedded frame/.test(o.toast), "frame click: nothing read (not from the earlier top-page click), page says why: " + JSON.stringify(o.toast.slice(0, 70)));
  });
  INFO_ = null;
  console.log(fail ? "READ-FROM-HERE PAGE E2E FAIL" : "READ-FROM-HERE PAGE E2E PASS"); await browser.close(); srv.close(); process.exit(fail ? 1 : 0);
})().catch((e) => { console.log("FAIL", e.message); process.exit(1); });
