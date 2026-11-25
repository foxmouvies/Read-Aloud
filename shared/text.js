/*
 * ReadAloud shared text utilities.
 * Pure functions, no DOM or browser API access, so they can run in
 * content scripts, extension pages and Node unit tests.
 */
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory();
  } else {
    root.RAText = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // Collapse runs of whitespace, drop zero-width chars.
  function normalizeWhitespace(text) {
    if (typeof text !== "string") return "";
    return text
      .replace(/[​‎‏⁠﻿]/g, "")
      .replace(/[\t ]+/g, " ")
      .replace(/[ \t]*\n[ \t]*/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  // Join hyphenated line breaks common in PDF extraction ("exam-\nple" -> "example").
  function dehyphenate(text) {
    return text.replace(/(\w)-[ \t]*\n(\w)/g, "$1$2");
  }

  // Turn a flat extracted string into readable text, keeping paragraph breaks.
  function normalizeExtractedText(text) {
    return normalizeWhitespace(dehyphenate(String(text || "")));
  }

  var ABBREVIATIONS = [
    "Mr", "Mrs", "Ms", "Dr", "Prof", "Sr", "Jr", "St", "vs", "etc", "e.g",
    "i.e", "No", "Fig", "Eq", "Vol", "pp", "Jan", "Feb", "Mar", "Apr",
    "Jun", "Jul", "Aug", "Sep", "Sept", "Oct", "Nov", "Dec"
  ];

  var ABBREVIATIONS = [
    // English
    "Mr", "Mrs", "Ms", "Dr", "Prof", "Sr", "Jr", "St", "vs", "etc", "e.g",
    "i.e", "No", "Fig", "Eq", "Vol", "pp", "Jan", "Feb", "Mar", "Apr",
    "Jun", "Jul", "Aug", "Sep", "Sept", "Oct", "Nov", "Dec",
    // French
    "M", "MM", "Mme", "Mmes", "Mlle", "Mlles", "Me", "Pr", "Cie", "cf",
    "env", "av", "janv", "févr", "avr", "juil", "sept", "déc", "p", "ex",
    "n°", "art", "chap", "fig", "éd", "Mgr", "St", "Ste", "boul"
  ];
  // Arabic titles written with a period before a name: د. (doctor) and
  // أ.د. (professor doctor). Other Arabic abbreviations are not protected.
  var ARABIC_TITLES = ["أ\\.د", "د"];

  var PROTECT = "\uE000";
  var PARA = "\uE001";

  // Mark periods that must not end a sentence (abbreviations, decimals,
  // initials). Used by both the Segmenter path and the regex fallback.
  function protectNonBoundaries(clean) {
    ABBREVIATIONS.forEach(function (abbr) {
      var esc = abbr.replace(/\./g, "\\.");
      var re = new RegExp("(^|[^\\p{L}\\p{N}])" + esc + "\\.", "gu");
      clean = clean.replace(re, function (m, pre) { return pre + abbr + PROTECT; });
    });
    ARABIC_TITLES.forEach(function (t) {
      var re = new RegExp("(^|[^\\p{L}\\p{N}])(" + t + ")\\.(?=\\s+[\\u0600-\\u06FF])", "gu");
      clean = clean.replace(re, function (m, pre, abbr) { return pre + abbr.replace(/\\/g, "").split(".").join(PROTECT) + PROTECT; });
    });
    clean = clean.replace(/(\d)\.(\d)/g, "$1" + PROTECT + "$2");
    // Initials in names ("J. R. Tolkien"): a standalone capital + period
    // before another capital is not a sentence end.
    clean = clean.replace(/\b([A-Z])\.(?=\s+[A-Z])/g, "$1" + PROTECT);
    return clean;
  }

  // Pick the segmentation locale for a paragraph. Priority: Arabic, French,
  // English. Arabic when Arabic-script letters are a third or more of the
  // letters; French when French-only letters or common French function
  // words show up; otherwise English.
  function detectLanguage(text) {
    var letters = (text.match(/\p{L}/gu) || []).length;
    if (!letters) return "en";
    var arabic = (text.match(/[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/g) || []).length;
    if (arabic / letters >= 0.33) return "ar";
    var accents = (text.match(/[àâçéèêëîïôûùüÿœæÀÂÇÉÈÊËÎÏÔÛÙÜŸŒÆ]/g) || []).length;
    var fr = (text.toLowerCase().match(/\b(le|la|les|des|une|est|dans|pour|avec|sont|nous|vous|ils|elle|qui|que|pas|sur|mais|ou|où|et|du|au|aux|ce|cette|ces|il|je|tu|de|en|un)\b/g) || []).length;
    var en = (text.toLowerCase().match(/\b(the|and|is|are|was|were|of|to|in|that|it|for|with|as|on|this|have|has|not|but)\b/g) || []).length;
    if (accents >= 2 && fr >= en) return "fr";
    if (fr >= 3 && fr > en * 1.5) return "fr";
    return "en";
  }

  var segmenters = {};
  function getSegmenter(lang) {
    if (typeof Intl === "undefined" || typeof Intl.Segmenter !== "function") return null;
    if (!segmenters.hasOwnProperty(lang)) {
      try { segmenters[lang] = new Intl.Segmenter(lang, { granularity: "sentence" }); }
      catch (e) { segmenters[lang] = null; }
    }
    return segmenters[lang];
  }

  // A segment made only of closing quotes/brackets belongs to the sentence
  // before it (He said "Stop." / « Bonjour. »).
  var CLOSER_START = /^[»"'”’)\]]+/;

  function mergeClosers(pieces) {
    var out = [];
    for (var i = 0; i < pieces.length; i++) {
      var piece = pieces[i];
      var m = piece.match(CLOSER_START);
      if (out.length && m) {
        out[out.length - 1] += m[0];
        piece = piece.slice(m[0].length);
        if (!piece.trim()) continue;
      }
      out.push(piece);
    }
    return out;
  }

  function segmentParagraph(par) {
    var seg = getSegmenter(detectLanguage(par));
    if (!seg) return null;
    var raw = [];
    var it = seg.segment(par)[Symbol.iterator]();
    for (var r = it.next(); !r.done; r = it.next()) raw.push(r.value.segment);
    return mergeClosers(raw);
  }

  /*
   * Split text into sentences. Uses Intl.Segmenter (sentence granularity)
   * with the locale picked per paragraph, Arabic then French then English,
   * when the browser provides it; otherwise a regex splitter on . ! ? …
   * and the Arabic question mark. In both paths common English and French
   * abbreviations, decimals and name initials are protected, and paragraph
   * breaks are hard boundaries.
   */
  function splitIntoSentences(text) {
    var clean = normalizeExtractedText(text);
    if (!clean) return [];
    clean = protectNonBoundaries(clean);
    clean = clean.replace(/\n{2,}/g, PARA).replace(/\n/g, " ");

    var pieces = [];
    var paragraphs = clean.split(PARA);
    for (var p = 0; p < paragraphs.length; p++) {
      var par = paragraphs[p];
      var segs = segmentParagraph(par);
      if (!segs) {
        // Regex fallback. Split after sentence punctuation, including when a
        // closing quote follows it. Parentheses are deliberately excluded.
        segs = mergeClosers(par.split(new RegExp("(?<=[.!?…؟][\"'”’»]*\\s+)(?=[^\\s\\p{Ll}])", "u")));
      }
      for (var k = 0; k < segs.length; k++) pieces.push(segs[k]);
    }
    var sentences = [];
    for (var i = 0; i < pieces.length; i++) {
      var s = pieces[i].split(PROTECT).join(".").trim();
      if (s.length > 0) sentences.push(s);
    }
    return sentences;
  }

  /*
   * Group sentences into utterance-sized chunks. speechSynthesis on some
   * platforms truncates very long utterances, so cap each chunk.
   */
  function chunkSentences(sentences, maxChars) {
    var cap = maxChars || 260;
    var chunks = [];
    var current = "";
    (sentences || []).forEach(function (s) {
      if (!s) return;
      if (s.length > cap) {
        // Hard-split an overlong sentence at the last space before the cap.
        var rest = s;
        while (rest.length > cap) {
          var cut = rest.lastIndexOf(" ", cap);
          if (cut <= 0) cut = cap;
          if (current) { chunks.push(current); current = ""; }
          chunks.push(rest.slice(0, cut).trim());
          rest = rest.slice(cut).trim();
        }
        current = current ? current + " " + rest : rest;
      } else if ((current ? current.length + 1 : 0) + s.length > cap) {
        if (current) chunks.push(current);
        current = s;
      } else {
        current = current ? current + " " + s : s;
      }
    });
    if (current) chunks.push(current);
    return chunks;
  }

  // Map each chunk back to the index of its first sentence (for highlighting).
  function chunkWithSentenceIndex(sentences, maxChars) {
    var chunks = chunkSentences(sentences, maxChars);
    var result = [];
    var cursor = 0;
    chunks.forEach(function (chunk) {
      var idx = cursor;
      var remaining = chunk;
      while (cursor < sentences.length && remaining.indexOf(sentences[cursor]) === 0) {
        remaining = remaining.slice(sentences[cursor].length).trim();
        cursor++;
      }
      result.push({ text: chunk, sentenceIndex: idx });
    });
    return result;
  }

  /*
   * Multi-column PDF pages: decide whether text items form two columns and,
   * if so, partition them (stream order preserved within each column).
   * The gutter between columns is the largest gap in sorted item x positions;
   * it must be wide, land in the page's middle band, and leave items on both
   * sides. Anything weaker returns a single column (unchanged behavior).
   */
// A recognised line that ends without sentence punctuation and is followed by
  // a line in the other script (Arabic vs Latin) is a separate item (heading,
  // caption, bilingual pair), so the pair becomes a paragraph break.
  function splitOnScriptSwitch(text) {
    const lines = (text || "").split("\n");
    const script = (l) => {
      const ar = (l.match(/[\u0600-\u06FF]/g) || []).length, la = (l.match(/[A-Za-z]/g) || []).length;
      return ar === 0 && la === 0 ? "" : ar > la ? "ar" : "la";
    };
    const out = [];
    for (let i = 0; i < lines.length; i++) {
      out.push(lines[i]);
      const a = script(lines[i]), nextLine = lines[i + 1];
      if (i + 1 < lines.length && lines[i].trim() && nextLine.trim() && a && script(nextLine) && a !== script(nextLine) && !/[.!?\u061F\u2026:;]["'\u201D\u00BB)]*\s*$/.test(lines[i])) out.push("");
    }
    return out.join("\n");
  }

  function splitColumns(items) {
    var positioned = [];
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (it && it.transform && it.str && it.str.trim()) positioned.push(it.transform[4]);
    }
    if (positioned.length < 8) return [items];
    var sorted = positioned.slice().sort(function (a, b) { return a - b; });
    var best = 0, gutter = 0;
    for (var j = 1; j < sorted.length; j++) {
      var gap = sorted[j] - sorted[j - 1];
      if (gap > best) { best = gap; gutter = (sorted[j] + sorted[j - 1]) / 2; }
    }
    var span = sorted[sorted.length - 1] - sorted[0];
    var center = (gutter - sorted[0]) / (span || 1);
    if (best < 40 || center < 0.2 || center > 0.8) return [items];
    var left = [], right = [];
    for (var k = 0; k < items.length; k++) {
      var item = items[k];
      if (item && item.transform && item.transform[4] >= gutter) right.push(item);
      else left.push(item);
    }
    var leftText = left.filter(function (i) { return i.str && i.str.trim(); }).length;
    var rightText = right.filter(function (i) { return i.str && i.str.trim(); }).length;
    if (leftText < 4 || rightText < 4) return [items];
    return [left, right];
  }

  /*
   * Repair visual-order Arabic produced by some PDF text layers (common in
   * browser print-to-PDF output): glyphs are stored as Arabic presentation
   * forms in display order, one glyph per text item. Detect lines dominated
   * by presentation forms and restore logical order: multi-space runs (word
   * boundaries from real space items) are protected, single spaces between
   * glyph items removed, the line reversed, and presentation forms folded
   * back to standard letters with Unicode NFKC. Lines without presentation
   * forms pass through unchanged, so ordinary LTR text and already-logical
   * RTL text (e.g. from web pages) are untouched. Lines mixing substantial
   * Latin content with visual-order Arabic are deliberately NOT reversed
   * (whole-line reversal would corrupt them); they pass through with a
   * console.debug note instead.
   */
  function fixVisualOrderRtl(text) {
    var lines = String(text).split("\n");
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      var presentation = (line.match(/[\uFB50-\uFDFF\uFE70-\uFEFF]/g) || []).length;
      var standard = (line.match(/[\u0600-\u06FF]/g) || []).length;
      if (presentation === 0 || presentation < standard) continue;
      // Conservative fallback: reversing reorders the whole line, so a line
      // with substantial Latin content (mixed text) would be corrupted, not
      // repaired. Only reverse when Latin content is incidental (a short
      // token like "PDF" inside an Arabic line). Mixed lines pass through
      // unchanged: imperfect glyph forms, but never reordered text.
      var latin = (line.match(/[A-Za-z0-9]/g) || []).length;
      if (latin > 4 && latin * 10 > presentation) {
        if (typeof console !== "undefined" && console.debug) {
          console.debug("ReadAloud: mixed RTL/Latin line left unreversed (" + latin + " latin, " + presentation + " presentation-form chars)");
        }
        continue;
      }
      // Reverse the order of text items, never the characters inside one:
      // pdf.js may group several glyphs (or a Latin word) in a single item,
      // and those are already in logical order internally. Single spaces
      // separate items; runs of 2+ spaces mark word boundaries (real space
      // items) and are protected as sentinels before the item split.
      var tokens = line.replace(/\s{2,}/g, " \u0000 ").split(" ").reverse();
      for (var t = 0; t < tokens.length; t++) {
        // Sentence punctuation of an RTL line renders at the visual start of
        // its item; move it back to the end after reversal (".PDF" -> "PDF.").
        tokens[t] = tokens[t].replace(/^([.,;:!?\u061F\u060C])(\S+)$/, "$2$1");
      }
      var fixed = tokens.join("");
      if (fixed.normalize) fixed = fixed.normalize("NFKC");
      lines[i] = fixed.replace(/\u0000/g, " ").replace(/\s+/g, " ").trim();
    }
    return lines.join("\n");
  }

  return {
    detectLanguage: detectLanguage,
    splitColumns: splitColumns,
    splitOnScriptSwitch: splitOnScriptSwitch,
    fixVisualOrderRtl: fixVisualOrderRtl,
    normalizeWhitespace: normalizeWhitespace,
    normalizeExtractedText: normalizeExtractedText,
    dehyphenate: dehyphenate,
    splitIntoSentences: splitIntoSentences,
    chunkSentences: chunkSentences,
    chunkWithSentenceIndex: chunkWithSentenceIndex
  };
});
