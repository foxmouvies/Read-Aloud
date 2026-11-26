/* Open shadow roots (web components): text inside them is read when the normal page has almost no text;
 * pages with normal article text are unchanged. Live-page extraction only. Chromium/Brave. */
const os = require("node:os"), path = require("node:path");
const puppeteer = require("puppeteer-core");
const EXT = path.resolve(__dirname, "..");
const CHROME = process.env.E2E_BROWSER || require("node:child_process").execSync("ls -d " + os.homedir() + "/chromium/linux-*/chrome-linux/chrome").toString().trim();
const L = (n) => "Sentence number " + n + " is here to give the block enough text so the scorer keeps it in the page.";
const SH = (ps) => `<article-view></article-view><script>document.querySelector('article-view').attachShadow({mode:'open'}).innerHTML=${JSON.stringify(ps.map((p) => "<p>" + p + "</p>").join(""))}</script>`;
const CASES = {
  "article only inside an open shadow root": { html: SH([L(1), L(2), L(3)]), expect: [L(1), L(2), L(3)] },
  "nested shadow roots": { html: `<outer-el></outer-el><script>const a=document.querySelector('outer-el').attachShadow({mode:'open'});a.innerHTML='<inner-el></inner-el>';a.querySelector('inner-el').attachShadow({mode:'open'}).innerHTML=${JSON.stringify("<p>" + L(1) + "</p><p>" + L(2) + "</p>")}</script>`, expect: [L(1), L(2)] },
  "hidden paragraph inside the shadow root stays silent": { html: `<article-view></article-view><script>document.querySelector('article-view').attachShadow({mode:'open'}).innerHTML=${JSON.stringify("<p>" + L(1) + '</p><p style="display:none">Hidden shadow text must stay silent here.</p><p>' + L(2) + "</p>")}</script>`, expect: [L(1), L(2)] },
  "normal article text wins; shadow content is not mixed in": { html: `<article><p>${L(1)}</p><p>${L(2)}</p><p>${L(3)}</p></article>` + SH([L(7)]), expect: [L(1), L(2), L(3)] },
  "short normal article is kept and shadow text is appended after it": { html: `<p>${L(1)}</p>` + SH([L(2)]), expect: [L(1), L(2)] },
  "short article plus shadow nav element: nav stays out": { html: `<p>${L(1)}</p><x-nav></x-nav><script>document.querySelector('x-nav').attachShadow({mode:'open'}).innerHTML=${JSON.stringify("<nav><p>Menu links home about contact here</p></nav>")}</script>`, expect: [L(1)] },
  "short article plus shadow host with a boilerplate class stays out": { html: `<p>${L(1)}</p><x-ad class="sidebar"></x-ad><script>document.querySelector('x-ad').attachShadow({mode:'open'}).innerHTML=${JSON.stringify("<p>" + L(5) + "</p>")}</script>`, expect: [L(1)] },
  "short article plus hidden shadow host stays out": { html: `<p>${L(1)}</p><x-h style="display:none"></x-h><script>document.querySelector('x-h').attachShadow({mode:'open'}).innerHTML=${JSON.stringify("<p>" + L(5) + "</p>")}</script>`, expect: [L(1)] },
  "short article plus shadow host inside a hidden light wrapper stays out": { html: `<p>${L(1)}</p><div style="display:none"><x-h></x-h></div><script>document.querySelector('x-h').attachShadow({mode:'open'}).innerHTML=${JSON.stringify("<p>" + L(5) + "</p>")}</script>`, expect: [L(1)] },
  "shadow paragraph hidden through a wrapper inside the root stays out": { html: SH([L(1)]).replace("<p>", '<div style=\"display:none\"><p>').replace(/<\/p>"\)/, '</p></div>")'), expect: [] },
  "shadow article BEFORE a short normal paragraph: document order kept": { html: SH([L(1), L(2)]) + `<p>Short normal closing line.</p>`, expect: [L(1), L(2), "Short normal closing line."] },
  "normal paragraph BEFORE a shadow article: document order kept": { html: `<p>Short normal opening line.</p>` + SH([L(1), L(2)]), expect: ["Short normal opening line.", L(1), L(2)] },
  "interleaved normal and shadow content: document order kept": { html: `<p>Normal one here.</p>` + SH([L(1)]) + `<p>Normal two here.</p><x-b></x-b><script>document.querySelector('x-b').attachShadow({mode:'open'}).innerHTML=${JSON.stringify("<p>" + L(2) + "</p>")}</script><p>Normal three here.</p>`, expect: ["Normal one here.", L(1), "Normal two here.", L(2), "Normal three here."] },
  "page with no text and no shadow reads nothing": { html: `<div></div>`, expect: [] },
};
(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox", "--disable-gpu"] });
  let fail = 0; const chk = (c, m) => { console.log(c ? "  ok:" : "  FAIL:", m); if (!c) fail++; };
  const norm = (t) => t.split(/\n+/).map((s) => s.replace(/\s+/g, " ").trim()).filter(Boolean);
  for (const [name, c] of Object.entries(CASES)) {
    const page = await browser.newPage(); await page.setContent(`<!doctype html><html><body>${c.html}</body></html>`);
    for (const f of ["shared/store.js", "shared/text.js", "shared/tts-engine.js", "content/read-page.js"]) await page.addScriptTag({ path: path.join(EXT, f) });
    const got = norm(await page.evaluate(() => window.__readAloudExtract()));
    chk(JSON.stringify(got) === JSON.stringify(c.expect), name + ": " + JSON.stringify(got).slice(0, 120));
    await page.close();
  }
  console.log(fail ? "SHADOW DOM E2E FAIL" : "SHADOW DOM E2E PASS"); await browser.close(); process.exit(fail ? 1 : 0);
})().catch((e) => { console.log("FAIL", e.message); process.exit(1); });
