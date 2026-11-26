/* Responsive layout check of the real reader and popup pages inside the loaded extension (Chromium).
 * Loads a long .txt, checks no horizontal overflow at several widths, sticky controls stay visible after
 * scrolling, the compact Settings toggle opens/closes, and the voice list is never blank. Screenshots to OUT. */
const assert = require("node:assert"), fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const puppeteer = require("puppeteer-core");
const EXT = path.resolve(__dirname, "..");
const CHROME = process.env.E2E_BROWSER || require("node:child_process").execSync("ls -d " + os.homedir() + "/chromium/linux-*/chrome-linux/chrome").toString().trim();
const OUT = process.env.OUT || fs.mkdtempSync(path.join(os.tmpdir(), "ra-layout-"));
function extId() { const m = JSON.parse(fs.readFileSync(path.join(EXT, "manifest.json"), "utf8")); const hex = require("node:crypto").createHash("sha256").update(Buffer.from(m.key, "base64")).digest("hex").slice(0, 32); return hex.split("").map((c) => String.fromCharCode(97 + parseInt(c, 16))).join(""); }
(async () => {
  const txt = path.join(OUT, "long.txt"); fs.mkdirSync(OUT, { recursive: true });
  let t = ""; for (let i = 1; i <= 80; i++) t += "This is sentence number " + i + " of a long test document used to check the reading layout. ";
  fs.writeFileSync(txt, t);
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox", "--disable-gpu", "--disable-features=DisableLoadExtensionCommandLineSwitch", `--load-extension=${EXT}`, "--disable-extensions-except=" + EXT, `--user-data-dir=${fs.mkdtempSync(path.join(os.tmpdir(), "ra-lay-prof-"))}`] });
  const id = extId(); let fail = 0; const chk = (c, m) => { console.log(c ? "  ok:" : "  FAIL:", m); if (!c) fail++; };
  for (const scheme of ["light", "dark"]) for (const w of [1280, 768, 390, 320]) {
    const pg = await browser.newPage(); await pg.setViewport({ width: w, height: w > 600 ? 800 : 640 });
    await pg.emulateMediaFeatures([{ name: "prefers-color-scheme", value: scheme }]);
    await pg.goto(`chrome-extension://${id}/reader/reader.html`);
    const empty = await pg.$eval("#voice", (s) => s.options.length);
    await (await pg.$("#file-input")).uploadFile(txt);
    await pg.waitForFunction(() => document.querySelectorAll("#text-view .sentence").length > 10, { timeout: 15000 });
    const voiceOpts = await pg.$eval("#voice", (s) => [...s.options].map((o) => o.textContent));
    chk(voiceOpts.length >= 1 && voiceOpts[0].trim().length > 0, `${scheme} ${w}: voice list never blank ${JSON.stringify(voiceOpts[0])}`);
    chk(!(await pg.evaluate(() => document.documentElement.scrollWidth > innerWidth)), `${scheme} ${w}: no horizontal overflow`);
    await pg.evaluate(() => window.scrollTo(0, 1500));
    const top = await pg.$eval("#controls", (e) => Math.round(e.getBoundingClientRect().top));
    const h = await pg.$eval("#controls", (e) => Math.round(e.getBoundingClientRect().height));
    chk(top <= 1 && top >= -1, `${scheme} ${w}: controls stay at top after scrolling (top=${top}, height=${h})`);
    if (w <= 520) {
      const vis = () => pg.$eval("#settings-row", (e) => getComputedStyle(e).display !== "none");
      chk(!(await vis()), `${scheme} ${w}: settings hidden by default`);
      await pg.click("#toggle-settings"); chk(await vis(), `${scheme} ${w}: Settings button opens settings`);
      chk((await pg.$eval("#toggle-settings", (e) => e.getAttribute("aria-expanded"))) === "true", `${scheme} ${w}: aria-expanded true`);
      await pg.screenshot({ path: path.join(OUT, `reader-${scheme}-${w}-settings.png`) });
      await pg.click("#toggle-settings"); chk(!(await vis()), `${scheme} ${w}: Settings button closes settings`);
    }
    const before = await pg.$eval("#text-view", (e) => parseFloat(getComputedStyle(e).fontSize));
    await pg.click("#size-up"); const after = await pg.$eval("#text-view", (e) => parseFloat(getComputedStyle(e).fontSize));
    chk(after > before, `${scheme} ${w}: A+ enlarges text ${before}->${after}`);
    await pg.click("#size-down");
    await pg.screenshot({ path: path.join(OUT, `reader-${scheme}-${w}.png`) });
    await pg.close();
  }
  for (const scheme of ["light", "dark"]) {
    const pg = await browser.newPage(); await pg.setViewport({ width: 300, height: 600, deviceScaleFactor: 2 });
    await pg.emulateMediaFeatures([{ name: "prefers-color-scheme", value: scheme }]);
    await pg.goto(`chrome-extension://${id}/popup/popup.html`);
    const dims = await pg.evaluate(() => [document.body.scrollWidth, document.documentElement.scrollHeight, innerWidth]);
    chk(dims[0] <= dims[2] && dims[1] <= 600, `popup ${scheme}: fits ${JSON.stringify(dims)}`);
    await pg.screenshot({ path: path.join(OUT, `popup-${scheme}.png`), fullPage: true }); await pg.close();
  }
  await browser.close(); console.log(fail ? "LAYOUT E2E: " + fail + " FAILED" : "LAYOUT E2E PASS", "screenshots:", OUT); process.exit(fail ? 1 : 0);
})().catch((e) => { console.log("FAIL", e.message); process.exit(2); });
