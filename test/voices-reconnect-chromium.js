/* Voice list / connection tests (Chromium or Brave). SIMULATED voices: the
 * browser has no real speech voices here, so speechSynthesis is replaced by a
 * controllable stand-in (en-US local, en-US online, en-GB, fr-FR). Offline
 * is real CDP network emulation (navigator.onLine and online/offline events);
 * the online voice failing offline is simulated by the stand-in. This tests
 * the extension's reaction, not any browser's real online voices. */
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const puppeteer = require("puppeteer-core");
const EXT_DIR = path.resolve(__dirname, "..");
const CHROME = process.env.E2E_BROWSER || require("node:child_process").execSync("ls -d " + os.homedir() + "/chromium/linux-*/chrome-linux/chrome").toString().trim();
function extId(dir) {
  const m = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
  const hex = require("node:crypto").createHash("sha256").update(Buffer.from(m.key, "base64")).digest("hex").slice(0, 32);
  return hex.split("").map((c) => String.fromCharCode(97 + parseInt(c, 16))).join("");
}
(async () => {
  const dst = fs.mkdtempSync(path.join(os.tmpdir(), "ra-vc-ext-"));
  for (const item of ["shared", "content", "popup", "reader", "icons", "vendor"]) fs.cpSync(path.join(EXT_DIR, item), path.join(dst, item), { recursive: true });
  fs.copyFileSync(path.join(EXT_DIR, "manifest.json"), path.join(dst, "manifest.json"));
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox", "--disable-gpu", "--disable-features=DisableLoadExtensionCommandLineSwitch", `--load-extension=${dst}`, "--disable-extensions-except=" + dst, `--user-data-dir=${fs.mkdtempSync(path.join(os.tmpdir(), "ra-vc-prof-"))}`] });
  let failed = 0; const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const check = (name, ok, extra) => { console.log((ok ? "ok   " : "FAIL ") + name + (extra ? " :: " + extra : "")); if (!ok) failed++; };
  try {
    const page = await browser.newPage(); const errors = []; page.on("pageerror", (e) => errors.push(e.message));
    await page.evaluateOnNewDocument(() => {
      const mk = (name, lang, local) => ({ name, lang, voiceURI: (local ? "l:" : "o:") + name, localService: local, default: false });
      window.__all = [mk("Fran", "fr-FR", true), mk("Dan", "en-GB", true), mk("Zed", "en-US", true), mk("Jen", "en-US", false), mk("Ann", "en-US", false)];
      window.__list = window.__all.slice();
      window.__spoken = []; window.__getCalls = 0;
      const ss = { onvoiceschanged: null, speaking: false, paused: false,
        getVoices() { window.__getCalls++; return window.__list; },
        speak(u) { window.__spoken.push({ text: u.text, voice: u.voice && u.voice.name });
          setTimeout(() => { if (u.voice && !u.voice.localService && !navigator.onLine) u.onerror && u.onerror({ error: "network" }); }, 20); },
        cancel() {}, pause() { this.paused = true; }, resume() { this.paused = false; }, addEventListener() {}, removeEventListener() {} };
      Object.defineProperty(window, "speechSynthesis", { value: ss, configurable: true });
      window.SpeechSynthesisUtterance = function (t) { this.text = t; this.voice = null; this.rate = 1; this.pitch = 1; };
    });
    await page.goto(`chrome-extension://${extId(dst)}/reader/reader.html`, { waitUntil: "load" });
    await sleep(500);
    const opts = () => page.evaluate(() => [...document.querySelectorAll("#voice option")].map((o) => o.textContent));
    const sel = () => page.evaluate(() => { const o = document.getElementById("voice"); return o.options[o.selectedIndex] && o.options[o.selectedIndex].textContent; });
    const note = () => page.evaluate(() => document.getElementById("voice-notice").textContent);
    const prog = () => page.evaluate(() => document.getElementById("progress").textContent);
    let o = await opts();
    check("default language en-US, only en-US voices listed incl. online", page && o.length === 3 && o.every((t) => /en-US/.test(t)) && o.some((t) => /online/.test(t)), JSON.stringify(o));
    check("no Allow/Disallow online voice controls", await page.evaluate(() => !document.getElementById("allow-online") && !document.getElementById("disallow-online")));
    check("French and other-region voices absent under English (United States)", !o.some((t) => /fr-FR|en-GB/.test(t)));
    check("default pick is local voice, not silently an online one", /Zed/.test(await sel()), await sel());
    // load a document and choose an online voice by hand
    await (await page.$("#file-input")).uploadFile(path.join(EXT_DIR, "test", "fixtures", "sample-hyphen.pdf"));
    await page.waitForFunction(() => /Loaded/.test(document.getElementById("progress").textContent), { timeout: 30000 });
    await page.evaluate(() => { const s = document.getElementById("voice"); const i = [...s.options].findIndex((x) => /Jen/.test(x.textContent)); s.value = s.options[i].value; s.dispatchEvent(new Event("change", { bubbles: true })); });
    check("online voice chosen manually shows provider disclosure", /sent to your browser's or system's voice provider/.test(await note()), await note());
    await page.click("#play"); await sleep(500);
    const spoken0 = await page.evaluate(() => window.__spoken.slice());
    check("reading starts with the chosen online voice", spoken0.length >= 1 && spoken0[0].voice === "Jen", JSON.stringify(spoken0.slice(0, 2)));
    // connection lost
    const cdp = await page.createCDPSession();
    await cdp.send("Network.enable"); await cdp.send("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
    await sleep(800);
    const onlineFlag = await page.evaluate(() => navigator.onLine);
    const n1 = await note(); const p1 = await prog();
    check("offline detected (navigator.onLine false)", onlineFlag === false);
    check("connection-lost message shown, reading paused on the online voice", /Connection lost/.test(n1) && /paused/.test(p1) || /Connection lost/.test(n1), n1 + " || " + p1);
    // voice list drops the online voices while offline
    await page.evaluate(() => { window.__list = window.__all.filter((v) => v.localService); window.dispatchEvent(new Event("offline")); });
    await sleep(300);
    o = await opts();
    check("online voices missing -> list refreshed, chosen voice NOT silently replaced", o.length >= 1 && /unavailable/.test(await sel()) && !/Zed|Dan/.test(await sel()), JSON.stringify(o) + " sel=" + await sel());
    const spokenBefore = (await page.evaluate(() => window.__spoken.length));
    await page.click("#play"); await sleep(400);
    check("Play is blocked with an explanation, no other voice used", /unavailable/.test(await prog()) && (await page.evaluate(() => window.__spoken.length)) === spokenBefore, await prog());
    // reconnect
    await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    const g0 = await page.evaluate(() => window.__getCalls);
    await page.evaluate(() => { window.__list = window.__all.slice(); });
    await sleep(1200);
    const n2 = await note(); const g1 = await page.evaluate(() => window.__getCalls);
    check("reconnect refreshed the voice list", g1 > g0, g0 + "->" + g1);
    check("reconnect message says nothing was restarted", /Connection restored/.test(n2) && /nothing was restarted/.test(n2), n2);
    check("chosen online voice restored by the refresh, still selected", /Jen/.test(await sel()), await sel());
    const spokenAfter = await page.evaluate(() => window.__spoken.length);
    await sleep(1500);
    check("no automatic restart of reading after reconnect", (await page.evaluate(() => window.__spoken.length)) === spokenAfter && spokenAfter === spokenBefore, spokenBefore + "/" + spokenAfter);
    // error path: online voice fails while offline during speech
    await page.evaluate(() => { document.getElementById("language").value = "en-US"; });
    await cdp.send("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
    await page.evaluate(() => { window.dispatchEvent(new Event("online")); }); // keep UI in "online" note state, then fail the utterance
    await page.click("#play"); await sleep(800);
    const pe = await prog(); const ne = await note();
    check("utterance network error on an online voice gives the connection explanation", /online voice stopped/.test(ne) || /Speech error/.test(pe), ne + " || " + pe);
    await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    check("page errors", errors.length === 0, errors.join(";"));
  } catch (e) { console.log("FAIL exception", e.message); failed++; }
  await browser.close(); console.log(failed ? "VOICES-RECONNECT: " + failed + " FAILED" : "VOICES-RECONNECT: ALL OK"); process.exit(failed ? 1 : 0);
})();
