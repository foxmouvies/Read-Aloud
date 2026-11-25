/*
 * ReadAloud TTS engine: a sentence queue on top of window.speechSynthesis.
 * Works in content scripts and extension pages in Firefox and Chromium.
 * Exposes a single global: RATTS.createEngine(options).
 */
(function (root) {
  "use strict";

  function createEngine(opts) {
    var options = opts || {};
    var synth = root.speechSynthesis;
    var sentences = [];
    var index = 0;               // index of the sentence being spoken / next to speak
    var state = "idle";          // idle | speaking | paused
    var sentenceMap = [];        // queue index -> original sentence index
    var currentUtter = null;     // retained so Chrome cannot GC a live utterance
    var watchdog = null;         // interval handle for the stall watchdog
    var lastSpeakAt = 0;
    var startSeen = false;
    var stallRetries = 0;
    var listeners = {};

    function emit(event, payload) {
      (listeners[event] || []).forEach(function (fn) {
        try { fn(payload); } catch (e) { /* listener errors must not kill the engine */ }
      });
    }

    function on(event, fn) {
      listeners[event] = listeners[event] || [];
      listeners[event].push(fn);
    }

    function supported() {
      return typeof synth !== "undefined" && typeof root.SpeechSynthesisUtterance !== "undefined";
    }

    function getState() {
      return {
        state: state,
        index: index,
        total: sentences.length,
        sentenceIndex: sentenceMap.length ? sentenceMap[Math.min(index, sentenceMap.length - 1)] : index,
        currentText: sentences[index] || ""
      };
    }

    function speakCurrent() {
      if (index >= sentences.length) {
        disarmWatchdog(); // natural completion: no live utterance to watch (B16)
        state = "idle";
        emit("end", getState());
        emit("state", getState());
        return;
      }
      var utter = new root.SpeechSynthesisUtterance(sentences[index]);
      if (options.voice) utter.voice = options.voice;
      if (typeof options.rate === "number") utter.rate = options.rate;
      if (typeof options.pitch === "number") utter.pitch = options.pitch;
      if (options.lang) utter.lang = options.lang;
      utter.onend = function () {
        if (state !== "speaking") return; // stopped or superseded
        index++;
        if (index < sentences.length) emit("progress", getState());
        speakCurrent();
      };
      utter.onerror = function (e) {
        if (e && (e.error === "interrupted" || e.error === "canceled")) return;
        // A real failure (e.g. no voices on this system): reset to idle so
        // the UI does not get stuck pretending to play.
        stopInternal();
        emit("error", { error: (e && e.error) || "unknown", state: getState() });
        emit("state", getState());
      };
      currentUtter = utter; // retain: Chrome can GC unreferenced live utterances
      lastSpeakAt = Date.now();
      startSeen = false;
      utter.onstart = function () { startSeen = true; };
      synth.speak(utter);
      armWatchdog();
      emit("state", getState());
    }

    /*
     * Chromium can silently drop a queued utterance (never starts) or stop a
     * long one without firing onend. The watchdog restarts an utterance that
     * never started (bounded retries) and nudges resume() while speaking,
     * which is a no-op elsewhere and works around the Chrome long-utterance
     * cutoff. Skipped when the synth does not expose speaking/pending.
     */
    function armWatchdog() {
      if (watchdog || typeof synth.speaking !== "boolean") return;
      var interval = typeof options.watchdogMs === "number" ? options.watchdogMs : 10000;
      watchdog = setInterval(function () {
        if (state !== "speaking") return;
        if (!startSeen && !synth.speaking && !synth.pending && Date.now() - lastSpeakAt > (options.stallGraceMs || 3000)) {
          if (stallRetries < 2) {
            stallRetries++;
            speakCurrent(); // re-queue the dropped utterance
          } else {
            stopInternal();
            emit("error", { error: "speech-stalled", state: getState() });
            emit("state", getState());
          }
        } else if (startSeen && synth.speaking && !synth.paused) {
          synth.resume(); // Chrome long-utterance keep-alive; no-op elsewhere
        }
      }, interval);
      if (watchdog.unref) watchdog.unref();
    }

    function disarmWatchdog() {
      if (watchdog) { clearInterval(watchdog); watchdog = null; }
    }

    // Long utterances are silently truncated by several platform voices
    // (notably network voices), so overlong sentences are hard-split at load.
    // sentenceMap keeps each queue entry's original sentence for highlighting.
    var MAX_UTTERANCE = 260;
    function splitLong(sentence) {
      var parts = [];
      var rest = sentence;
      while (rest.length > MAX_UTTERANCE) {
        var cut = rest.lastIndexOf(" ", MAX_UTTERANCE);
        if (cut <= 0) cut = MAX_UTTERANCE;
        parts.push(rest.slice(0, cut).trim());
        rest = rest.slice(cut).trim();
      }
      if (rest) parts.push(rest);
      return parts;
    }

    function load(newSentences, startIndex) {
      stopInternal();
      var raw = (newSentences || []).slice();
      sentences = [];
      sentenceMap = [];
      raw.forEach(function (s, i) {
        splitLong(s).forEach(function (part) {
          sentences.push(part);
          sentenceMap.push(i);
        });
      });
      index = Math.min(Math.max(startIndex || 0, 0), Math.max(sentences.length - 1, 0));
      emit("state", getState());
    }

    function play(fromIndex) {
      if (!supported()) {
        emit("error", { error: "tts-unsupported", state: getState() });
        return false;
      }
      if (typeof fromIndex === "number") index = Math.min(Math.max(fromIndex, 0), Math.max(sentences.length - 1, 0));
      if (!sentences.length) return false;
      if (index >= sentences.length) index = 0; // replay after natural completion restarts from the top
      synth.cancel(); // clear any stuck queue before starting
      state = "speaking";
      speakCurrent();
      return true;
    }

    function pause() {
      if (state === "speaking") {
        synth.pause();
        state = "paused";
        emit("state", getState());
      }
    }

    function resume() {
      if (state === "paused") {
        synth.resume();
        state = "speaking";
        emit("state", getState());
      }
    }

    function stopInternal() {
      disarmWatchdog();
      if (supported()) synth.cancel();
      currentUtter = null;
      state = "idle";
    }

    function stop() {
      stopInternal();
      index = 0;
      emit("state", getState());
    }

    function next() {
      if (index < sentences.length - 1) {
        var wasSpeaking = state === "speaking" || state === "paused";
        stopInternal();
        index++;
        if (wasSpeaking) { state = "speaking"; speakCurrent(); }
        else emit("state", getState());
      }
    }

    function prev() {
      if (index > 0) {
        var wasSpeaking = state === "speaking" || state === "paused";
        stopInternal();
        index--;
        if (wasSpeaking) { state = "speaking"; speakCurrent(); }
        else emit("state", getState());
      }
    }

    function sameVoice(a, b) {
      if (a === b) return true;
      if (!a || !b) return false;
      return (a.voiceURI || a.name) === (b.voiceURI || b.name) && String(a.lang || "") === String(b.lang || "");
    }

    function setRate(rate) {
      if ((typeof options.rate === "number" ? options.rate : 1) === rate) return; // unchanged: never restart the sentence being read
      options.rate = rate;
      // Rate only applies to new utterances; restart the current one if playing.
      if (state === "speaking") {
        stopInternal();
        state = "speaking";
        speakCurrent();
      }
    }

    function setPitch(pitch) {
      if ((typeof options.pitch === "number" ? options.pitch : 1) === pitch) return;
      options.pitch = pitch;
      if (state === "speaking") {
        stopInternal();
        state = "speaking";
        speakCurrent();
      }
    }

    function setLang(lang) {
      options.lang = lang || null;
    }

    function setVoice(voice) {
      // The page re-reads the voice list on every voices-changed event and
      // while it loads; re-applying the same voice must not restart (repeat)
      // the sentence that is being read.
      if (sameVoice(options.voice || null, voice || null)) { if (voice) options.voice = voice; return; }
      options.voice = voice;
      if (state === "speaking") {
        stopInternal();
        state = "speaking";
        speakCurrent();
      }
    }

    return {
      on: on,
      supported: supported,
      load: load,
      play: play,
      pause: pause,
      resume: resume,
      stop: stop,
      next: next,
      prev: prev,
      setRate: setRate,
      setPitch: setPitch,
      setVoice: setVoice,
      setLang: setLang,
      getState: getState
    };
  }

  // Voice privacy gate: without an explicit online-voice opt-in, only voices
  // the browser marks as local may be used and the ambiguous "browser
  // default" is never chosen silently. Returns the voice to use (null means
  // browser default, only returned when opted in) and whether playback must
  // pause for a deliberate online-voice choice.
  // True when a voice speaks the given language ("en" matches en, en-US, en_GB).
  function voiceMatches(v, lang) {
    var want = String(lang).toLowerCase();
    var l = String(v.lang || "").toLowerCase().replace("_", "-");
    return l === want || l.indexOf(want + "-") === 0;
  }

  // The user chooses the language (English United States by default); the
  // program never picks a language from the document and never falls back to
  // a voice of another language. Online voices are listed with local ones.
  // Default pick inside the chosen language: the first local voice, else the
  // first online one. A voice the user chose is kept; if it is missing from
  // the list (for example an online voice while offline) it is NOT replaced
  // silently: savedMissing is true and the caller must say so.
  function chooseVoice(voices, savedURI, lang) {
    lang = lang || "en-US";
    var all = voices;
    var eligible = voices.filter(function (v) { return voiceMatches(v, lang); });
    var locals = eligible.filter(function (v) { return v.localService !== false; });
    var onlines = eligible.filter(function (v) { return v.localService === false; });
    var r = { voice: null, needsChoice: false, savedMissing: false, localCount: locals.length,
              onlineCount: onlines.length, noLangVoice: all.length > 0 && eligible.length === 0 };
    if (savedURI) {
      for (var i = 0; i < eligible.length; i++) {
        if (eligible[i].voiceURI === savedURI) { r.voice = eligible[i]; return r; }
      }
      var known = all.some(function (v) { return v.voiceURI === savedURI; });
      if (!known && all.length > 0) { r.savedMissing = true; return r; }
    }
    // An online voice is never picked for the user: with no saved choice and
    // no local voice, the user has to choose one deliberately.
    r.voice = locals[0] || null;
    if (!r.voice && onlines.length) r.needsChoice = true;
    return r;
  }

  root.RATTS = { createEngine: createEngine, chooseVoice: chooseVoice, voiceMatches: voiceMatches };
})(typeof self !== "undefined" ? self : this);
