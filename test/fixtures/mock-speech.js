/*
 * Test-only mock of the Web Speech API, injected BEFORE the content script
 * in the e2e test so headless Linux (which has no speech voices) behaves
 * like a desktop browser: speak() accepts the utterance and "speaks"
 * forever until canceled. Not shipped with the extension.
 */
(function () {
  "use strict";
  var spoken = [];
  window.__mockSpeech = { spoken: spoken };
  // Content scripts run in an isolated world: window state is invisible to
  // the page's main world, but the DOM is shared. Mirror spoken text into a
  // hidden element so tests can read it from either world.
  function logToDom(text) {
    var el = document.getElementById("__mock_speech_log");
    if (!el) {
      el = document.createElement("div");
      el.id = "__mock_speech_log";
      el.style.display = "none";
      (document.body || document.documentElement).appendChild(el);
    }
    var span = document.createElement("span");
    span.textContent = text;
    el.appendChild(span);
  }
  window.SpeechSynthesisUtterance = function (text) {
    this.text = text;
    this.rate = 1;
    this.pitch = 1;
    this.voice = null;
    this.lang = "";
  };
  // window.speechSynthesis is a read-only getter; shadow it on the instance.
  Object.defineProperty(window, "speechSynthesis", {
    configurable: true,
    writable: true,
    value: {
      speak: function (u) {
        spoken.push(u.text); logToDom(u.text);
        // Auto-end mode (test sets the DOM flag before READ_PAGE): each
        // utterance ends almost immediately so playback advances through
        // every chunk and the log collects the full extracted text.
        // Default keeps speaking until canceled, like a real voice.
        var autoEnd = document.documentElement.getAttribute("data-mock-auto-end");
        if (autoEnd) {
          var ms = parseInt(autoEnd, 10);
          setTimeout(function () { if (u.onend) u.onend(); }, isNaN(ms) ? 2 : Math.max(ms, 1));
        }
      },
      pause: function () {},
      resume: function () {},
      cancel: function () {},
      getVoices: function () { return [{ name: "Mock Voice", lang: "en-US" }]; },
      onvoiceschanged: null
    }
  });
})();
