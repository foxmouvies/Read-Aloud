/* Detected-language selection (Chromium/Brave), MOCK speech with a configurable voice list.
 * Checks: language picked from the document text (OCR for scans), no other voice
 * substituted when the language has no voice, manual choice never overridden, and
 * the chosen voice is used when present. Synthetic scans; mock speech (queueing only). */
const assert = require("node:assert"), fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const puppeteer = require("puppeteer-core");
const EXT_DIR = path.resolve(__dirname, "..");
const CHROME = process.env.E2E_BROWSER || require("node:child_process").execSync("ls -d " + os.homedir() + "/chromium/linux-*/chrome-linux/chrome").toString().trim();
const FIX = (n) => path.join(EXT_DIR, "test", "fixtures", n);
const MOCK = fs.readFileSync(FIX("mock-speech.js"), "utf8");
function extId(dir) { const m = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8")); const hex = require("node:crypto").createHash("sha256").update(Buffer.from(m.key, "base64")).digest("hex").slice(0, 32); return hex.split("").map((c) => String.fromCharCode(97 + parseInt(c, 16))).join(""); }
const voicesJs = (list) => `Object.defineProperty(window.speechSynthesis,'getVoices',{value:function(){return ${JSON.stringify(list)};}});`;
(async () => {
  const dst = fs.mkdtempSync(path.join(os.tmpdir(), "ra-lang-ext-"));
  for (const item of ["shared", "content", "popup", "reader", "icons", "vendor"]) fs.cpSync(path.join(EXT_DIR, item), path.join(dst, item), { recursive: true });
  fs.copyFileSync(path.join(EXT_DIR, "manifest.json"), path.join(dst, "manifest.json"));
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox", "--disable-gpu", "--disable-features=DisableLoadExtensionCommandLineSwitch", `--load-extension=${dst}`, "--disable-extensions-except=" + dst, `--user-data-dir=${fs.mkdtempSync(path.join(os.tmpdir(), "ra-lang-prof-"))}`] });
  const V = (n, l) => ({ name: n, lang: l, voiceURI: n, localService: true, default: false });
  const ALL = [V("Eng", "en-US"), V("Ara", "ar-MA"), V("Fra", "fr-FR")];
  const out = [];
  async function run(label, voices, file, pre) {
    const page = await browser.newPage();
    await page.evaluateOnNewDocument(MOCK + "\n" + voicesJs(voices));
    await page.goto(`chrome-extension://${extId(dst)}/reader/reader.html`);
    await page.evaluate(() => document.documentElement.setAttribute("data-mock-auto-end", "5"));
    if (pre) { await page.waitForSelector("#language", { visible: false }).catch(() => {}); await page.evaluate((v) => { const s = document.getElementById("language"); s.value = v; s.dispatchEvent(new Event("change")); }, pre); }
    await (await page.$("#file-input")).uploadFile(FIX(file));
    await page.waitForFunction(() => /^Loaded|Could not|No readable/.test(document.getElementById("progress").textContent), { timeout: 100000 });
    await new Promise((r) => setTimeout(r, 400));
    const r = await page.evaluate(() => ({ lang: document.getElementById("language").value, notice: document.getElementById("voice-notice").textContent, voice: document.getElementById("voice").selectedOptions[0] && document.getElementById("voice").selectedOptions[0].textContent, text: document.getElementById("text-view").textContent.slice(0, 120) }));
    await page.click("#play"); await new Promise((res) => setTimeout(res, 500));
    if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT + "-" + label.replace(/[^a-z0-9]+/gi, "_").slice(0, 40) + ".png", clip: { x: 0, y: 0, width: 1000, height: 560 } });
    r.progress = await page.evaluate(() => document.getElementById("progress").textContent);
    r.spoken = await page.evaluate(() => window.__mockSpeech.spoken.length);
    console.log(label, JSON.stringify(r).slice(0, 700)); out.push([label, r]);
    await page.close(); return r;
  }
  let fail = 0; const chk = (c, m) => { if (!c) { fail++; console.log("  FAIL:", m); } };
  let r = await run("EN text pdf, all voices", ALL, "sample.pdf"); chk(r.lang === "en-US" && r.spoken > 0, "English stays en-US and speaks");
  r = await run("EN scan, all voices", ALL, "scanned-en.pdf"); chk(r.lang === "en-US" && r.spoken > 0, "English scan -> en-US");
  r = await run("AR scan, all voices", ALL, "scanned-ar.pdf"); chk(r.lang === "ar-MA" && /Ara/.test(r.voice || "") && r.spoken > 0, "Arabic scan -> ar-MA with the Moroccan voice");
  r = await run("FR scan, all voices", ALL, "scanned-fr.pdf"); chk(r.lang === "fr-FR" && /Fra/.test(r.voice || "") && r.spoken > 0, "French scan -> fr-FR with the French voice");
  r = await run("FR scan, no French voice (en + ar-SA only)", [V("Eng", "en-US"), V("ArSA", "ar-SA")], "scanned-fr.pdf"); chk(r.lang === "fr-FR" && r.spoken === 0 && /No voice for French \(France\)/.test(r.notice), "French without voice: unavailable notice, nothing spoken");
  r = await run("AR scan, only ar-SA voice (no ar-MA)", [V("Eng", "en-US"), V("ArSA", "ar-SA")], "scanned-ar.pdf"); chk(r.lang === "ar-MA" && r.spoken === 0 && /No voice for Arabic \(Morocco\)/.test(r.notice) && /ar-SA/.test(r.notice), "ar-SA not substituted for ar-MA; availability listed");
  r = await run("TXT english", ALL, "sample-en.txt"); chk(r.lang === "en-US" && r.spoken > 0, "plain .txt English");
  r = await run("TXT french", ALL, "sample-fr.txt"); chk(r.lang === "fr-FR" && /Fra/.test(r.voice || "") && r.spoken > 0, "plain .txt French -> fr-FR voice");
  r = await run("TXT arabic", ALL, "sample-ar.txt"); chk(r.lang === "ar-MA" && /Ara/.test(r.voice || "") && r.spoken > 0, "plain .txt Arabic -> ar-MA voice");
  r = await run("TXT french, generic fr voice only", [V("Eng", "en-US"), V("FrGeneric", "fr")], "sample-fr.txt"); chk(r.lang === "fr-FR" && r.spoken === 0 && /No voice for French \(France\)/.test(r.notice), "generic fr voice is NOT matched as French (France)");
  r = await run("manual English chosen BEFORE French scan", ALL, "scanned-fr.pdf", "en-US"); chk(r.lang === "en-US", "manual choice not overridden");
  console.log(fail ? "LANGUAGE E2E FAIL" : "LANGUAGE E2E PASS"); await browser.close(); process.exit(fail ? 1 : 0);
})().catch((e) => { console.log("FAIL", e.message); process.exit(1); });
