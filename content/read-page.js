/*
 * ReadAloud content script. Injected on demand by the popup via
 * chrome.scripting.executeScript. Extracts the selection or the main
 * article text of the current page, reads it aloud, and shows a small
 * floating control bar so playback can be controlled after the popup closes.
 */
(function () {
  "use strict";

  if (window.__readAloudInjected) return; // idempotent injection
  window.__readAloudInjected = true;

  var engine = null;
  var controlBar = null;
  var readBlocks = []; // leaf blocks of the last container extraction
  var sentenceEls = []; // sentence index -> source block element
  var highlightedEl = null;

  function getSelectionText() {
    var sel = window.getSelection();
    return sel ? String(sel.toString()) : "";
  }

  /*
   * Extract the main readable text of the page: the selection if there is
   * one, else the best-scoring content container. Containers are scored
   * Readability-style: block text length, penalized by link density,
   * weighted by semantic class/id hints. Boilerplate (nav, sidebars,
   * share/related/comment blocks) is excluded from the collected text.
   */
  var SKIP_TAGS = /^(NAV|ASIDE|FOOTER|HEADER|FORM|BUTTON|SCRIPT|STYLE|NOSCRIPT|IFRAME|FIGURE|SELECT)$/;
  var SKIP_CLASS = /(share|sharing|social|related|comment|promo|advert|newsletter|subscribe|cookie|breadcrumb|pagination|toolbar|widget|sidebar|menu|nav|popup|modal|banner)/i;
  var GOOD_CLASS = /(article|content|post|entry|main|story|article-body|post-body|body-text|text)/i;
  var BAD_CLASS = /(nav|sidebar|comment|footer|header|promo|related|share|widget|menu|banner|ad)/i;
  var BLOCK_TAGS = /^(P|H1|H2|H3|H4|H5|H6|LI|BLOCKQUOTE|PRE)$/;

  function insideSkipped(el) {
    for (var n = el; n && n !== document.body; n = n.parentElement) {
      if (SKIP_TAGS.test(n.tagName)) return true;
      var cls = (n.className && n.className.baseVal !== undefined ? n.className.baseVal : n.className) || "";
      if (typeof cls === "string" && SKIP_CLASS.test(cls)) return true;
    }
    return false;
  }

  function isVisible(el) {
    var style = window.getComputedStyle(el);
    return style.display !== "none" && style.visibility !== "hidden";
  }

  // Leaf-most text blocks of a container, boilerplate excluded.
  function collectBlocks(root) {
    var blocks = [];
    var all = root.querySelectorAll("p, h1, h2, h3, h4, h5, h6, li, blockquote, pre");
    Array.prototype.forEach.call(all, function (el) {
      if (el.querySelector("p, h1, h2, h3, h4, h5, h6, li, blockquote, pre")) return; // keep leaf-most only
      if (insideSkipped(el) || !isVisible(el)) return;
      var text = (el.innerText || "").trim();
      if (text) blocks.push(text);
    });
    return blocks;
  }

  function scoreContainer(el) {
    var blocks = collectBlocks(el);
    var len = blocks.join("\n").length;
    if (len < 200) return -1;
    var fullLen = (el.innerText || " ").length || 1;
    var linkLen = 0;
    Array.prototype.forEach.call(el.querySelectorAll("a"), function (a) {
      linkLen += (a.innerText || "").length;
    });
    var score = len * (1 - Math.min(linkLen / fullLen, 0.9));
    var cls = ((el.className || "") + " " + (el.id || ""));
    if (typeof cls === "string") {
      if (GOOD_CLASS.test(cls)) score *= 1.5;
      if (BAD_CLASS.test(cls)) score *= 0.3;
    }
    if (el.tagName === "ARTICLE" || el.tagName === "MAIN") score *= 1.25;
    return score;
  }

  function extractPageText() {
    var selected = getSelectionText();
    if (selected && selected.trim().length > 2) { readBlocks = []; return selected; }

    var best = null;
    var bestScore = 0;
    Array.prototype.forEach.call(
      document.querySelectorAll("article, main, [role=main], div, section"),
      function (el) {
        var score = scoreContainer(el);
        if (score > bestScore) { bestScore = score; best = el; }
      }
    );
    if (best) {
      readBlocks = [];
      var blocks = collectBlocks(best);
      // keep the elements too: re-walk to pair text with its element
      var els = [];
      var all = best.querySelectorAll("p, h1, h2, h3, h4, h5, h6, li, blockquote, pre");
      Array.prototype.forEach.call(all, function (el) {
        if (el.querySelector("p, h1, h2, h3, h4, h5, h6, li, blockquote, pre")) return;
        if (insideSkipped(el) || !isVisible(el)) return;
        if ((el.innerText || "").trim()) els.push(el);
      });
      readBlocks = els;
      return window.RAText.normalizeExtractedText(blocks.join("\n\n"));
    }
    readBlocks = [];
    var text = document.body ? document.body.innerText || document.body.textContent || "" : "";
    return window.RAText.normalizeExtractedText(text);
  }

  function ensureControlBar() {
    if (controlBar) return controlBar;
    controlBar = document.createElement("div");
    controlBar.id = "readaloud-control-bar";
    controlBar.setAttribute("role", "toolbar");
    controlBar.setAttribute("aria-label", "ReadAloud playback controls");
    controlBar.style.cssText = [
      "position:fixed", "bottom:16px", "right:16px", "z-index:2147483647",
      "display:flex", "gap:6px", "align-items:center",
      "background:#1f2430", "color:#fff", "border-radius:24px",
      "padding:6px 10px", "font:13px/1.4 system-ui,sans-serif",
      "box-shadow:0 2px 10px rgba(0,0,0,.35)"
    ].join(";");

    // Inline SVG icons: reliable in every environment, unlike Unicode glyphs.
    var ICONS = {
      play: '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="7 4 20 12 7 20"/></svg>',
      pause: '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>',
      stop: '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="1.5"/></svg>',
      prev: '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="5" width="3" height="14" rx="1"/><polygon points="19 5 9.5 12 19 19"/></svg>',
      next: '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 5 14.5 12 5 19"/><rect x="16" y="5" width="3" height="14" rx="1"/></svg>'
    };

    function btn(icon, title, onClick) {
      var b = document.createElement("button");
      b.innerHTML = ICONS[icon];
      b.title = title;
      b.setAttribute("aria-label", title);
      b.style.cssText = "background:#3a4356;border:none;color:#fff;border-radius:14px;" +
        "padding:4px 10px;cursor:pointer;display:inline-flex;align-items:center";
      b.addEventListener("click", onClick);
      controlBar.appendChild(b);
      return b;
    }

    btn("prev", "Previous sentence", function () { engine && engine.prev(); });
    var pauseBtn = btn("pause", "Pause / resume", function () {
      if (!engine) return;
      var s = engine.getState().state;
      if (s === "speaking") engine.pause();
      else if (s === "paused") engine.resume();
    });
    btn("next", "Next sentence", function () { engine && engine.next(); });
    btn("stop", "Stop", function () {
      if (engine) engine.stop();
      removeControlBar();
    });
    var label = document.createElement("span");
    label.id = "readaloud-progress";
    label.setAttribute("aria-live", "polite");
    label.style.cssText = "min-width:56px;text-align:center";
    controlBar.appendChild(label);

    controlBar.update = function (st) {
      label.textContent = st.total ? (st.index + 1) + " / " + st.total : "";
      pauseBtn.innerHTML = st.state === "paused" ? ICONS.play : ICONS.pause;
    };
    document.documentElement.appendChild(controlBar);
    return controlBar;
  }

  function removeControlBar() {
    if (controlBar && controlBar.parentNode) controlBar.parentNode.removeChild(controlBar);
    controlBar = null;
  }

  /*
   * Follow-along highlight: the block element (paragraph, heading, list
   * item) containing the currently spoken sentence is outlined on the page.
   * Block-level, never text-node surgery, so arbitrary page DOMs stay safe.
   */
  function ensureHighlightStyle() {
    if (document.getElementById("readaloud-highlight-style")) return;
    var st = document.createElement("style");
    st.id = "readaloud-highlight-style";
    st.textContent = ".readaloud-current-block{background:rgba(255,224,130,.45) !important;" +
      "outline:2px solid #d4a017 !important;border-radius:3px !important;}";
    (document.head || document.documentElement).appendChild(st);
  }

  function clearHighlight() {
    if (highlightedEl) highlightedEl.classList.remove("readaloud-current-block");
    highlightedEl = null;
  }

  // Map each sentence to the first block (in reading order) containing it.
  function mapSentencesToBlocks(sentences) {
    sentenceEls = [];
    if (!readBlocks.length) return;
    var norm = function (t) { return String(t).replace(/\s+/g, " ").trim(); };
    var bi = 0;
    for (var i = 0; i < sentences.length; i++) {
      var probe = norm(sentences[i]).slice(0, 30);
      var found = -1;
      for (var j = bi; j < readBlocks.length && probe; j++) {
        if (norm(readBlocks[j].innerText).indexOf(probe) !== -1) { found = j; break; }
      }
      if (found !== -1) { sentenceEls[i] = readBlocks[found]; bi = found; }
    }
  }

  function updateHighlight(st) {
    var idx = typeof st.sentenceIndex === "number" ? st.sentenceIndex : st.index;
    if (st.state === "idle" || idx == null) { clearHighlight(); return; }
    var el = sentenceEls[idx];
    if (!el || el === highlightedEl) return;
    clearHighlight();
    ensureHighlightStyle();
    el.classList.add("readaloud-current-block");
    highlightedEl = el;
  }

  var lastPosSave = 0;

  function startReading(text, rate, cb) {
    var sentences = window.RAText.splitIntoSentences(text);
    if (!sentences.length) { cb({ ok: false, reason: "no-text" }); return; }
    if (!engine) {
      engine = window.RATTS.createEngine({ rate: rate || 1 });
      engine.on("state", function (st) {
        var bar = ensureControlBar();
        bar.update(st);
        updateHighlight(st);
        if (st.state === "idle") { removeControlBar(); clearHighlight(); }
      });
      engine.on("progress", function (st) {
        if (controlBar) controlBar.update(st);
        updateHighlight(st);
        if (window.RAStore && st.state !== "idle") {
          var now = Date.now();
          if (now - lastPosSave > 1500) {
            lastPosSave = now;
            var idx = typeof st.sentenceIndex === "number" ? st.sentenceIndex : st.index;
            var key = RAStore.pageKey(location.href);
            if (key) RAStore.savePosition(key, idx);
          }
        }
      });
      engine.on("end", function () { removeControlBar(); clearHighlight(); });
    }
    mapSentencesToBlocks(sentences);
    engine.load(sentences, 0);
    if (typeof rate === "number") engine.setRate(rate);

    function begin() {
      function playAt(i) {
        var ok = engine.play(i);
        if (ok) ensureControlBar().update(engine.getState());
        cb({ ok: ok, sentences: sentences.length });
      }
      // Resume where this page was last read (origin+path key, no query).
      // Look the position up BEFORE playing so a resumed read never blips
      // the first sentence before jumping.
      if (window.RAStore) {
        var pageKey = RAStore.pageKey(location.href);
        if (pageKey) {
          RAStore.loadPosition(pageKey, function (savedIdx) {
            var start = (savedIdx && savedIdx > 0 && savedIdx < sentences.length) ? savedIdx : 0;
            playAt(start);
          });
          return;
        }
      }
      playAt(0);
    }

    // Voice choice for page reading: a voice the user picked in the reader is
    // used as is (any language, local or online). Otherwise English (United
    // States) only, never a voice of another language. If the picked voice is
    // missing from the list (for example an online voice while offline) it is
    // not replaced silently. Online voices send spoken text to the provider.
    if (window.RAStore && window.RATTS.chooseVoice && window.speechSynthesis) {
      RAStore.loadSettings(function (s) {
        var voices = (speechSynthesis.getVoices ? speechSynthesis.getVoices() : []) || [];
        var picked = null;
        if (s.voiceURI) {
          for (var i = 0; i < voices.length; i++) if (voices[i].voiceURI === s.voiceURI) picked = voices[i];
          if (!picked && voices.length) {
            cb({ ok: false, reason: "voice-unavailable", onlineCount: 0 });
            return;
          }
        }
        var choice = picked ? { voice: picked } : RATTS.chooseVoice(voices, null, "en-US");
        if (!choice.voice && voices.length) {
          cb({ ok: false, reason: "no-local-voice", onlineCount: choice.onlineCount || 0 });
          return;
        }
        if (choice.voice) engine.setVoice(choice.voice);
        begin();
      });
    } else {
      begin();
    }
  }

  // In an isolated content-script world chrome.runtime is always present;
  // the guard lets tests load this file in a plain page context.
  function handleMessage(msg, sender, sendResponse) {
    if (!msg || !msg.type) return;
    switch (msg.type) {
      case "READ_PAGE": {
        var text = extractPageText();
        startReading(text, msg.rate, sendResponse);
        break;
      }
      case "READ_SELECTION": {
        var sel = getSelectionText();
        if (!sel || sel.trim().length < 2) {
          sendResponse({ ok: false, reason: "no-selection" });
        } else {
          startReading(sel, msg.rate, sendResponse);
        }
        break;
      }
      case "PAUSE": if (engine) engine.pause(); sendResponse(engine ? engine.getState() : null); break;
      case "RESUME": if (engine) engine.resume(); sendResponse(engine ? engine.getState() : null); break;
      case "STOP":
        if (engine) engine.stop();
        removeControlBar();
        sendResponse({ ok: true });
        break;
      case "SET_RATE":
        if (engine) engine.setRate(msg.rate);
        sendResponse({ ok: true });
        break;
      case "STATE":
        sendResponse(engine ? engine.getState() : { state: "idle", index: 0, total: 0 });
        break;
    }
    return true;
  }
  if (window.chrome && chrome.runtime && chrome.runtime.onMessage && !window.__readAloudDispatcher) {
    chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
      // When the popup-installed dispatcher exists it owns delivery; this
      // listener stays silent so messages are handled exactly once.
      if (window.__readAloudDispatcher) return undefined;
      return handleMessage(msg, sender, sendResponse);
    });
  }
  // Extraction hook: invisible to the page (isolated world), used by the
  // cross-browser extraction tests that load this file directly.
  window.__readAloudExtract = extractPageText;
  // Message hook for the cross-browser message-flow driver: routes the same
  // protocol messages through the same handler where a test environment
  // cannot deliver messages to injected-script listeners.
  window.__readAloudMessage = function (msg) {
    return new Promise(function (resolve) { handleMessage(msg, null, resolve); });
  };
})();
