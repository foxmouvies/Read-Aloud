/* Test-only: file-injected listener, mirrors production read-page.js structure. */
(function () {
  if (window.chrome && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener(function (m, snd, send) {
      if (m && m.type === "PING2") { send({ pong: "file-injected" }); return true; }
    });
  }
  window.__ping2Loaded = true;
})();
