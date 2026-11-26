/*
 * Remembers where the last right-click landed so "Read from here" can start at
 * that exact word. It runs on every page, keeps one caret position in memory
 * and does nothing else: it reads no page text, stores nothing and sends
 * nothing. Top frame only.
 */
(function () {
  "use strict";
  if (window.__readAloudRC) return;
  var last = null;
  function caretAt(x, y) {
    if (document.caretPositionFromPoint) {
      var p = document.caretPositionFromPoint(x, y);
      return p ? { node: p.offsetNode, offset: p.offset } : null;
    }
    if (document.caretRangeFromPoint) {
      var r = document.caretRangeFromPoint(x, y);
      return r ? { node: r.startContainer, offset: r.startOffset } : null;
    }
    return null;
  }
  window.__readAloudRC = { get: function () { return last; } };
  document.addEventListener("contextmenu", function (ev) {
    var c = null;
    try { c = caretAt(ev.clientX, ev.clientY); } catch (e) { c = null; }
    last = c && c.node ? { node: c.node, offset: c.offset, target: ev.target, at: Date.now() } : null;
  }, true);
})();
