/* Adversarial page-structure cases for page extraction (content/read-page.js) and the reader HTML parser.
 * Each case compares the words read, in order, against what a person sees. Chromium. */
const os = require("node:os"), path = require("node:path");
const puppeteer = require("puppeteer-core");
const EXT = path.resolve(__dirname, "..");
const CHROME = process.env.E2E_BROWSER || require("node:child_process").execSync("ls -d " + os.homedir() + "/chromium/linux-*/chrome-linux/chrome").toString().trim();
const L = (n) => "Sentence number " + n + " is here to give the block enough text so the scorer keeps it in the page.";
const deep = (n, inner) => "<div>".repeat(n) + inner + "</div>".repeat(n);
const PAGES = {
  "box in box 6 deep, text at each level": { html: `<div class="card">${L(1)}<div class="card">${L(2)}<div class="card">${L(3)}<div class="card">${L(4)}<div class="card">${L(5)}<div class="card">${L(6)}</div></div></div></div></div></div>`, expect: [1,2,3,4,5,6] },
  "sibling boxes, each with heading and text": { html: `<div class="grid"><div class="box"><h3>Alpha title heading</h3>${L(1)}</div><div class="box"><h3>Beta title heading</h3>${L(2)}</div><div class="box"><h3>Gamma title heading</h3>${L(3)}</div></div>`, expectWords: ["Alpha title heading", L(1), "Beta title heading", L(2), "Gamma title heading", L(3)] },
  "flex row with spans and divs mixed": { html: `<div style="display:flex"><span>${L(1)}</span><div>${L(2)}</div><span>${L(3)}</span></div>`, expect: [1,2,3] },
  "400 nested divs (stack depth)": { html: deep(400, L(1)), expect: [1] },
  "nested lists inside boxes": { html: `<div class="box"><ul><li>${L(1)}<ul><li>${L(2)}</li><li>${L(3)}</li></ul></li><li>${L(4)}</li></ul></div>`, expect: [1,2,3,4] },
  "blockquote in div in blockquote": { html: `<blockquote><div>${L(1)}<blockquote>${L(2)}</blockquote></div>${L(3)}</blockquote>`, expect: [1,2,3] },
  "details and summary": { html: `<details open><summary>Open this section now please</summary>${L(1)}</details><p>${L(2)} ${L(3)}</p>`, expectWords: ["Open this section now please", L(1), L(2) + " " + L(3)] },
  "definition list": { html: `<dl><dt>Term one name here</dt><dd>${L(1)}</dd><dt>Term two name here</dt><dd>${L(2)}</dd></dl>`, expectWords: ["Term one name here", L(1), "Term two name here", L(2)] },
  "pre block keeps lines separate": { html: `<pre>${L(1)}\n${L(2)}\n${L(3)}</pre>`, expect: [1,2,3] },
  "nbsp and zero-width characters": { html: `<div class="content">${L(1).replace(/ /g, "\u00a0")}<div>${L(2).replace("here", "he\u200bre")}</div></div>`, expect: [1,2], loose: true },
  "mixed Arabic and English": { html: `<div class="content"><p dir="rtl">مرحبا بكم في هذه الصفحة التي تحتوي على نص عربي طويل بما يكفي ليقرأه المحرك بشكل صحيح.</p><p>${L(1)}</p></div>`, expectWords: ["مرحبا بكم في هذه الصفحة التي تحتوي على نص عربي طويل بما يكفي ليقرأه المحرك بشكل صحيح.", L(1)] },
  "no duplicate text from wrapper elements": { html: `<div class="content"><section><article><div><span><b>${L(1)}</b></span></div></article></section></div>`, expect: [1] },
  "aria-hidden is still read, hidden attribute is not": { html: `<div class="content"><div>${L(1)}</div><div hidden>Hidden attribute text must stay silent here.</div><div>${L(2)}</div></div>`, expect: [1,2] },
  "offscreen absolutely positioned text is read (documents current behaviour; screen-reader-only text)": { html: `<div class="content"><div>${L(1)}</div><div style="position:absolute;left:-9999px">${L(2)}</div></div>`, expect: [1,2] },
  "iframe and canvas are ignored": { html: `<div class="content"><div>${L(1)}</div><iframe srcdoc="<p>Framed text must stay silent.</p>"></iframe><canvas>Canvas fallback text must stay silent.</canvas><div>${L(2)}</div></div>`, expect: [1,2] },
  "malformed: unclosed and mismatched tags": { html: `<div class="content"><div><p>${L(1)}<div><b>${L(2)}</i></div><p>${L(3)}</div></div>`, expectWords: [L(1), L(2), L(3)] },
  "binary garbage control characters around text": { html: `<div class="content"><p>${L(1)}\u0000\u0001\u0002\ufffd\ufffd</p><p>${L(2)}</p></div>`, expect: [1,2] },
  "2000 paragraphs (large document)": { html: `<div class="content">${Array.from({length:2000},(_, k)=>"<p>"+L(k)+"</p>").join("")}</div>`, expectWords: Array.from({length:2000},(_, k)=>L(k)) },
  "media and object fallbacks skipped, surrounding text kept": { html: `<div class="content"><p>${L(1)} <video controls>Video fallback silent text.</video> ${L(2)}</p><object data="x.swf">Object fallback silent text.</object><div>${L(3)}</div><audio>Audio fallback silent text.</audio><embed src="y"><div>${L(4)}</div></div>`, expectWords: [L(1) + " " + L(2), L(3), L(4)] },
  "details closed: only the summary is read, the body is skipped (user-approved)": { html: `<div class="content"><div>${L(1)}</div><details><summary>Summary stays readable now</summary>${L(2)}<p>${L(4)}</p></details><div>${L(3)}</div></div>`, expectWords: [L(1), "Summary stays readable now", L(3)] },
  "details closed with an open details inside: nothing inside is read": { html: `<div class="content"><div>${L(1)}</div><details><summary>Outer summary line</summary><details open><summary>Inner summary line</summary>${L(2)}</details></details><div>${L(3)}</div></div>`, expectWords: [L(1), "Outer summary line", L(3)] },
  "details open inside a page: summary and body read": { html: `<div class="content"><div>${L(1)}</div><details open><summary>Opened summary line</summary>${L(2)}</details><div>${L(3)}</div></div>`, expectWords: [L(1), "Opened summary line", L(2), L(3)] },
  "contenteditable region": { html: `<div contenteditable="true">${L(1)}<div>${L(2)}</div></div>`, expect: [1,2] },
  "table inside div inside table": { html: `<table><tr><td><div>${L(1)}<table><tr><td>${L(2)}</td><td>${L(3)}</td></tr></table></div></td></tr></table>`, expect: [1,2,3], loose: true },
  "button and form labels are not article text": { html: `<article><p>${L(1)} ${L(2)}</p><form><label>Email address field</label><input value="secret"><button>Subscribe now</button></form><p>${L(3)} ${L(4)}</p></article>`, expect: [1,2,3,4], loose: true, note: "form text must not be read" },
  "50k character single block": { html: `<div class="content"><p>${(L(1) + " ").repeat(550)}</p></div>`, bigCheck: true },
  "emoji and symbols between sentences": { html: `<div class="content"><p>${L(1)} \uD83D\uDE00\uD83D\uDE80 ${L(2)}</p></div>`, expect: [1,2], loose: true, anyEmoji: true },
};
(async () => {
  const FF = process.env.E2E_FIREFOX; // set to a Firefox binary to run the same cases in Firefox (WebDriver BiDi)
  const browser = FF ? await puppeteer.launch({ browser: "firefox", executablePath: FF, headless: true }) : await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox", "--disable-gpu"] });
  console.log("BROWSER", await browser.version());
  let fail = 0; const chk = (c, m) => { console.log(c ? "  ok:" : "  FAIL:", m); if (!c) fail++; };
  const norm = (t) => t.replace(/[\u200b]/g, "").replace(/\u00a0/g, " ").split(/\n+/).map((s) => s.replace(/\s+/g, " ").trim()).filter(Boolean);
  for (const [name, p] of Object.entries(PAGES)) {
    const page = await browser.newPage(); const errs = []; page.on("pageerror", (e) => errs.push(e.message));
    await page.setContent(`<!doctype html><html><body>${p.html}</body></html>`);
    for (const f of ["shared/store.js", "shared/text.js", "shared/tts-engine.js", "content/read-page.js", "shared/html-text.js"]) await page.addScriptTag({ path: path.join(EXT, f) });
    const t0 = Date.now();
    const live = await page.evaluate(() => window.__readAloudExtract()); const ms = Date.now() - t0;
    const file = await page.evaluate((h) => (window.RAText ? window.RAText.normalizeExtractedText(window.RAHtml.htmlToText(h)) : window.RAHtml.htmlToText(h)), `<!doctype html><html><body>${p.html}</body></html>`);
    const want = p.expectWords || (p.expect || []).map(L);
    for (const [label, got] of [["page", live], ["reader file", file]]) {
      let g = norm(got), w = want;
      if (p.bigCheck) { chk(g.join(" ").length > 20000 && ms < 5000, `${label} [${name}]: ${g.join(" ").length} chars in ${ms}ms`); continue; }
      if (p.loose) { g = [g.join(" ")]; w = [w.join(" ")]; }
      if (p.anyEmoji) { g = [g.join(" ").replace(/[\uD83C-\uDBFF][\uDC00-\uDFFF]/g, "").replace(/\s+/g, " ")]; }
      const ok = JSON.stringify(g) === JSON.stringify(w);
      chk(ok, `${label} [${name}]${ok ? "" : ": got " + JSON.stringify(g).slice(0, 300) + (p.note ? " (" + p.note + ")" : "")}`);
    }
    chk(errs.length === 0, `no page errors [${name}] ${errs.join("|").slice(0, 100)}`);
    await page.close();
  }
  console.log(fail ? "ADVERSARIAL EXTRACT FAIL (" + fail + ")" : "ADVERSARIAL EXTRACT PASS"); await browser.close(); process.exit(fail ? 1 : 0);
})().catch((e) => { console.log("FAIL", e.message); process.exit(1); });
