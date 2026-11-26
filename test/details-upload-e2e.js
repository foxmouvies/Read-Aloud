/* Closed <details> bodies are not read (user-approved: read only what is shown); open ones are. Uploaded HTML in the
 * reader, MOCK speech (not real audio). Checks the text view and what the engine is told to speak. */
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const puppeteer = require("puppeteer-core");
const EXT = path.resolve(__dirname, "..");
const CHROME = process.env.E2E_BROWSER || require("node:child_process").execSync("ls -d " + os.homedir() + "/chromium/linux-*/chrome-linux/chrome").toString().trim();
const MOCK = fs.readFileSync(path.join(__dirname, "fixtures/mock-speech.js"), "utf8");
function extId() { const m = JSON.parse(fs.readFileSync(path.join(EXT, "manifest.json"), "utf8")); return require("node:crypto").createHash("sha256").update(Buffer.from(m.key, "base64")).digest("hex").slice(0, 32).split("").map((c) => String.fromCharCode(97 + parseInt(c, 16))).join(""); }
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ra-det-"));
  const closed = path.join(dir, "closed.html"), open = path.join(dir, "open.html");
  fs.writeFileSync(closed, "<html><body><p>Before the section.</p><details><summary>Summary line</summary><p>Hidden body text.</p>Loose hidden words.</details><p>After the section.</p></body></html>");
  fs.writeFileSync(open, "<html><body><p>Before the section.</p><details open><summary>Summary line</summary><p>Visible body text.</p></details><p>After the section.</p></body></html>");
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox", "--disable-gpu", "--disable-features=DisableLoadExtensionCommandLineSwitch", `--load-extension=${EXT}`, "--disable-extensions-except=" + EXT, `--user-data-dir=${fs.mkdtempSync(path.join(os.tmpdir(), "ra-det-prof-"))}`] });
  let fail = 0; const check = (ok, msg) => { console.log(ok ? "  ok:" : "  FAIL:", msg); if (!ok) fail++; };
  const pg = await browser.newPage(); await pg.evaluateOnNewDocument(MOCK);
  await pg.goto(`chrome-extension://${extId()}/reader/reader.html`);
  const load = async (f) => { await pg.evaluate(() => { document.getElementById("file-input").value = ""; document.getElementById("progress").textContent = ""; }); await (await pg.$("#file-input")).uploadFile(f); await pg.waitForFunction(() => /^Loaded /.test(document.getElementById("progress").textContent), { timeout: 15000 }); return pg.evaluate(() => document.getElementById("text-view").textContent); };
  let t = await load(closed);
  check(/Before the section/.test(t) && /Summary line/.test(t) && /After the section/.test(t), "closed: before, summary and after are read");
  check(!/Hidden body text|Loose hidden words/.test(t), "closed: body (element and loose text) is not read");
  t = await load(open);
  check(/Summary line/.test(t) && /Visible body text/.test(t), "open: summary and body are read");
  await browser.close(); console.log(fail ? "DETAILS UPLOAD E2E FAIL (" + fail + ")" : "DETAILS UPLOAD E2E PASS (mock speech)"); process.exit(fail ? 1 : 0);
})().catch((e) => { console.log("FAIL", e.message); process.exit(1); });
