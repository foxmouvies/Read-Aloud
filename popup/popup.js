/* ReadAloud popup: injects the reader into the active tab and relays controls. */
(function () {
  "use strict";

  var INJECT_FILES = ["/shared/store.js", "/shared/text.js", "/shared/tts-engine.js", "/content/read-page.js"];

  var statusEl = document.getElementById("status");
  var rateInput = document.getElementById("rate");
  var rateValue = document.getElementById("rate-value");

  function setStatus(text, isError) {
    statusEl.textContent = text || "";
    statusEl.className = isError ? "error" : "";
  }

  function currentRate() {
    return parseFloat(rateInput.value);
  }

  rateInput.addEventListener("input", function () {
    rateValue.textContent = currentRate().toFixed(1) + "×";
    sendToTab({ type: "SET_RATE", rate: currentRate() });
    RAStore.saveSettings({ rate: currentRate() });
  });

  RAStore.loadSettings(function (s) {
    if (s.rate !== null) {
      rateInput.value = String(s.rate);
      rateValue.textContent = s.rate.toFixed(1) + "×";
    }
  });

  document.getElementById("clear-data").addEventListener("click", function () {
    RAStore.clearAll(function () {
      setStatus("Saved settings and reading positions cleared.");
    });
  });

  function withActiveTab(fn) {
    chrome.tabs.query({ active: true, currentWindow: true }).then(function (tabs) {
      if (!tabs || !tabs.length) {
        setStatus("No active tab found.", true);
        return;
      }
      fn(tabs[0]);
    }).catch(function (e) {
      setStatus("Error: " + e.message, true);
    });
  }

  // Installs a function-injected message dispatcher that delegates to the
  // reader's handler. Firefox does not deliver runtime messages to listeners
  // registered by file-injected scripts (root cause unknown; reproduced on
  // ESR 153.8 and Developer 162.0b1), while function-injected listeners do
  // receive them. The dispatcher is idempotent: repeat clicks never stack
  // listeners. The reader's own listener defers to it (see read-page.js), so
  // Chromium/Brave handle each message exactly once.
  function installDispatcher(tabId) {
    return chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: function () {
        if (window.__readAloudDispatcher) return;
        window.__readAloudDispatcher = true;
        chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
          if (typeof window.__readAloudMessage === "function") {
            window.__readAloudMessage(msg).then(function (r) { sendResponse(r); }, function () { sendResponse(undefined); });
            return true;
          }
          return undefined;
        });
      }
    }).catch(function () { /* restricted page; files path still reports errors */ });
  }

  function injectReader(tabId) {
    return installDispatcher(tabId).then(function () {
      return chrome.scripting.executeScript({
        target: { tabId: tabId },
        files: INJECT_FILES
      });
    });
  }

  function sendToTab(msg) {
    withActiveTab(function (tab) {
      chrome.tabs.sendMessage(tab.id, msg).catch(function () { /* no reader active; ignore */ });
    });
  }

  // B4: reflect live playback state when the popup is (re)opened.
  withActiveTab(function (tab) {
    chrome.tabs.sendMessage(tab.id, { type: "STATE" }).then(function (st) {
      if (st && st.total && st.state !== "idle") {
        setStatus("Reading sentence " + (st.index + 1) + " of " + st.total + " — " + st.state + ".");
      }
    }).catch(function () { /* no reader on this tab */ });
  });

  function readAloud(type) {
    withActiveTab(function (tab) {
      if (!/^https?:|^file:/.test(tab.url || "")) {
        setStatus("This tab cannot be read (browser-internal page). Open the PDF/text reader instead.", true);
        return;
      }
      if (/^file:/.test(tab.url || "")) {
        if (/Firefox\//.test(navigator.userAgent || "")) {
          setStatus("This page can't read local files in Firefox. Open the file in the PDF / text reader above instead.", true);
        } else {
          setStatus("Local files need 'Allow access to file URLs' in the extension details — or use the PDF / text reader above.", true);
        }
        return;
      }
      injectReader(tab.id).then(function () {
        return chrome.tabs.sendMessage(tab.id, { type: type, rate: currentRate(), lang: document.getElementById("lang").value });
      }).then(function (resp) {
        if (!resp) {
          setStatus("No response from the page. Try reloading the tab.", true);
        } else if (resp.ok) {
          setStatus("Reading " + resp.sentences + " sentences" + (resp.langLabel ? " in " + resp.langLabel + (resp.detected ? " (detected)" : "") : "") + ".");
        } else if (resp.lang && resp.lang !== "en-US" && (resp.reason === "no-lang-voice" || resp.reason === "no-local-voice")) {
          setStatus(resp.onlineCount > 0
            ? "Only online voices are available for " + resp.langLabel + ", and none is chosen yet, so nothing was read. Open the PDF/text reader and choose a voice there first."
            : "No voice for " + resp.langLabel + (resp.detected ? " (detected from the text)" : "") + " is available, so nothing was read and no other voice was used. Installed voice languages: " + (resp.installed || "none") + ". Add a voice in your system speech settings or choose another language here.", true);
        } else if (resp.reason === "no-local-voice" || resp.reason === "no-lang-voice") {
          setStatus(resp.onlineCount > 0
            ? "Only online English (United States) voices are available, and none is chosen yet, so the page was not read. Open the PDF/text reader and choose a voice there first."
            : "No English (United States) voice is available, so the page was not read. Open the PDF/text reader, choose a voice there, or add an English voice in your system speech settings.", true);
        } else if (resp.reason === "voice-unavailable") {
          setStatus("The voice you chose is not available right now (an online voice needs a connection). Reconnect, or choose another voice in the reader.", true);
        } else if (resp.reason === "no-selection") {
          setStatus("Select some text on the page first.", true);
        } else if (resp.reason === "no-text") {
          setStatus("No readable text found on this page.", true);
        } else {
          setStatus("Could not start reading on this page.", true);
        }
      }).catch(function (e) {
        setStatus("Cannot access this page: " + e.message, true);
      });
    });
  }

  document.getElementById("read-page").addEventListener("click", function () { readAloud("READ_PAGE"); });
  document.getElementById("read-selection").addEventListener("click", function () { readAloud("READ_SELECTION"); });
  document.getElementById("pause").addEventListener("click", function () { sendToTab({ type: "PAUSE" }); });
  document.getElementById("resume").addEventListener("click", function () { sendToTab({ type: "RESUME" }); });
  document.getElementById("stop").addEventListener("click", function () { sendToTab({ type: "STOP" }); setStatus("Stopped."); });

  document.getElementById("open-reader").addEventListener("click", function () {
    chrome.tabs.create({ url: chrome.runtime.getURL("reader/reader.html") });
    window.close();
  });
})();
