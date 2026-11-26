/* Right-click "read from this word" in the reader page (Chromium/Brave), MOCK speech.
 * A real right-click (mouse button 2) on a word starts at exactly that word and the queue
 * continues through every remaining sentence to the last word. Mock speech: queueing only. */
const assert = require("node:assert"), fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const puppeteer = require("puppeteer-core");
const EXT_DIR = path.resolve(__dirname, "..");
const CHROME = process.env.E2E_BROWSER || require("node:child_process").execSync("ls -d " + os.homedir() + "/chromium/linux-*/chrome-linux/chrome").toString().trim();
const FIX = (n) => path.join(EXT_DIR, "test", "fixtures", n);
const MOCK = fs.readFileSync(FIX("mock-speech.js"), "utf8");
function extId(dir) { const m = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8")); const hex = require("node:crypto").createHash("sha256").update(Buffer.from(m.key, "base64")).digest("hex").slice(0, 32); return hex.split("").map((c) => String.fromCharCode(97 + parseInt(c, 16))).join(""); }
(async () => {
  const dst = fs.mkdtempSync(path.join(os.tmpdir(), "ra-rf-ext-"));
  for (const item of ["shared", "content", "popup", "reader", "icons", "vendor"]) fs.cpSync(path.join(EXT_DIR, item), path.join(dst, item), { recursive: true });
  fs.copyFileSync(path.join(EXT_DIR, "manifest.json"), path.join(dst, "manifest.json"));
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox", "--disable-gpu", "--disable-features=DisableLoadExtensionCommandLineSwitch", `--load-extension=${dst}`, "--disable-extensions-except=" + dst, `--user-data-dir=${fs.mkdtempSync(path.join(os.tmpdir(), "ra-rf-prof-"))}`] });
  const V = (n, l) => ({ name: n, lang: l, voiceURI: n, localService: true, default: false });
  const voices = JSON.stringify([V("Eng", "en-US")]);
  let fail = 0; const chk = (c, m) => { console.log(c ? "  ok:" : "  FAIL:", m); if (!c) fail++; };
  async function fresh() {
    const page = await browser.newPage();
    await page.evaluateOnNewDocument(MOCK + `\nObject.defineProperty(window.speechSynthesis,'getVoices',{value:function(){return ${voices};}});`);
    await page.setViewport({ width: 1000, height: 700 });
    await page.goto(`chrome-extension://${extId(dst)}/reader/reader.html`);
    await (await page.$("#file-input")).uploadFile(FIX("sample-readfrom.txt"));
    await page.waitForFunction(() => /^Loaded/.test(document.getElementById("progress").textContent), { timeout: 30000 });
    return page;
  }
  // Viewport point inside a given word (nth occurrence char index in the sentence span), optionally mid-word.
  const pointOf = (page, spanIdx, word, inside) => page.evaluate((spanIdx, word, inside) => {
    const span = document.querySelectorAll("#text-view .sentence")[spanIdx];
    const tn = span.firstChild, at = tn.data.indexOf(word);
    const r = document.createRange(); r.setStart(tn, at + inside); r.setEnd(tn, at + inside + 1);
    const b = r.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  }, spanIdx, word, inside);
  const spokenLog = (page) => page.evaluate(() => window.__mockSpeech.spoken.slice());
  const full = ["The harbour festival starts on Friday evening.", "Everyone is welcome at the pier near the old lighthouse.", "Musicians will play until midnight and food stalls stay open.", "Children can join the lantern parade at seven.", "The last boat leaves the dock at eleven thirty."];

  // 1) right-click in the middle of "pier" in sentence 2 -> starts at "pier", then sentences 3..5 whole
  let page = await fresh(); await page.evaluate(() => document.documentElement.setAttribute("data-mock-auto-end", "5"));
  let p = await pointOf(page, 1, "pier", 2); await page.mouse.click(p.x, p.y, { button: "right" });
  await new Promise((r) => setTimeout(r, 800));
  let sp = await spokenLog(page);
  chk(sp[0] === "pier near the old lighthouse.", "first utterance starts exactly at the clicked word: " + JSON.stringify(sp[0]));
  chk(JSON.stringify(sp.slice(1)) === JSON.stringify(full.slice(2)), "continues through every remaining sentence to the last word");
  chk(!sp.includes(full[0]), "nothing before the click is read");
  await page.close();

  // 2) right-click on the first word of a sentence and on a word in the last sentence
  page = await fresh(); await page.evaluate(() => document.documentElement.setAttribute("data-mock-auto-end", "5"));
  p = await pointOf(page, 3, "Children", 0); await page.mouse.click(p.x, p.y, { button: "right" }); await new Promise((r) => setTimeout(r, 700));
  sp = await spokenLog(page); chk(JSON.stringify(sp) === JSON.stringify(full.slice(3)), "first word of a sentence: that sentence whole, then the rest");
  await page.evaluate(() => { window.__mockSpeech.spoken.length = 0; });
  p = await pointOf(page, 4, "dock", 1); await page.mouse.click(p.x, p.y, { button: "right" }); await new Promise((r) => setTimeout(r, 600));
  sp = await spokenLog(page); chk(JSON.stringify(sp) === JSON.stringify(["dock at eleven thirty."]), "word in the last sentence reads to the final word only: " + JSON.stringify(sp));
  // 3) after a right-click start, a normal click on an earlier sentence reads that sentence whole (full queue restored)
  await page.evaluate(() => { window.__mockSpeech.spoken.length = 0; });
  p = await pointOf(page, 1, "Everyone", 3); await page.mouse.click(p.x, p.y, { button: "left" }); await new Promise((r) => setTimeout(r, 800));
  sp = await spokenLog(page); chk(sp[0] === full[1] && JSON.stringify(sp.slice(1)) === JSON.stringify(full.slice(2)), "normal click after a right-click start restores whole sentences");
  if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT, clip: { x: 0, y: 0, width: 1000, height: 560 } });
  await page.close();
  console.log(fail ? "READ-FROM-WORD E2E FAIL" : "READ-FROM-WORD E2E PASS"); await browser.close(); process.exit(fail ? 1 : 0);
})().catch((e) => { console.log("FAIL", e.message); process.exit(1); });
