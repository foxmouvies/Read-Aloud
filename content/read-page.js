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
  var SKIP_TAGS = /^(NAV|ASIDE|FOOTER|HEADER|FORM|BUTTON|SCRIPT|STYLE|NOSCRIPT|IFRAME|SELECT|CANVAS|OBJECT|EMBED|VIDEO|AUDIO)$/;
  var SKIP_CLASS = /(share|sharing|social|related|comment|promo|advert|newsletter|subscribe|cookie|breadcrumb|pagination|toolbar|widget|sidebar|menu|nav|popup|modal|banner)/i;
  var GOOD_CLASS = /(article|content|post|entry|main|story|article-body|post-body|body-text|text)/i;
  var BAD_CLASS = /(nav|sidebar|comment|footer|header|promo|related|share|widget|menu|banner|ad)/i;
  var BLOCK_TAGS = /^(P|H1|H2|H3|H4|H5|H6|LI|BLOCKQUOTE|PRE)$/;

  // Whole class tokens only: "comment-list" is boilerplate, "commentary" or "shareholder-letter" are not.
  var SKIP_TOKEN = /^(comments?|share|sharing|social|related|promo|sidebar|widget|advert|advertisement|newsletter|subscribe|cookie|breadcrumbs?|pagination|toolbar|popup|modal|banner|menu|nav|navbar|navigation)([-_](list|section|bar|buttons?|links?|posts?|articles?|stories|box|block|container|wrapper|area|form|items?|banner|notice))?$/;
  function isBoilerplateClass(cls) {
    var toks = String(cls).toLowerCase().split(/\s+/);
    for (var k = 0; k < toks.length; k++) if (toks[k] && SKIP_TOKEN.test(toks[k])) return true;
    return false;
  }

  // A <header> that sits inside an <article>/<main> is the article's own heading block (title, byline), not the
  // site header; it is read. Its <nav>, buttons and boilerplate-class children are still skipped by their own rules.
  function isSkipTag(n) {
    if (!SKIP_TAGS.test(n.tagName)) return false;
    if (n.tagName === "HEADER" && n.parentElement && n.parentElement.closest && n.parentElement.closest("article, main, [role=main]")) return false;
    return true;
  }
  var noClassSkip = false; // set while re-reading a container whose real content sits inside a boilerplate-named class
  function insideSkipped(el) {
    for (var n = el; n && n !== document.body; n = n.parentElement) {
      if (isSkipTag(n)) return true;
      var cls = (n.className && n.className.baseVal !== undefined ? n.className.baseVal : n.className) || "";
      if (!noClassSkip && typeof cls === "string" && isBoilerplateClass(cls)) return true;
    }
    return false;
  }

  // Body of a closed <details> (everything except its first <summary>) is not shown, so it is not read.
  function insideClosedDetails(el) {
    for (var n = el; n && n.parentElement; n = n.parentElement) {
      var p = n.parentElement;
      if (p.tagName === "DETAILS" && !p.open) {
        var first = null;
        for (var c = p.firstElementChild; c; c = c.nextElementSibling) { if (c.tagName === "SUMMARY") { first = c; break; } }
        if (n !== first) return true;
      }
    }
    return false;
  }

  function isVisible(el) {
    var style = window.getComputedStyle(el);
    return style.display !== "none" && style.visibility !== "hidden" && !insideClosedDetails(el);
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

  // Reading blocks of a container in source order: leaf text elements (p, headings, li...) as before, plus
  // the text that sits directly inside div/section/td-like elements, as one block per uninterrupted run.
  // A run is a pseudo-block ({innerText, contains, classList}) because it is not a single element.
  var LEAF_TAGS = /^(P|H1|H2|H3|H4|H5|H6|LI|BLOCKQUOTE|PRE)$/;
  var CONTAINER_TAGS = /^(DIV|SECTION|ARTICLE|MAIN|UL|OL|DL|DD|DT|TABLE|TBODY|THEAD|TFOOT|TR|TD|TH|FIGURE|FIGCAPTION|ADDRESS|DETAILS|SUMMARY|CENTER|BODY)$/;
  var LEAF_SEL = "p, h1, h2, h3, h4, h5, h6, li, blockquote, pre";
  var BLOCKISH_SEL = LEAF_SEL + ", div, section, article, main, ul, ol, dl, dd, dt, table, tr, td, th, figure, figcaption, address, details, summary, center";

  function makeRun(nodes) {
    var text = nodes.map(function (n) { return n.nodeType === 3 ? n.data : (n.innerText || n.textContent || ""); }).join("").replace(/\s+/g, " ").trim();
    if (!text) return null;
    return {
      isRun: true, nodes: nodes, innerText: text,
      contains: function (x) { return nodes.some(function (n) { return n === x || n.contains(x); }); },
      classList: { add: function () {}, remove: function () {} }
    };
  }

  function collectBlockObjs(root) {
    var out = [];
    function blockish(el) { return LEAF_TAGS.test(el.tagName) || CONTAINER_TAGS.test(el.tagName) || !!el.querySelector(BLOCKISH_SEL); }
    function walk(el) {
      if (insideSkipped(el) || !isVisible(el)) return;
      if (LEAF_TAGS.test(el.tagName) && !el.querySelector(LEAF_SEL)) {
        if ((el.innerText || "").trim()) out.push(el);
        return;
      }
      var run = [];
      function flush() { if (run.length) { var r = makeRun(run); if (r) out.push(r); run = []; } }
      Array.prototype.forEach.call(el.childNodes, function (c) {
        if (c.nodeType === 3) { if (!(el.tagName === "DETAILS" && !el.open)) run.push(c); return; } // text directly inside a closed details is its hidden body
        if (c.nodeType !== 1) return;
        if (insideSkipped(c) || !isVisible(c)) return;
        if (/^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|CANVAS|OBJECT|EMBED|VIDEO|AUDIO|BR|WBR)$/.test(c.tagName)) { if (c.tagName === "BR") run.push(document.createTextNode(" ")); return; }
        if (blockish(c)) { flush(); walk(c); } else run.push(c);
      });
      flush();
    }
    walk(root);
    return out;
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

  // Blocks of a container. Guard: if skipping by class removed 60% or more of the text that tag-based skipping
  // keeps and nothing kept sits in an article/main element, the content itself carries a boilerplate-looking class, so use the unfiltered-by-class blocks
  // (script/style/nav/hidden text are still skipped).
  function blocksWithGuard(root) {
    var len = function (arr) { return arr.reduce(function (n, b) { return n + (b.innerText || "").replace(/\s+/g, " ").trim().length; }, 0); };
    var objs = collectBlockObjs(root), kept = len(objs);
    noClassSkip = true;
    var all; try { all = collectBlockObjs(root); } finally { noClassSkip = false; }
    // Content kept inside a real <article>/<main> is trusted: comment threads next to it stay skipped.
    var semantic = objs.some(function (b) { return b.closest && b.closest("article, main, [role=main]"); });
    return (!semantic && len(all) > 0 && kept < len(all) * 0.4) ? all : objs;
  }

  // Text inside open shadow roots (web components). Only used when the normal page walk finds almost nothing.
  function topHost(el) { for (var n = el; ; ) { var r = n.getRootNode && n.getRootNode(); if (r && r.host) n = r.host; else return n; } }
  // Document (composed) order: light blocks and shadow blocks sorted by where their element / outermost host sits.
  function anchorOf(b) { return b.anchor || (b.isRun ? b.nodes[0] : b); }
  function inDocumentOrder(blocks) {
    var tagged = blocks.map(function (b, i) { return { b: b, i: i, a: anchorOf(b) }; });
    tagged.sort(function (x, y) {
      if (x.a !== y.a && x.a && y.a && x.a.compareDocumentPosition) {
        var c = x.a.compareDocumentPosition(y.a);
        if (c & 4) return -1;      // y follows x
        if (c & 2) return 1;       // y precedes x
      }
      return x.i - y.i;
    });
    return tagged.map(function (t) { return t.b; });
  }
  function shadowBlockObjs() {
    var out = [];
    // Visible and not boilerplate all the way up, crossing shadow boundaries (host classes and tags count too).
    function usable(node) {
      for (var n = node; n; n = n.parentElement || (n.getRootNode && n.getRootNode().host) || null) {
        if (n === document.body || n === document.documentElement) return true;
        if (isSkipTag(n) || !isVisible(n)) return false;
        var cls = (n.className && n.className.baseVal !== undefined ? n.className.baseVal : n.className) || "";
        if (typeof cls === "string" && isBoilerplateClass(cls)) return false;
      }
      return true;
    }
    function visit(root) {
      Array.prototype.forEach.call(root.querySelectorAll("*"), function (el) {
        if (!el.shadowRoot) return;
        var sr = el.shadowRoot;
        if (usable(el)) {
          Array.prototype.forEach.call(sr.querySelectorAll(LEAF_SEL), function (b) {
            if (b.querySelector(LEAF_SEL) || !usable(b)) return;
            var t = (b.innerText || b.textContent || "").trim();
            if (t) out.push({ anchor: topHost(el), isRun: true, nodes: [b], innerText: t.replace(/\s+/g, " "), contains: function (x) { return b === x || b.contains(x); }, classList: { add: function () {}, remove: function () {} } });
          });
        }
        visit(sr);
      });
    }
    if (document.body) visit(document.body);
    return out;
  }

  function extractPageText(ignoreSelection) {
    var selected = ignoreSelection ? "" : getSelectionText();
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
      var objs = blocksWithGuard(best);
      readBlocks = objs;
      return window.RAText.normalizeExtractedText(objs.map(function (b) { return (b.innerText || "").trim(); }).join("\n\n"));
    }
    if (document.body) {
      var bobjs = blocksWithGuard(document.body);
      var btext = window.RAText.normalizeExtractedText(bobjs.map(function (b) { return (b.innerText || "").trim(); }).join("\n\n"));
      if (btext && btext.length >= 200) { readBlocks = bobjs; return btext; }
      var sb0 = shadowBlockObjs();
      if (sb0.length) { var comb = inDocumentOrder(bobjs.concat(sb0)); readBlocks = comb; return window.RAText.normalizeExtractedText(comb.map(function (b) { return (b.innerText || "").trim(); }).join("\n\n")); }
      if (btext) { readBlocks = bobjs; return btext; }
    }
    var sb = shadowBlockObjs();
    if (sb.length) {
      readBlocks = sb;
      return window.RAText.normalizeExtractedText(sb.map(function (b) { return b.innerText; }).join("\n\n"));
    }
    readBlocks = [];
    var text = document.body ? document.body.innerText || "" : ""; // innerText only: textContent would include hidden text
    return window.RAText.normalizeExtractedText(text);
  }

  function ensureControlBar() {
    if (controlBar) return controlBar;
    controlBar = document.createElement("div");
    controlBar.id = "readaloud-control-bar";
    controlBar.setAttribute("role", "toolbar");
    controlBar.setAttribute("aria-label", "ReadAloud playback controls");
    controlBar.style.cssText = [
      "position:fixed", "bottom:max(8px, env(safe-area-inset-bottom))", "right:8px", "z-index:2147483647",
      "display:flex", "gap:6px", "align-items:center",
      "background:#1f2430", "color:#fff", "border-radius:24px",
      "padding:6px 10px", "font:13px/1.4 system-ui,sans-serif",
      "flex-wrap:wrap", "justify-content:center", "box-sizing:border-box", "max-width:calc(100vw - 16px)",
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

    // Visible language choice for page reading: English, Arabic or French. Changing it
    // switches to a voice for that language and continues from the current sentence;
    // with no voice for it, nothing changes and a notice says so.
    var langSel = document.createElement("select");
    langSel.id = "readaloud-lang";
    langSel.title = "Reading language";
    langSel.setAttribute("aria-label", "Reading language");
    langSel.style.cssText = "background:#3a4356;color:#fff;border:none;border-radius:14px;padding:4px 6px;font:12px system-ui,sans-serif;max-width:120px;cursor:pointer";
    [["en-US", "English"], ["ar-MA", "العربية"], ["fr-FR", "Français"]].forEach(function (o) {
      var op = document.createElement("option"); op.value = o[0]; op.textContent = o[1]; langSel.appendChild(op);
    });
    langSel.value = currentLang;
    langSel.addEventListener("change", function () { changeLang(langSel.value, langSel); });
    controlBar.appendChild(langSel);

    controlBar.update = function (st) {
      label.textContent = st.total ? (st.index + 1) + " / " + st.total : "";
      pauseBtn.innerHTML = st.state === "paused" ? ICONS.play : ICONS.pause;
    };
    document.documentElement.appendChild(controlBar);
    // Room at the very end of the page so the bar never sits on top of the last lines.
    if (padBefore === null) {
      padBefore = document.documentElement.style.paddingBottom;
      document.documentElement.style.paddingBottom = (controlBar.getBoundingClientRect().height + 24) + "px";
    }
    return controlBar;
  }

  var currentLang = "en-US";
  var padBefore = null;

  function changeLang(lang, sel) {
    if (!engine || !LANG_LABELS[lang]) return;
    var voices = (window.speechSynthesis && speechSynthesis.getVoices ? speechSynthesis.getVoices() : []) || [];
    var choice = window.RATTS.chooseVoice(voices, null, lang);
    var usedOnline = false;
    // The user deliberately picked this language on the bar: when only online
    // voices exist for it, use the first one of that exact language (never a
    // voice of another language). Online voices send spoken text to the
    // browser's or system's voice provider.
    if (!choice.voice && choice.needsChoice) {
      var online = voices.filter(function (v) { return v.localService === false && window.RATTS.voiceMatches(v, lang); })[0];
      if (online) { choice = { voice: online }; usedOnline = true; }
    }
    if (!choice.voice && voices.length) {
      sel.value = currentLang;
      toast("No voice for " + LANG_LABELS[lang] + " is installed, so the reading language was not changed.");
      return;
    }
    // The notice comes first: setVoice may restart the current sentence at once.
    if (usedOnline) toast("Reading in " + LANG_LABELS[lang] + " with an online voice: spoken text is sent to your browser's or system's voice provider.");
    currentLang = lang;
    engine.setLang(lang);
    if (choice.voice) engine.setVoice(choice.voice);
  }

  function removeControlBar() {
    if (padBefore !== null) { document.documentElement.style.paddingBottom = padBefore; padBefore = null; }
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

  var LANG_LABELS = { "en-US": "English (United States)", "ar-MA": "Arabic (Morocco)", "fr-FR": "French (France)" };
  var DETECTED = { en: "en-US", ar: "ar-MA", fr: "fr-FR" };
  // Language for this reading: the popup's explicit choice, or detected from
  // the text when the popup says "auto". No message language means English
  // (United States), as before. Detection happens only when reading starts.
  function resolveLang(text, requested) {
    if (requested === "auto") return { lang: DETECTED[window.RAText.detectLanguage(text, 0.5)] || "en-US", detected: true };
    return { lang: LANG_LABELS[requested] ? requested : "en-US", detected: false };
  }

  function startReading(text, rate, cb, requestedLang, fromPoint) {
    var pick = resolveLang(text, requestedLang);
    currentLang = pick.lang;
    var existingSel = document.getElementById("readaloud-lang"); if (existingSel) existingSel.value = currentLang;
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
        cb({ ok: ok, sentences: sentences.length, lang: pick.lang, langLabel: LANG_LABELS[pick.lang], detected: pick.detected });
      }
      // Resume where this page was last read (origin+path key, no query).
      // Look the position up BEFORE playing so a resumed read never blips
      // the first sentence before jumping.
      if (window.RAStore && !fromPoint) {
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
          // A chosen voice that is missing is not replaced silently (English reading keeps this rule).
          if (!picked && voices.length && pick.lang === "en-US") {
            cb({ ok: false, reason: "voice-unavailable", onlineCount: 0 });
            return;
          }
          // A saved voice of another language is not used for this language.
          if (picked && !RATTS.voiceMatches(picked, pick.lang)) picked = null;
        }
        var choice = picked ? { voice: picked } : RATTS.chooseVoice(voices, null, pick.lang);
        if (!choice.voice && voices.length) {
          var have = {}; voices.forEach(function (v) { have[v.lang] = 1; });
          cb({ ok: false, reason: choice.noLangVoice ? "no-lang-voice" : "no-local-voice", onlineCount: choice.onlineCount || 0,
               lang: pick.lang, langLabel: LANG_LABELS[pick.lang], detected: pick.detected, installed: Object.keys(have).sort().join(", ") });
          return;
        }
        engine.setLang(pick.lang);
        if (choice.voice) engine.setVoice(choice.voice);
        begin();
      });
    } else {
      begin();
    }
  }


  // "Read from here": the text from the right-clicked word to the end of the
  // page text. The click point comes from content/right-click-point.js.
  function toast(msg) {
    var t = document.createElement("div");
    t.setAttribute("role", "status");
    t.textContent = msg;
    t.style.cssText = "position:fixed;bottom:72px;right:8px;z-index:2147483647;background:#1f2430;color:#fff;box-sizing:border-box;" +
      "border-radius:8px;padding:8px 12px;font:13px/1.4 system-ui,sans-serif;max-width:min(320px,calc(100vw - 16px));box-shadow:0 2px 10px rgba(0,0,0,.35)";
    document.documentElement.appendChild(t);
    setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 6000);
  }

  function textFromPoint() {
    var rc = window.__readAloudRC && window.__readAloudRC.get();
    if (!rc || !rc.node || !rc.node.isConnected) return { error: "no-point" };
    extractPageText(true); // sets readBlocks (empty when no article container was found)
    var blocks = readBlocks;
    if (!blocks.length) {
      blocks = document.body ? collectBlockObjs(document.body) : [];
      readBlocks = blocks;
    }
    var k = -1;
    for (var i = 0; i < blocks.length; i++) if (blocks[i].contains(rc.node)) { k = i; break; }
    if (k < 0) return { error: "not-in-text" };
    var r = document.createRange();
    if (blocks[k].isRun) r.setStartBefore(blocks[k].nodes[0]); else r.selectNodeContents(blocks[k]);
    r.setEnd(rc.node, rc.offset);
    var off = blocks[k].isRun ? r.toString().replace(/\s+/g, " ").replace(/^\s+/, "").length : r.toString().length;
    var own = (blocks[k].innerText || "").replace(/^\s+/, "");
    var start = window.RAText.wordStartAt(own, off);
    var parts = [];
    if (start >= 0) parts.push(own.slice(start).trim());
    for (var j = k + 1; j < blocks.length; j++) {
      var t = (blocks[j].innerText || "").trim();
      if (t) parts.push(t);
    }
    var text = window.RAText.normalizeExtractedText(parts.join("\n\n"));
    return text ? { text: text, startsAtWord: start >= 0 } : { error: "not-in-text" };
  }

  function readFromPoint(msg, cb) {
    if (msg && msg.inFrame) {
      toast("Read from here does not work inside an embedded frame. Right-click the page text outside it.");
      cb({ ok: false, reason: "in-frame" });
      return;
    }
    var res = textFromPoint();
    if (res.error) {
      toast(res.error === "no-point"
        ? "Read from here: right-click a word in the page text first."
        : "Read from here works on the page's article text. This spot is outside it (menus, sidebars, images and text drawn on a canvas are not read).");
      cb({ ok: false, reason: res.error });
      return;
    }
    startReading(res.text, msg.rate, function (r) {
      if (!r.ok) toast(r.reason === "no-lang-voice" ? "No voice for " + (r.langLabel || "this language") + ". Installed voice languages: " + (r.installed || "none") + "."
        : "ReadAloud could not start reading here (" + r.reason + ").");
      cb(r);
    }, msg.lang || "en-US", true);
  }

  // In an isolated content-script world chrome.runtime is always present;
  // the guard lets tests load this file in a plain page context.
  function handleMessage(msg, sender, sendResponse) {
    if (!msg || !msg.type) return;
    switch (msg.type) {
      case "READ_PAGE": {
        var text = extractPageText();
        startReading(text, msg.rate, sendResponse, msg.lang);
        break;
      }
      case "READ_SELECTION": {
        var sel = getSelectionText();
        if (!sel || sel.trim().length < 2) {
          sendResponse({ ok: false, reason: "no-selection" });
        } else {
          startReading(sel, msg.rate, sendResponse, msg.lang);
        }
        break;
      }
      case "READ_FROM_POINT": readFromPoint(msg, sendResponse); break;
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
  window.__readAloudExtract = function () { return extractPageText(); };
  // Message hook for the cross-browser message-flow driver: routes the same
  // protocol messages through the same handler where a test environment
  // cannot deliver messages to injected-script listeners.
  window.__readAloudMessage = function (msg) {
    return new Promise(function (resolve) { handleMessage(msg, null, resolve); });
  };
})();
