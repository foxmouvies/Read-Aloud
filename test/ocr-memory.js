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
  const dst = fs.mkdtempSync(path.join(os.tmpdir(), "ra-mem-ext-"));
  for (const i of ["shared", "content", "popup", "reader", "icons", "vendor", "manifest.json"]) fs.cpSync(path.join(EXT_DIR, i), path.join(dst, i), { recursive: true });
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox", "--disable-gpu", "--disable-features=DisableLoadExtensionCommandLineSwitch", `--load-extension=${dst}`, "--disable-extensions-except=" + dst, `--user-data-dir=${fs.mkdtempSync(path.join(os.tmpdir(), "ra-mem-prof-"))}`] });
  const pid = browser.process().pid; const mb = (b) => Math.round(b / 1048576);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  try {
    const page = await browser.newPage();
    await page.goto(`chrome-extension://${extId(dst)}/reader/reader.html`, { waitUntil: "load" });
    await sleep(2000); const start = rssTree(pid); console.log("start MB", mb(start));
    const LOADS = +(process.env.LOADS || 5), WAIT = +(process.env.WAITMS || 20000);
    for (let k = 1; k <= LOADS; k++) {
      await page.evaluate(() => { document.getElementById("file-input").value = ""; document.getElementById("progress").textContent = ""; });
      await (await page.$("#file-input")).uploadFile(path.join(EXT_DIR, "test/fixtures/mild-8page.pdf"));
      let peak = 0; const iv = setInterval(() => { peak = Math.max(peak, rssTree(pid)); }, 250);
      await page.waitForFunction(() => /^Loaded mild/.test(document.getElementById("progress").textContent), { timeout: 110000 });
      clearInterval(iv);
      const samples = [];
      for (const t of (process.env.TS ? process.env.TS.split(",").map(Number) : [2000, 5000, 10000, WAIT])) { await sleep(t - (samples.length ? samples[samples.length - 1][0] : 0)); samples.push([t, mb(rssTree(pid))]); }
      console.log(`load ${k}: peak ${mb(peak)} MB; after finish: ` + samples.map(([t, v]) => `${t / 1000}s=${v}`).join(", "));
    }
    // Process list at the end: which processes hold memory
    const procs = [];
    for (const d of fs.readdirSync("/proc").filter((x) => /^\d+$/.test(x))) { try { const cm = fs.readFileSync(`/proc/${d}/cmdline`, "utf8"); const m = cm.match(/--type=([a-z-]+)/); const st = fs.readFileSync(`/proc/${d}/stat`, "utf8"); const ppid = st.slice(st.lastIndexOf(")") + 2).split(" ")[1]; procs.push({ d, ppid, type: m ? m[1] : "browser", rss: mb(parseInt(fs.readFileSync(`/proc/${d}/statm`, "utf8").split(" ")[1]) * 4096) }); } catch (e) {} }
    const tree = new Set([String(pid)]); let g = true; while (g) { g = false; for (const p of procs) if (!tree.has(p.d) && tree.has(p.ppid)) { tree.add(p.d); g = true; } }
    const by = {}; for (const p of procs.filter((p) => tree.has(p.d))) by[p.type] = (by[p.type] || 0) + p.rss;
    console.log("end MB by process type:", JSON.stringify(by));
  } finally { await browser.close(); }
})().catch((e) => { console.error("FAIL", e); process.exit(1); });
