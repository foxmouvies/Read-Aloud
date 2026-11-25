/*
 * ReadAloud local persistence (chrome.storage.local only - never sync, no
 * network). Stores ONLY: rate/pitch/voiceURI settings, and reading positions
 * (page origin+path or file name+size -> sentence index). Never stores
 * document text, full URLs with queries, or history beyond the 50-entry cap.
 * Entries expire after 90 days; the popup's Clear button wipes everything.
 * Falls back to in-memory state where chrome.storage is unavailable (tests).
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.RAStore = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var MAX_POSITIONS = 50;
  var MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000; // 90 days
  var memory = {}; // fallback when chrome.storage is unavailable

  function backend() {
    try {
      if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
        return chrome.storage.local;
      }
    } catch (e) { /* no access */ }
    return null;
  }

  function getArea(keys, cb) {
    var b = backend();
    if (b) { b.get(keys, function (r) { cb(r || {}); }); return; }
    var out = {};
    keys.forEach(function (k) { if (memory[k] !== undefined) out[k] = memory[k]; });
    setTimeout(function () { cb(out); }, 0);
  }

  function setArea(obj, cb) {
    var b = backend();
    if (b) { b.set(obj, function () { if (cb) cb(); }); return; }
    Object.keys(obj).forEach(function (k) { memory[k] = obj[k]; });
    if (cb) setTimeout(cb, 0);
  }

  function removeAll(cb) {
    var b = backend();
    if (b) { b.remove(["settings", "positions"], function () { if (cb) cb(); }); return; }
    delete memory.settings; delete memory.positions;
    if (cb) setTimeout(cb, 0);
  }

  // Position keys: page = origin+path only (no query/fragment, which can
  // carry tokens); file = name+size (no path, no content).
  function pageKey(url) {
    try {
      var u = new URL(url);
      return "page:" + u.origin + u.pathname;
    } catch (e) { return null; }
  }
  function fileKey(name, size) {
    return "file:" + String(name || "") + ":" + String(size || 0);
  }

  function prune(positions) {
    var now = Date.now();
    var entries = Object.keys(positions).map(function (k) { return [k, positions[k]]; })
      .filter(function (e) { return e[1] && typeof e[1].i === "number" && (now - (e[1].t || 0)) < MAX_AGE_MS; });
    entries.sort(function (a, b) { return (b[1].t || 0) - (a[1].t || 0); });
    var out = {};
    entries.slice(0, MAX_POSITIONS).forEach(function (e) { out[e[0]] = e[1]; });
    return out;
  }

  var Store = {
    MAX_POSITIONS: MAX_POSITIONS,
    pageKey: pageKey,
    fileKey: fileKey,
    loadSettings: function (cb) {
      getArea(["settings"], function (r) {
        var s = r.settings || {};
        cb({
          rate: typeof s.rate === "number" ? s.rate : null,
          pitch: typeof s.pitch === "number" ? s.pitch : null,
          voiceURI: typeof s.voiceURI === "string" ? s.voiceURI : null,
          onlineOptIn: s.onlineOptIn === true
        });
      });
    },
    saveSettings: function (settings, cb) {
      getArea(["settings"], function (r) {
        var s = r.settings || {};
        if (typeof settings.rate === "number") s.rate = settings.rate;
        if (typeof settings.pitch === "number") s.pitch = settings.pitch;
        // Keys that are present are applied, including explicit clears: a
        // null voiceURI removes the saved voice (back to the default list
        // behavior) and onlineOptIn false revokes the opt-in. Keys that are
        // absent are left untouched, so partial saves (e.g. popup rate-only)
        // never wipe the voice choice or the opt-in.
        if ("voiceURI" in settings) {
          if (typeof settings.voiceURI === "string") s.voiceURI = settings.voiceURI;
          else delete s.voiceURI;
        }
        if ("onlineOptIn" in settings) s.onlineOptIn = settings.onlineOptIn === true;
        setArea({ settings: s }, cb);
      });
    },
    loadPosition: function (key, cb) {
      getArea(["positions"], function (r) {
        var p = prune(r.positions || {});
        var hit = p[key];
        cb(hit ? hit.i : null);
      });
    },
    savePosition: function (key, index, cb) {
      getArea(["positions"], function (r) {
        var p = prune(r.positions || {});
        p[key] = { i: index, t: Date.now() };
        p = prune(p);
        setArea({ positions: p }, cb);
      });
    },
    clearAll: removeAll,
    _prune: prune // exposed for tests
  };
  return Store;
});
