/*
 * "Read from here" context-menu item. Right-click a word, choose the item, and
 * reading starts at that word and continues to the end of the page text.
 * The page remembers the click (content/right-click-point.js); this script
 * only adds the menu entry and starts the reader in the clicked tab.
 */
(function () {
  "use strict";
  var ID = "readaloud-read-from-here";
  var INJECT_FILES = ["/shared/store.js", "/shared/text.js", "/shared/tts-engine.js", "/content/read-page.js"];

  function addMenu() {
    chrome.contextMenus.removeAll(function () {
      chrome.contextMenus.create({ id: ID, title: "Read from here (ReadAloud)", contexts: ["page", "selection", "link"] });
    });
  }
  chrome.runtime.onInstalled.addListener(addMenu);
  if (chrome.runtime.onStartup) chrome.runtime.onStartup.addListener(addMenu);

  function readFromHere(tab, info) {
    var inFrame = !!(info && typeof info.frameId === "number" && info.frameId > 0); // right-click was inside an embedded frame
    if (!tab || tab.id == null) return Promise.resolve();
    return chrome.scripting.executeScript({ target: { tabId: tab.id }, files: INJECT_FILES }).then(function () {
      // Runs in the same isolated world as the injected reader, so the
      // reader's handler is called directly (no runtime message needed).
      return chrome.scripting.executeScript({
        target: { tabId: tab.id },
        args: [inFrame],
        func: function (inFrameArg) {
          return typeof window.__readAloudMessage === "function"
            ? window.__readAloudMessage({ type: "READ_FROM_POINT", lang: "en-US", inFrame: inFrameArg }) : { ok: false, reason: "not-ready" };
        }
      });
    }).catch(function () { /* restricted page: nothing to read */ });
  }

  chrome.contextMenus.onClicked.addListener(function (info, tab) {
    if (info.menuItemId === ID) readFromHere(tab, info);
  });
  self.__raReadFromHere = readFromHere; // entry point for the automated tests
})();
