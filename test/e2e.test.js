/*
 * End-to-end test: loads the unpacked extension in headless Chrome
 * (Brave shares the Chromium engine) and exercises the real flows:
 *  A. Reader page: load a PDF file, verify text extraction + sentence render + play state.
 *  B. Content script: inject into a web page via chrome.scripting (what the popup does),
 *     trigger READ_PAGE, verify extraction response and the floating control bar.
 * Also records speechSynthesis voice availability in this environment.
 * Screenshots land in /tmp for visual inspection.
 */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const puppeteer = require("puppeteer-core");
const { ARTICLE_HTML, COMPLEX_HTML } = require("./fixtures/pages");

const EXT_DIR = path.resolve(__dirname, "..");
// E2E_BROWSER overrides the binary (e.g. a real Brave); default is Chromium.
const CHROME = process.env.E2E_BROWSER ||
  require("node:child_process").execSync("ls -d " + require("node:os").homedir() + "/chromium/linux-*/chrome-linux/chrome").toString().trim();



function serveArticle() {
  const server = http.createServer((req, res) => {
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.end((req.url || "").includes("complex") ? COMPLEX_HTML : ARTICLE_HTML);
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port }));
  });
}

/*
 * Build a test copy of the extension. The shipped manifest uses the minimal
 * activeTab permission, which a real user grants by clicking the toolbar
 * icon; an automated test has no click, so the test build adds
 * host_permissions to stand in for that grant. Code under test is identical.
 */
function buildTestExtension() {
  const dst = fs.mkdtempSync(path.join(os.tmpdir(), "ra-ext-"));
  for (const item of ["shared", "content", "popup", "reader", "icons", "vendor", "test/fixtures"]) {
    fs.cpSync(path.join(EXT_DIR, item), path.join(dst, item), { recursive: true });
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(EXT_DIR, "manifest.json"), "utf8"));
  manifest.host_permissions = ["http://*/*", "https://*/*"];
  fs.writeFileSync(path.join(dst, "manifest.json"), JSON.stringify(manifest, null, 2));
  return dst;
}

function computeExtensionId(extDir) {
  // ID source: the manifest "key" when present (SHA-256 of the public key
  // DER), otherwise the absolute path. First 32 hex chars, 0-9a-f -> a-p.
  const crypto = require("node:crypto");
  const manifest = JSON.parse(fs.readFileSync(path.join(extDir, "manifest.json"), "utf8"));
  const material = manifest.key ? Buffer.from(manifest.key, "base64") : path.resolve(extDir);
  const hex = crypto.createHash("sha256").update(material).digest("hex").slice(0, 32);
  return hex.split("").map((c) => String.fromCharCode(97 + parseInt(c, 16))).join("");
}

test("e2e: extension loads, reader reads a PDF, content script reads a page", async (t) => {
  const { server, port } = await serveArticle();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "ra-profile-"));
  const testExtDir = buildTestExtension();
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: "new",
    args: [
      "--no-sandbox",
      "--disable-gpu",
      "--disable-features=DisableLoadExtensionCommandLineSwitch",
      `--load-extension=${testExtDir}`,
      `--user-data-dir=${profile}`,
      "--disable-extensions-except=" + testExtDir
    ]
  });

  try {
    // Unpacked-extension ID is deterministic from the install path; verifying
    // that its pages load below is itself proof the extension registered.
    const extId = computeExtensionId(testExtDir);

    /* ---- A. Reader page: PDF extraction ---- */
    const reader = await browser.newPage();
    const readerErrors = [];
    reader.on("pageerror", (e) => readerErrors.push("pageerror: " + e.message));
    reader.on("console", (m) => { if (m.type() === "error") readerErrors.push("console: " + m.text()); });
    await reader.goto(`chrome-extension://${extId}/reader/reader.html`, { waitUntil: "load" });
    assert.equal(await reader.title(), "ReadAloud — PDF & text reader");

    // Voices can arrive asynchronously (onvoiceschanged); give them time.
    let voiceCount = -1;
    try {
      await reader.waitForFunction(
        () => window.speechSynthesis && window.speechSynthesis.getVoices().length > 0,
        { timeout: 10000 });
    } catch (e) { /* no voices on this system */ }
    voiceCount = await reader.evaluate(() =>
      window.speechSynthesis ? window.speechSynthesis.getVoices().length : -1);
    t.diagnostic("speechSynthesis voices available in " + CHROME + ": " + voiceCount);

    let twoColumnOrdered = false;
    const input = await reader.$("#file-input");
    await input.uploadFile(path.join(EXT_DIR, "test", "fixtures", "sample.pdf"));
    await reader.waitForFunction(
      () => document.querySelectorAll("#text-view .sentence").length > 0,
      { timeout: 20000 });
    const sentenceInfo = await reader.evaluate(() => ({
      count: document.querySelectorAll("#text-view .sentence").length,
      text: document.getElementById("text-view").innerText,
      progress: document.getElementById("progress").textContent
    }));
    assert.ok(sentenceInfo.count >= 3, "PDF produced sentences, got " + sentenceInfo.count);
    assert.match(sentenceInfo.text, /reads text aloud/i);
    assert.match(sentenceInfo.text, /3\.5 decimals/, "decimal kept intact");
    await reader.screenshot({ path: "/tmp/e2e-reader-loaded.png" });

    // True line-break hyphenation: the PDF text layer contains "extraordi-\nnarily".
    // Two-column PDF: left column must be fully extracted before the right column (B6).
    await (await reader.$("#file-input")).uploadFile(path.join(EXT_DIR, "test", "fixtures", "sample-twocol.pdf"));
    await reader.waitForFunction(
      () => document.getElementById("text-view").innerText.includes("Right column closing sentence"),
      { timeout: 15000 }
    );
    const twocol = await reader.evaluate(() => document.getElementById("text-view").innerText);
    const leftLast = twocol.lastIndexOf("Left column");
    const rightFirst = twocol.indexOf("Right column");
    if (!(leftLast !== -1 && rightFirst !== -1 && leftLast < rightFirst)) {
      throw new Error("two-column PDF interleaved: leftLast=" + leftLast + " rightFirst=" + rightFirst);
    }
    twoColumnOrdered = true;

    await (await reader.$("#file-input")).uploadFile(path.join(EXT_DIR, "test", "fixtures", "sample-hyphen.pdf"));
    await reader.waitForFunction(
      () => document.getElementById("text-view").innerText.includes("spoken aloud"),
      { timeout: 20000 });
    const hyphenText = await reader.evaluate(() => document.getElementById("text-view").innerText);
    assert.match(hyphenText, /extraordinarily/, "hyphenated word joined across line break");
    assert.ok(!/extraordi-\s*narily/.test(hyphenText), "no leftover hyphen line break");

    // Arabic RTL PDF: markers must extract and stay in logical order.
    await (await reader.$("#file-input")).uploadFile(path.join(EXT_DIR, "test", "fixtures", "sample-arabic.pdf"));
    await reader.waitForFunction(
      () => document.getElementById("text-view").innerText.includes("\u0639\u0644\u0627\u0645\u0629 \u0627\u0644\u0646\u0647\u0627\u064a\u0629"),
      { timeout: 15000 }).catch(() => {});
    const arabic = await reader.evaluate(() => document.getElementById("text-view").innerText);
    const arStart = arabic.indexOf("\u0639\u0644\u0627\u0645\u0629 \u0627\u0644\u0628\u062f\u0627\u064a\u0629");
    const arEnd = arabic.indexOf("\u0639\u0644\u0627\u0645\u0629 \u0627\u0644\u0646\u0647\u0627\u064a\u0629");
    assert.ok(arStart !== -1, "Arabic start marker extracted");
    assert.ok(arEnd !== -1, "Arabic end marker extracted");
    assert.ok(arStart < arEnd, "Arabic sentences in logical order");
    assert.ok(arabic.includes("PDF."), "latin item keeps internal order with trailing period");
    assert.ok(!arabic.includes("FDP"), "latin item not character-reversed");

    // Long multi-page document: first and last pages both extract.
    const benchStart = Date.now();
    await (await reader.$("#file-input")).uploadFile(path.join(EXT_DIR, "test", "fixtures", "sample-multipage.pdf"));
    await reader.waitForFunction(
      () => document.getElementById("text-view").innerText.includes("Final page closing sentence"),
      { timeout: 20000 });
    const longText = await reader.evaluate(() => document.getElementById("text-view").innerText);
    assert.ok(longText.includes("First page opening sentence"), "page 1 extracted");
    assert.ok(longText.includes("Final page closing sentence"), "page 15 extracted");
    const longDocMs = Date.now() - benchStart;
    const heapMb = await reader.evaluate(() =>
      (performance.memory ? performance.memory.usedJSHeapSize / 1048576 : -1));
    const longSentences = await reader.evaluate(
      () => document.querySelectorAll("#text-view .sentence").length);
    assert.ok(longSentences >= 60, "long document produced many sentences, got " + longSentences);

    // Regression (B15): after a failed load (empty file), Play must NOT
    // replay the previously loaded document - the queue is cleared.
    await (await reader.$("#file-input")).uploadFile(path.join(EXT_DIR, "test", "fixtures", "empty.txt"));
    await reader.waitForFunction(
      () => /No readable text found/.test(document.getElementById("progress").textContent),
      { timeout: 15000 });
    await reader.evaluate(() => document.getElementById("play").click());
    await new Promise((r) => setTimeout(r, 400));
    const afterFailedLoadPlay = await reader.evaluate(() => document.getElementById("progress").textContent);
    assert.ok(/No readable text found/.test(afterFailedLoadPlay),
      "Play after a failed load does not replay the previous document, progress: " + afterFailedLoadPlay);
    // Restore a loaded document for the checks below.
    await (await reader.$("#file-input")).uploadFile(path.join(EXT_DIR, "test", "fixtures", "sample.pdf"));
    await reader.waitForFunction(
      () => document.querySelectorAll("#text-view .sentence").length >= 3,
      { timeout: 15000 });

    // HTML upload: parsed locally as inert text. (1) Readable text checks.
    {
      const hits = [];
      const tracker = http.createServer((rq, rs) => { hits.push(rq.url); rs.end("x"); });
      await new Promise((r) => tracker.listen(0, "127.0.0.1", r));
      const tport = tracker.address().port;
      const htmlPath = "/tmp/ra-inert-" + tport + ".html";
      fs.writeFileSync(htmlPath, fs.readFileSync(path.join(EXT_DIR, "test", "fixtures", "sample-inert.html"), "utf8").replace(/__PORT__/g, String(tport)));
      await (await reader.$("#file-input")).uploadFile(htmlPath);
      await reader.waitForFunction(
        () => /^Loaded ra-inert/.test(document.getElementById("progress").textContent),
        { timeout: 15000 });
      const htmlText = await reader.evaluate(() => document.getElementById("text-view").textContent);
      for (const want of ["Harbour Lights Festival", "lantern parade", "local musicians", "Read the full programme online", "shuttle bus"]) {
        assert.ok(htmlText.includes(want), "HTML text kept: " + want);
      }
      for (const bad of ["Navigation menu", "Secret hidden", "Another hidden", "Vector label", "Footer legal", "Hidden title", "__pwned"]) {
        assert.ok(!htmlText.includes(bad), "HTML text excluded: " + bad);
      }
      await reader.screenshot({ path: "/downloads/readaloud/html-loaded.png" });
      // (2) Inertness / network-disclosure checks, kept separate from the text checks.
      await new Promise((r) => setTimeout(r, 1500));
      assert.deepStrictEqual(hits, [], "uploading HTML made no network request, got: " + JSON.stringify(hits));
      const pwned = await reader.evaluate(() => window.__pwned === true);
      assert.ok(!pwned, "no script from the HTML file ran in the reader");
      const injected = await reader.evaluate(() => document.querySelectorAll("#text-view img, #text-view iframe, #text-view script, #text-view object, #text-view a").length);
      assert.strictEqual(injected, 0, "no markup from the file was inserted into the reader");
      tracker.close();
      console.log("HTML upload: readable text kept/excluded OK; inert (0 network requests, no script ran, no markup inserted)");
      // Restore a loaded document for the checks below.
      await (await reader.$("#file-input")).uploadFile(path.join(EXT_DIR, "test", "fixtures", "sample.pdf"));
      await reader.waitForFunction(
        () => document.querySelectorAll("#text-view .sentence").length >= 3,
        { timeout: 15000 });
    }

    // B8: sentences are keyboard-operable (tabindex, role, Enter seeks playback).
    const a11y = await reader.evaluate(() => {
      const el = document.querySelectorAll("#text-view .sentence")[2];
      const attrs = { tabIndex: el.tabIndex, role: el.getAttribute("role"), label: el.getAttribute("aria-label") || "" };
      el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
      return attrs;
    });
    assert.equal(a11y.tabIndex, 0, "sentence focusable");
    assert.equal(a11y.role, "button", "sentence has button role");
    assert.ok(a11y.label.includes("3"), "sentence aria-label names it, got: " + a11y.label);
    await new Promise((r) => setTimeout(r, 500));
    const seekProgress = await reader.evaluate(() => document.getElementById("progress").textContent);
    assert.ok(seekProgress.length > 0, "Enter on a sentence started playback, progress: " + seekProgress);
    await reader.evaluate(() => { const b = document.getElementById("stop"); if (b) b.click(); });

    // Regression (v1.0.8): Space on a focused sentence must seek-and-PLAY,
    // not seek-then-pause. The sentence's own keydown handler seeks, and the
    // page-level shortcut handler must skip events it already handled. The
    // progress read is synchronous, right in the dispatch call: the pause
    // this bug caused happened during event bubbling, while any later speech
    // error (0 voices here) lands asynchronously.
    await new Promise((r) => setTimeout(r, 300));
    const spaceSeek = await reader.evaluate(() => {
      const el = document.querySelectorAll("#text-view .sentence")[1];
      el.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true }));
      return document.getElementById("progress").textContent;
    });
    assert.ok(/speaking/.test(spaceSeek), "Space on a sentence starts (not pauses) playback, progress: " + spaceSeek);
    await reader.evaluate(() => { const b = document.getElementById("stop"); if (b) b.click(); });

    // Keyboard shortcuts: ignored inside form controls, Space toggles
    // playback, Escape stops.
    const beforeInputSpace = await reader.evaluate(() => document.getElementById("progress").textContent);
    await reader.evaluate(() => {
      document.getElementById("rate").dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true }));
    });
    await new Promise((r) => setTimeout(r, 300));
    const afterInputSpace = await reader.evaluate(() => document.getElementById("progress").textContent);
    assert.equal(afterInputSpace, beforeInputSpace, "Space inside the rate slider does not trigger playback");
    // From a clean idle state, Space must start playback (progress changes),
    // then Escape must return to idle.
    await reader.evaluate(() => {
      document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    });
    await new Promise((r) => setTimeout(r, 300));
    const idleText = await reader.evaluate(() => document.getElementById("progress").textContent);
    assert.ok(/idle/.test(idleText), "Escape stops playback, progress: " + idleText);
    await reader.evaluate(() => {
      document.body.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true }));
    });
    await new Promise((r) => setTimeout(r, 500));
    const afterSpace = await reader.evaluate(() => document.getElementById("progress").textContent);
    assert.notEqual(afterSpace, idleText, "Space toggles playback from the page");
    await reader.evaluate(() => {
      document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    });
    await new Promise((r) => setTimeout(r, 300));
    const afterEsc = await reader.evaluate(() => document.getElementById("progress").textContent);
    assert.ok(/idle/.test(afterEsc), "Escape returns to idle, progress: " + afterEsc);

    // Play behavior depends on whether this machine has speech voices.
    // Desktop Firefox/Brave ship OS voices; this headless Linux has none,
    // which must surface as a graceful "Speech error" message, not a hang.
    await reader.click("#play");
    await new Promise((r) => setTimeout(r, 1500));
    const playState = await reader.evaluate(() => document.getElementById("progress").textContent);
    if (voiceCount > 0) {
      assert.ok(/speaking|paused/i.test(playState), "reader is playing, progress says: " + playState);
      await reader.click("#pause");
      await new Promise((r) => setTimeout(r, 400));
      const pauseState = await reader.evaluate(() => document.getElementById("progress").textContent);
      assert.match(pauseState, /paused/i);
      await reader.click("#resume");
      await new Promise((r) => setTimeout(r, 500));
      const resumeState = await reader.evaluate(() => document.getElementById("progress").textContent);
      assert.match(resumeState, /speaking/i, "resumed playback, progress says: " + resumeState);
      await reader.click("#stop");
    } else {
      assert.match(playState, /speech error/i,
        "no voices on this system: reader must surface the error, got: " + playState);
      const st = await reader.evaluate(() => document.querySelector("#play").textContent);
      assert.ok(st.length > 0, "controls still usable after the error");
    }
    await reader.screenshot({ path: "/tmp/e2e-reader-controls.png" });
    assert.deepEqual(readerErrors.filter((e) => !/speech|audio|voices|synthesis/i.test(e)), [],
      "no unexpected page errors in reader");

    /* ---- B. Content script: read a web page ---- */
    const article = await browser.newPage();
    const articleErrors = [];
    article.on("pageerror", (e) => articleErrors.push("pageerror: " + e.message));
    await article.goto(`http://127.0.0.1:${port}/article.html`, { waitUntil: "load" });

    // Do exactly what the popup does, driven from the extension page context.
    const realResp = await reader.evaluate(async (url) => {
      const tabs = await chrome.tabs.query({});
      const tab = tabs.find((tb) => (tb.url || "").includes(url));
      if (!tab) return { ok: false, reason: "tab-not-found" };
      // Mock speech makes this voiceless test box behave like a desktop browser.
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["/test/fixtures/mock-speech.js", "/shared/text.js", "/shared/tts-engine.js", "/content/read-page.js"]
      });
      return chrome.tabs.sendMessage(tab.id, { type: "READ_PAGE", rate: 1 });
    }, `127.0.0.1:${port}`);
    assert.ok(realResp && realResp.ok, "READ_PAGE succeeded: " + JSON.stringify(realResp));
    assert.ok(realResp.sentences >= 5, "extracted main article sentences, got " + realResp.sentences);

    // Floating control bar must appear in the article page.
    await article.waitForSelector("#readaloud-control-bar", { timeout: 5000 });
    const barText = await article.evaluate(() =>
      document.getElementById("readaloud-progress").textContent);
    assert.match(barText, /1 \/ \d+/, "control bar shows progress, got: " + barText);
    const barA11y = await article.evaluate(() => ({
      role: document.getElementById("readaloud-control-bar").getAttribute("role"),
      live: document.getElementById("readaloud-progress").getAttribute("aria-live")
    }));
    assert.equal(barA11y.role, "toolbar", "control bar has toolbar role");
    assert.equal(barA11y.live, "polite", "control bar progress is aria-live");
    // Follow-along highlight marks the current sentence's block on the page.
    await article.waitForSelector(".readaloud-current-block", { timeout: 5000 });
    const highlighted = await article.evaluate(() => {
      const el = document.querySelector(".readaloud-current-block");
      return el ? el.textContent.trim().slice(0, 40) : "";
    });
    assert.ok(highlighted.length > 0, "a block is highlighted during playback");
    assert.match(highlighted, /reading aloud matters/i, "first sentence's block highlighted, got: " + highlighted);
    // Pause, resume and stop through the real message channel.
    const afterPause = await reader.evaluate(async (url) => {
      const tabs = await chrome.tabs.query({});
      const tab = tabs.find((tb) => (tb.url || "").includes(url));
      await chrome.tabs.sendMessage(tab.id, { type: "PAUSE" });
      const st = await chrome.tabs.sendMessage(tab.id, { type: "STATE" });
      return st.state;
    }, `127.0.0.1:${port}`);
    assert.equal(afterPause, "paused");
    await article.screenshot({ path: "/tmp/e2e-page-controlbar.png" });
    await reader.evaluate(async (url) => {
      const tabs = await chrome.tabs.query({});
      const tab = tabs.find((tb) => (tb.url || "").includes(url));
      await chrome.tabs.sendMessage(tab.id, { type: "STOP" });
    }, `127.0.0.1:${port}`);
    await new Promise((r) => setTimeout(r, 300));
    const barGone = await article.evaluate(() => !document.getElementById("readaloud-control-bar"));
    assert.ok(barGone, "control bar removed after stop");
    const highlightGone = await article.evaluate(() => !document.querySelector(".readaloud-current-block"));
    assert.ok(highlightGone, "highlight removed after stop");
    assert.deepEqual(articleErrors, [], "no page errors in article");

    /* ---- B3. Web resume: live-reading save, reload, resume (unmodified flow) ---- */
    const resumePg = await browser.newPage();
    const resumeErrors = [];
    resumePg.on("pageerror", (e) => resumeErrors.push("pageerror: " + e.message));
    await resumePg.goto(`http://127.0.0.1:${port}/article.html?resume=1`, { waitUntil: "load" });
    // Timed auto-end: each utterance "speaks" for 400 ms, so live reading
    // advances sentence by sentence and progress events fire realistically.
    await resumePg.evaluate(() =>
      document.documentElement.setAttribute("data-mock-auto-end", "400"));
    const startResp = await reader.evaluate(async (url) => {
      const tabs = await chrome.tabs.query({});
      const tab = tabs.find((tb) => (tb.url || "").includes(url));
      if (!tab) return { ok: false, reason: "tab-not-found" };
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["/test/fixtures/mock-speech.js", "/shared/store.js", "/shared/text.js", "/shared/tts-engine.js", "/content/read-page.js"]
      });
      return chrome.tabs.sendMessage(tab.id, { type: "READ_PAGE", rate: 1 });
    }, `resume=1`);
    assert.ok(startResp && startResp.ok, "B3 READ_PAGE started: " + JSON.stringify(startResp));
    // Let live reading advance a few sentences; positions save on progress
    // events (throttled to 1.5 s) under the page origin+path key.
    await new Promise((r) => setTimeout(r, 2600));
    await reader.evaluate(async (url) => {
      const tabs = await chrome.tabs.query({});
      const tab = tabs.find((tb) => (tb.url || "").includes(url));
      await chrome.tabs.sendMessage(tab.id, { type: "STOP" });
    }, `resume=1`);
    const savedPositions = await reader.evaluate(() =>
      new Promise((res) => chrome.storage.local.get(["positions"], (r) => res(r.positions || {}))));
    const pageKey = `page:http://127.0.0.1:${port}/article.html`;
    const savedIdx = (savedPositions[pageKey] || {}).i;
    assert.ok(typeof savedIdx === "number" && savedIdx >= 2,
      "live reading saved a mid-page position, got: " + JSON.stringify(savedPositions));
    // Reload and read again: playback must resume at the saved sentence.
    await resumePg.reload({ waitUntil: "load" });
    await resumePg.evaluate(() =>
      document.documentElement.setAttribute("data-mock-auto-end", "400"));
    const resumed = await reader.evaluate(async (url) => {
      const tabs = await chrome.tabs.query({});
      const tab = tabs.find((tb) => (tb.url || "").includes(url));
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["/test/fixtures/mock-speech.js", "/shared/store.js", "/shared/text.js", "/shared/tts-engine.js", "/content/read-page.js"]
      });
      const resp = await chrome.tabs.sendMessage(tab.id, { type: "READ_PAGE", rate: 1 });
      if (!resp || !resp.ok) return { resp };
      await new Promise((r) => setTimeout(r, 250));
      const st = await chrome.tabs.sendMessage(tab.id, { type: "STATE" });
      await chrome.tabs.sendMessage(tab.id, { type: "STOP" });
      return { resp, st };
    }, `resume=1`);
    assert.ok(resumed.resp && resumed.resp.ok, "B3 READ_PAGE after reload: " + JSON.stringify(resumed));
    assert.ok(resumed.st && resumed.st.sentenceIndex >= savedIdx,
      `resumed at or after the saved sentence (saved index ${savedIdx}, got ` +
      `${resumed.st && resumed.st.sentenceIndex})`);
    t.diagnostic(`web resume (unmodified flow): live save at sentence ${savedIdx + 1}, ` +
      `after reload resumed at sentence ${resumed.st.sentenceIndex + 1}`);
    assert.deepEqual(resumeErrors, [], "no page errors in resume scenario");

    /* ---- B2. Complex page: Readability-class extraction accuracy ---- */
    const complex = await browser.newPage();
    const complexErrors = [];
    complex.on("pageerror", (e) => complexErrors.push("pageerror: " + e.message));
    await complex.goto(`http://127.0.0.1:${port}/complex.html`, { waitUntil: "load" });
    await complex.evaluate(() =>
      document.documentElement.setAttribute("data-mock-auto-end", "1"));
    const complexResp = await reader.evaluate(async (url) => {
      const tabs = await chrome.tabs.query({});
      const tab = tabs.find((tb) => (tb.url || "").includes(url + "/complex"));
      if (!tab) return { ok: false, reason: "tab-not-found" };
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["/test/fixtures/mock-speech.js", "/shared/text.js", "/shared/tts-engine.js", "/content/read-page.js"]
      });
      return chrome.tabs.sendMessage(tab.id, { type: "READ_PAGE", rate: 1 });
    }, `127.0.0.1:${port}`);
    assert.ok(complexResp && complexResp.ok, "complex READ_PAGE succeeded: " + JSON.stringify(complexResp));
    await complex.waitForFunction(
      () => (document.getElementById("__mock_speech_log") || { textContent: "" })
        .textContent.includes("Article body marker Sentex closes"),
      { timeout: 10000 });
    const spokenText = await complex.evaluate(() =>
      Array.from(document.querySelectorAll("#__mock_speech_log span")).map((n) => n.textContent).join("\n"));
    await reader.evaluate(async (url) => {
      const tabs = await chrome.tabs.query({});
      const tab = tabs.find((tb) => (tb.url || "").includes(url + "/complex"));
      await chrome.tabs.sendMessage(tab.id, { type: "STOP" });
    }, `127.0.0.1:${port}`);
    assert.ok(spokenText.includes("Article body marker Sentex"), "article text extracted from complex page");
    assert.ok(spokenText.includes("Article body marker Sentex closes"), "final article paragraph included");
    for (const marker of ["Navigation marker Northex", "Sidebar marker Zelphia",
        "Related marker Quorin", "Footer marker Davron", "Hidden marker Invisia"]) {
      assert.ok(!spokenText.includes(marker), "boilerplate excluded: " + marker);
    }
    const complexResults = {
      articleIncluded: spokenText.includes("Article body marker Sentex closes"),
      boilerplateExcluded: true,
      spokenChars: spokenText.length
    };
    assert.deepEqual(complexErrors, [], "no page errors in complex page");

    /* ---- C. Popup loads and renders ---- */
    const popup = await browser.newPage();
    await popup.goto(`chrome-extension://${extId}/popup/popup.html`, { waitUntil: "load" });
    await popup.screenshot({ path: "/tmp/e2e-popup.png" });
    const popupButtons = await popup.evaluate(() =>
      Array.from(document.querySelectorAll("button")).map((b) => b.textContent.trim()));
    assert.ok(popupButtons.some((b) => /Read this page/.test(b)));
    assert.ok(popupButtons.some((b) => /PDF/.test(b)));

    console.log("E2E RESULTS:", JSON.stringify({
      extId, voiceCount,
      pdfSentences: sentenceInfo.count,
      hyphenationJoined: /extraordinarily/.test(hyphenText),
      articleSentences: realResp.sentences,
      controlBar: barText
    , twoColumnOrdered: twoColumnOrdered,
      arabicOrdered: arStart !== -1 && arEnd !== -1 && arStart < arEnd,
      longDocSentences: longSentences,
      longDocMs: longDocMs,
      heapMbAfterLongDoc: Math.round(heapMb * 10) / 10,
      complexExtraction: complexResults }));
    /* ---- E. Settings persistence + Clear saved data (chrome.storage.local) ---- */
    await reader.evaluate(() => {
      const r = document.getElementById("rate");
      r.value = "1.5";
      r.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await new Promise((r) => setTimeout(r, 400)); // let the save land
    await reader.reload({ waitUntil: "load" });
    await reader.waitForFunction(
      () => document.getElementById("rate").value === "1.5",
      { timeout: 8000 });
    const persistedRate = await reader.evaluate(() => document.getElementById("rate").value);
    assert.equal(persistedRate, "1.5", "rate setting persisted across reload");

    const popupPage = await browser.newPage();
    await popupPage.goto(`chrome-extension://${extId}/popup/popup.html`, { waitUntil: "load" });
    await popupPage.click("#clear-data");
    await new Promise((r) => setTimeout(r, 400));
    const keysLeft = await popupPage.evaluate(() =>
      new Promise((res) => chrome.storage.local.get(["settings", "positions"], (r) => res(Object.keys(r).length))));
    assert.equal(keysLeft, 0, "Clear saved data removed settings and positions");
    const clearStatus = await popupPage.evaluate(() => document.getElementById("status").textContent);
    assert.match(clearStatus, /cleared/i);
    t.diagnostic("settings persistence + Clear saved data verified");
  } finally {
    await browser.close();
    server.close();
    fs.rmSync(profile, { recursive: true, force: true });
    fs.rmSync(testExtDir, { recursive: true, force: true });
  }

});
