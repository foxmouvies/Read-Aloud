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
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: "new",
    args: ["--no-sandbox", "--disable-gpu", "--disable-features=DisableLoadExtensionCommandLineSwitch",
      `--load-extension=${dst}`, "--disable-extensions-except=" + dst,
      `--user-data-dir=${fs.mkdtempSync(path.join(os.tmpdir(), "ra-ocr-prof-"))}`,
      "--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1"]
  });
  const packaged = new Set(), external = [];
  const note = (u) => { if (/^chrome-extension:/.test(u)) packaged.add(u.split("/").slice(3).join("/")); else if (!/^(data|blob|about|chrome):/.test(u)) external.push(u); };
  browser.on("targetcreated", async (t) => {
    if (t.type() === "worker" || t.type() === "service_worker") {
      try { const s = await t.createCDPSession(); await s.send("Network.enable"); s.on("Network.requestWillBeSent", (e) => note(e.request.url)); } catch (e) { /* worker gone */ }
    }
  });
  try {
    const reader = await browser.newPage();
    const errors = [];
    reader.on("pageerror", (e) => errors.push(e.message));
    reader.on("request", (r) => note(r.url()));
    await reader.goto(`chrome-extension://${extId(dst)}/reader/reader.html`, { waitUntil: "load" });
    const upload = async (f) => { await reader.evaluate(() => { document.getElementById("file-input").value = ""; }); return (await reader.$("#file-input")).uploadFile(FIX(f)); };
    const loaded = (re) => reader.waitForFunction((s) => new RegExp(s).test(document.getElementById("progress").textContent), { timeout: 110000 }, re.source);
    const view = () => reader.evaluate(() => document.getElementById("text-view").textContent);
    // Sentence splitting inside this browser: Intl.Segmenter present and used, English/French/Arabic.
    const seg = await reader.evaluate(() => ({
      has: typeof Intl.Segmenter === "function",
      fr: RAText.splitIntoSentences("M. Dupont est arrivé à 3.5 heures. Il a dit « Bonjour. » Puis il est parti ! Vraiment ?"),
      ar: RAText.splitIntoSentences("ذهب أحمد إلى السوق. هل رأيته؟ نعم! ثم عاد إلى البيت."),
      en: RAText.splitIntoSentences("Dr. Lee paid 3.5 MAD. He left. Then he said \"Stop.\" She agreed.")
    }));
    assert.ok(seg.has, "Intl.Segmenter available in this browser");
    assert.deepStrictEqual(seg.fr, ["M. Dupont est arrivé à 3.5 heures.", "Il a dit « Bonjour. »", "Puis il est parti !", "Vraiment ?"]);
    assert.deepStrictEqual(seg.ar, ["ذهب أحمد إلى السوق.", "هل رأيته؟", "نعم!", "ثم عاد إلى البيت."]);
    assert.deepStrictEqual(seg.en, ["Dr. Lee paid 3.5 MAD.", "He left.", "Then he said \"Stop.\"", "She agreed."]);
    console.log("SENTENCE SPLITTING (Intl.Segmenter present): English, French, Arabic OK in this browser");
    const timings = {};

    // Scanned English
    let t0 = Date.now(); await upload("scanned-en.pdf"); await loaded(/^Loaded scanned-en/); timings.english_first_page_ms = Date.now() - t0;
    let txt = await view();
    for (const w of ["lantern parade", "seven in the evening", "shuttle buses"]) assert.ok(txt.toLowerCase().includes(w), "English OCR kept: " + w + " got: " + txt);
    await reader.screenshot({ path: "/downloads/readaloud/ocr-english.png" });
    // Second scanned page load reuses a fresh worker each time (cleanup between files)
    await reader.evaluate(() => { document.getElementById("progress").textContent = ""; }); t0 = Date.now(); await upload("scanned-en.pdf"); await loaded(/^Loaded scanned-en/); timings.english_second_load_ms = Date.now() - t0;

    // Scanned Arabic
    t0 = Date.now(); await upload("scanned-ar.pdf"); await loaded(/^Loaded scanned-ar/); timings.arabic_page_ms = Date.now() - t0;
    txt = await view();
    for (const w of ["مهرجان", "الميناء"]) assert.ok(txt.includes(w), "Arabic OCR kept: " + w + " got: " + txt);
    await reader.screenshot({ path: "/downloads/readaloud/ocr-arabic.png" });

    // Mixed text-layer + scanned page
    await upload("mixed-text-scanned.pdf"); await loaded(/^Loaded mixed-text-scanned/);
    txt = await view();
    assert.ok(/reads text aloud/i.test(txt) && txt.toLowerCase().includes("lantern parade"), "mixed PDF has text-layer page and OCR page: " + txt.slice(0, 200));

    // Replacement race: start a 2-page scan, immediately replace with a text PDF.
    await upload("scanned-both.pdf");
    await new Promise((r) => setTimeout(r, 400));
    await upload("sample.pdf");
    await loaded(/^Loaded sample\.pdf/);
    await new Promise((r) => setTimeout(r, 8000)); // let any superseded OCR finish; it must not overwrite
    txt = await view();
    assert.ok(/reads text aloud/i.test(txt) && !/lantern|مهرجان/.test(txt), "replacement file won; no stale OCR text");
    assert.match(await reader.evaluate(() => document.getElementById("progress").textContent), /^Loaded sample\.pdf/);

    // Cancel: during OCR the cancel button shows, clicking it clears the document.
    await upload("scanned-both.pdf");
    await reader.waitForFunction(() => !document.getElementById("cancel-ocr").hidden, { timeout: 30000 });
    await reader.click("#cancel-ocr");
    await reader.waitForFunction(() => /cancelled/.test(document.getElementById("progress").textContent), { timeout: 15000 });
    await new Promise((r) => setTimeout(r, 6000));
    const after = await reader.evaluate(() => ({ n: document.querySelectorAll("#text-view .sentence").length, p: document.getElementById("progress").textContent, hidden: document.getElementById("cancel-ocr").hidden }));
    assert.strictEqual(after.n, 0); assert.ok(/cancelled/.test(after.p)); assert.ok(after.hidden);
    await reader.evaluate(() => document.getElementById("play").click());
    await new Promise((r) => setTimeout(r, 300));
    assert.ok(/cancelled/.test(await reader.evaluate(() => document.getElementById("progress").textContent)), "Play after cancel does not replay anything");

    // Empty image-only noise page still reports no text, not a hang.
    assert.deepStrictEqual(errors.filter((e) => !/speech/i.test(e)), [], "no page errors: " + errors.join("; "));
    // Network: packaged loads vs external
    const pk = [...packaged];
    assert.ok(pk.some((u) => /vendor\/tesseract\/worker\.min\.js/.test(u)) && pk.some((u) => /lang\/eng\.traineddata\.gz/.test(u)) && pk.some((u) => /lang\/ara\.traineddata\.gz/.test(u)), "packaged worker and models were loaded: " + pk.join(","));
    assert.deepStrictEqual(external, [], "no external network requests: " + external.join(","));
    console.log("OCR PACKAGED LOADS:", pk.filter((u) => /tesseract/.test(u)).join(", "));
    console.log("OCR EXTERNAL REQUESTS: 0");
    console.log("OCR TIMINGS:", JSON.stringify(timings));
    console.log("OCR E2E: PASS");
  } finally { await browser.close(); }
})().catch((e) => { console.error("OCR E2E: FAIL:", e.message); process.exit(1); });
