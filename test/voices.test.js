"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { RATTS } = require("../shared/tts-engine.js");

const local = (name) => ({ name, voiceURI: "local://" + name, localService: true, lang: "en" });
const online = (name) => ({ name, voiceURI: "online://" + name, localService: false, lang: "en" });

test("prefers a local voice by default", () => {
  const c = RATTS.chooseVoice([online("A"), local("B")], null, false);
  assert.equal(c.voice.name, "B");
  assert.equal(c.needsChoice, false);
});

test("never returns a remote voice without opt-in", () => {
  const c = RATTS.chooseVoice([online("A"), online("B")], null, false);
  assert.equal(c.voice, null);
  assert.equal(c.needsChoice, true);
  assert.equal(c.onlineCount, 2);
});

test("no voices at all does not ask for a choice", () => {
  const c = RATTS.chooseVoice([], null, false);
  assert.equal(c.needsChoice, false);
});

test("saved online voice is ignored without opt-in and cannot bypass it", () => {
  const voices = [online("A"), local("B")];
  const c = RATTS.chooseVoice(voices, "online://A", false);
  assert.equal(c.voice.name, "B", "falls back to a local voice instead of the saved online one");
});

test("saved online voice applies after explicit opt-in", () => {
  const c = RATTS.chooseVoice([online("A"), local("B")], "online://A", true);
  assert.equal(c.voice.name, "A");
});

test("opt-in with no local voices allows the browser default", () => {
  const c = RATTS.chooseVoice([online("A")], null, true);
  assert.equal(c.voice, null);
  assert.equal(c.needsChoice, false);
});

test("saved local voice always applies", () => {
  const c = RATTS.chooseVoice([online("A"), local("B"), local("C")], "local://C", false);
  assert.equal(c.voice.name, "C");
});

test("store keeps the onlineOptIn flag through a round-trip", async () => {
  const Store = require("../shared/store.js");
  await new Promise((r) => Store.clearAll(r));
  await new Promise((r) => Store.saveSettings({ onlineOptIn: true, rate: 1.2 }, r));
  const s = await new Promise((r) => Store.loadSettings(r));
  assert.equal(s.onlineOptIn, true);
  assert.equal(s.rate, 1.2);
  // a later partial save does not clobber the flag
  await new Promise((r) => Store.saveSettings({ pitch: 1.1 }, r));
  const s2 = await new Promise((r) => Store.loadSettings(r));
  assert.equal(s2.onlineOptIn, true);
  assert.equal(s2.rate, 1.2);
});
