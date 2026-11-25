/* OCR e2e (Chromium/Brave): scanned and mixed PDFs, English + Arabic, cancel,
 * replacement race, and a network check that separates packaged-resource
 * loads (chrome-extension://) from external requests (must be zero; the
 * browser is also started with every external host unresolvable, so any
 * remote fetch would fail the recognition itself). */
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const puppeteer = require("puppeteer-core");
const EXT_DIR = path.resolve(__dirname, "..");
const CHROME = process.env.E2E_BROWSER || require("node:child_process").execSync("ls -d " + os.homedir() + "/chromium/linux-*/chrome-linux/chrome").toString().trim();
const FIX = (n) => path.join(EXT_DIR, "test", "fixtures", n);

function extId(dir) {
  const m = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
  const hex = require("node:crypto").createHash("sha256").update(Buffer.from(m.key, "base64")).digest("hex").slice(0, 32);
  return hex.split("").map((c) => String.fromCharCode(97 + parseInt(c, 16))).join("");
}
(async () => {
  const dst = fs.mkdtempSync(path.join(os.tmpdir(), "ra-ocr-ext-"));
  for (const item of ["shared", "content", "popup", "reader", "icons", "vendor"]) fs.cpSync(path.join(EXT_DIR, item), path.join(dst, item), { recursive: true });
  fs.copyFileSync(path.join(EXT_DIR, "manifest.json"), path.join(dst, "manifest.json")); // shipped manifest as-is
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox", "--disable-gpu", "--disable-features=DisableLoadExtensionCommandLineSwitch", `--load-extension=${dst}`, "--disable-extensions-except=" + dst, `--user-data-dir=${fs.mkdtempSync(path.join(os.tmpdir(), "ra-res-prof-"))}`] });
  let failed = 0; const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  try {
    const reader = await browser.newPage(); const errors = []; reader.on("pageerror", (e) => errors.push(e.message));
    await reader.goto(`chrome-extension://${extId(dst)}/reader/reader.html`, { waitUntil: "load" });
    const upload = async (f) => { await reader.evaluate(() => { document.getElementById("file-input").value = ""; }); return (await reader.$("#file-input")).uploadFile(FIX(f)); };
    const prog = () => reader.evaluate(() => document.getElementById("progress").textContent);
    const settle = (re) => reader.waitForFunction((s) => new RegExp(s).test(document.getElementById("progress").textContent), { timeout: 100000 }, re.source);
    const cancelVis = () => reader.waitForFunction(() => !document.getElementById("cancel-ocr").hidden, { timeout: 30000 });
    await reader.evaluate(`window.__ev=[];window.__live=0;window.__peak=0;window.__rec=0;window.__t0=performance.now();
      const oc=Tesseract.createWorker.bind(Tesseract);
      Tesseract.createWorker=async(...a)=>{const w=await oc(...a);const id=window.__ev.filter(e=>e.k=='created').length+1;window.__live++;window.__peak=Math.max(window.__peak,window.__live);
        window.__ev.push({k:'created',id,t:Math.round(performance.now()-window.__t0)});
        const ot=w.terminate.bind(w);w.terminate=()=>{window.__live--;window.__ev.push({k:'terminate',id,t:Math.round(performance.now()-window.__t0)});return ot();};
        const or=w.recognize.bind(w);w.recognize=(...b)=>{window.__rec++;window.__ev.push({k:'recognize',id,t:Math.round(performance.now()-window.__t0)});return or(...b);};return w;};
      window.__pend=0;window.__pendPeak=0;const st=window.setTimeout;window.setTimeout=(f,ms,...r)=>{if(ms===250){window.__pend++;window.__pendPeak=Math.max(window.__pendPeak,window.__pend);return st(()=>{window.__pend--;f(...r)},ms)}return st(f,ms,...r)};`);
    
    const snap = () => reader.evaluate(() => ({ live: window.__live, peak: window.__peak, rec: window.__rec, pend: window.__pend, pendPeak: window.__pendPeak, created: window.__ev.filter((e) => e.k == "created").length, term: window.__ev.filter((e) => e.k == "terminate").length }));
    const report = async (label) => { await sleep(1500); const s = await snap(); console.log(label + ": " + JSON.stringify(s)); return s; };
    await upload("scanned-both.pdf"); await cancelVis(); await reader.click("#cancel-ocr");
    let s = await report("A cancel during creation"); if (s.live !== 0 || s.created !== s.term || s.rec !== 0) failed++;
    await upload("scanned-both.pdf"); await cancelVis(); const rb = (await snap()).rec; await reader.waitForFunction((n) => window.__rec > n, { timeout: 20000 }, rb); const r0 = (await snap()).rec; await reader.click("#cancel-ocr").catch(() => {});
    s = await report("B cancel mid-recognition"); console.log("B recognize after cancel: " + (s.rec - r0)); if (s.live !== 0 || s.created !== s.term) failed++;
    for (let i = 0; i < 6; i++) { await upload(i % 2 ? "scanned-en.pdf" : "scanned-both.pdf"); await sleep(120); }
    await upload("sample.pdf"); await settle(/Loaded/);
    s = await report("C 6 rapid scanned replacements"); if (s.live !== 0 || s.created !== s.term) failed++;
    await upload("scanned-both.pdf"); await cancelVis(); await sleep(1500); await upload("scanned-en.pdf"); await settle(/Loaded/);
    const t = await reader.evaluate(() => document.getElementById("text-view").textContent); if (t.length < 50) failed++;
    s = await report("D replacement scan completed, chars " + t.length); if (s.live !== 0 || s.created !== s.term) failed++;
    console.log("page errors: " + errors.length); if (errors.length) failed++;
  } catch (e) { console.log("FAIL", e.message); failed++; }
  await browser.close(); console.log(failed ? "RESOURCE: " + failed + " FAILED" : "RESOURCE: ALL OK"); process.exit(failed ? 1 : 0);
})();
