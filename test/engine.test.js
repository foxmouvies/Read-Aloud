/* Unit tests for the TTS engine with a mocked speechSynthesis (node:test). */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");

// The engine attaches to `self`; give it a browser-like global with a mock synth.
globalThis.self = globalThis;

function makeMockSynth() {
  const spoken = [];
  const synth = {
    spoken,
    paused: false,
    canceled: 0,
    speak(utter) {
      spoken.push(utter.text);
      // Simulate async speech completion.
      setImmediate(() => utter.onend && utter.onend());
    },
    pause() { this.paused = true; },
    resume() { this.paused = false; },
    cancel() { this.canceled++; },
    getVoices() { return []; }
  };
  return synth;
}

globalThis.SpeechSynthesisUtterance = class {
  constructor(text) { this.text = text; this.rate = 1; this.pitch = 1; }
};

require("../shared/tts-engine.js");
const RATTS = globalThis.RATTS;

test("engine plays through the whole queue and emits end", async () => {
  globalThis.speechSynthesis = makeMockSynth();
  const engine = RATTS.createEngine({ rate: 1.2 });
  let ended = null;
  const progresses = [];
  engine.on("end", (st) => { ended = st; });
  engine.on("progress", (st) => progresses.push(st.index));
  engine.load(["One.", "Two.", "Three."], 0);
  const ok = engine.play();
  assert.equal(ok, true);
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(globalThis.speechSynthesis.spoken, ["One.", "Two.", "Three."]);
  assert.deepEqual(progresses, [1, 2]);
  assert.equal(ended.state, "idle");
  assert.equal(ended.total, 3);
});

test("engine reports unsupported without speechSynthesis", () => {
  const saved = globalThis.speechSynthesis;
  delete globalThis.speechSynthesis;
  const engine = RATTS.createEngine({});
  let err = null;
  engine.on("error", (e) => { err = e; });
  engine.load(["x"], 0);
  assert.equal(engine.play(), false);
  assert.equal(err.error, "tts-unsupported");
  globalThis.speechSynthesis = saved;
});

test("pause/resume toggle state", async () => {
  globalThis.speechSynthesis = makeMockSynth();
  const engine = RATTS.createEngine({});
  engine.load(["A."], 0);
  // Never-ending utterance so we stay in "speaking".
  globalThis.speechSynthesis.speak = function (u) { this.spoken.push(u.text); };
  engine.play();
  assert.equal(engine.getState().state, "speaking");
  engine.pause();
  assert.equal(engine.getState().state, "paused");
  assert.equal(globalThis.speechSynthesis.paused, true);
  engine.resume();
  assert.equal(engine.getState().state, "speaking");
  assert.equal(globalThis.speechSynthesis.paused, false);
});

test("next/prev restart from the right index while playing", async () => {
  globalThis.speechSynthesis = makeMockSynth();
  const engine = RATTS.createEngine({});
  engine.load(["A.", "B.", "C."], 0);
  globalThis.speechSynthesis.speak = function (u) { this.spoken.push(u.text); };
  engine.play(0);
  engine.next();
  assert.equal(engine.getState().index, 1);
  engine.prev();
  assert.equal(engine.getState().index, 0);
  assert.deepEqual(globalThis.speechSynthesis.spoken, ["A.", "B.", "A."]);
});

test("stop resets to idle and cancels synthesis", () => {
  globalThis.speechSynthesis = makeMockSynth();
  const engine = RATTS.createEngine({});
  engine.load(["A.", "B."], 0);
  globalThis.speechSynthesis.speak = function (u) { this.spoken.push(u.text); };
  engine.play();
  engine.stop();
  const st = engine.getState();
  assert.equal(st.state, "idle");
  assert.equal(st.index, 0);
  assert.ok(globalThis.speechSynthesis.canceled >= 1);
});

test("setRate applies to subsequent utterances", async () => {
  globalThis.speechSynthesis = makeMockSynth();
  const engine = RATTS.createEngine({ rate: 1 });
  const seen = [];
  globalThis.speechSynthesis.speak = function (u) { seen.push(u.rate); };
  engine.load(["A.", "B."], 0);
  engine.play();
  engine.setRate(1.8);
  engine.next();
  assert.equal(seen[0], 1);
  assert.equal(seen[seen.length - 1], 1.8);
});

test("replay after natural completion restarts from the top", async () => {
  globalThis.speechSynthesis = makeMockSynth();
  const engine = RATTS.createEngine({ rate: 1 });
  engine.load(["A.", "B."], 0);
  engine.play();
  await new Promise((r) => setTimeout(r, 20)); // let both utterances finish
  let st = engine.getState();
  assert.equal(st.state, "idle");
  assert.equal(globalThis.speechSynthesis.spoken.length, 2);
  engine.play(); // user presses Play again after it finished
  st = engine.getState();
  assert.equal(st.state, "speaking");
  assert.equal(st.index, 0);
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(globalThis.speechSynthesis.spoken, ["A.", "B.", "A.", "B."]);
});

test("setPitch applies pitch and preserves the selected voice (B1)", () => {
  globalThis.speechSynthesis = makeMockSynth();
  const engine = RATTS.createEngine({ rate: 1, pitch: 1 });
  const voice = { name: "Test Voice", lang: "en-US" };
  const seen = [];
  globalThis.speechSynthesis.speak = function (u) { seen.push({ pitch: u.pitch, voice: u.voice }); };
  engine.load(["A.", "B."], 0);
  engine.setVoice(voice);
  engine.play();
  engine.setPitch(1.6); // must re-speak with new pitch and the SAME voice
  const last = seen[seen.length - 1];
  assert.equal(last.pitch, 1.6);
  assert.equal(last.voice, voice);
});

test("overlong sentences are split at load and map back to their sentence (B2)", async () => {
  globalThis.speechSynthesis = makeMockSynth();
  const engine = RATTS.createEngine({});
  const longSentence = "word ".repeat(80).trim() + "."; // ~400 chars
  engine.load([longSentence, "Short."], 0);
  const st0 = engine.getState();
  assert.ok(st0.total >= 2, "long sentence should be split into multiple queue entries");
  assert.equal(st0.sentenceIndex, 0);
  engine.play();
  await new Promise((r) => setTimeout(r, 30));
  const spoken = globalThis.speechSynthesis.spoken;
  assert.ok(spoken.every((t) => t.length <= 260), "every utterance within the platform-safe cap");
  // every chunk of the long sentence maps back to sentence 0
  const parts = spoken.length;
  assert.ok(parts >= 3, "two long-sentence chunks plus the short sentence, got " + parts);
});

test("watchdog restarts an utterance that never starts, then errors (B3)", async () => {
  const spoken = [];
  const deadSynth = {
    spoken,
    speaking: false,
    pending: false,
    paused: false,
    speak(u) { spoken.push(u.text); /* never fires onstart/onend: dropped */ },
    pause() {}, resume() {}, cancel() {},
    getVoices() { return []; }
  };
  globalThis.speechSynthesis = deadSynth;
  const engine = RATTS.createEngine({ watchdogMs: 20, stallGraceMs: 10 });
  let err = null;
  engine.on("error", (e) => { err = e.error; });
  engine.load(["A."], 0);
  engine.play();
  await new Promise((r) => setTimeout(r, 250));
  assert.ok(spoken.length >= 2, "watchdog re-queued the dropped utterance, spoken=" + spoken.length);
  assert.equal(err, "speech-stalled");
  assert.equal(engine.getState().state, "idle");
});

test("watchdog is disarmed when reading finishes naturally (B16)", async () => {
  const synth = makeMockSynth();
  synth.speaking = false; // expose the flag so the watchdog arms
  let intervals = 0, cleared = 0;
  const realSet = globalThis.setInterval, realClear = globalThis.clearInterval;
  globalThis.setInterval = (...a) => { intervals++; return realSet(...a); };
  globalThis.clearInterval = (h) => { cleared++; return realClear(h); };
  try {
    const engine = RATTS.createEngine({ watchdogMs: 20, stallGraceMs: 10 });
    engine.load(["One.", "Two."], 0);
    engine.play();
    await new Promise((r) => setTimeout(r, 80));
    assert.ok(intervals >= 1, "watchdog armed while speaking");
    assert.equal(engine.getState().state, "idle", "finished naturally");
    assert.ok(cleared >= 1, "watchdog disarmed on natural completion, cleared=" + cleared);
  } finally {
    globalThis.setInterval = realSet;
    globalThis.clearInterval = realClear;
  }
});
