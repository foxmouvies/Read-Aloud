/* With MOCK speech (not real audio): stepping through a long document keeps the active sentence fully visible
 * below the sticky player, with Settings open and closed, at narrow and desktop widths. */
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const puppeteer = require("puppeteer-core");
const EXT = path.resolve(__dirname, "..");
const CHROME = process.env.E2E_BROWSER || require("node:child_process").execSync("ls -d " + os.homedir() + "/chromium/linux-*/chrome-linux/chrome").toString().trim();
const MOCK = fs.readFileSync(path.join(__dirname, "fixtures/mock-speech.js"), "utf8");
function extId() { const m = JSON.parse(fs.readFileSync(path.join(EXT, "manifest.json"), "utf8")); const hex = require("node:crypto").createHash("sha256").update(Buffer.from(m.key, "base64")).digest("hex").slice(0, 32); return hex.split("").map((c) => String.fromCharCode(97 + parseInt(c, 16))).join(""); }
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ra-scr-")); const txt = path.join(dir, "long.txt");
  let t = ""; for (let i = 1; i <= 80; i++) t += "This is sentence number " + i + " of a long test document used to check the reading layout. "; fs.writeFileSync(txt, t);
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox", "--disable-gpu", "--disable-features=DisableLoadExtensionCommandLineSwitch", `--load-extension=${EXT}`, "--disable-extensions-except=" + EXT, `--user-data-dir=${fs.mkdtempSync(path.join(os.tmpdir(), "ra-scr-prof-"))}`] });
  const id = extId(); let fail = 0;
  for (const [w, h, open] of [[1280, 800, false], [390, 640, false], [390, 640, true], [320, 568, false], [320, 568, true]]) {
    const pg = await browser.newPage(); await pg.setViewport({ width: w, height: h });
    await pg.evaluateOnNewDocument(MOCK);
    await pg.goto(`chrome-extension://${id}/reader/reader.html`);
    await (await pg.$("#file-input")).uploadFile(txt);
    await pg.waitForFunction(() => document.querySelectorAll("#text-view .sentence").length > 10, { timeout: 15000 });
    if (open) await pg.click("#toggle-settings");
    await pg.click("#play"); let bad = 0, checks = 0;
    for (let i = 0; i < 40; i++) {
      await pg.click("#next"); await new Promise((r) => setTimeout(r, 300)); for (let k = 0, last = -1; k < 15; k++) { const y = await pg.evaluate(() => scrollY); if (y === last) break; last = y; await new Promise((r) => setTimeout(r, 150)); }
      const m = await pg.evaluate(() => { const c = document.getElementById("controls").getBoundingClientRect(); const e = document.querySelector(".sentence.speaking"); if (!e) return null; const r = e.getBoundingClientRect(); return { cb: c.bottom, top: r.top, bottom: r.bottom, vh: innerHeight }; });
      if (!m) continue; checks++; if (m.top < m.cb - 1 || m.bottom > m.vh + 1) { bad++; if (bad < 3) console.log("   hidden", JSON.stringify(m)); }
    }
    const ok = bad === 0 && checks > 30; if (!ok) fail++;
    console.log(ok ? "  ok:" : "  FAIL:", `${w}x${h} settings ${open ? "open" : "closed"}: ${checks} steps checked, ${bad} hidden`);
    if (open) await pg.screenshot({ path: process.env.OUT ? path.join(process.env.OUT, `scroll-${w}-open.png`) : path.join(dir, "s.png") });
    await pg.close();
  }
  await browser.close(); console.log(fail ? "SCROLL STICKY: " + fail + " FAILED" : "SCROLL STICKY E2E PASS (mock speech)"); process.exit(fail ? 1 : 0);
})().catch((e) => { console.log("FAIL", e.message); process.exit(2); });
