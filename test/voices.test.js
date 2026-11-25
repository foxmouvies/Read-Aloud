"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { RATTS } = require("../shared/tts-engine.js");

const v = (name, lang, local) => ({ name, voiceURI: (local ? "local://" : "online://") + name, localService: !!local, lang });

test("English (United States) is the default and only en-US voices are eligible", () => {
  const voices = [v("Amelie", "fr-FR", true), v("Daniel", "en-GB", true), v("Zira", "en-US", true), v("Jenny", "en_US", false)];
  const c = RATTS.chooseVoice(voices, null);
  assert.equal(c.voice.name, "Zira");
  assert.equal(c.localCount, 1);
  assert.equal(c.onlineCount, 1);
});

test("online-only voices are listed but never auto-selected without a saved choice", () => {
  const c = RATTS.chooseVoice([v("Amelie", "fr-FR", true), v("Jenny", "en-US", false)], null);
  assert.equal(c.voice, null);
  assert.equal(c.needsChoice, true);
  assert.equal(c.onlineCount, 1);
  const s = RATTS.chooseVoice([v("Jenny", "en-US", false)], "online://Jenny");
  assert.equal(s.voice.name, "Jenny");
  assert.equal(s.needsChoice, false);
});

test("a local voice is the default over an online one in the same language", () => {
  const c = RATTS.chooseVoice([v("Jenny", "en-US", false), v("Zira", "en-US", true)], null);
  assert.equal(c.voice.name, "Zira");
});

test("never falls back to a voice of another language", () => {
  const c = RATTS.chooseVoice([v("Amelie", "fr-FR", true), v("Hoda", "ar-EG", true), v("Daniel", "en-GB", true)], null);
  assert.equal(c.voice, null);
  assert.equal(c.noLangVoice, true);
});

test("all English regions is an explicit user choice", () => {
  const c = RATTS.chooseVoice([v("Amelie", "fr-FR", true), v("Daniel", "en-GB", true)], null, "en");
  assert.equal(c.voice.name, "Daniel");
});

test("the user's chosen voice is kept, other-language saved voice is ignored", () => {
  const voices = [v("Amelie", "fr-FR", true), v("Zira", "en-US", true), v("Jenny", "en-US", false)];
  assert.equal(RATTS.chooseVoice(voices, "online://Jenny").voice.name, "Jenny");
  assert.equal(RATTS.chooseVoice(voices, "local://Amelie").voice.name, "Zira");
});

test("a chosen online voice that disappears is not silently replaced", () => {
  const c = RATTS.chooseVoice([v("Zira", "en-US", true)], "online://Jenny");
  assert.equal(c.voice, null);
  assert.equal(c.savedMissing, true);
  const back = RATTS.chooseVoice([v("Zira", "en-US", true), v("Jenny", "en-US", false)], "online://Jenny");
  assert.equal(back.voice.name, "Jenny");
  assert.equal(back.savedMissing, false);
});

test("an empty voice list is not treated as a missing chosen voice", () => {
  const c = RATTS.chooseVoice([], "online://Jenny");
  assert.equal(c.savedMissing, false);
  assert.equal(c.noLangVoice, false);
});
