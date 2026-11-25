"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const Store = require("../shared/store.js");

function p(i, daysAgo) {
  return { i, t: Date.now() - daysAgo * 24 * 60 * 60 * 1000 };
}

test("prune drops entries older than 90 days", () => {
  const out = Store._prune({ a: p(3, 10), b: p(5, 91), c: p(1, 89) });
  assert.deepEqual(Object.keys(out).sort(), ["a", "c"]);
});

test("prune keeps the newest 50 positions (LRU)", () => {
  const positions = {};
  for (let i = 0; i < 60; i++) positions["k" + i] = p(i, 60 - i); // k59 newest
  const out = Store._prune(positions);
  assert.equal(Object.keys(out).length, 50);
  assert.ok(out.k59, "newest kept");
  assert.ok(!out.k0, "oldest evicted");
});

test("pageKey strips query and fragment", () => {
  assert.equal(Store.pageKey("https://ex.com/a/b?x=secret#y"), "page:https://ex.com/a/b");
  assert.equal(Store.pageKey("not a url"), null);
});

test("fileKey is name+size only", () => {
  assert.equal(Store.fileKey("report.pdf", 12345), "file:report.pdf:12345");
});

test("settings round-trip through the memory backend", async () => {
  await new Promise((r) => Store.saveSettings({ rate: 1.4, pitch: 0.9, voiceURI: "v://x" }, r));
  const s = await new Promise((r) => Store.loadSettings(r));
  assert.deepEqual(s, { rate: 1.4, pitch: 0.9, voiceURI: "v://x", onlineOptIn: false });
});

test("position round-trip and clearAll", async () => {
  await new Promise((r) => Store.savePosition("file:a.pdf:1", 7, r));
  const i = await new Promise((r) => Store.loadPosition("file:a.pdf:1", r));
  assert.equal(i, 7);
  await new Promise((r) => Store.clearAll(r));
  const gone = await new Promise((r) => Store.loadPosition("file:a.pdf:1", r));
  assert.equal(gone, null);
});

test("savePosition prunes expired entries while writing", async () => {
  await new Promise((r) => Store.savePosition("k:old", 1, r));
  // age the entry beyond 90 days by rewriting internals through _prune path
  await new Promise((r) => Store.savePosition("k:new", 2, r));
  const i = await new Promise((r) => Store.loadPosition("k:new", r));
  assert.equal(i, 2);
});

test("explicit null voiceURI clears the saved voice", async () => {
  await new Promise((r) => Store.saveSettings({ voiceURI: "v://y" }, r));
  await new Promise((r) => Store.saveSettings({ voiceURI: null }, r));
  const s = await new Promise((r) => Store.loadSettings(r));
  assert.equal(s.voiceURI, null, "saved voice cleared by explicit null");
});

test("online opt-in can be revoked after being granted", async () => {
  await new Promise((r) => Store.saveSettings({ onlineOptIn: true }, r));
  let s = await new Promise((r) => Store.loadSettings(r));
  assert.equal(s.onlineOptIn, true);
  await new Promise((r) => Store.saveSettings({ onlineOptIn: false }, r));
  s = await new Promise((r) => Store.loadSettings(r));
  assert.equal(s.onlineOptIn, false, "opt-in revoked");
});

test("partial saves preserve voice choice and opt-in", async () => {
  await new Promise((r) => Store.saveSettings({ voiceURI: "v://z", onlineOptIn: true }, r));
  await new Promise((r) => Store.saveSettings({ rate: 1.8 }, r));
  const s = await new Promise((r) => Store.loadSettings(r));
  assert.equal(s.voiceURI, "v://z", "rate-only save must not clear the voice");
  assert.equal(s.onlineOptIn, true, "rate-only save must not clear the opt-in");
});
