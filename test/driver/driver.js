/* Test-only driver page (never shipped in the release zip): stands in for
 * the toolbar-button click, which no automation API can perform in Firefox.
 * It loads the REAL popup (popup/popup.html, unmodified) in an iframe and
 * clicks its real buttons, so the entire production path runs: popup click
 * handler -> production installDispatcher + inject-files -> production
 * dispatcher -> production content handler. Direct STATE/SET_RATE messages
 * used for assertions are delivered by the same production dispatcher. */
(async () => {
  document.title = "MSGFLOW STEP boot";
  const port = new URLSearchParams(location.search).get("port") || "8917";
  const pageUrl = `http://127.0.0.1:${port}/complex.html`;
  const out = { pageUrl };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  try {
    const tab = await chrome.tabs.create({ url: pageUrl, active: true });
    await new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error("tab load timeout")), 20000);
      const l = (tid, info) => {
        if (tid === tab.id && info.status === "complete") {
          clearTimeout(t);
          chrome.tabs.onUpdated.removeListener(l);
          res();
        }
      };
      chrome.tabs.onUpdated.addListener(l);
    });

    // This environment exposes 0 voices to web-page contexts (the reader
    // extension page sees the full list), so the gate is exercised against a
    // controlled all-remote voice list stubbed into the tab.
    out.voiceCount = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => speechSynthesis.getVoices().length }).then((r) => r[0].result);
    out.voicesStubbed = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        try {
          const fake = [
            { voiceURI: "remote-one", name: "Remote One", lang: "en-US", localService: true, default: true },
            { voiceURI: "remote-two", name: "Remote Two", lang: "en-GB", localService: false, default: false }
          ];
          Object.defineProperty(window.speechSynthesis, "getVoices", { value: () => fake, configurable: true });
          return window.speechSynthesis.getVoices().length;
        } catch (e) { return "stub-failed: " + e; }
      }
    }).then((r) => r[0].result);

    // Load the REAL popup, unmodified, in an iframe.
    const frame = document.createElement("iframe");
    frame.src = chrome.runtime.getURL("popup/popup.html");
    document.body.appendChild(frame);
    await new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error("popup iframe load timeout")), 10000);
      frame.addEventListener("load", () => { clearTimeout(t); res(); });
    });
    await sleep(300);
    const doc = frame.contentDocument;
    if (!doc || !doc.getElementById("read-page")) throw new Error("popup iframe did not render");
    out.popupLoaded = true;

    const statusEl = doc.getElementById("status");
    async function waitStatus(substr, ms) {
      const start = Date.now();
      while (Date.now() - start < (ms || 15000)) {
        const t = statusEl.textContent || "";
        if (t.includes(substr)) return t;
        await sleep(250);
      }
      throw new Error("popup status never showed: " + substr + " (last: " + (statusEl.textContent || "") + ")");
    }
    function click(id) { doc.getElementById(id).click(); }
    async function stateOf() {
      return await chrome.tabs.sendMessage(tab.id, { type: "STATE" });
    }

    // Phase A: only a French voice is listed - the real popup flow must refuse
    // (no English United States voice), never speak with the other language.
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => {
      const fr = [{ voiceURI: "fr-one", name: "Fr One", lang: "fr-FR", localService: true, default: true }];
      Object.defineProperty(window.speechSynthesis, "getVoices", { value: () => fr, configurable: true });
    } });
    click("read-page");
    out.gatedStatus = await waitStatus("No English");
    out.stateAfterGate = await stateOf();

    // Phase B: an English (United States) online voice is listed; online
    // voices need no opt-in now. Read through the real popup button.
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => {
      const fake = [
        { voiceURI: "fr-one", name: "Fr One", lang: "fr-FR", localService: true, default: false },
        { voiceURI: "remote-one", name: "Remote One", lang: "en-US", localService: false, default: true }
      ];
      Object.defineProperty(window.speechSynthesis, "getVoices", { value: () => fake, configurable: true });
      // Stand-in voice objects are not real SpeechSynthesisVoice instances, so
      // utterances are plain objects and speak() is a no-op (as before, no
      // speech events fire in this environment).
      window.SpeechSynthesisUtterance = function (t) { this.text = t; };
      window.speechSynthesis.speak = function () {};
    } });
    // Only online voices and no saved choice: page reading must refuse until
    // the user chooses one (nothing is auto-selected).
    click("read-page");
    out.onlineOnlyStatus = await waitStatus("Only online");
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => {
      const fake2 = [
        { voiceURI: "fr-one", name: "Fr One", lang: "fr-FR", localService: true, default: false },
        { voiceURI: "local-one", name: "Local One", lang: "en-US", localService: true, default: true }
      ];
      Object.defineProperty(window.speechSynthesis, "getVoices", { value: () => fake2, configurable: true });
    } });
    click("read-page");
    out.startStatus = await waitStatus("Reading ");
    await sleep(1500);
    out.stateAfterStart = await stateOf();
    click("stop");
    await sleep(300);
    const pos = await new Promise((res) => chrome.storage.local.get(["positions"], (r) => res(r.positions || {})));
    out.positionKeys = Object.keys(pos);
    // Speech events do not fire in this environment's web-page context (0
    // voices), so the progress-triggered save cannot run here. Verify the
    // save/load wiring and key shape directly in the real page context.
    out.positionRoundTrip = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => new Promise((res) => {
        const key = RAStore.pageKey(location.href);
        RAStore.savePosition(key, 3);
        setTimeout(() => RAStore.loadPosition(key, (idx) => res({ key, idx })), 400);
      })
    }).then((r) => r[0] && r[0].result);

    // Phase C: resume read path through the real popup after a full reload.
    // The reload wipes content contexts, so the popup's production injection
    // runs again on the same tab - this also proves reinjection does not
    // stack dispatchers (idempotent install) and handles messages exactly once.
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => new Promise((res) => {
        RAStore.savePosition(RAStore.pageKey(location.href), 2);
        setTimeout(res, 400);
      })
    });
    await chrome.tabs.reload(tab.id);
    await new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error("reload timeout")), 20000);
      const l = (tid, info) => {
        if (tid === tab.id && info.status === "complete") {
          clearTimeout(t); chrome.tabs.onUpdated.removeListener(l); res();
        }
      };
      chrome.tabs.onUpdated.addListener(l);
    });
    // Re-stub voices (reload restored the real, empty list).
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const fake = [
          { voiceURI: "remote-one", name: "Remote One", lang: "en-US", localService: true, default: true },
          { voiceURI: "remote-two", name: "Remote Two", lang: "en-GB", localService: false, default: false }
        ];
        Object.defineProperty(window.speechSynthesis, "getVoices", { value: () => fake, configurable: true });
        window.SpeechSynthesisUtterance = function (t) { this.text = t; };
        window.speechSynthesis.speak = function () {};
      }
    });
    click("read-page");
    out.resumedStatus = await waitStatus("Reading ");
    await sleep(1200);
    out.stateAfterResume = await stateOf();
    out.dispatcherFlag = await chrome.scripting.executeScript({
      target: { tabId: tab.id }, func: () => window.__readAloudDispatcher === true
    }).then((r) => r[0] && r[0].result);
    click("stop");
    await sleep(300);

    // Phase D: READ_SELECTION through the real popup button: explicit refusal
    // with no selection, then a real selection reads only the selected text.
    click("read-selection");
    out.selectionEmptyStatus = await waitStatus("Select some text");
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const el = document.querySelector("p");
        const range = document.createRange();
        range.selectNodeContents(el);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
      }
    });
    click("read-selection");
    out.selectionStatus = await waitStatus("Reading ");
    await sleep(800);
    out.stateAfterSelection = await stateOf();
    click("stop");
    await sleep(300);

    // Phase E: speed slider through the real popup UI (sends SET_RATE), then
    // a protocol-level SET_RATE ack over the same production dispatcher.
    const rateInput = doc.getElementById("rate");
    rateInput.value = "1.3";
    rateInput.dispatchEvent(new frame.contentWindow.Event("input", { bubbles: true }));
    await sleep(400);
    out.rateLabel = doc.getElementById("rate-value").textContent;
    out.setRateResponse = await chrome.tabs.sendMessage(tab.id, { type: "SET_RATE", rate: 1.3 });

    document.title = "MSGFLOW DONE";
  } catch (e) {
    out.error = String((e && e.message) || e);
    document.title = "MSGFLOW FAIL";
  }
  window.__result = out;
  try {
    await fetch(`http://127.0.0.1:${port}/result`, { method: "POST", mode: "no-cors", headers: { "Content-Type": "text/plain" }, body: JSON.stringify(out) });
  } catch (e) { /* harness falls back to title polling */ }
  document.body.textContent = JSON.stringify(out, null, 2);
})();
