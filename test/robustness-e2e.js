/* Robustness e2e (Chromium/Brave): malformed, empty, encrypted and truncated
 * files, cancel and replacement during loading. Checks: clear message, no
 * document left, Play cannot replay a previous document, cancel button
 * hidden, no uncaught page errors. */
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const puppeteer = require("puppeteer-core");
const EXT_DIR = path.resolve(__dirname, "..");
const CHROME = process.env.E2E_BROWSER || require("node:child_process").execSync("ls -d " + os.homedir() + "/chromium/linux-*/chrome-linux/chrome").toString().trim();
const ROB = process.env.ROB_DIR || "/tmp/rob";
const FIX = (n) => path.join(EXT_DIR, "test", "fixtures", n);
function extId(dir) {
  const m = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
  const hex = require("node:crypto").createHash("sha256").update(Buffer.from(m.key, "base64")).digest("hex").slice(0, 32);
  return hex.split("").map((c) => String.fromCharCode(97 + parseInt(c, 16))).join("");
}
(async () => {
  const dst = fs.mkdtempSync(path.join(os.tmpdir(), "ra-rob-ext-"));
  for (const item of ["shared", "content", "popup", "reader", "icons", "vendor"]) fs.cpSync(path.join(EXT_DIR, item), path.join(dst, item), { recursive: true });
  fs.copyFileSync(path.join(EXT_DIR, "manifest.json"), path.join(dst, "manifest.json"));
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox", "--disable-gpu", "--disable-features=DisableLoadExtensionCommandLineSwitch", `--load-extension=${dst}`, "--disable-extensions-except=" + dst, `--user-data-dir=${fs.mkdtempSync(path.join(os.tmpdir(), "ra-rob-prof-"))}`] });
  let failed = 0;
  try {
    const reader = await browser.newPage();
    const errors = [];
    reader.on("pageerror", (e) => errors.push(e.message));
    await reader.goto(`chrome-extension://${extId(dst)}/reader/reader.html`, { waitUntil: "load" });
    const upload = async (p) => { await reader.evaluate(() => { document.getElementById("file-input").value = ""; }); return (await reader.$("#file-input")).uploadFile(p); };
    const prog = () => reader.evaluate(() => document.getElementById("progress").textContent);
    const settle = (re, t = 100000) => reader.waitForFunction((s) => new RegExp(s).test(document.getElementById("progress").textContent), { timeout: t }, re.source);
    const state = () => reader.evaluate(() => ({ n: document.querySelectorAll("#text-view .sentence").length, cancelHidden: document.getElementById("cancel-ocr").hidden, p: document.getElementById("progress").textContent }));
    const cases = [
      ["garbage bytes named .pdf", path.join(ROB, "garbage.pdf"), /Could not read|No readable/],
      ["zero-byte .pdf", path.join(ROB, "zero.pdf"), /Could not read|No readable/],
      ["truncated text PDF", path.join(ROB, "truncated.pdf"), /Could not read|No readable|Loaded/],
      ["truncated scanned PDF", path.join(ROB, "truncated-scan.pdf"), /Could not read|No readable|Loaded/],
      ["password-protected PDF", path.join(ROB, "encrypted-user.pdf"), /Could not read|No readable/],
      ["plain text with .pdf name", path.join(ROB, "fake.pdf"), /Could not read|No readable/],
      ["blank 2-page PDF (no text, no image)", path.join(ROB, "blank.pdf"), /No readable|Could not read/],
      ["HTML with only a script", path.join(ROB, "empty.html"), /No readable/],
      ["whitespace-only .txt", path.join(ROB, "spaces.txt"), /No readable/],
      ["empty .txt", FIX("empty.txt"), /No readable/]
    ];
    for (const [label, file, re] of cases) {
      // A good document is loaded first, so a stale replay would be visible.
      await upload(FIX("sample.pdf")); await settle(/Loaded/);
      await upload(file);
      let msg;
      try { await settle(/Loaded|Could not read|No readable|cancelled/, 110000); msg = await prog(); } catch (e) { msg = "TIMEOUT: " + (await prog()); }
      const st = await state();
      await reader.evaluate(() => document.getElementById("play").click());
      await new Promise((r) => setTimeout(r, 600));
      const after = await reader.evaluate(() => ({ speaking: speechSynthesis.speaking, p: document.getElementById("progress").textContent }));
      const real = fs.existsSync(file) && /could not be found/i.test(msg) === false; // a missing fixture must never count as a pass
      const ok = real && re.test(msg) && (/Loaded/.test(msg) || (st.n === 0 && st.cancelHidden)) && !after.speaking;
      if (!ok) failed++;
      if (!real) console.log("   (fixture missing or file not found: not a valid pass; build with test/fixtures/build-robustness.py)");
      console.log((ok ? "OK   " : "FAIL ") + label + " -> \"" + msg.slice(0, 90) + "\" sentences=" + st.n + " cancelHidden=" + st.cancelHidden + " speakingAfterPlay=" + after.speaking);
      await reader.evaluate(() => speechSynthesis.cancel());
    }
    // Owner-password-only PDF should still read.
    await upload(path.join(ROB, "encrypted-owner-only.pdf")); await settle(/Loaded|Could not read|No readable/);
    console.log("INFO owner-password-only PDF -> " + (await prog()).slice(0, 90));
    // Cancel during OCR, then immediately load a second scan, then a text PDF: no stale text.
    await upload(FIX("scanned-both.pdf"));
    await reader.waitForFunction(() => !document.getElementById("cancel-ocr").hidden, { timeout: 30000 });
    await reader.click("#cancel-ocr");
    await upload(FIX("scanned-en.pdf"));
    await reader.waitForFunction(() => !document.getElementById("cancel-ocr").hidden, { timeout: 30000 });
    await upload(FIX("sample.pdf")); await settle(/Loaded/);
    const txt = await reader.evaluate(() => document.getElementById("text-view").textContent);
    const st = await state();
    const stale = /lantern|مهرجان/i.test(txt) || !st.cancelHidden;
    if (stale) failed++;
    console.log((stale ? "FAIL " : "OK   ") + "cancel then two quick replacements: final text from last file only, cancel hidden=" + st.cancelHidden);
    // Rapid repeated replacement x6 with alternating bad/good files.
    const seq = [path.join(ROB, "garbage.pdf"), FIX("sample.pdf"), path.join(ROB, "encrypted-user.pdf"), FIX("scanned-en.pdf"), path.join(ROB, "truncated.pdf"), FIX("sample.pdf")];
    for (const f of seq) await upload(f);
    await settle(/Loaded/);
    await new Promise((r) => setTimeout(r, 4000));
    const fin = await state();
    const okSeq = /Loaded sample\.pdf/.test(fin.p) && fin.n > 0 && fin.cancelHidden;
    if (!okSeq) failed++;
    console.log((okSeq ? "OK   " : "FAIL ") + "6 rapid replacements (bad/good mix): last file wins -> \"" + fin.p.slice(0, 70) + "\"");
    console.log("page errors: " + errors.length + (errors.length ? " " + JSON.stringify(errors.slice(0, 3)) : ""));
    if (errors.length) failed++;
  } finally { await browser.close(); }
  console.log(failed ? "ROBUSTNESS: " + failed + " FAILED" : "ROBUSTNESS: ALL CASES OK");
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
