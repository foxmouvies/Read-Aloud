/* Playback repeat check (Chromium/Brave). Uploads PDFs in the reader, plays
 * with a MOCK speech API (each utterance ends after ~5 ms), and compares the
 * sequence of spoken utterances with the sentences shown in the text view.
 * Fails if any utterance is spoken more than the text shows it, or order
 * differs. Mock speech: this checks the app's queueing, not audible speech. */
require("./diag");
const assert = require("node:assert"), fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const puppeteer = require("puppeteer-core");
const EXT_DIR = path.resolve(__dirname, "..");
const CHROME = process.env.E2E_BROWSER || require("node:child_process").execSync("ls -d " + os.homedir() + "/chromium/linux-*/chrome-linux/chrome").toString().trim();
const FIX = (n) => path.join(EXT_DIR, "test", "fixtures", n);
const MOCK = fs.readFileSync(FIX("mock-speech.js"), "utf8");
function extId(dir) { const m = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8")); const hex = require("node:crypto").createHash("sha256").update(Buffer.from(m.key, "base64")).digest("hex").slice(0, 32); return hex.split("").map((c) => String.fromCharCode(97 + parseInt(c, 16))).join(""); }
(async () => {
  const dst = fs.mkdtempSync(path.join(os.tmpdir(), "ra-rep-ext-"));
  for (const item of ["shared", "content", "popup", "reader", "icons", "vendor"]) fs.cpSync(path.join(EXT_DIR, item), path.join(dst, item), { recursive: true });
  fs.copyFileSync(path.join(EXT_DIR, "manifest.json"), path.join(dst, "manifest.json"));
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox", "--disable-gpu", "--disable-features=DisableLoadExtensionCommandLineSwitch", `--load-extension=${dst}`, "--disable-extensions-except=" + dst, `--user-data-dir=${fs.mkdtempSync(path.join(os.tmpdir(), "ra-rep-prof-"))}`] });
  let failed = 0;
  try {
    for (const name of (process.env.FILES ? process.env.FILES.split(',') : ["sample.pdf", "sample-multipage.pdf", "sample-long.pdf", "sample-twocol.pdf", "sample-hyphen.pdf", "mixed-text-scanned.pdf", "scanned-en.pdf", "mild-8page.pdf"])) {
      const page = await browser.newPage();
      await page.evaluateOnNewDocument(MOCK);
      await page.goto(`chrome-extension://${extId(dst)}/reader/reader.html`);
      await page.evaluate(() => document.documentElement.setAttribute("data-mock-auto-end", "5"));
      const el = await page.$("#file-input"); await el.uploadFile(FIX(name));
      await page.waitForFunction(() => /^Loaded/.test(document.getElementById("progress").textContent), { timeout: 100000 });
      const sentences = await page.evaluate(() => [...document.querySelectorAll("#text-view .sentence")].map((s) => s.textContent.trim()));
      await page.evaluate(() => { window.__mockSpeech.spoken.length = 0; });
      await page.click("#play");
      await new Promise((r) => setTimeout(r, 1500 + sentences.length * 30));
      const spoken = await page.evaluate(() => window.__mockSpeech.spoken.slice());
      const norm = (s) => s.replace(/\s+/g, " ").trim();
      const sp = spoken.map(norm), se = sentences.map(norm);
      const dupConsecutive = sp.filter((x, i) => i && x === sp[i - 1]).length;
      const extra = sp.length - se.length;
      const inOrder = sp.join(" ") === se.join(" "); // long sentences are split by design, so compare joined text
      const ok = dupConsecutive === 0 && inOrder;
      console.log(JSON.stringify({ file: name, sentences: se.length, spoken: sp.length, consecutiveRepeats: dupConsecutive, matchesTextViewInOrder: inOrder, ok }));
      if (!ok) { failed++; console.log("  first spoken:", JSON.stringify(sp.slice(0, 4)).slice(0, 300), "\n  first text:", JSON.stringify(se.slice(0, 4)).slice(0, 300)); }
      await page.close();
    }
  } catch (e) { console.log("FAIL", e.message); failed++; }
  await browser.close(); process.exit(failed ? 1 : 0);
})();
