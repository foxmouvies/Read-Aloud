/* Degraded multipage OCR measurement (Chromium/Brave). The fixture is
 * SYNTHETIC: clean text rendered to images, then rotated, blurred, speckled
 * and JPEG-compressed (quality 35). It is not a real scan. Reports character
 * and word error rate against the known source text, per-page timing, and
 * browser process-tree memory (RSS, sampled from /proc) during recognition. */
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const puppeteer = require("puppeteer-core");
const EXT_DIR = path.resolve(__dirname, "..");
const CHROME = process.env.E2E_BROWSER || require("node:child_process").execSync("ls -d " + os.homedir() + "/chromium/linux-*/chrome-linux/chrome").toString().trim();
function extId(dir) { const m = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8")); const h = require("node:crypto").createHash("sha256").update(Buffer.from(m.key, "base64")).digest("hex").slice(0, 32); return h.split("").map((c) => String.fromCharCode(97 + parseInt(c, 16))).join(""); }
function lev(a, b) { const m = a.length, n = b.length; let prev = Array.from({ length: n + 1 }, (_, i) => i); for (let i = 1; i <= m; i++) { const cur = [i]; for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = cur; } return prev[n]; }
function rssTree(root) {
  const ps = {}; for (const d of fs.readdirSync("/proc").filter((x) => /^\d+$/.test(x))) { try { const st = fs.readFileSync(`/proc/${d}/stat`, "utf8"); const f = st.slice(st.lastIndexOf(")") + 2).split(" "); ps[d] = { ppid: f[1], rss: parseInt(fs.readFileSync(`/proc/${d}/statm`, "utf8").split(" ")[1]) * 4096 }; } catch (e) { /* gone */ } }
  let sum = 0; const seen = new Set([String(root)]); let grew = true; while (grew) { grew = false; for (const [pid, p] of Object.entries(ps)) if (!seen.has(pid) && seen.has(p.ppid)) { seen.add(pid); grew = true; } }
  for (const pid of seen) if (ps[pid]) sum += ps[pid].rss; return sum;
}
(async () => {
  const dst = fs.mkdtempSync(path.join(os.tmpdir(), "ra-acc-ext-"));
  for (const i of ["shared", "content", "popup", "reader", "icons", "vendor", "manifest.json"]) fs.cpSync(path.join(EXT_DIR, i), path.join(dst, i), { recursive: true });
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox", "--disable-gpu", "--disable-features=DisableLoadExtensionCommandLineSwitch", `--load-extension=${dst}`, "--disable-extensions-except=" + dst, `--user-data-dir=${fs.mkdtempSync(path.join(os.tmpdir(), "ra-acc-prof-"))}`] });
  const pid = browser.process().pid;
  try {
    const page = await browser.newPage();
    await page.goto(`chrome-extension://${extId(dst)}/reader/reader.html`, { waitUntil: "load" });
    const base = rssTree(pid); let peak = base; const iv = setInterval(() => { peak = Math.max(peak, rssTree(pid)); }, 250);
    const marks = []; const t0 = Date.now(); let lastP = "";
    const poll = setInterval(async () => { try { const p = await page.evaluate(() => document.getElementById("progress").textContent); if (p !== lastP) { lastP = p; marks.push([Date.now() - t0, p]); } } catch (e) {} }, 100);
    await (await page.$("#file-input")).uploadFile(path.join(EXT_DIR, "test/fixtures/" + (process.env.FIXN || "degraded") + "-8page.pdf"));
    await page.waitForFunction(() => /^Loaded (degraded|mild)/.test(document.getElementById("progress").textContent), { timeout: 110000 });
    const total = Date.now() - t0; clearInterval(poll); await new Promise((r) => setTimeout(r, 1500)); const afterIdle = rssTree(pid); clearInterval(iv);
    const got = (await page.evaluate(() => document.getElementById("text-view").textContent)).replace(/\s+/g, " ").trim();
    const truth = JSON.parse(fs.readFileSync(path.join(EXT_DIR, "test/fixtures/" + (process.env.FIXN || "degraded") + "-8page.truth.json"), "utf8")).join(" ").replace(/\s+/g, " ").trim();
    const cer = lev(got, truth) / truth.length;
    const gw = got.split(" "), tw = truth.split(" "); const wer = lev(gw.join("\u0001"), tw.join("\u0001")) ; // placeholder replaced below
    function levArr(a, b) { let prev = Array.from({ length: b.length + 1 }, (_, i) => i); for (let i = 1; i <= a.length; i++) { const cur = [i]; for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = cur; } return prev[b.length]; }
    const werv = levArr(gw, tw) / tw.length;
    const pagesSeen = marks.filter((m) => /Recognising/.test(m[1])).map((m) => m[0]);
    const mb = (b) => (b / 1048576).toFixed(0);
    console.log("DEGRADED (synthetic) 8-page doc: truth chars", truth.length, "words", tw.length);
    console.log("CER " + (cer * 100).toFixed(2) + "%  WER " + (werv * 100).toFixed(2) + "%");
    console.log("TOTAL ms", total, "per page ms ~", Math.round(total / 8), "page start marks", JSON.stringify(pagesSeen));
    console.log(`BROWSER RSS MB: before ${mb(base)}, peak ${mb(peak)}, after finish+1.5s ${mb(afterIdle)}`);
    fs.writeFileSync("/tmp/ocr-" + (process.env.FIXN || "degraded") + "-got.txt", got);
    await page.screenshot({ path: "/downloads/readaloud/ocr-" + (process.env.FIXN || "degraded") + ".png" });
  } finally { await browser.close(); }
})().catch((e) => { console.error("FAIL", e); process.exit(1); });
