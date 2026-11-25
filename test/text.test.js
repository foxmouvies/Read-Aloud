/* Unit tests for the shared text library (node:test). */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const RAText = require("../shared/text.js");

test("normalizeWhitespace collapses spaces and trims", () => {
  assert.equal(RAText.normalizeWhitespace("  hello   world \n\n\n\n next  "), "hello world\n\nnext");
});

test("dehyphenate joins PDF line-break hyphenation", () => {
  assert.equal(RAText.dehyphenate("This is an exam-\nple of text."), "This is an example of text.");
});

test("splitIntoSentences splits basic sentences", () => {
  const s = RAText.splitIntoSentences("One two three. Four five! Six seven?");
  assert.deepEqual(s, ["One two three.", "Four five!", "Six seven?"]);
});

test("splitIntoSentences protects abbreviations and decimals", () => {
  const s = RAText.splitIntoSentences("Dr. Amine paid 3.5 MAD. He left.");
  assert.deepEqual(s, ["Dr. Amine paid 3.5 MAD.", "He left."]);
});

test("splitIntoSentences handles Arabic question mark", () => {
  const s = RAText.splitIntoSentences("هل هذا يعمل؟ نعم إنه يعمل.");
  assert.deepEqual(s, ["هل هذا يعمل؟", "نعم إنه يعمل."]);
});

test("splitIntoSentences treats paragraph breaks as boundaries", () => {
  const s = RAText.splitIntoSentences("First paragraph has no end mark\n\nSecond starts here.");
  assert.deepEqual(s, ["First paragraph has no end mark", "Second starts here."]);
});

test("splitIntoSentences returns [] for empty input", () => {
  assert.deepEqual(RAText.splitIntoSentences(""), []);
  assert.deepEqual(RAText.splitIntoSentences(null), []);
});

test("chunkSentences groups short sentences under the cap", () => {
  const sentences = ["Short one.", "Short two.", "Short three."];
  const chunks = RAText.chunkSentences(sentences, 60);
  assert.deepEqual(chunks, ["Short one. Short two. Short three."]);
});

test("chunkSentences splits when over the cap", () => {
  const a = "A".repeat(50) + ".";
  const b = "B".repeat(50) + ".";
  const chunks = RAText.chunkSentences([a, b], 60);
  assert.deepEqual(chunks, [a, b]);
});

test("chunkSentences hard-splits a single overlong sentence", () => {
  const long = Array.from({ length: 40 }, (_, i) => "word" + i).join(" ");
  const chunks = RAText.chunkSentences([long], 60);
  assert.ok(chunks.length > 1);
  chunks.forEach((c) => assert.ok(c.length <= 60, `chunk too long: ${c.length}`));
  assert.equal(chunks.join(" ").replace(/\s+/g, " ").trim(), long);
});

test("chunkWithSentenceIndex maps chunks to first-sentence indexes", () => {
  const sentences = ["One.", "Two.", "Three."];
  const result = RAText.chunkWithSentenceIndex(sentences, 12);
  assert.equal(result[0].sentenceIndex, 0);
  assert.equal(result.map((r) => r.text).join(" "), "One. Two. Three.");
});

test("splitColumns partitions a two-column page at the gutter", () => {
  const items = [];
  for (let i = 0; i < 6; i++) {
    // row-major emission: left line then right line, same y
    items.push({ str: "Left line " + i, transform: [1, 0, 0, 1, 50, 700 - i * 14] });
    items.push({ str: "Right line " + i, transform: [1, 0, 0, 1, 320, 700 - i * 14] });
  }
  const cols = RAText.splitColumns(items);
  assert.equal(cols.length, 2);
  assert.ok(cols[0].every((it) => it.transform[4] < 200), "left column items only");
  assert.ok(cols[1].every((it) => it.transform[4] >= 200), "right column items only");
  assert.equal(cols[0].length + cols[1].length, items.length);
});

test("splitColumns leaves single-column and small pages untouched", () => {
  const single = [];
  for (let i = 0; i < 6; i++) single.push({ str: "Body line " + i, transform: [1, 0, 0, 1, 50 + (i % 2) * 5, 700 - i * 14] });
  assert.equal(RAText.splitColumns(single).length, 1);
  const few = [{ str: "a", transform: [1, 0, 0, 1, 50, 700] }, { str: "b", transform: [1, 0, 0, 1, 300, 700] }];
  assert.equal(RAText.splitColumns(few).length, 1);
  // indented block but too few items on the right: stays single-column
  const indented = [];
  for (let i = 0; i < 8; i++) indented.push({ str: "Main " + i, transform: [1, 0, 0, 1, 50, 700 - i * 14] });
  indented.push({ str: "Note", transform: [1, 0, 0, 1, 200, 600] });
  assert.equal(RAText.splitColumns(indented).length, 1);
});

test("fixVisualOrderRtl restores logical order and standard letters", () => {
  // Visual-order glyph stream as pdf.js emits it from a print-to-PDF Arabic
  // page: presentation forms, one glyph per item, double space at word
  // boundaries (space item + separator), single spaces between glyphs.
  const visual = "\ufeaa \ufee8 \ufe98 \ufeb4 \ufee3  \ufee6 \ufee3";
  assert.equal(RAText.fixVisualOrderRtl(visual), "\u0645\u0646 \u0645\u0633\u062a\u0646\u062f");
});

test("fixVisualOrderRtl leaves LTR and logical-order RTL text untouched", () => {
  assert.equal(RAText.fixVisualOrderRtl("Hello world."), "Hello world.");
  const logical = "\u0647\u0630\u0647 \u062a\u062c\u0631\u0628\u0629";
  assert.equal(RAText.fixVisualOrderRtl(logical), logical);
});

test("fixVisualOrderRtl never reorders mixed Latin/RTL lines (conservative fallback)", () => {
  // Presentation forms present, but substantial Latin content: reversing the
  // whole line would corrupt it, so the line must pass through unchanged.
  const mixed = "Invoice 2026 total 1500 \uFEB4 \uFEE8 \uFE9C \uFEAE \uFEE1 items shipped";
  assert.equal(RAText.fixVisualOrderRtl(mixed), mixed);
  // A short incidental Latin token inside an Arabic line is still repaired.
  const dominated = "\uFEAA \uFEE8 \uFE98 \uFEB4 \uFEE3  PDF";
  const fixed = RAText.fixVisualOrderRtl(dominated);
  assert.ok(fixed.includes("PDF"), "latin token kept");
  assert.ok(fixed.indexOf("\u0645\u0633\u062a\u0646\u062f") !== -1, "arabic restored");
});

test("fixVisualOrderRtl keeps multi-glyph items and Latin tokens intact", () => {
  // First line of the Arabic fixture as the reader joins pdf.js items:
  // ".PDF" is one Latin item with visual-leading punctuation, "aj" is one
  // two-glyph item. Character reversal corrupts both; item reversal must not.
  const line = ".\u0050\u0044\u0046   \ufeaa \ufee8 \ufe98 \ufeb4 \ufee3   \ufee6 \ufee3   \ufef2 \ufe91 \ufeae \ufecc \ufedf \u0627   \ufeba \ufee8 \ufedf \u0627   \u0627\u062c \ufeae \ufea8 \ufe98 \ufeb3 \ufefb ";
  const fixed = RAText.fixVisualOrderRtl(line);
  assert.ok(fixed.endsWith("PDF."), "latin item unreversed with trailing period, got: " + fixed);
  assert.ok(!fixed.includes("FDP"), "latin item not character-reversed");
  assert.ok(fixed.includes("\u0644\u0627\u0633\u062a\u062e\u0631\u0627\u062C".normalize("NFC")), "lam-alef word restored in order");
  assert.ok(fixed.indexOf("\u0645\u0633\u062a\u0646\u062f") !== -1, "presentation forms folded to standard letters");
});

test("splitIntoSentences splits after a closing quote", () => {
  const s = RAText.splitIntoSentences('He said "Stop." She left. Then (finally.) they rested.');
  assert.deepEqual(s, ['He said "Stop."', "She left.", "Then (finally.) they rested."]);
});

test("splitIntoSentences protects initials in names", () => {
  const s = RAText.splitIntoSentences("He met J. R. Tolkien. They talked.");
  assert.deepEqual(s, ["He met J. R. Tolkien.", "They talked."]);
});

test("splitIntoSentences keeps mid-sentence quoted text together when no period", () => {
  const s = RAText.splitIntoSentences('He called it "a test" and moved on. She agreed.');
  assert.deepEqual(s, ['He called it "a test" and moved on.', "She agreed."]);
});
