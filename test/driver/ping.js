/* Test-only: manifest-declared content script for message-delivery diagnosis. */
chrome.runtime.onMessage.addListener((m, snd, send) => {
  if (m && m.type === "PING_DECLARED") { send({ pong: "declared" }); return true; }
  if (m && m.type === "PING_ASYNC") {
    setTimeout(() => { try { send({ pong: "async-declared" }); } catch (e) {} }, 500);
    return true;
  }
});
