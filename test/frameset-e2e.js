/* Frameset page (no <body>) and iframe-only page: live extraction must not throw and must read nothing. Chromium/Brave. */
const os = require("node:os"), path = require("node:path");
const puppeteer = require("puppeteer-core");
const EXT = path.resolve(__dirname, "..");
const CHROME = process.env.E2E_BROWSER || require("node:child_process").execSync("ls -d " + os.homedir() + "/chromium/linux-*/chrome-linux/chrome").toString().trim();
(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox", "--disable-gpu"] });
  let fail = 0; const chk = (c, m) => { console.log(c ? "  ok:" : "  FAIL:", m); if (!c) fail++; };
  const pages = { frameset: `<!doctype html><html><frameset cols="50%,50%"><frame src="about:blank"><frame src="about:blank"></frameset></html>`,
    "iframe only": `<!doctype html><html><body><iframe srcdoc="<p>Text inside an embedded frame.</p>"></iframe></body></html>` };
  for (const [name, html] of Object.entries(pages)) {
    const page = await browser.newPage(); await page.setContent(html);
    for (const f of ["shared/store.js", "shared/text.js", "shared/tts-engine.js", "content/read-page.js"]) await page.addScriptTag({ path: path.join(EXT, f) });
    const r = await page.evaluate(() => { try { return { ok: true, t: String(window.__readAloudExtract() || "") }; } catch (e) { return { ok: false, e: e.message }; } });
    console.log(name, JSON.stringify(r));
    chk(r.ok && r.t.trim() === "", name + ": no throw, nothing read");
    await page.close();
  }
  console.log(fail ? "FRAMESET E2E FAIL" : "FRAMESET E2E PASS"); await browser.close(); process.exit(fail ? 1 : 0);
})().catch((e) => { console.log("FAIL", e.message); process.exit(1); });
