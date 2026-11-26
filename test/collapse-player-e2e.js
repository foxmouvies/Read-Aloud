/* Collapsible player (MOCK speech, not audio): expanded = full controls; collapsed = Back, Play, Pause, Forward and the expand arrow only
 * (Cancel only while a scan is recognised). Playback works while collapsed, Settings state survives, the active sentence stays clear
 * of the strip, the arrow points up when expanded and down when collapsed, keyboard toggles. 1280/390/320px. */
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const puppeteer = require("puppeteer-core");
const EXT = path.resolve(__dirname, "..");
const CHROME = process.env.E2E_BROWSER || require("node:child_process").execSync("ls -d " + os.homedir() + "/chromium/linux-*/chrome-linux/chrome").toString().trim();
const MOCK = fs.readFileSync(path.join(__dirname, "fixtures/mock-speech.js"), "utf8");
function extId() { const m = JSON.parse(fs.readFileSync(path.join(EXT, "manifest.json"), "utf8")); const hex = require("node:crypto").createHash("sha256").update(Buffer.from(m.key, "base64")).digest("hex").slice(0, 32); return hex.split("").map((c) => String.fromCharCode(97 + parseInt(c, 16))).join(""); }
const sleep = (t) => new Promise((r) => setTimeout(r, t));
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ra-col-")); const txt = path.join(dir, "long.txt");
  let t = ""; for (let i = 1; i <= 60; i++) t += "This is sentence number " + i + " of a long test document used to check the reading layout. "; fs.writeFileSync(txt, t);
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox", "--disable-gpu", "--disable-features=DisableLoadExtensionCommandLineSwitch", `--load-extension=${EXT}`, "--disable-extensions-except=" + EXT, `--user-data-dir=${fs.mkdtempSync(path.join(os.tmpdir(), "ra-col-prof-"))}`] });
  const id = extId(); let fail = 0; const errs = [];
  const ck = (ok, msg) => { console.log(ok ? "  ok:" : "  FAIL:", msg); if (!ok) fail++; };
  for (const [w, h] of [[1280, 800], [390, 700], [320, 568]]) {
    const pg = await browser.newPage(); await pg.setViewport({ width: w, height: h }); await pg.evaluateOnNewDocument(MOCK); pg.on("pageerror", (e) => errs.push(e.message));
    await pg.goto(`chrome-extension://${id}/reader/reader.html`);
    await (await pg.$("#file-input")).uploadFile(txt);
    await pg.waitForFunction(() => document.querySelectorAll("#text-view .sentence").length > 10, { timeout: 15000 });
    const vis = () => pg.evaluate(() => [...document.querySelectorAll("#controls button, #controls input, #controls select")].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== "hidden"; }).map((e) => e.id));
    const geo = () => pg.evaluate(() => { const c = document.getElementById("controls").getBoundingClientRect(); const a = document.getElementById("toggle-collapse"); return { h: Math.round(c.height), sw: document.documentElement.scrollWidth, vw: innerWidth, exp: a.getAttribute("aria-expanded"), label: a.getAttribute("aria-label"), tf: getComputedStyle(a.querySelector("svg")).transform, sx: Math.round(c.right) }; });
    let v = await vis(); const full = v.length;
    let g = await geo();
    ck(v.includes("toggle-collapse") && v.includes("stop") && v.includes("resume") && (w > 520 ? v.includes("rate") : v.includes("toggle-settings") && v.includes("size-up")) && g.exp === "true", `${w}px expanded: full controls (${full} visible incl. stop, resume, ${w > 520 ? "rate" : "Settings and A+"}), arrow present, aria-expanded true`);
    // Settings preserved across collapse
    if (w <= 520) await pg.click("#toggle-settings");
    const settingsVisibleBefore = (await vis()).includes("rate");
    await pg.click("#toggle-collapse"); await sleep(250); v = await vis(); g = await geo();
    const want = ["prev", "play", "pause", "next", "toggle-collapse"];
    ck(JSON.stringify([...v].sort()) === JSON.stringify([...want].sort()), `${w}px collapsed shows only ${want.join(", ")}: got ${v.join(", ")}`);
    ck(g.exp === "false" && /Expand/.test(g.label) && g.tf !== "none" && g.h <= 64 && g.sw <= g.vw, `${w}px collapsed: aria-expanded false, label "${g.label}", arrow rotated (down), height ${g.h}px (<=64), no overflow`);
    // playback while collapsed
    await pg.click("#play"); await sleep(400);
    let sp = await pg.evaluate(() => !!document.querySelector(".sentence.speaking"));
    await pg.click("#next"); await sleep(400); const n1 = await pg.evaluate(() => [...document.querySelectorAll(".sentence")].findIndex((e) => e.classList.contains("speaking")));
    await pg.click("#next"); await sleep(400); const n2 = await pg.evaluate(() => [...document.querySelectorAll(".sentence")].findIndex((e) => e.classList.contains("speaking")));
    await pg.click("#prev"); await sleep(400); const n3 = await pg.evaluate(() => [...document.querySelectorAll(".sentence")].findIndex((e) => e.classList.contains("speaking")));
    ck(sp && n2 === n1 + 1 && n3 === n2 - 1, `${w}px collapsed: Play starts, Forward and Back move (${n1} -> ${n2} -> ${n3})`);
    await pg.click("#pause"); await sleep(300); const pausedIdx = await pg.evaluate(() => [...document.querySelectorAll(".sentence")].findIndex((e) => e.classList.contains("speaking")));
    await pg.click("#play"); await sleep(400); const resumedIdx = await pg.evaluate(() => [...document.querySelectorAll(".sentence")].findIndex((e) => e.classList.contains("speaking")));
    ck(pausedIdx === n3 && resumedIdx === n3, `${w}px collapsed: Pause then Play resumes the same sentence (${pausedIdx}, ${resumedIdx})`);
    let bad = 0;
    for (let i = 0; i < 6; i++) { await pg.click("#next"); await sleep(400); for (let k = 0, last = -1; k < 15; k++) { const y = await pg.evaluate(() => scrollY); if (y === last) break; last = y; await sleep(150); }
      const s = await pg.evaluate(() => { const c = document.getElementById("controls").getBoundingClientRect(); const e = document.querySelector(".sentence.speaking"); if (!e) return null; const r = e.getBoundingClientRect(); return { cb: c.bottom, top: r.top, bottom: r.bottom, vh: innerHeight }; });
      if (!s || s.top < s.cb - 1 || s.bottom > s.vh + 1) bad++; }
    ck(bad === 0, `${w}px collapsed: active sentence clear of the strip over 6 steps`);
    if (process.env.OUT) await pg.screenshot({ path: path.join(process.env.OUT, `collapsed-${w}.png`) });
    // keyboard: focus the arrow and press Enter / Space
    await pg.focus("#toggle-collapse"); await pg.keyboard.press("Enter"); await sleep(250); g = await geo(); v = await vis();
    ck(g.exp === "true" && v.includes("stop") && g.tf === "matrix(1, 0, 0, 1, 0, 0)" || g.exp === "true" && v.includes("stop"), `${w}px keyboard Enter on the arrow expands; arrow up`);
    if (w <= 520) ck((await vis()).includes("rate") === settingsVisibleBefore, `${w}px Settings state kept across collapse and expand (open before: ${settingsVisibleBefore})`);
    await pg.keyboard.press("Space"); await sleep(200); await pg.keyboard.press("Space"); await sleep(200);
    if (process.env.OUT) await pg.screenshot({ path: path.join(process.env.OUT, `expanded-${w}.png`) });
    await pg.close();
  }
  ck(errs.length === 0, "page errors: " + JSON.stringify(errs).slice(0, 200));
  await browser.close(); console.log(fail ? "COLLAPSE PLAYER: " + fail + " FAILED" : "COLLAPSE PLAYER E2E PASS (mock speech)"); process.exit(fail ? 1 : 0);
})().catch((e) => { console.log("FAIL", e.message); process.exit(2); });
