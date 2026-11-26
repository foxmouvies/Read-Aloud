/* Upload strip with MOCK speech (not real audio): the file box is a slim one-line strip, and a very long loaded file name
 * does not grow the sticky player (status shows a shortened name, full name in the tooltip), at 320/390/1280px, Settings
 * closed and open, and the active sentence stays below the player. */
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const puppeteer = require("puppeteer-core");
const EXT = path.resolve(__dirname, "..");
const CHROME = process.env.E2E_BROWSER || require("node:child_process").execSync("ls -d " + os.homedir() + "/chromium/linux-*/chrome-linux/chrome").toString().trim();
const MOCK = fs.readFileSync(path.join(__dirname, "fixtures/mock-speech.js"), "utf8");
function extId() { const m = JSON.parse(fs.readFileSync(path.join(EXT, "manifest.json"), "utf8")); const hex = require("node:crypto").createHash("sha256").update(Buffer.from(m.key, "base64")).digest("hex").slice(0, 32); return hex.split("").map((c) => String.fromCharCode(97 + parseInt(c, 16))).join(""); }
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ra-strip-"));
  const LONG = "this-is-a-very-long-document-filename-used-to-test-the-slim-upload-strip-layout-on-narrow-phones.txt";
  const txt = path.join(dir, LONG); let t = ""; for (let i = 1; i <= 60; i++) t += "This is sentence number " + i + " of a long test document used to check the reading layout. "; fs.writeFileSync(txt, t);
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox", "--disable-gpu", "--disable-features=DisableLoadExtensionCommandLineSwitch", `--load-extension=${EXT}`, "--disable-extensions-except=" + EXT, `--user-data-dir=${fs.mkdtempSync(path.join(os.tmpdir(), "ra-strip-prof-"))}`] });
  const id = extId(); let fail = 0;
  const check = (ok, msg) => { console.log(ok ? "  ok:" : "  FAIL:", msg); if (!ok) fail++; };
  for (const [w, h, open] of [[1280, 800, false], [390, 700, false], [390, 700, true], [320, 568, false], [320, 568, true]]) {
    const pg = await browser.newPage(); await pg.setViewport({ width: w, height: h }); await pg.evaluateOnNewDocument(MOCK);
    await pg.goto(`chrome-extension://${id}/reader/reader.html`);
    const empty = await pg.evaluate(() => { const d = document.getElementById("drop-zone").getBoundingClientRect(); return { h: d.height, sw: document.documentElement.scrollWidth, vw: innerWidth }; });
    check(empty.h <= 40 && empty.sw <= empty.vw, `${w}px empty strip height ${Math.round(empty.h)}px (<=40), no horizontal overflow`);
    await (await pg.$("#file-input")).uploadFile(txt);
    await pg.waitForFunction(() => document.querySelectorAll("#text-view .sentence").length > 10, { timeout: 15000 });
    if (open) await pg.click("#toggle-settings");
    await pg.click("#play"); await pg.click("#next"); await new Promise((r) => setTimeout(r, 600));
    await pg.evaluate(() => { const p = document.getElementById("progress"); window.__loaded = p.title; });
    await pg.click("#pause").catch(() => {});
    // the status right after load: reload the file to capture it before playback overwrites it
    await pg.reload(); await (await pg.$("#file-input")).uploadFile(txt);
    await pg.waitForFunction(() => /^Loaded /.test(document.getElementById("progress").textContent), { timeout: 15000 });
    if (open) await pg.click("#toggle-settings");
    const m = await pg.evaluate(() => { const c = document.getElementById("controls").getBoundingClientRect(); const p = document.getElementById("progress"); const pr = p.getBoundingClientRect(); const d = document.getElementById("drop-zone").getBoundingClientRect();
      const lh = parseFloat(getComputedStyle(p).lineHeight) || 16; return { ctrlH: c.height, vh: innerHeight, statusLines: Math.round(pr.height / lh), text: p.textContent, title: p.title, dzH: d.height, sw: document.documentElement.scrollWidth, vw: innerWidth }; });
    check(m.dzH <= 40, `${w}px loaded strip stays slim (${Math.round(m.dzH)}px)`);
    check(m.sw <= m.vw, `${w}px no horizontal overflow after load`);
    check(m.text.length < 70 && m.statusLines <= 4, `${w}px status compact: ${m.statusLines} line(s), ${m.text.length} chars: "${m.text}"`);
    check(m.title.includes(LONG), `${w}px full file name available in the status tooltip`);
    check(m.ctrlH <= m.vh * (open ? 0.46 : 0.4), `${w}px sticky player ${Math.round(m.ctrlH)}px of ${m.vh}px viewport (<=40%)${open ? ", Settings open" : ""}`);
    await pg.click("#play"); let bad = 0;
    for (let i = 0; i < 6; i++) { await pg.click("#next"); await new Promise((r) => setTimeout(r, 400)); for (let k = 0, last = -1; k < 15; k++) { const y = await pg.evaluate(() => scrollY); if (y === last) break; last = y; await new Promise((r) => setTimeout(r, 150)); }
      const s = await pg.evaluate(() => { const c = document.getElementById("controls").getBoundingClientRect(); const e = document.querySelector(".sentence.speaking"); if (!e) return null; const r = e.getBoundingClientRect(); return { cb: c.bottom, top: r.top, bottom: r.bottom, vh: innerHeight }; });
      if (!s || s.top < s.cb - 1 || s.bottom > s.vh + 1) bad++; }
    check(bad === 0, `${w}px active sentence clear of the sticky player over 6 steps`);
    if (process.env.OUT) await pg.screenshot({ path: path.join(process.env.OUT, `strip-long-${w}${open ? "-open" : ""}.png`) });
    await pg.close();
  }
  await browser.close(); console.log(fail ? "UPLOAD STRIP: " + fail + " FAILED" : "UPLOAD STRIP E2E PASS (mock speech)"); process.exit(fail ? 1 : 0);
})().catch((e) => { console.log("FAIL", e.message); process.exit(2); });
