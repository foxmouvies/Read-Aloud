/* Text directly inside <div> (and mixed div/p content) must be extracted, in source order, without duplicates:
 * page extraction (content/read-page.js) and the reader's HTML file parser (shared/html-text.js). Chromium/Brave. */
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const puppeteer = require("puppeteer-core");
const EXT = path.resolve(__dirname, "..");
const CHROME = process.env.E2E_BROWSER || require("node:child_process").execSync("ls -d " + os.homedir() + "/chromium/linux-*/chrome-linux/chrome").toString().trim();
const L = (n) => "Sentence number " + n + " is here to give the block enough text so the scorer keeps it in the page.";
const PAGES = {
  "div-only": { html: `<div id="c"><div>${L(1)}</div><div>${L(2)}</div><div>${L(3)}</div></div>`, expect: [L(1), L(2), L(3)] },
  "nested divs with direct text": { html: `<div class="content"><div>${L(1)}<div>${L(2)}<div>${L(3)}</div></div></div></div>`, expect: [L(1), L(2), L(3)] },
  "mixed: direct div text, p, direct div text": { html: `<div class="content">${L(1)}<p>${L(2)}</p>${L(3)}<p>${L(4)}</p></div>`, expect: [L(1), L(2), L(3), L(4)] },
  "inline tags inside div": { html: `<div class="content">${L(1)} <b>bold words</b> and <a href="#">a link</a> end.<p>${L(2)}</p></div>`, expect: [L(1) + " bold words and a link end.", L(2)] },
  "long p plus direct div text": { html: `<div class="content"><p>${L(1)} ${L(2)}</p>${L(3)}<p>${L(4)} ${L(5)}</p><div>${L(6)}</div></div>`, expect: [L(1) + " " + L(2), L(3), L(4) + " " + L(5), L(6)] },
  "long p plus div wrapped text, nested": { html: `<main><div><p>${L(1)} ${L(2)}</p><div>${L(3)}<div>${L(4)}</div></div><p>${L(5)} ${L(6)}</p></div></main>`, expect: [L(1) + " " + L(2), L(3), L(4), L(5) + " " + L(6)] },
  "hidden content never read": { html: `<div class="content"><div>${L(1)}</div><div style="display:none">Hidden display none text must stay silent here.</div><div style="visibility:hidden">Hidden visibility text must stay silent too.</div><div hidden>Hidden attribute text stays silent.</div><div>${L(2)}</div></div>`, expect: [L(1), L(2)] },
  "hidden-only page reads nothing": { html: `<div style="display:none">Only hidden text lives on this page.</div>`, expect: [] },
  "script and style text never read": { html: `<div class="content"><style>.x{color:red}</style><script>var secret = "script text";</script><div>${L(1)}</div></div>`, expect: [L(1)] },
  "nav-only page: walker empty, falls back to visible body text": { html: `<nav><div>Menu Home Links Contact</div></nav>`, expect: ["Menu Home Links Contact"], expectFile: [] },
  "comments and share blocks inside the article are skipped": { html: `<article><p>${L(1)} ${L(2)}</p>${L(3)}<div class="comments"><div>Comment text from a reader must stay silent here.</div></div><div class="share-buttons">Share this on social sites</div><p>${L(4)} ${L(5)}</p></article>`, expect: [L(1) + " " + L(2), L(3), L(4) + " " + L(5)] },
  "side story next to the article is not mixed in": { html: `<div class="page"><div class="story">${L(1)}<p>${L(2)} ${L(3)}</p>${L(4)}</div><div class="sidebar"><div>Sidebar teaser text for another story entirely.</div></div></div>`, expect: [L(1), L(2) + " " + L(3), L(4)] },
  "legit classes that only contain boilerplate words as substrings are kept": { html: `<div class="story"><div class="commentary">${L(1)}</div><div class="shareholder-letter">${L(2)}</div><div class="social-studies">${L(3)}</div><div class="unrelated-note banner-story">${L(4)}</div><p>${L(5)} ${L(6)}</p></div>`, expect: [L(1), L(2), L(3), L(4), L(5) + " " + L(6)], onlyFile: true },
  "text directly in body next to paragraphs": { html: `${L(1)}<p>${L(2)} ${L(3)}</p>${L(4)}<p>${L(5)} ${L(6)}</p>`, expect: [L(1), L(2) + " " + L(3), L(4), L(5) + " " + L(6)] },
  "table layout page": { html: `<table><tr><td>${L(1)}</td><td>${L(2)}</td></tr><tr><td>${L(3)}<br>${L(4)}</td></tr></table>`, expect: [L(1), L(2), L(3) + " " + L(4)], loose: true },
  "br separated lines in a div": { html: `<div class="content">${L(1)}<br>${L(2)}<br><br>${L(3)}</div>`, expect: [L(1) + " " + L(2) + " " + L(3)], loose: true },
  "article wrapped in a class named like boilerplate is still read": { html: `<div class="comments"><p>${L(1)}</p><p>${L(2)}</p><p>${L(3)}</p></div>`, expect: [L(1), L(2), L(3)], expectFile: [L(1), L(2), L(3)] },
  "article wrapped in a sidebar-named class next to a short real paragraph is still read": { html: `<div class="page"><p>${L(9)}</p><div class="sidebar"><p>${L(1)}</p><p>${L(2)}</p><p>${L(3)}</p><p>${L(4)}</p></div></div>`, expect: [L(9), L(1), L(2), L(3), L(4)], expectFile: [L(9), L(1), L(2), L(3), L(4)] },
  "long comment thread next to a short article is still skipped": { html: `<article><p>${L(1)} ${L(2)}</p></article><div class="comments"><p>${L(3)}</p><p>${L(4)}</p><p>${L(5)}</p><p>${L(6)}</p><p>${L(7)}</p></div>`, expect: [L(1) + " " + L(2)], expectFile: [L(1) + " " + L(2)] },
  "figure caption is read": { html: `<article><p>${L(1)}</p><figure><img alt="x"><figcaption>${L(2)}</figcaption></figure><p>${L(3)}</p></article>`, expect: [L(1), L(2), L(3)], expectFile: [L(1), L(2), L(3)] },
  "article header (title, byline) is read": { html: `<article><header><h1>Harbour festival opens on Friday evening</h1><p>By the harbour office</p></header><p>${L(1)}</p><p>${L(2)}</p><p>${L(3)}</p></article>`, expect: ["Harbour festival opens on Friday evening", "By the harbour office", L(1), L(2), L(3)], expectFile: ["Harbour festival opens on Friday evening", "By the harbour office", L(1), L(2), L(3)] },
  "site header outside the article stays skipped": { html: `<header><h1>Site name and tagline for the whole website</h1></header><article><p>${L(1)}</p><p>${L(2)}</p><p>${L(3)}</p></article>`, expect: [L(1), L(2), L(3)], expectFile: [L(1), L(2), L(3)] },
  "nav inside an article header stays skipped": { html: `<article><header><h1>Harbour festival opens on Friday evening</h1><nav><a href="#">Home page link</a> <a href="#">About us link</a></nav></header><p>${L(1)}</p><p>${L(2)}</p><p>${L(3)}</p></article>`, expect: ["Harbour festival opens on Friday evening", L(1), L(2), L(3)], expectFile: ["Harbour festival opens on Friday evening", L(1), L(2), L(3)] },
  "share toolbar class inside an article header stays skipped": { html: `<article><header><h1>Harbour festival opens on Friday evening</h1><div class="share"><span>Share this story with friends now</span></div></header><p>${L(1)}</p><p>${L(2)}</p><p>${L(3)}</p></article>`, expect: ["Harbour festival opens on Friday evening", L(1), L(2), L(3)], expectFile: ["Harbour festival opens on Friday evening", L(1), L(2), L(3)] },
  "p only (control)": { html: `<article><p>${L(1)}</p><p>${L(2)}</p><p>${L(3)}</p></article>`, expect: [L(1), L(2), L(3)] },
  "boilerplate excluded": { html: `<nav><div>Menu Home Links Contact</div></nav><div class="content"><div>${L(1)}</div><div>${L(2)}</div></div><footer><div>Footer text should not be read here</div></footer>`, expect: [L(1), L(2)] },
};
(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox", "--disable-gpu"] });
  let fail = 0; const chk = (c, m) => { console.log(c ? "  ok:" : "  FAIL:", m); if (!c) fail++; };
  const norm = (t) => t.split(/\n+/).map((s) => s.replace(/\s+/g, " ").trim()).filter(Boolean);
  for (const [name, p] of Object.entries(PAGES)) {
    const page = await browser.newPage(); await page.setContent(`<!doctype html><html><body>${p.html}</body></html>`);
    for (const f of ["shared/store.js", "shared/text.js", "shared/tts-engine.js", "content/read-page.js", "shared/html-text.js"]) await page.addScriptTag({ path: path.join(EXT, f) });
    const live = await page.evaluate(() => window.__readAloudExtract());
    const lv = p.loose ? [norm(live).join(" ")] : norm(live); chk(JSON.stringify(lv) === JSON.stringify(p.loose ? [p.expect.join(" ")] : p.expect), "page [" + name + "]: " + JSON.stringify(norm(live)).slice(0, 160));
    const file = await page.evaluate((h) => window.RAHtml.htmlToText(h), `<!doctype html><html><body>${p.html}</body></html>`);
    let rd = norm(window_normalize(file)); if (p.loose) rd = [rd.join(" ")];
    chk(JSON.stringify(rd) === JSON.stringify(p.loose ? [p.expect.join(" ")] : (p.expectFile || p.expect)), "reader file [" + name + "]: " + JSON.stringify(rd).slice(0, 160));
    await page.close();
  }
  function window_normalize(t) { return t; }
  console.log(fail ? "DIV TEXT E2E FAIL" : "DIV TEXT E2E PASS"); await browser.close(); process.exit(fail ? 1 : 0);
})().catch((e) => { console.log("FAIL", e.message); process.exit(1); });
