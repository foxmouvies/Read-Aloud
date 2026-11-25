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

    function setRate(rate) {
      options.rate = rate;
      // Rate only applies to new utterances; restart the current one if playing.
      if (state === "speaking") {
        stopInternal();
        state = "speaking";
        speakCurrent();
      }
    }

    function setPitch(pitch) {
      options.pitch = pitch;
      if (state === "speaking") {
        stopInternal();
        state = "speaking";
        speakCurrent();
      }
    }

    function setVoice(voice) {
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
      getState: getState
    };
  }

  // Voice privacy gate: without an explicit online-voice opt-in, only voices
  // the browser marks as local may be used and the ambiguous "browser
  // default" is never chosen silently. Returns the voice to use (null means
  // browser default, only returned when opted in) and whether playback must
  // pause for a deliberate online-voice choice.
  function chooseVoice(voices, savedURI, onlineOptIn) {
    var locals = voices.filter(function (v) { return v.localService !== false; });
    var onlines = voices.filter(function (v) { return v.localService === false; });
    if (savedURI) {
      for (var i = 0; i < voices.length; i++) {
        if (voices[i].voiceURI === savedURI) {
          // A saved online voice never bypasses the opt-in.
          if (voices[i].localService !== false || onlineOptIn) {
            return { voice: voices[i], needsChoice: false, localCount: locals.length, onlineCount: onlines.length };
          }
          break;
        }
      }
    }
    if (locals.length) return { voice: locals[0], needsChoice: false, localCount: locals.length, onlineCount: onlines.length };
    if (onlineOptIn) return { voice: null, needsChoice: false, localCount: 0, onlineCount: onlines.length };
    // No local voices and no opt-in: caller must explain and offer the choice.
    return { voice: null, needsChoice: onlines.length > 0, localCount: 0, onlineCount: onlines.length };
  }

  root.RATTS = { createEngine: createEngine, chooseVoice: chooseVoice };
})(typeof self !== "undefined" ? self : this);
